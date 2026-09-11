# Super Reader

A lightweight RSS reader. Paste a website, a Substack, or an RSS link — or just
type a topic — preview what you'd get, and keep it in a named feed.

**Live:** https://super-reader-nathan-kuczmarskis-projects.vercel.app

No accounts, no database, no AI. Your feeds live in your browser's
`localStorage`; the server only fetches and parses XML.

## Running it

```bash
npm install
npm run dev     # http://localhost:3000
```

```bash
npm run build && npm start   # production
npm test                     # parser + discovery tests
```

## How it works

**Adding a source** (`lib/discover.ts`) resolves whatever you paste:

1. **A topic** ("semiconductors") → a Bing News search feed for that term.
   Not Google News: it wraps every result in a link that only resolves inside a
   browser running its JavaScript, so those articles cannot be opened in the
   reader at all. Bing's wrapper carries the publisher's URL in a query
   parameter, which is unwrapped back to a direct link.
2. **A feed URL** → parsed directly.
3. **A website** → looks for `<link rel="alternate" type="application/rss+xml">`
   in the page's `<head>`, then falls back to conventional paths (`/feed`,
   `/rss.xml`, `/index.xml`, …) that cover Substack, WordPress, Ghost, Hugo and
   Jekyll.
4. **A newsroom that hides its feed** → many sites, government ones
   especially, link their feed as an ordinary anchor or list it only on a
   `/feeds` page. Those are read too, and the candidates are ranked so press
   releases and newsrooms win over comment, podcast and regional feeds. The
   index pages are probed directly, since a site can block its HTML homepage
   while happily serving both `/feeds` and the feeds themselves.
5. **An X account** (`@OpenAI`, `x.com/OpenAI`, `twitter.com/OpenAI`) → the
   account's posts, via the official X API. See below.
6. **A page with no feed at all** → the page's HTML is read directly and turned
   into a feed (`lib/scrape.ts`). This is how sites like `anthropic.com/news`,
   which never published RSS, become followable.
7. **A page that builds its list in the browser** → the site's own sitemap
   (`lib/sitemap.ts`). See "Sites that publish no feed at all" below.
8. **A publication on a platform** — Substack, Medium, YouTube, GitHub,
   Tumblr — resolves straight to that platform's published feed address, and
   never widens to the platform itself. See "Platforms" below.
9. **An Instagram account** → Meta's API, with your own credentials. See below.

### Sections vs whole sites

Pasting a section — `blog.google/products-and-platforms/products/gemini` —
should follow that section, not the entire blog. Section pages routinely
declare the *site-wide* feed in their `<head>`, so trusting that link silently
widens the source to everything the publisher posts.

Anything deeper than the domain root is therefore treated as a section, and
resolved in this order:

1. A feed for the section itself (`<section>/rss`, `<section>/feed`, …), or a
   declared feed whose URL sits under the section path.
2. Failing that, the section page is read directly — it lists exactly that
   section's articles.
3. Only then the site-wide feed.

The preview shows which applied and offers a **This section / Whole site**
switch, so the wider scope is one click away when that is what you want. A
bare domain is always site-wide and shows no switch.

### Reading a page that has no feed

A listing page links to its articles many times in a consistent shape
(`/news/<slug>`), while nav and footer links are one-offs scattered across
unrelated paths. So the scraper strips `<nav>`/`<header>`/`<footer>`, groups
every remaining link by the directory it lives in, and keeps the largest group
— strongly preferring links directly beneath the page being viewed. Titles come
from the card's heading, dates from `<time datetime>` (or the URL), images from
the card's `<img>`. If nothing looks like a repeated list, it says so rather
than inventing a feed.

These sources are labelled "built from the page — no RSS" in the preview, and
refresh re-reads the page, so they stay up to date like any other source. They
are more fragile than real RSS: a site redesign can change the markup.

You always see a preview — the source's real recent articles — before deciding
to keep it, and you pick which feed it joins.

### Sites that publish no feed at all

Reading the listing page covers a lot, but not the two cases that are getting
more common rather than less: a page that assembles its list in the browser
server-renders nothing to group, and a paginated section shows ten items and
hides the eleventh behind a click. Government publishers are the worst case —
a department that has never shipped RSS, whose newsroom is a React shell, was
simply unfollowable.

Those sites do publish a machine-readable index of what they post: a sitemap,
advertised in `robots.txt` because search engines require it of them. A **news
sitemap** is better still — capped by its own specification to the last two
days, carrying each item's real headline and publication time, and holding
exactly what the newsroom considers news.

