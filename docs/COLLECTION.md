# How this app collects stories, and what it has learned the hard way

This is the standing brief for any change that touches how articles get into
the reader. It exists because every failure in this area has been silent — no
error, no red test, just fewer stories than the publisher filed — and because
the same wrong instincts keep being reached for. Read it before changing
anything under "what this covers" below.

Everything numbered here was measured against the live deployment on the date
given, not assumed. When a measurement is stale, re-run it rather than trusting
the number.

**What this covers:** `lib/discover.ts`, `lib/article-link.ts`, `lib/scholarly.ts`, `lib/harvest.ts`, `lib/sitemap.ts`,
`lib/structured.ts`, `lib/sitesearch.ts`, `lib/authentic.ts`,
`lib/relevance.ts`, `lib/coverage.ts`, `lib/bundle.ts`, `lib/window.ts`,
`lib/publishers.ts`, `lib/scrape.ts`, `lib/feed.ts`, `app/api/feed/route.ts`,
`app/api/discover/route.ts`, `scripts/coverage.mjs`.

---

## 1. The goal, stated precisely

**Maximise the number of genuine articles caught within a time window.**

Not article count. Not archive depth. Not how full the list looks. The measure
is *recall inside a window*:

```
caught in the window ÷ published in the window
```

Four hundred stories spanning a year is worse coverage than a hundred from the
last day. The first is an archive that happens to be large; the second is a
newsroom's output caught in full. What a reader loses when collection degrades
is not volume — it is the stories filed since they last looked that never
arrived.

Three corollaries that have already caught real mistakes:

- **A bigger number is not a better result.** Any change justified by "it
  returns more articles" must be re-justified in terms of in-window recall, or
  it is not justified.
- **Padding is negative value.** Tag pages, nav links and duplicates raise the
  count and lower the precision. `lib/authentic.ts` exists for this.
- **Archive depth is a different feature.** The search routes reach years back.
  That answers a question; it does not improve coverage, and it must never be
  reported as though it did.

`lib/coverage.ts` implements this. It is the yardstick, not decoration.

### Where the denominator comes from

Nothing tells us what a publisher actually filed. Two approximations, in order
of trust:

1. **The news sitemap.** Publishers in Google News are obliged to list
   everything from roughly the last 48 hours. Closest thing to ground truth
   that exists — which is why it is worth reading even at sites whose feeds
   already collect well.
2. **The union of every route.** Where no sitemap exists, the best estimate is
   everything any route found. This measures *agreement between routes*, not
   truth: it cannot see a story every route missed. Say so when reporting it;
   `CoverageReport.basis` carries which one was used.

A thin sitemap does not get to define the window. If it holds fewer than
`max(10, 60% of the union)`, the union is used instead — otherwise the Verge's
17-item sitemap would score its much fuller feed at over 100% and hide real
losses.

---

## 2. The measurements (14 Sep 2026, via a temporary `/api/lab` probe on the deployment)

News sitemap vs. declared feeds, per publisher:

| Publisher | News sitemap | Items | Declared RSS | Notes |
|---|---|---|---|---|
| The Guardian | `/sitemaps/news.xml` (robots) | **431** | 1 | every guessed path 404'd |
| New York Times | `/sitemaps/new/news.xml.gz` | **442** | 1 | 25 sitemaps in robots.txt |
| CNN | `/sitemap/news.xml` | **108** | **0** | sitemap is the only structured route |
| BBC | index, 39 sitemaps | index | **0** | needs index descent + edition picking |
| Washington Post | 7 sitemaps | — | — | HTML too slow to read in budget |
| The Verge | `/sitemaps/google_news` | **17** | 1 | **feed carries more than the sitemap** |
| TechCrunch | `/news-sitemap.xml` | **11** | 1 | search feed a year deep |
| Ars Technica | none found | — | 0 | |
| Politico | — | — | — | 403 to robots.txt *and* HTML |
| WSJ | — | — | — | 401 on HTML and `/rss`; feeds only |

Also measured:

- **TechCrunch search feed**: `?s=openai&feed=rss2` → 20 articles spanning
  ~8,600 hours. Its news sitemap held 11 items from two days; its RSS held 20
  from a week. Neither can answer a question about the archive.
- **`SearchAction` in JSON-LD** is real and present (TechCrunch ships
  `WebSite` → `potentialAction`), giving the site's own search URL in the
  publisher's own words.
- **Feed windows**: WSJ markets turns over in under 2 days; tech press 3–5
  days; independent blogs weeks; government newsrooms months.
- **Item count is not window coverage.** The Guardian's `/us/rss` returns 131
  items — but spanning 598 days, of which only **87 fall in the last 48 hours**.
  Its news sitemap lists 431, effectively all of them in-window. Judging that
  feed by its item count would have called it healthy.

### Live result of the union (14 Sep 2026, `/api/feed` coverage report)

Following `theguardian.com/us/rss` as a source:

| Route | In-window stories | Found by no other route |
|---|---|---|
| news sitemap | 400 (hit the read cap; the site lists 431) | **317** |
| the RSS feed | 87 | 4 |

The feed alone was catching roughly a fifth of the window. The recall figure
in that report reads `1.0` with `referenceTruncated: true`, which means *upper
bound*, not *perfect* — see §1.

### Reading a walled publisher through an aggregator (14 Sep 2026)

AP refuses every server request, so the routes in §3 have nothing to read. The
question becomes which aggregator's index of that publisher is freshest, and
that is a measurement like any other:

| Route | Items | Newest | Span |
|---|---|---|---|
| Google News, `site:apnews.com when:2d` | **100** | **47 min** | 46h |
| Google News, `site:apnews.com when:7d` | 100 | 50 min | 167h |
| Bing, `site:apnews.com` | 12 | 8h | 19h |

