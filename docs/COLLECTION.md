# How this app collects stories, and what it has learned the hard way

This is the standing brief for any change that touches how articles get into
the reader. It exists because every failure in this area has been silent — no
error, no red test, just fewer stories than the publisher filed — and because
the same wrong instincts keep being reached for. Read it before changing
anything under "what this covers" below.

Everything numbered here was measured against the live deployment on the date
given, not assumed. When a measurement is stale, re-run it rather than trusting
the number.

**What this covers:** `lib/discover.ts`, `lib/harvest.ts`, `lib/sitemap.ts`,
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

## 2. The measurements (14 Sep 2026, via `/api/lab` on the deployment)

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
direction. Nothing stores whether a source is a section, so
`sharedPathPrefix()` infers it from the path the source's own stories share.
Fewer than four stories yields `/` and constrains nothing: two articles in a
folder is a coincidence, not a beat.

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
   search.
7. **Order the discovery ladder deliberately.** Subreddits before URLs
   (`reddit.com/...` would be scraped as a page); X before URLs (login wall);
   topics last.
8. **Report what a filter removed.** Collection fails silently by nature. A
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
| Telemetry | *not built* | is coverage drifting over time |

To measure a real site from here, go through the deployment — add a temporary
`/api/lab`-style probe, deploy, read it with the Vercel fetch tool, and remove
it in the same session. That is how every number in section 2 was obtained.

`test/watchlist.json` is the accumulating record: whenever a source misbehaves
in real use, add an entry with what you expect of it. The entry becomes the
thing that notices the regression.

The gap worth closing: the server sweep across 162 outlets already computes
per-source counts and freshness every run and throws them away. Retaining a
per-source-per-day roll-up would turn coverage from something you check into
something you can see drift.

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
- **AP, Reuters, USA Today, PBS** — absent from the outlet directory on
  purpose; see the note at the top of `lib/outlets.ts`. A directory entry that
  can never load is worse than an absence.
- **X** — login wall to logged-out visitors; the API is the only route.

When adding a publisher that walls us, put it in the known-publisher table with
a route that works, or leave it out. Do not ship an entry that 403s.