So a sitemap is tried after the page scrape rather than giving up: `robots.txt`
first, then the conventional addresses, ranking a news sitemap above the
site-wide one and anything matching a pasted section above both. One level of
index is followed and at most four documents are opened.

An entry with no date is dropped rather than sorted last — a sitemap has no
order, so an undated entry cannot be placed, and a feed ordered by the CMS's
internals is worse than a shorter honest one. Plain sitemaps carry no
headlines, so the URL slug stands in until each page's own title is read.

### Platforms

`substack.com/@someone` used to find no feed under that path, widen to the
domain, and subscribe you to **Substack's own corporate blog** — filed under
the title you pasted, so it looked like it had worked. These pages make it
worse by declaring the platform's site-wide feed in their own `<head>`, which
is the first thing discovery trusts.

Two rules fix it. A host known to carry thousands of unrelated publications
never widens to its own domain feed: on those, a pasted path stays a pasted
path. And where a platform's feed address is documented and stable it is used
directly, before any crawling — `<pub>.substack.com/feed`,
`medium.com/feed/@user`, YouTube's `feeds/videos.xml`, GitHub's
`releases.atom`, Tumblr's `/rss`. A publication's own subdomain is not
multi-tenant: `platformer.substack.com` is one publisher and widening to it is
right.

Anything that would be a guess is left out. `substack.com/@handle` is a
writer's profile with no documented feed, and a YouTube `@handle` needs its
channel id looked up — which ordinary discovery does perfectly well by reading
the feed the page declares. A wrong feed that answers 200 is worse than no
feed at all.


**Reading** merges every source in the selected feed, always newest first
(undated items sort last). Click a headline to read the whole article inside
the app: the server fetches it, works out which copy of the article is the
fullest one available (see below), and **sanitizes the HTML** — scripts,
styles, iframes, event handlers and non-http URLs are stripped before it
reaches the page. Cmd/Ctrl-click still opens the original. Click a feed
in the sidebar to see everything in it, or a single source to narrow to it.
Each source shows its favicon, with a letter avatar as fallback.

## Sidebar

Each feed collapses to hide its sources — click the chevron beside the name.
Which feeds are collapsed is remembered per device. A collapsed feed still
shows its unread count and is still selectable, and collapsing on a phone does
not close the drawer.

### Moving a source between feeds

Each source in the sidebar has a grip on its left. Drag it onto another feed to
move it there — with a mouse, or with a finger on a phone. The feed under the
pointer is outlined as you go, Escape abandons the drag, and dropping into a
collapsed feed opens it so you can see what landed.

It is a move rather than a copy, and dropping a source onto a feed that already
follows the same URL merges the two rather than leaving it listed twice.

## View modes

Settings (bottom of the sidebar) chooses how articles are laid out:

- **Magazine** — a large header image inline above each story, in a narrower
  column. Best for image-rich sources.
- **Cards** — a small thumbnail beside the headline. The default.
- **List** — headlines only, no images or summaries. Most stories per screen.

There is also an option to hide articles you have already opened rather than
just dimming them.

The choice is stored per device, not synced: a phone and a desktop want
different densities, while the feeds themselves are what needs to match.

### Layout

| Path | What it does |
| --- | --- |
| `lib/feed.ts` | Fetch + parse RSS 2.0, Atom, and RDF into one article shape |
| `lib/discover.ts` | Turn a pasted topic/URL/site into a feed |
| `lib/scrape.ts` | Build a feed from a page that has no RSS |
| `lib/enrich.ts` | Fill in missing summaries/dates from article metadata |
| `lib/article.ts` | Extract + sanitize an article for the in-app reader |
| `lib/sort.ts` | Newest-first ordering shared by every path |
| `lib/x.ts` | Following an X account, list or search through the official API |
| `lib/instagram.ts` | Following an Instagram account through Meta's API |
| `lib/platforms.ts` | Platform feed addresses, and hosts that must not widen |
| `lib/sitemap.ts` | Building a feed from a site's sitemap |
| `lib/structured.ts` | Reading a page's schema.org JSON-LD |
| `lib/paywall.ts` | Telling a free article from the free part of one |
| `lib/offline.ts` | Offline store, download schedule, list snapshot |
| `public/sw.js` | Service worker: opens the app with no connection |
| `lib/sync-code.ts` | Sync code generation, normalising and hashing |
| `lib/sync.ts` | Reading and writing a synced feed list |
| `lib/db.ts` | Postgres connection and one-table schema |
| `lib/store.ts` | `localStorage` persistence for feeds and read state |
| `app/api/discover` | Preview endpoint used by the add dialog |
| `app/api/feed` | Batch feed refresh |
| `app/api/article` | Readable, sanitized article for the reader |
| `app/api/sync` | Create / fetch / save a synced feed list |
| `app/manifest.ts` | Web app manifest for Home Screen installs |
| `scripts/gen-icons.mjs` | Regenerates the PNG app icons from the mark |
| `components/Reader.tsx` | Sidebar, article list, feed management |
| `components/SettingsDialog.tsx` | View mode and reading preferences |