Three things in that table decided the shape:

- **Google News over Bing, against the standing preference.** `lib/discover.ts`
  prefers Bing for topic feeds because Bing's wrapper carries the publisher's
  URL in a query parameter and Google's does not (a token only a browser can
  resolve). That reasoning holds for topics and loses here: for a wire service,
  twelve items eight hours stale is not the same product as a hundred items
  fifty minutes old. Where the publisher's own text is unreachable anyway — AP
  403s the article too — the link was never going to be readable in the app,
  so freshness is the only axis left.
- **The `when:` window is a density knob, not a depth knob.** Google returns at
  most 100 items and spreads them across whatever window is asked for: one day
  is ~100/day, seven days is ~14/day. Two days is the compromise, and
  `lib/window.ts` makes the choice cheap — each refresh merges into what the
  device already holds, so a narrow window loses nothing between visits.
- **Scope must be recorded as `section`, whatever the source really is.** The
  feed's host is Google's. Sitemap augmentation aimed at it would gather
  nothing and ask Google for it on every refresh. This is the §3 rule ("a
  section must stay a section") arriving from a third direction: what `scope`
  controls is where collection is *pointed*, not how broad the source reads.

An aggregator's feed also lies about two things, and both are corrected in
`parseFeed`: it appends the publisher to every headline (removed using the
item's own `<source>` element, never by guessing at the last dash), and its
description is the headline again inside a link (dropped when it only repeats
the title). The channel description names the aggregator, so a known-publisher
entry carries its own `note`.

### A publication whose own site cannot be read, but whose feed can (25 Sep 2026)

Pirate Wires was asked for by its technology section,
`piratewires.com/c/technology`. What the routes in §3 found there:

| Route | Result |
|---|---|
| `piratewires.com/c/technology` | 429, "Vercel Security Checkpoint" |
| `piratewires.com/robots.txt` | 429, the same page |
| …as Googlebot | 429, the same page |
| `piratewires.substack.com/feed` | **200**, 20 items, **full text** |
| `piratewires.substack.com/feed/s/technology` | 404 |

Three things that table decided:

- **A mirror on another host is a route, and often a better one.** The
  Substack feed carries 11k–26k characters of `content:encoded` an article —
  the whole piece, not a summary — so the reader never has to reach
  piratewires.com to *show* an article, which is just as well because it
  cannot. Newest item the same morning, twenty items across about four days
  of a daily publication.
- **A section that has no feed does not get invented.** `/feed/s/technology`
  is a 404, no item carries a `<category>`, and Substack's own 404 page
  declares exactly one feed for this publisher. So there is no technology-only
  route, and the source is recorded as the whole publication under the
  publication's name. Naming it "Pirate Wires · Technology" because that is
  the URL someone pasted would be the WSJ bug of §4.1 — a site-wide feed
  wearing a section's name — and the preview's note says plainly that one feed
  covers everything they file.
- **Scope follows what the source holds, not the URL that was pasted.**
  Recorded `site`, because it genuinely is everything. Compare AP, recorded
  `section` though it is a whole wire, because *there* scope had to stop
  sitemap collection being pointed at Google's host. Scope is about where
  collection is aimed, and the two cases pull in opposite directions.

### A section with no feed, listed only in a plain sitemap (26 Sep 2026)

`institute.deepmind.com/essays` redirects to a 57KB minified homepage with
unquoted attributes, declares no feed, and `/feed`, `/rss.xml`,
`/essays/rss.xml` and `/feed.xml` all 404. robots.txt names one plain
`/sitemap.xml` (homepage + eight essays under `/essays/<slug>/`, no news
block). Discovery now tries robots-declared sitemaps before scraping a
section (and after the outlet directory for a bare domain), keeps only
entries under the pasted path, and records the path in the source's
fragment (`sitemap.xml#within=%2Fessays%2F`) so refresh keeps it a section.
Titles and dates come from each page's `og:title` and
`article:published_time` — only for plain sitemaps, never news ones, which
already carry both and list hundreds. `lib/enrich.ts` now reads unquoted meta
attributes; minified pages ship them.

### An article folded behind "Read more" (1 Oct 2026)

`finance.yahoo.com/news/mark-zuckerberg-expands-300m-hawaii-191500262.html`
read as 478 words of a "4 min read". The page carries the whole story, but
everything after the first few paragraphs sits in `<div class="read-more-wrapper"
style="display: none">` behind a "Story Continues" button, and Readability skips
hidden elements. `unfoldReadMore()` in `lib/article.ts` now unhides a hidden
block only when its class, id or test id names it as the continuation and it
holds real paragraphs — other hidden content, modals included, stays hidden.
The same story then reads as 771 words. `EXTRACT_VERSION` went to 3 so the
truncated copies on devices and at the edge are fetched again.

### A help-centre article whose list vanished (4 Oct 2026)

A support.claude.com article (an Intercom help centre) read with its intro and
closing paragraphs but none of the six-item list between them, plus the
site's breadcrumbs and "Related Articles". Measured from the deployment: the
list is an ordinary `<ul>`, wrapped in `div.intercom-interblocks-unordered-nested-list`.
Readability scores any class containing `com-` as a comment block, and
"intercom-" contains it, so the list was discarded as comments.
`tidyForReadability()` in `lib/article.ts` now takes the `intercom-` prefix
off class names before scoring and removes breadcrumb trails and
related-articles lists. `EXTRACT_VERSION` went to 6 to drop the cached copies.

### A link to one story (9 Oct 2026)

Discovery read any path below the domain as a section, so a pasted
article was looked for a feed at its own address (none exists) and then
scraped as a listing — which on an article page is its related-stories
rail and navigation: §6's "heuristic that picks nav". An article is not a
source; the outlet that published it is. `lib/article-link.ts` now
recognises one — by the page's own markup (JSON-LD `NewsArticle` and
kin, or `og:type=article` with a publish date or an article-shaped
address), or, when the page cannot be read, by an address that is
unmistakably a story (a dated path, or a long hyphenated headline slug).
The feed is then looked for where the story sits: its section (the path
above it, dates and containers like `/stories/` taken off — recorded as
`section` only if a feed actually answers there), then the site's
declared and conventional feeds, the outlet directory, and a declared
sitemap. The story page is never scraped, and a story's own comment feed
is never taken for the outlet's. The preview says which story the feed
was found from.

`news.stanford.edu/stories/2026/10/bladder-cancer-urine-test-research`
was the case, and is also a wall — see §8.

### Research: journals, preprints and papers by link (11 Oct 2026)

Asked for: neuroscience and philosophy journals, arXiv, "perhaps Google
Scholar", addable from the directory or by pasting a link. Measured from a
preview deployment with a temporary probe, three rounds, removed the same day.

**Publishers will not show a server a paper.** nature.com answers an article
with a "Client Challenge"; jneurosci.org, cell.com, Wiley, Oxford
(academic.oup.com), ScienceDirect and PhilPapers answer 403 to their pages;
bioRxiv answered 429. So a pasted paper cannot be read to learn its journal,
and `lib/scholarly.ts` works from what the link says: an arXiv id or listing,
a bioRxiv collection or DOI, a DOI in any of the shapes publishers put one
(doi.org, `/doi/…`, Springer's `/article/10…`, PLOS's `?id=`, Nature's and
eLife's article ids), an Elsevier PII, or an address under a journal the
directory holds. The journal is then looked up — one Crossref call, which a
paste can afford — never fetched.

**Their feeds mostly do answer**, and the directory holds the ones measured:

| Route | Result |
|---|---|
| Nature (neuro, nrn, nathumbehav, subject feeds) | 8–30 items, newest 8–11 Oct |
| Cell Press `inpress.rss` (Neuron, Cell, Curr Biol, TINS, TICS) | 16–94 items, dated |
| ScienceDirect `rss.sciencedirect.com/publication/science/<issn>` | answers, **every item undated** — not used |
| Wiley `/feed/<issn>/most-recent` (Noûs, PPR, Mind & Language, Compass) | 9–51 items |
| Taylor & Francis `/feed/rss/<code>` (AJP) | 107 items |
| eLife, PLOS, eNeuro, J Neurophysiology, Science and PNAS eTOCs | answer, dated |
| jneurosci.org RSS, PNAS topic feed | 403 / error page |
| Springer `search.rss` | two journals answered, Synthese got a bot check — not used |
| bioRxiv/medRxiv `connect.*rxiv.org/*_xml/<subject>` | 404 — gone |
| PhilPapers, PhilArchive, NDPR feeds | 403 / 404 |
| arXiv RSS, every category | **0 items** on a Sunday: it lists only the latest announcement |

What fills the gaps, all measured the same day:

- **arXiv's API** answered every category with its newest twenty. Categories
  are followed through it (`api:arxiv?q=cat:…`), not RSS.
- **bioRxiv's API**, by date range and subject: 237 neuroscience records in
  five days, 155 of them new papers, oldest first, thirty a page. The
  provider reads the newest end and keeps first versions only.
- **OpenAlex** by ISSN, for journals whose feeds refuse: J Neurosci,
  NeuroImage, Brain, Cerebral Cortex, Mind, Phil Review, J Phil, Ethics, Phil
  Studies, Synthese, Erkenntnis, BJPS — each with that week's papers.
  **But it rate-limits a burst**: the twelfth request of a quick run got 429
  (its error names credits and a daily budget), and the same request answered
  minutes later. So: two requests at a time per service, one retry after the
  pause asked for, and **Crossref as the fallback** for a journal (it answered
  for Phil Quarterly, Ergo and Philosophy of Science while OpenAlex was
  refusing). Crossref also rate-limits concurrency (two of four parallel calls
  got 429), which is why it is the fallback and the single paste-time lookup,
  not the backbone.
- **Google Scholar has no API and no feed**, and refuses automated access;
  its alerts are email only. OpenAlex's search (`api:openalex`, title and
  abstract, optionally one field) is the open stand-in. Semantic Scholar's
  search needs a key (429 without one) and its date sort led with
  future-dated records.
- Philosophers' Imprint is left out: OpenAlex lists its new papers as
  "Title Pending".

None of this is in the ranking panel, and research categories are kept out of
`frontOutletForHost`: a bare `jneurosci.org` is found by the research rung,
and some of these entries are API sources, not feeds.

### Every discipline, and the directory audited (12 Oct 2026)

Asked for: journals in every discipline — economics, psychology, sociology,
political science, anthropology "and more" — added and checked. Measured
from a preview deployment with a temporary probe, removed the same day; the
directory audit now reports each entry's newest date, not only whether it
answered, so a quiet entry shows up as one.

**Which publishers serve a server their tables of contents:**

| Publisher | Route | Result |
|---|---|---|
| Wiley (incl. AGU, ESA, RAI, AnthroSource) | `/feed/<eissn>/most-recent` | answered for all 13 asked |
| University of Chicago Press | `/action/showFeed?…&jc=<code>` | answered for all 10 |
| SAGE | `/action/showFeed?…&jc=<code>` | answered; the code is the `/home/<code>` path |
| Taylor & Francis, APS, ACP, NEJM, the Lancet, JAMA, the BMJ | their own feeds | answered, dated |
| Nature (`<code>.rss`) | | answered alone every time; **a burst got HTML** |
| Annual Reviews, AEA, ACS, CACM, Yale LJ, OJS (Cultural Anthropology) | | 403, timeout or 404 |
| RSC (Chemical Science), NBER | | answer, **every item undated** |
| JMLR | | every paper dated as its volume — a year old |
| EarthArXiv `/feed/` | | other journals' papers: not EarthArXiv's |

**OpenAlex costs money now.** Its answers carry `x-ratelimit-limit: 1000`,
`x-ratelimit-limit-usd: 0.1` and `x-ratelimit-cost-usd: 0.0001`: a thousand
list requests a day without a key, reset at midnight UTC. Every journal
followed by ISSN spends one per refresh. So a publisher's own feed is used
wherever one answered, and ISSN only where none did.

**Crossref allows one request at a time** (`x-concurrency-limit: 1`, five a
second, on every answer). Three probe batches at two each drew 429 on most
calls. `lib/apis.ts` now sends Crossref one request at a time.

**A year is not a date.** OpenAlex dated every 2026 paper in the Journal of
Philosophy, BJPolS, Sociological Science and Representations as 1 January,
then sorted them — a year's papers in no order, the newest missing — so the
Journal of Philosophy looked nine months quiet while Crossref showed papers
registered on 9 October. Crossref's `created` (registration) is exact; a
journal like that is read from Crossref first (`via=crossref`), newest
registered first, and a year-only date takes the registration moment when it
falls in that year. A 2011 paper registered last week keeps 2011.

The same reading put Mind and Cerebral Cortex on Crossref too: OpenAlex's
newest Mind paper was 30 July, Crossref's published online 23 September;
Cerebral Cortex 22 September against 12 October. A registration sort brings
back old back issues as well — New Literary History's newest was from 1994 —
so Crossref is asked for the last year only. New Literary History itself
was left out: Crossref has nothing of it from the past year (it publishes
through Project MUSE) and OpenAlex dates it by the issue, so it would only
ever look quiet. LawArXiv's newest preprint was May 2025; the OSF server is
still in the API directory, the directory entry is not.

**Furniture is not a paper.** Philosophy of Science's newest "paper" was
"Cover and Front matter"; Ergo's were "Title Pending 12682". The research
APIs drop covers, front and back matter, issue information, mastheads and
placeholder titles; an answer with nothing left asks the other service, as
an error does. A publisher's feed is left alone — §3, "a feed item is an
article by declaration".

**OSF preprints** (PsyArXiv, SocArXiv, EdArXiv, LawArXiv and others) answer
`api.osf.io/v2/preprints/` with published preprints newest first and their
authors embedded, about a second a page. First versions only, as for bioRxiv.

**arXiv's archives.** `cat:astro-ph` matches only filings to the pre-2009
archive itself: the directory's Astrophysics entry's newest paper was from
2019. `cat:astro-ph.*` is every subcategory, current to the day; the same
for `cond-mat` and the others that are only ever filed by subcategory.

**The directory's own audit**, all 221 entries, found 32 problems — none of
which any test could have seen:

| Problem | Entries | Done |
|---|---|---|
| frozen since 2023–25, still 200 | CNN (two), VOA, Jerusalem Post | Google News for CNN; JPost's front-page feed; VOA and CNN World dropped |
| 402 / 403 / 404 on the feed | Telegraph, Times of Israel, Kyiv Independent, Barron's, BleepingComputer, Lawfare, ESPN, Chicago Tribune, SF Chronicle, Denver Post, AJC, Dallas News, Miami Herald, AZ Central | Google News, two days (seven for Lawfare, which files less) |
| moved | ABA Journal, Canary Media, Boston Globe, Inquirer, CDC | the measured new address |
| refuses, no route | Engadget (Google lists its section pages), SEC (needs a declared contact) | dropped |
| research | Astrophysics, Journal of Philosophy, Ergo, Philosophy of Science | above |

A saved source pointing at one of those dead addresses is rewritten to its
replacement when the device loads its list (`RETIRED_FEEDS`,
`repairSources`), by exact address only. CNN World is not: no route answers
for the section alone, and the whole of CNN in its place would be the
plausible substitute of §6.

**Feeds are fetched two at a time per host** (`lib/feed.ts`), and a feed's
address answered with a web page is asked once more before anything else is
done with it (`fetchFeedText`, used by the refresh and the audit alike). A
reader following six Nature journals sent nature.com six requests at once,
and some came back as HTML; two at a time was not enough on its own — the
audit of the finished directory still saw two Nature feeds answered with a
page — which is why the retry is there.

What that page was, read from a preview: nature.com had sent the feed's
request through its sign-in host (`idp.nature.com`) to set a cookie and back,
and a client that keeps no cookies landed on `?error=cookies_not_supported`.
Discovery then scraped that page into a "feed" of error icons. The retry
now carries the cookie the site set along its own redirects — the site's own
cookie, to the site's own hosts, as any feed reader with a cookie jar does;
nothing here pretends to be a browser — and a feed's address that still
answers with a page is a failure for the refresh, never a page to scrape.
nature.com gets one request at a time: two together still drew the
challenge for one Nature feed in four. Enrichment, which reads each
article's page for its picture, skips a bot or cookie check
(`lib/challenge.ts`) — it had given every Nature story the challenge
page's error icon as its image.

The finished directory — 356 entries, 198 of them research across 22
disciplines — was audited from the preview the same afternoon: every entry
answered, every research entry with a dated paper, and the newest within
days for all but the quarterlies and the academic calendar (Harvard Law
Review's last issue was June; it resumes in November).

### A refresh that answered nothing (12 Oct 2026)

A phone refreshed All articles, waited, and got nothing new. The runtime
logs had four `Task timed out after 60 seconds` on `/api/feed` in an
hour. The refresh was one request carrying every source the reader
follows, and a function stopped at its limit answers nothing — the
two-second sources lost along with the slow ones.

What made it slow was that morning's per-host queue (above, "two at a
time per host"). It had been put on every page fetch, not just feeds, and
a refresh also reads up to fifteen article pages a source for their
pictures. So a reader's Nature journals queued every Nature story page
behind one another, one at a time, and the Google News sources did the
same on news.google.com, two at a time. Measured from production and from
a preview of the fix, the same requests minutes apart:

| Request | Production | Fix |
|---|---|---|
| six Nature journals | 22 s | 3 s |
| thirty sources (Google News, Wiley, Nature, NPR) | **timed out at 60 s** | 2 s, 28 of 30 answered |

And the page reads it was queueing found nothing: ten Wiley journals, 495
papers, not one picture; ten Google News sources, 889 stories, none.
Publishers' pages refuse a server (§8), and a Google News link is a token
only a browser resolves.

What changed, and why each:

- **The per-host queue is for feeds only** (`fetchFeedText`), which is
  what it was measured for.
- **Papers and Google News links are not read page by page**
  (`readsPages`, `lib/enrich.ts`). Their feeds carry the abstract or
  headline; the pages were all cost.
- **A request answers by 45 seconds with what it has**
  (`lib/deadline.ts`). A source still reading is reported as "Took too
  long to answer", page reads and the sitemap merge give way to the clock,
  and the rest of the request is not held for them. The held window keeps
  a slow source's stories, and `mergeWindow` now keeps a held story's
  picture when a fetched copy lacks one: an empty value never overwrites a
  real one, as in `combine()`.
- **The device sends a refresh in groups** (`lib/refresh.ts`): eight
  sources a request, six requests at a time, one host's sources together
  and its groups dealt apart. The list fills in as each group answers, and
  a group that fails costs only its own sources. The counter on the
  "Checking for new articles" pill is sources answered so far.
- **Research services are asked every two hours, not every visit**
  (`isDue`). OpenAlex allows a thousand requests a day without a key and
  every journal followed by ISSN spends one a refresh; sixty journals on
  a phone opened twenty times a day would spend it by the afternoon, and
  every journal would then wait on the one-at-a-time Crossref fallback.
  A failure is asked again at once. Feeds are free and are always asked.

Still open from the same measurement: Nature Human Behaviour and Nature
Communications' neuroscience feed answered with a web page every time,
alone or together, through the cookie retry and through
`feeds.nature.com`. The other Nature feeds answered.

### What those numbers mean

**No ordering of routes wins everywhere.** Sitemaps-first loses stories at the
Verge; feeds-first loses three hundred at the Guardian. This is the entire
argument for the union design, and it is why the old "ladder" shape — try each
route, return the first that answers — was right for *identifying* a source and
wrong for *collecting* from one.

---

## 3. The architecture, and why each piece is shaped that way

```
identify  lib/discover.ts    an ordered ladder — first answer wins
collect   lib/harvest.ts     every route in parallel — all answers merge
judge     lib/authentic.ts   is this a story or is it furniture
match     lib/relevance.ts   does it answer what was asked
score     lib/coverage.ts    what share of the window did we catch
hold      lib/window.ts      keep what the feed has since dropped
```

Discovery stays a ladder because its job is to answer "what is this thing the
user pasted, and what should it be called". Collection is a union because its
job is "get everything". Do not merge these two shapes.

**Merging is field-by-field, not winner-takes-all.** The sitemap knows the
headline and the exact publication time; the feed knows the summary and the
image; the scrape knows almost nothing. `combine()` in `lib/harvest.ts` takes
the best of each. Two rules in it that were bugs first:

- An empty string never overwrites a real value.
- The *earliest* publication date wins. Sitemap `lastmod` drifts forward every
  time a story is touched; the first date is the truth.

**A feed item is an article by declaration.** Shape heuristics exist to judge
links we found ourselves. Applying them to something the publisher put in their
own feed means overruling the only party who actually knows — plenty of blogs
publish at `/a-post` with a four-word headline. `lib/authentic.ts` trusts
`from: "feed"` and skips the structural penalties.

**A section must stay a section.** A site's news sitemap lists the whole
newsroom, so merging it wholesale into "BBC Technology" would quietly turn it
into "BBC" — the same failure as the WSJ bug, arriving from the other
direction.

This was first attempted by *inferring* scope from the path a source's own
stories share (`sharedPathPrefix()`), and that was wrong. It works only where
a publisher's URLs carry their section. The BBC files every story at
`/news/articles/<id>`, so its technology feed is indistinguishable from a
site-wide one, and the technology source filled up with football.

**Scope is therefore recorded, not guessed.** `Source.scope` is captured at
the moment a source is added, because that is the only moment anything knows
it: by refresh time all that is left is a feed URL. The refresh passes
`&whole=` for site-scoped sources only, and augmentation is off by default.
`sharedPathPrefix()` remains as a second line of defence, not the first.

The general rule this produced: **where guessing wrong means collecting the
wrong thing, do not guess — carry the fact from where it was known.**
Collecting less is recoverable; a source that silently became a different
source is not.

**Bundles.** One source may name several feeds (`bundle:` + encoded members).
Everything about a source stays inside one string, so refresh, dedupe, offline
and sync never had to learn a new shape. Follow that pattern for anything
similar.

---

## 4. Rules that came from specific failures

Each of these is a bug that shipped. Do not undo them.

1. **Never let a preview's meta become the saved source.** Discovery previews a
   bundle by reading its members and was returning the meta of whichever
   section answered first — the preview showed every desk, and saving it
   followed one desk for ever. The saved source is always *what was asked for*.
2. **Never replace the held list with the current feed window.** `refresh()`
   used to do this, so anything published and pushed out between two visits was
   never seen. `lib/window.ts` merges; 14 days, capped per source so a busy desk
   cannot crowd out a weekly column.
   The age cut never empties a source: each keeps its newest ten however old
   (`KEEP_NEWEST`). journal.nyphilosophy.org, a weekly whose latest essay was
   a month old, previewed twenty and refreshed to none (28 Sep 2026).
3. **Dedupe before capping, never after.** The same story under two tracking
   tags is two stories unless links are canonicalised first, and a cap spent on
   duplicates is coverage thrown away silently.
4. **Cap per source, not overall.** A desk filing hourly will otherwise push a
   weekly column out of a list it belongs in.
5. **Tolerate partial failure.** A publisher that 403s its sitemap while serving
   its feed must give us the feed. Half a paper beats an error where the rest of
   it would have been.
6. **A known-publisher entry comes before everything.** `wsj.com` would
   otherwise be crawled into a 401, and the word "wsj" would become a news
   search. The outlet directory is the same fact in bulk: it holds an audited
   feed for 160-odd domains, and discovery now falls back to it for a bare
   domain whose feeds cannot be found by looking. `cnbc.com` is the case —
   CNBC serves RSS from `search.cnbc.com/rs/search/combinedcms/view.xml?id=…`,
   which is neither declared in the HTML nor guessable from a path, so every
   candidate 404'd and the reader was handed a scrape of the front page. The
   rung sits *after* the feed probing and *before* the page scrape: a verified
   feed beats a heuristic, and a site that answers for itself still wins. Only
   for a bare domain — a section URL with no feed is better scraped than given
   a site-wide feed wearing the section's name.
7. **Order the discovery ladder deliberately.** Subreddits before URLs
   (`reddit.com/...` would be scraped as a page); X before URLs (login wall);
   topics last.
8. **A story two sources deliver belongs to both.** It is shown once, but it
   is filed under its publisher's own source and carries the others in
   `alsoIn` (`lib/attribute.ts`). The dedupe used to hand it to whichever
   source came first in the refresh, so a news search for "OpenAI" listed
   before `openai.com/news/rss.xml` took every story from it: the OpenAI
   source showed nothing while its feed answered 250 stories, and Source
   status called it healthy because it judged the fetch, not what was held
   (9 Oct 2026). A good fetch with nothing held is now *broken*.
9. **Report what a filter removed.** Collection fails silently by nature. A
   count of what was dropped, and why, is the difference between noticing and
   not. `keepArticles()` returns both halves for this reason.

---

## 5. How to verify anything here

**The build sandbox cannot reach the internet.** This is not an inconvenience;
it is precisely how a source stops working without a single test going red.
Every real finding in this area came from reading a live response.

Four layers, each answering a question the others cannot:

| Layer | Command | Answers |
|---|---|---|
| Fixtures | `npm test` | does the parsing still work |
| Live coverage | `npm run coverage <deployment>` | does the internet still behave |
| Browser | Playwright on `next start` | does the interaction work |
| Telemetry | Settings → Source status (per device) | is a source drifting, dying or losing access |

To measure a real site from here, go through the deployment — add a temporary
`/api/lab`-style probe (robots.txt sitemaps, news-sitemap candidates and their
item counts, declared feeds, JSON-LD types, and a feed's window), deploy, read
it with the Vercel fetch tool, and remove it in the same session. That is how
every number in section 2 was obtained, and the probe is deliberately not in
the repository: a permanent endpoint that fetches arbitrary URLs on request is
not something a reader app should carry.

`test/watchlist.json` is the accumulating record: whenever a source misbehaves
in real use, add an entry with what you expect of it. The entry becomes the
thing that notices the regression.

**Source status** (`lib/health.ts`, `components/StatusPage.tsx`) is the
per-device half of telemetry. Every refresh records, per source, what came
back — count, newest date, error and its HTTP status — and keeps the last 40
refreshes plus a 30-day daily roll-up. Verdicts, most serious first: *broken*
(nothing arriving, nothing cached), *losing access* (401/403/404/410 on
repeated refreshes while the cache hides it — the §6 "source that died after
it was added"), *degraded*, *declining* (under half the previous week's
typical count, or a newest story frozen across a week of refreshes — the §6
"fresh-looking stale feed"), and *quiet*, which is deliberately not called
broken. It stays on the device because the server never learns what a reader
follows.

The gap worth closing: the server sweep across 162 outlets already computes
per-source counts and freshness every run and throws them away. Retaining a
per-source-per-day roll-up would turn coverage from something you check into
something you can see drift.

---

## 5b. What the reader costs to run (21 Sep 2026)

Collection is not free, and the bill is mostly made of requests that fail.
Read from the deployment's runtime logs over seven days:

| | requests | share |
|---|---|---|
| `/api/article` 502 | **373** | 65% |
| `/api/article` 200 | 232 | 38% |
| `/api/article` 504 (`Task timed out after 30 seconds`) | **36** | 6% |
| `/api/sync`, `/api/team` | 15 | — |

Two thirds of everything the reader asked for came back as nothing, and
almost all of it was the background offline top-up rather than a person
opening a story. Three things made that as expensive as it was:

1. **Nothing remembered a failure.** The top-up runs on every visit, every
   return to the foreground and every reconnection, and re-asked for exactly
   the same dead articles each time. One publisher that refuses us, times
   fifteen articles a source, times however often a phone is picked up.
2. **A failure costs more than a success.** The route falls back twice —
   re-reading the source feed, then fetching the page again for its
   metadata — so a dead link is up to three outbound fetches and two DOM
   parses, where a live one is one of each.
3. **The fallbacks outlasted the function.** 15s + 10s + 12s is 37 seconds of
   budget inside a 30-second function, and a timeout bills the full thirty
   and returns nothing. The slowest failures were the most expensive.

What answers each, in `lib/offline.ts` and `app/api/article/route.ts`:
a failure is recorded with its status and left alone for six hours (a bad
afternoon) to seven days (a refusal); a host already measured as refusing is
never queued at all; one run fetches at most `MAX_PER_RUN`, so a device
catches up across visits instead of asking for twelve hundred articles at
once; every step gets the time actually left rather than its own timeout; and
a failure is cacheable at the edge for five minutes so a burst of retries
does not become a burst of invocations.

**A reader opening a story is never skipped** — only the background top-up
consults the back-off.

**The top-up is off by default** (12 Oct 2026), per device and not synced
(`loadAutoDownload`, `lib/offline.ts`): a desktop is rarely offline, and
the top-up was most of the bill above. With it off, only Saved stories
and subjects marked available offline are fetched in the background;
Download now still fetches everything, and a small run never prunes what
a full one kept. The rule is that the app may stop *guessing* at work,
never stop doing what someone asked for.

Re-measure from the logs rather than trusting this table: `get_runtime_logs`
grouped by `statusCode` is the whole check, and the ratio of 200s to 502s is
the number that says whether collection is paying its way.

---

## 6. Failure shapes to recognise

Every outage that has mattered here returned HTTP 200. Collection does not
crash, it thins out.

- **The plausible substitute** — a feed answers, carries real stories, and is
  the wrong feed. World News under the whole paper's name, for months.
- **The preview that lies** — the preview is assembled differently from the
  thing that gets saved.
- **The fresh-looking stale feed** — 200, well-formed, newest item nine days
  old. Indistinguishable from a quiet week without a written expectation.
- **The silent truncation** — a cap applied before a dedupe or a merge.
- **The heuristic that picks nav** — a scraper grabbing the wrong link group
  returns a full, confident, useless list.
- **The duplicate that eats the cap** — same story, two tracking tags.
- **The filter that ate the news** — an authenticity or relevance rule too
  strict, dropping real articles. `lostToFiltering` in the coverage report is
  the number that catches this.
- **The source that died after it was added** — the known-publisher table is
  consulted when a source is *added*, so a source saved while its feed worked
  keeps pointing at a URL that has since started refusing. Nothing reports it:
  the held window (§4.2) keeps fourteen days of what was collected before, so a
  dead source reads as a quiet one whose newest story is a few days old and
  getting older. This is how AP was reported. `repairSources()` in
  `lib/publishers.ts` rewrites the hosts measured dead when a device loads its
  list — and only those, because rewriting a working feed would be the
  plausible-substitute failure at the top of this list.
- **The retry that never gives up** — work that fails, is not recorded as
  having failed, and is therefore repeated on every visit for ever. Costs
  nothing visible and everything in the bill; see §5b.

---

## 7. Ground not yet covered

Weigh by coverage gained *within a window*, not by how clever it is.

- **WebSub / PubSubHubbub** — feeds declaring a hub push on publication,
  closing the between-visits gap at the source. Patchy adoption, skewed to
  independent publishers; strictly better than any poll interval where present.
- **Headless rendering** — the only route to client-rendered listings, which is
  the one category with no route at all today. Seconds per fetch; worth it as an
  explicit last resort for a few pinned sources, never as a default rung.
- **Listing-page diffing** — store the previous link set for a scraped source
  and treat new links as publications. Gives undated sites a real first-seen
  date. The window store already provides the storage this needs.
- **Newsletter ingestion** — a per-user ingest address. The only route to
  publications that have left the open web.
- **Publisher APIs / licensed wires** — authoritative and stable in a way no
  heuristic can be. Involves terms and usually money. For the two or three
  sources that matter most, price it rather than out-engineering it.
- **Per-site search as an auditor** — too noisy to follow directly, excellent
  for finding coverage gaps: anything it returns that the source did not is a
  gap with a name.

---

## 8. Walls we do not control

Some publishers refuse us, and no amount of engineering changes that. Record
them rather than re-discovering them:

- **WSJ** — 401 on HTML and on `/rss`. Dow Jones feed hosts are the entire
  available surface, which is why the bundle matters so much there.
- **Politico** — 403 on both robots.txt and HTML.
- **AP** — 403 on *every* path, robots.txt and all six sitemaps that robots.txt
  itself declares (14 Sep 2026). No user agent changes it; AP's own
  machine-readable route is its paid API. `feeds.apnews.com` no longer
  resolves, and the old app backend (`afs-prod.appspot.com`) answers but its
  feed endpoints are gone. Now in the known-publisher table via an aggregator —
  see §2, "Reading a walled publisher through an aggregator".
- **Reuters, USA Today, PBS** — absent from the outlet directory on purpose;
  see the note at the top of `lib/outlets.ts`. A directory entry that can never
  load is worse than an absence.
- **X** — login wall to logged-out visitors; the API is the only route.
- **Pirate Wires** — *their own domain only*. Measured 25 Sep 2026: every path
  on piratewires.com — `/c/technology`, an article, even `robots.txt` —
  answers **429** with a 31KB page titled "Vercel Security Checkpoint". It is
  a JavaScript challenge, not a rate limit: no `retry-after`, and identical as
  Googlebot and as a browser user agent. Nothing on that host is discoverable.
  Their Substack mirror is the route, and it is a good one — see below.
- **New York Times** — *articles only*, and the shape of it matters. Measured
  16 Sep 2026 from the deployment: `nytimes.com/` answers **200 with 1.25 MB**
  of real homepage, and every article URL answers **403**. Five header shapes
  against the same story — plain, browser-like `sec-ch-ua` + `sec-fetch`, with
  a nytimes.com referer, as Googlebot, as mobile Safari — all 403. So the
  refusal is not about the request's shape; it is the source, a datacentre
  address and a server's TLS fingerprint. Note what this rules out: the block
  lands *before* any cookie is read, so **a subscription cannot lift it** —
  there is no authentication step to reach. Its feeds and sitemap still list
  the stories, so NYT belongs in a reader's lists; the article opens on
  nytimes.com, where their subscription works.

- **SFGate (and bot checks generally)** — measured 2 Oct 2026 from the
  deployment: an article URL answers **200** with a page titled "Client
  Challenge" ("A required part of this site couldn't load…"), 35 words of
  it. Being a 200, it was read as the article, saved under that title by
  Paste story, and cached at the edge for a day. `isChallengePage()` in
  `lib/article.ts` now recognises these interstitials by title (Client
  Challenge, Just a moment…, Attention Required, Access Denied, Vercel
  Security Checkpoint, …) or by their wording on a short page, and treats
  them as the refusal they are; `EXTRACT_VERSION` went to 4 to drop the
  cached copies. A pasted link to such a site is still kept, titled from its
  address, and opens on the site. Passing the check means running the
  site's JavaScript challenge as a browser would — see below; we don't.

- **Stanford News (news.stanford.edu)** — measured 9 Oct 2026 from a
  preview deployment: every path — an article, `robots.txt`, `/rss`,
  `/feed`, `/rss.xml`, `/feed.xml`, `/stories/rss`, `/sitemap.xml`,
  `/sitemap_index.xml`, `/news-sitemap.xml` — answers **403** from
  `server: cloudflare` with a ~6KB page titled "Just a moment…" ("Enable
  JavaScript and cookies to continue"): Cloudflare's JavaScript challenge.
  Nothing on the host is discoverable from a server. Google News carries
  it: `site:news.stanford.edu when:7d` returned 12 items, the newest 45
  minutes old (headlines and Google's links only, as with AP). Bing's
  `site:` search returned none. The reader's own browser passes the
  check, so the extension's "scan it in" reads its articles.

- **YouTube transcripts** — measured 3 Oct 2026 from the deployment: the
  watch page answers a server **200** with 1.26 MB, but its player response
  says `playabilityStatus: LOGIN_REQUIRED`, "Sign in to confirm you're not a
  bot", and lists **no caption tracks**. That is a bot check on the source of
  the request; services that do get transcripts from servers do it through
  residential proxies or forged clients, which this app will not use (see
  below). The oEmbed preview (title, channel, thumbnail) still answers. The
  transcript comes from the reader's own browser instead: the extension reads
  the caption track or the "Show transcript" panel off the page
  (`extension/extract.js`, `__superReaderYoutube`), or the reader pastes the
  panel's text, whose times `lib/youtube.ts` turns into links into the video.

- **Scholarly publishers' pages** — measured 11 Oct 2026: nature.com
  articles (bot check), jneurosci.org, cell.com, Wiley, Oxford, ScienceDirect,
  PhilPapers and PhilArchive all refuse a server. Their feeds mostly answer;
  where they don't, a journal is followed by ISSN (§2, "Research").
- **Publishers' tables of contents, by publisher** — measured 12 Oct 2026:
  Annual Reviews, the AEA, ACS and CACM refuse or time out; Oxford,
  Cambridge and APA journals have no feed that answered. All of them are
  followed by ISSN (§2, "Every discipline").
- **SEC** — 403 to an undeclared client; sec.gov asks for a contact address
  in the user agent, which this app does not send on anyone's behalf.
- **Google Scholar** — no API, no feed, and it refuses automated access by
  design. Not integrated; OpenAlex stands in for it.

When adding a publisher that walls us, put it in the known-publisher table with
a route that works, or leave it out. Do not ship an entry that 403s.

**A subscription is the one wall a reader can open.** Where someone pays a
publisher, `lib/subscriptions.ts` stores one cookie per site in the encrypted
vault and `/api/article` attaches it to that fetch alone. Two rules hold it
together, and both were designed in rather than found:

- A page fetched with a credential is *that reader's* copy and is marked
  `private, no-store` on all three cache headers. This deployment is public
  behind a shared CDN; caching a subscriber's article would hand one person's
  subscription to whoever asked next. It is also never written to the offline
  store, nor is a walled preview — the cache is read before the network, so a
  stored stub would outlive the expired sign-in that produced it.
- A credential goes only to the host it was stored for, matched on a dot
  boundary so `wsj.com` never reaches `notwsj.com`.

Whether the copy we got is the whole article is read off the page, not guessed
from its length: schema.org `isAccessibleForFree` is the publisher's own
statement, and NYT, WSJ and the FT all ship it. That is what lets the reader
say "your subscription did not apply" instead of showing two paragraphs and
leaving the reader to wonder. A datacentre request can still be refused
whatever cookie it carries — the fallbacks are unchanged, so an outlet that
refuses behaves exactly as it did before.

**Where a refusal has been measured, say so rather than blaming the cookie.**
`REFUSES_SERVER_FETCH` in `lib/subscriptions.ts` holds those hosts with the
measurement behind each. Without it, the New York Times reads as an expired
sign-in, and someone spends an evening re-pasting a cookie that was never the
problem. Add a host only after measuring it, and record the numbers in §8.

**What this app will not do to get past one.** These blocks key on the source
of the request — datacentre IP ranges, the TLS fingerprint of a server's HTTP
client. Defeating that means impersonating a residential browser: proxying
through consumer connections, or forging a fingerprint. That is evading an
access-control decision the publisher has deliberately made, and it stays out
of this repository regardless of how good the reader's reason is. A paid
subscription is a reason to open the story on the publisher's own site, not a
licence to look like someone we are not.