Feeds are fetched server-side, which sidesteps browser CORS restrictions —
this is why the app needs a Node server rather than being a static page.

Every dialog closes three ways: the X in its header, the button in its footer,
and a tap outside it. Opening one from the sidebar drawer puts the drawer away
with it, so closing it returns you to the articles rather than to the drawer.

## On a phone

The layout adapts below 860px: the sidebar becomes an off-canvas drawer behind
a menu button (it used to be hidden outright, which left no way to switch feeds
or reach sync), touch targets grow, dialogs slide up from the bottom, and
safe-area insets keep content clear of the notch and home indicator.

### Refreshing

Two ways, and only ever one of them at a time.

Below 860px — the same width that turns the sidebar into a drawer — pull the
list down past its top. It engages only when the list is already at the very
top and the drag is downward, so it cannot fight an ordinary scroll, and it
promises a refresh only once the pull is far enough to cause one.

Above it, there is a **Refresh** button in the header. Scrolling up at the top
of the list used to refresh on a desktop too, which is a hidden feature with
nothing on screen to suggest it — and easy to trigger by accident on a
trackpad. A touchscreen laptop counts as a desktop here and gets the button,
because the button is the one you can see.

### Adding it to your Home Screen

The app ships a web manifest, so it installs as a standalone app with no
browser chrome.

- **iOS:** open it in Safari → Share → **Add to Home Screen**.
- **Android:** Chrome menu → **Install app** / **Add to Home screen**.
- **Desktop:** the install icon in the address bar.

Icons are generated from the same lens mark (`scripts/gen-icons.mjs`): a
maskable variant keeps the mark inside the safe zone so Android can crop it to
any shape, and the Apple touch icon is full-bleed because iOS applies its own
rounded mask.

## The API directory

Not everything worth following publishes RSS. Court opinions, federal
rulemaking, SEC filings, clinical trials, preprints — these live behind JSON
APIs. **Add a source → API directory** lists the ones the app knows how to
read, with the fields each one takes:

| API | What it follows | Key |
| --- | --- | --- |
| CourtListener | Opinions, PACER filings, oral arguments, by court or search | listing free; **text needs a key** |
| Federal Register | Rules, proposed rules, notices, by agency or term | — |
| Regulations.gov | Dockets and rulemaking documents | required |
| Congress.gov | Bills and resolutions as they move | required |
| SEC EDGAR | Full-text search across filings (8-K, 10-K, S-1…) | — |
| ClinicalTrials.gov | Registered studies, newest updates first | — |
| openFDA | Drug, device and food recalls | optional |
| arXiv | Preprints by category, author or term | — |
| Crossref | Newly registered journal articles | — |
| Hacker News | Stories matching a query, with a points floor | — |
| GitHub releases | Every release of a repository, with notes | optional |
| NWS alerts | Active weather warnings by state | — |

Fill in the fields, preview, and it joins a feed like any other source.
Refresh, the reader, offline download and sync all treat it identically —
an API source is stored as a single string, `api:<provider>?<fields>`, so
nothing downstream needed to learn about APIs.

Where an API wants a key, the directory says which environment variable to set
and where to get one; `api.data.gov` issues one free key that several of the US
government APIs accept. "Optional" above means the API answers without a key
but rate-limits harder. Nothing is stored client-side: keys live only in the
deployment's environment, and the catalogue the browser receives never
contains them.

### Your own API keys

Settings → **API keys** takes a key per provider. They are encrypted in the
browser with a passphrase you choose, and only the ciphertext syncs, so the
server stores bytes it cannot read — which matters because this deployment is
public: anything the server could read would be readable by whoever has the
URL. A key is sent, in a header, only with the request that calls that API,
used once, and never stored server-side.

On another device the vault arrives locked; entering the passphrase there
unlocks it. The decrypted keys are then kept on that device, so the passphrase
is asked for once per device rather than once per launch. There is no recovery:
forgetting the passphrase means entering the keys again.

Keys set in the deployment's environment still work and act as the fallback —
but they apply to everyone who opens the URL, which is what the vault exists to
avoid.

### Adding another API

`lib/apis.ts` is a list of providers, one object each. A new one needs: what
the catalogue shows (name, category, description, docs link), the fields the
user fills in, a `request()` that builds the URL and headers, an `items()` that
finds the records in the response, and an `article()` that maps one record to a
title, link, date and summary. Set `envKey` if it needs a credential, and
`format: "feed"` if the API answers with RSS or Atom rather than JSON — arXiv
does, and is handled by the existing feed parser rather than a mapper.

There is a test asserting every provider is well formed, and each mapper is
tested against a recorded response shape rather than the live API.

## Reddit

Paste `r/AskHistorians`, or any reddit.com URL for a subreddit, and it becomes
a source. A sort comes with it — `reddit.com/r/news/top/?t=week` follows the
week's top posts.

A subreddit is not the only thing people follow there, and the rest used to
fall through to the topic branch — pasting `u/kn0thing` quietly subscribed you
to a Bing News search for the letter u. These all work now, because Reddit
publishes an RSS feed for each of them at the same `.rss` suffix:

| Paste | What you get |
| --- | --- |
| `r/AskHistorians`, `reddit.com/r/news/top/?t=week` | a subreddit, with its sort |
| `u/kn0thing`, `reddit.com/user/kn0thing` | that author's submissions |
| `u/someone/m/newsmix` | a multireddit |
| `reddit.com/domain/nature.com` | every post linking that publication |
| `reddit.com/r/science/search?q=climate` | a standing search, newest first |

Reddit answers a datacenter request with 429 or 403 often enough to matter, so
every read retries against `old.reddit.com`, which serves the identical feed
from a different tier.

Reddit's entries need unpicking to read well. A **link post** is pointed at what
it links to, so opening it gives the article rather than Reddit's comments page
(which refuses reader view), and its summary and image come from the
destination. A **self post** keeps the text the author wrote. Either way the
thread is a **Discussion** link beside the article, so following a subreddit
for the links does not lose the comments.

## Following X accounts

x.com shows logged-out visitors a login wall with no posts, and the community
front-ends that used to expose them (Nitter and friends) were hit with
cease-and-desist letters in August 2026 and no longer answer. The only route
left is the official API — which is how Feedly does it too, with you supplying
your own credentials.

1. Create a project at the [X developer portal](https://developer.x.com) and
   generate a **bearer token**. Reading timelines needs a paid tier; the free
   tier does not include it.
2. Add `X_BEARER_TOKEN` to the project's environment variables in Vercel.
3. Redeploy.

Then paste any of these like any other source:

- `@handle` or an `x.com/handle` URL — that account's posts
- `x.com/i/lists/<id>` — a list, which is how a beat is actually followed there
- `x.com/search?q=…` or `x.com/hashtag/…` — a standing search over the last week

Without the key, everything else keeps working and the dialog explains what is
missing. Replies and retweets are excluded, posts carry their images, and a
post over 280 characters arrives whole — the full text of a long one lives in
`note_tweet` rather than `text`, so they used to be cut off at the limit with
an ellipsis. Reply counts come back too, which the story ranking uses as a
comment count.

## Following Instagram accounts

There is one way to do this and it is worth being blunt about why, because
every other route is either broken or a bad idea. instagram.com serves a
logged-out visitor a login wall — no public HTML, and no RSS anywhere on the
service. The `?__a=1` endpoint that bridges relied on was closed years ago,
and the bridges that scraped around it are blocked, rate-limited into
uselessness, or ask for your password. Storing a session cookie on this server
is out for the same reason a subscription cookie is: the deployment is public,
so a credential the server can use is one anyone with the URL can use.

What is left is the official API — the same bargain X asks for. Meta exposes
other people's accounts only through Business Discovery, so it needs two
values, both from the same place in Meta's developer console:

1. `INSTAGRAM_ACCESS_TOKEN` — a token for an Instagram business or creator
   account you control.
2. `INSTAGRAM_USER_ID` — that account's id, since the request is made *as* it.

Then paste `instagram.com/nasa` or `ig:nasa`. Not a bare `@nasa`: that already
means X, and silently changing what it resolves to would be worse than asking
for four more characters. The account you follow must itself be a business or
creator account — Meta's API describes no others, and the reader says so
rather than coming back empty.

### Court opinions

CourtListener serves an opinion as a single preformatted block: fixed-width
text, hard-wrapped by the court, which on a phone is either a sideways-scrolling
slab or a column of ragged monospace. The hard wrapping is undone so the
paragraphs flow at reader size, citation links intact, and the opinion as filed
is offered as a PDF at the top of the reader for reading in a proper viewer.

### Comment threads

A page's comment section is removed before the text is extracted. Readability
picks whichever container holds the most text, so a short post with a busy
thread underneath returns a reader's comment as the article — under the
author's name and the post's title. Containers that are, or hold, the page's
own article body are left alone, so a post about comments still reads
correctly.

### What the reader shows when a page will not cooperate

Not every link is an article. In order: a **Reddit post** is read from Reddit's
own feed for it, so the post and its replies appear in the reader rather than a
page that refuses reader view. A link that is **itself a picture** is shown as
one. A **video** becomes a card with its real title, channel and thumbnail,
from oEmbed. Anything else with no extractable text falls back to what the page
says about itself — title, picture, description — labelled as a preview rather
than passed off as the article.

## Getting the whole article

Readability on the page it was handed was the whole of extraction, which is
right when the page holds the article and quietly wrong three ways:

- A metered site serves its opening paragraphs to everyone. They extract
  perfectly, so nothing errors and nothing says anything — the reader showed a
  confident, complete-looking story that stopped mid-thought.
- A page that assembles its body in the browser leaves a shell in the HTML.
  Readability finds nothing and the reader fell back to a preview card, while
  the prose sat in the page's own structured data the whole time.
- A thin page that declares a full AMP copy of itself was never asked for it.

So four candidate bodies are gathered and compared:

| Where | What it is |
| --- | --- |
| the page | Readability's extraction, as before |
| structured data | the publisher's own `articleBody` in schema.org JSON-LD |
| the feed | `content:encoded` from the source's own feed |
| AMP | the publisher's AMP copy, fetched only when the first pass is thin |

The page wins at comparable length, because it carries the photographs, the
pull quotes and the links where the others are prose alone. A challenger has
to be half as much again **and** eighty words longer to displace it — both
conditions matter, since the ratio alone promotes a forty-word difference on
a short post and the absolute alone promotes a feed's boilerplate footer on a
long one.

Where a publisher files an article under subjects in that same structured
data, those are shown under the byline. On a wire story or a government
notice they are often the only plain statement of what the thing is about.

The feed copy is a candidate rather than a catch. It used to be reached for
only when the page refused outright; it is now fetched whenever the
extraction comes back short or marked partial, which is the far more common
case. On a metered article with a full-text feed that is the difference
between 53 words and 518.

### Paywalled and blocked articles

Where a publisher marks an article as not free — `isAccessibleForFree` in
their structured data, or the `article:content_tier` property — and nothing
fuller is available, the reader says **Free excerpt** and offers the site,
instead of passing a teaser off as the article. A page carrying a
subscription wall, or text that ends at one, is read the same way. Long
bodies are never marked partial: if the publisher's own feed carried the
whole article, the wall on the page it came from says nothing about what you
are holding.

This detects walls; it does not go round them. No archive mirrors, no crawler
impersonation, no proxying, and no storing anyone's subscription credentials.
Using text a publisher chose to syndicate, or to publish in their own page
metadata for every crawler that asks, is fair; defeating an access control
they chose to apply is not, and it is also what gets a reader blocked harder.

Note in particular that this deployment is **public** — Vercel Authentication
is off so the app works from a phone. Any subscription cookie held
server-side would therefore be usable by anyone who has the URL, which is
reason enough on its own not to put one there.

**Open on their site.** For a subscription source, the headlines, summaries
and images still arrive in the feed; only the body needs the publisher. When
reader view fails, the error offers **"Always open <host> on the site"**.
After that, articles from that host go straight to the browser — where a
subscription applies — instead of failing in the reader first. Settings lists
those hosts and can put any of them back.

## Top stories

The list sorts newest-first by default. **Top stories** ranks it instead by
how big each story is — from evidence, not opinion.

A fixed panel of newsrooms (`lib/outlets.ts`, the entries marked `panel`) is
swept on a schedule into a shared corpus: which article, from which newsroom,
in which feed, at which position. Nothing is extracted or stored beyond the
headline, the link and the placement. The panel is fixed on purpose — a story
looks big because many newsrooms independently chose to run it, and that
comparison means nothing if the set being watched changes with whoever is
reading. Nothing per-person is recorded, on either side.

Copies of one story are clustered, and each cluster scored on four signals:

| Signal | Weight | What it answers |
| --- | --- | --- |
| Breadth | 45% | How many *different newsrooms* ran it, weighted by reach |
| Engagement | 25% | Which communities carried it, how near their own top, comment counts |
| Placement | 20% | Where it sat — a front page is an editor's ranking, a section feed is mostly recency |
| Velocity | 10% | How fast that breadth arrived: ten outlets in two hours is breaking, ten over three days is a topic |

Then the total is scaled by **freshness**, measured from the most recent copy
rather than the first. A story nobody has added to in a day has stopped
happening, whatever ran yesterday. It only ever marks down — being current is
not evidence a story is big, while having gone quiet is evidence it has
stopped — and it stops at 60%, because yesterday's big story should sit below
today's rather than vanish beneath a quiet one from an hour ago. The reasons
line says which of the two you are looking at.

Two things are deliberately not counted:

- **An aggregator is not a newsroom.** Hacker News carrying a story is readers
  voting, which is the engagement signal and is counted there. Counting it
  towards breadth credited a link-voting site with an editorial decision and
  inflated exactly the stories that are popular rather than big.
- **A newsroom counts once.** The same paper running it in World and in
  Markets is one newsroom, not two.

Engagement is matched to a story by URL *and* by headline. A community links
whichever copy someone found first, usually a different newsroom from the ones
the panel carried, so URL alone threw most of the signal away — and threw it
away unevenly, crediting only the stories whose links happened to line up. The
headline threshold is deliberately higher than the one used to match your own
articles: a false match credits one story with another's audience, which is
worse than missing the signal.

Your own articles are then scored against that picture, by URL first and
headline second, so a source nobody else follows still gets ranked as long as
the press covered the same event. Tapping the score opens a page showing the
whole calculation — every signal, what produced it, and the headline of each
copy counted, so "8 newsrooms" can be checked rather than taken.

Sweeping is driven by traffic rather than by a cron plan — a couple of slices
run after each request, in the background — so the budget is real on a quiet
day. It is not spent evenly: front pages are swept four times an hour, because
that is where a story is first visible and the only place the placement signal
comes from; communities every half hour, since a day's voting does not turn
over in fifteen minutes; section timelines every three quarters of an hour,
because an hour of one is a few more items in order.

### When a source stops answering

Breadth is a count, so a panel feed that quietly stops answering produces no
error anyone sees: it lowers every score a little and goes on doing it. Each
sweep therefore records what every source did — consecutive failures, the last
error, when it last succeeded — and `/api/outlets/health` reads it back, so
one timeout reads differently from a feed that has been gone all week. An
outlet also gets one quick retry, since a single timeout otherwise costs that
newsroom's coverage for half an hour and makes a story look smaller than it is.

That is a different question from `/api/outlets/audit`, which fetches the whole
directory live to find rot in the menu people add sources from. A live check
never catches a source that fails intermittently.

On your side of the app, a source whose refresh failed used to keep its place
in the sidebar, show no unread count, and read as a quiet week. It now carries
a small mark with the reason.

## Files in the feed

Sources often link a file rather than write the thing itself: the PDF behind a
notice, the CSV of the figures. Those arrive as chips under the story, the way
an image does — tap one and it expands in place with the file's own text,
without leaving the list.

A file appears only where a publication actually links one — an RSS enclosure,
or a link in the item's own text. Files are the exception, not a fixture of
every story.

Only formats with text in them are read: PDF, plain text, Markdown, CSV (shown
as a table) and JSON. An image or a video would need a viewer rather than an
extractor, and pretending to read one would be worse than linking it. A scanned
PDF with no text layer says so instead of opening blank — that needs OCR, which
this does not do.

A file is otherwise an article: **Read it all** opens it in the reader, **Save**
puts it in Saved on its own, and a saved file downloads for offline reading like
anything else. That is one mechanism rather than two, because `/api/article`
reads a file URL into the same shape as an extracted page.

## Saving articles

**Save** on any article puts it in the **Saved** list in the sidebar, and the
reader has the same button. Saved articles are kept whole rather than by
reference, so one stays readable long after it has scrolled out of its feed,
and they are always included in the offline download — a bookmark is the
article most worth having on the device.

The list syncs across your devices along with your feeds, and it merges
rather than being replaced — see **Syncing across devices** below.

## Reading offline

Articles already on the device carry a small sky-blue check in their byline
line — the mark appears as each one lands, and is still there on the next
visit. Hovering an article warms it too, so a story you were about to open
picks up the check on its own.

Anything missing is fetched whenever the app is open — on launch, on returning
to it, and when a connection comes back — so a download interrupted by
switching apps finishes itself rather than waiting for the next slot. The full
refresh, which also prunes what has aged out, still runs on the first visit
after 7am and after 4pm ET.

The app also asks the browser to keep this cache rather than evict it. Safari
clears site storage after about a week of not visiting unless the app is on
your Home Screen; Settings shows which state you are in.

While that download is running, a thin progress bar sits across the top of the
screen and fills as each article lands — it holds at full for a moment when it
finishes, so completing looks different from stopping. Settings still carries
the exact count and the last download time.

The newest 15 stories from each source are downloaded to the device — the full
extracted text, not just headlines — so they can be read with no connection.
The app shell is cached by a service worker, and the article list is saved too,
so opening it offline shows the list rather than an empty screen.

**When it happens.** On the first visit after **7am ET** and after **4pm ET**.
It is deliberately *not* a timer: iOS will not wake a web app on a schedule, so
promising a download at exactly 7am would be a promise the platform cannot
keep. Instead each slot is recorded, and the moment the app is opened or
focused after a new slot begins, the download runs. Settings shows when it last
completed and offers **Download now**.

Slots are identified by name (`2026-07-15-am`) rather than by timestamp, which
avoids converting a wall-clock time in a DST-observing zone back to UTC.

## Faster articles

Three things, in the order they help:

1. A downloaded or previously read article renders straight from IndexedDB —
   no network at all.
2. Hovering or touching a headline fetches it before the click lands.
3. `/api/article` sets `max-age` for the browser and a CDN lifetime via
   `CDN-Cache-Control`. The browser cache is a real win on a repeat open; the
   **edge cache is unverified** — repeat requests still reported
   `x-vercel-cache: MISS`, which may mean dynamic route handlers are not
   edge-cached, or simply that the tool used to check bypasses the CDN. The
   headers are correct either way and cost nothing, but do not count on the
   edge until a HIT is actually observed.

## Syncing across devices

Feeds still live in your browser by default. Turning on sync stores them
server-side under a **sync code** — 100 bits of randomness, shown as
`XXXXX-XXXXX-XXXXX-XXXXX`. Paste that code on another device and both stay in
step. No account, no email, no password.

The code is a bearer secret: anyone holding it can read and change your feed
list, so treat it like a password. Rows are keyed by **SHA-256 of the code**,
never the code itself, so a database leak does not hand out access. Codes are
accepted however you paste them — lower case, spaces instead of dashes.

Devices pull on load and whenever the window regains focus, and push changes
after a short debounce. Conflicts resolve last-write-wins: two devices editing
in the same moment costs one side's change, not the list.

### Saved articles merge, they do not replace

Everything else in the synced document resolves by "most recent change wins",
which is right for a feed list: it is edited rarely, and deliberately.
Bookmarks are not like that. They are added a few at a time, on whichever
device is to hand, often while the other one is asleep — so a whole-document
replace would mean saving something on your phone in the morning and losing
it the moment a laptop that had not pulled yet saved something of its own.

So Saved is the union of every device's list: each article at its earliest
save, newest first. Removing one is recorded as a removal and travels with the
list, because otherwise the union would simply put it back from the device
that still had it. Save it again after removing it and it stays — the later
action is the one that counts. Removal records are dropped after 90 days, by
which time every device in use has seen them.

The newest 400 bookmarks sync. They are stored whole — headline, summary,
image, source — so that the article outlives the feed it came from, which
makes the list far heavier than the feeds beside it; anything past that stays
on the device that saved it rather than being deleted anywhere.

Conflicts resolve by **most recent change**, not most recent write. Each device
records when its data actually changed; a device that has been closed for a
week cannot overwrite what happened while it was away, and instead picks up
what is current. Nothing is sent until the first pull has answered, so opening
a stale device is safe.

### Setting it up

Sync needs a Postgres database. Without one the app works exactly as before and
the sync dialog says it is unavailable.

1. In the Vercel dashboard: **Storage → Create Database → Neon Postgres**
   (free tier), and connect it to this project.
2. That adds `POSTGRES_URL` to the project's environment variables.
3. Redeploy. The table is created automatically on first use.

## Security

This app fetches URLs on behalf of whoever is using it and renders HTML it
did not write, so both of those are treated as hostile input.

**Outbound requests are restricted to the public internet** (`lib/net.ts`).
Every fetch — a feed, a page, a sitemap, a linked file, an API — goes through
one guard that resolves the hostname rather than trusting how it is spelled,
refuses private, loopback, link-local and carrier-NAT addresses in both IPv4
and IPv6 (including the IPv4-mapped, 6to4 and NAT64 forms that hide one inside
the other), follows redirects by hand so every hop is checked, and caps how
much it will read. Without this the app is an open proxy into whatever network
it is deployed in — cloud metadata endpoints included, which on most providers
hand out credentials.

**Known residual:** the guard resolves, validates, then fetches, so a name
whose DNS answer changes between those two moments — DNS rebinding — is not
stopped. Closing it needs the connection pinned to the address that was
checked, which Node's `fetch` will not do without a custom dispatcher.

**Third-party HTML is sanitised to an allowlist** before it reaches the page:
scripts, styles, iframes, forms, objects, event handlers and non-http(s) URLs
are removed, whether the body came from the page, the publisher's structured
data, their feed, or an API. A content security policy backs that up, so even
a sanitiser failure cannot load script from anywhere else. Links that the app
could never open — `javascript:`, `data:` — are kept out of the article model
at the point it is built, rather than filtered at each place they are shown.

**Parsers are bounded.** Reading pages chosen by someone else means every
regex is a potential denial of service: an unbounded scan before a literal
backtracks from every position the literal fails at, and a page carrying
twenty thousand unterminated tags cost 92 seconds of CPU against routes that
are allowed 30. Tag scans are bounded, responses are capped at 8MB, files at
their own limit, and `/api/feed` takes a bounded number of sources per call.

**Secrets.** Sync codes are stored as SHA-256 hashes, never the code itself.
API keys are encrypted in the browser before they sync, and travel in a header
for the one request that needs them — never in a URL, where they would reach
logs and referrers. SQL is parameterised throughout.

### Before you share the URL

The deployment is **public by default** — there is no login in front of it —
and several of this app's design decisions follow from that: no subscription
cookies server-side, no server-readable API keys, nothing personal stored.

If you are sharing it with colleagues rather than the world, turn on access
control at the platform, in the Vercel project's **Settings → Deployment
Protection** (Vercel Authentication, or a shared password). That is worth more
than anything in this repository can do for you:

- It removes the anonymous-caller problem entirely. Nothing here is
  rate-limited, and a serverless in-process limiter would be theatre — so
  until the URL is restricted, anyone who has it can use the deployment to
  fetch pages at your expense.
- Keys set in the deployment's environment apply to whoever opens the URL.
  Behind access control, that is your colleagues instead of everyone.
- A sync code is a bearer secret. Anyone holding one can read and change that
  feed list, so treat it like a password and share it deliberately.

Note that Vercel Authentication also blocks the app on a phone unless each
person signs in, which is why it is off by default here.

## Deployment

Hosted on Vercel, linked to this GitHub repo: every push to
`claude/feedly-clone-custom-feeds-laz6ll` (the repo's default branch) builds
and deploys to production automatically.

The API routes run on Node — they must, since fetching feeds server-side is
what avoids browser CORS limits.

## Notes

- Without a database, feeds stay per-browser; with one, they sync by code.
  OPML import/export is still the natural next step for portability.
- Favicons come from Google's public `s2/favicons` service.
- Scraped pages only expose what the site server-renders. `anthropic.com/news`,
  for example, ships ~11 posts in its HTML and paginates client-side, so that
  is what a scraper (Feedly included) can see. Fine for following new posts;
  it is not a back catalogue.
- Listing pages rarely include a summary for every card, so missing summaries
  are filled from each article's `og:description`. That costs one extra request
  per article, capped and batched.
- The site is public (no Vercel login) so it works from any device. Nothing
  personal is exposed by that: feeds never leave your browser, and the server
  keeps no state.
