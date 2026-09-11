# Super Reader — handoff

A self-hosted feed reader: paste a site, an RSS URL, an X account or a topic,
and it becomes a source in a named feed. Built from scratch in one session.

- **Live:** https://super-reader-nathan-kuczmarskis-projects.vercel.app
- **Repo:** `nkuczm/super-reader`, branch `claude/feedly-clone-custom-feeds-laz6ll`
  (this branch is the repo's default; every push deploys to production)
- **Vercel project:** `super-reader` — team `nathan-kuczmarskis-projects`
- 200 tests, all passing.

---

## Start here

```bash
npm install
npm test          # 200 tests, ~45s
npm run dev       # but see "the sandbox can't do this" below
```

**The one thing to understand before changing anything:** in the Claude Code
sandbox, outbound HTTPS to arbitrary sites is blocked by the egress proxy, and
`next dev` will not hydrate (its HMR websocket is blocked, so React effects
never run and the app renders as a dead shell). This shapes the whole workflow:

- **Verify UI locally** with `npx next start` on a spare port against local
  fixture servers, driven by Playwright. Never `next dev`.
- **Verify anything touching the real web on the deployed app.** Push, wait
  ~90–100s, then call the deployed API. That loop is how every real-world bug
  in this project was found.
- Local reads of real sites will always fail. That is the sandbox, not the code.

```bash
# the local loop that works
npx next build
(setsid env ALLOW_PRIVATE_HOSTS=1 npx next start -p 5300 &)
(setsid node -e "import('./test/fixtures.mjs').then(m=>m.startNoFeedSite(8783))" &)
# then drive it with Playwright at http://127.0.0.1:5300
```

`ALLOW_PRIVATE_HOSTS=1` exists only for this: `/api/article` refuses private
hosts in production so the deployed app cannot be used to probe its own
network. Fixtures live on 127.0.0.1, hence the escape hatch.

**Fixture ports** are 8781/8783–8795 and 9101–9104. A fixture server now waits
out a port the previous run has not finished releasing (up to five seconds),
which is what used to turn two back-to-back `npm test` runs into ten cancelled
tests in whichever file lost the race. If a port is held by something that is
not going away, that still fails — `fuser -k <port>/tcp` clears it.

---

## How it fits together

| Path | What it does |
| --- | --- |
| `lib/discover.ts` | Turns a pasted string into a source. The brain of the app. |
| `lib/feed.ts` | Fetch + parse RSS/Atom/RDF; entity decoding; link unwrapping |
| `lib/scrape.ts` | Builds a feed from a page that has no RSS |
| `lib/enrich.ts` | Fills missing summaries/images from each article's metadata |
| `lib/article.ts` | Readability extraction + sanitising for the reader |
| `lib/files.ts` | Reading linked files — PDF, text, Markdown, CSV, JSON |
| `lib/x.ts` | Following an X account, list or search via the official API |
| `lib/instagram.ts` | Following an Instagram account via Meta's Business Discovery |
| `lib/platforms.ts` | Platform feed addresses; hosts that must never widen |
| `lib/sitemap.ts` | Building a feed from a site's sitemap when it has no RSS |
| `lib/structured.ts` | A page's schema.org JSON-LD — body, byline, date, tier |
| `lib/paywall.ts` | Whether what arrived is the article or the free part of it |
| `lib/net.ts` | The public-web guard every outbound fetch goes through |
| `lib/reddit.ts` | Reddit sources — subreddits, users, multis, domains, searches |
| `lib/apis.ts` | The API directory — CourtListener, Federal Register, arXiv… |
| `lib/offline.ts` | IndexedDB store, download schedule, list snapshot |
| `lib/sync.ts` `lib/sync-code.ts` `lib/db.ts` | Cross-device sync |
| `lib/sort.ts` | Newest-first ordering, shared by every path |
| `lib/store.ts` | Feeds, settings, read state and the Saved list (localStorage) |
| `components/Reader.tsx` | The whole app shell: sidebar, list, state |
| `components/DownloadBar.tsx` | Top-of-screen progress for the offline download |
| `app/api/{discover,feed,article,sync,apis}` | The original five endpoints |
| `app/api/{pulse,rank,outlets}` | The corpus sweep, ranking, and panel health |
| `components/ApiCatalog.tsx` | The API directory tab in "Add a source" |
| `public/sw.js` | Service worker so the app opens offline |
| `scripts/gen-icons.mjs` | Regenerates PNG app icons from the mark |

**Discovery order** (`lib/discover.ts`) — this is deliberate and load-bearing:

1. X account (`@handle`, `x.com/handle`)
2. Bare topic → Bing News search feed
3. The URL is itself a feed
4. **If a path was pasted, section-scoped candidates first** — `<section>/rss`,
   then declared feeds under that path, then reading the section page. Only
   then the site-wide feed. Pasting `blog.google/.../gemini` must not subscribe
   you to all of blog.google.
5. Site-wide: declared `<link rel=alternate>`, feed-shaped anchors, common
   paths, newsroom paths — ranked (press releases and news win; comments, jobs,
   podcasts, regional splits lose) and probed in parallel batches of 4.
6. Feed index pages (`/feeds`, `/rss`, …) probed **directly**, because a site
   can block its HTML homepage while serving both `/feeds` and the feeds.
7. Scrape the page as a last resort.
8. The site's sitemap, when the scrape found no list (`lib/sitemap.ts`).

Two things sit *before* all of that and are easy to miss: `platformFeedFor`
resolves a Substack/Medium/YouTube/GitHub/Tumblr URL straight to its published
feed address, and `isMultiTenantHost` stops steps 5-7 widening a pasted path to
the host's own feed on those domains.

---

## Decisions that will look wrong until you know why

- **Bing News, not Google News, for topics.** Google wraps every result in
  `news.google.com/rss/articles/<opaque token>`. The token contains no URL and
  the page behind it is a 592KB JS app that resolves the destination
  client-side. Articles could not be opened at all. Bing's wrapper carries the
  publisher URL in a query param, which `unwrapRedirect` recovers.
- **`/api/article` is deliberately not `force-dynamic`.** That flag disables
  CDN caching outright.
- **Route folders must not start with `_`** — App Router treats them as
  private and they 404.
- **Env is read at call time, not module load** (`lib/x.ts`), because
  module-load capture breaks in serverless and in tests.
- **Offline slots are named (`2026-07-15-am`), not timestamps.** This avoids
  converting a wall-clock time in a DST zone back to UTC. Tested on both sides
  of daylight saving.
- **Cached articles are filed under the URL they resolved to, which is not
  always the link the list shows.** A topic source's links point at Bing's
  redirector and the server unwraps them before extracting, so the store keys
  and the list's links disagree for exactly those sources. `lib/offline.ts`
  therefore also keeps the *requested* links in the meta store, and the check
  marks match against both. Two consequences worth knowing: `pruneTo` compares
  against the keys articles were actually stored under (before this it deleted
  a topic source's articles immediately after saving them), and the link list
  is written through a promise chain, because three concurrent
  read-modify-writes drop each other's entries — measured: 3 of 5 links
  survived without it.
- **Offline progress is reported per article, not per batch of three.** The
  bar is the only sign the download is running; moving in threes on a slow
  connection reads as stuck. It also holds at 100% for 900ms before fading,
  because a bar that vanishes at 80% looks like a failure.
- **The device is topped up on every visit, focus and reconnection**, not only
  at slot boundaries. A phone suspends the page the moment you switch away, so
  a run interrupted after five articles used to leave the rest until the next
  7am or 4pm — the slot was already marked. Articles already stored cost one
  lookup and are skipped, so a top-up is cheap when there is nothing to do.
- **`navigator.storage.persist()` is requested at startup.** Safari clears site
  storage after roughly a week of not visiting; the grant usually follows from
  adding the app to the Home Screen. Settings says which state you are in,
  because "downloaded" and "downloaded until you go on holiday" look identical
  otherwise.
- **Downloading with the app closed is not possible on iOS today**, and this is
  the one request the platform refuses. No Background Sync, no Periodic
  Background Sync in Safari. The only mechanism that runs code while a web app
  is closed is Web Push (iOS 16.4+, Home Screen install, permission granted):
  a push wakes the service worker, which can fetch and store. That needs VAPID
  keys, a subscription table — so the Neon database — and a Vercel cron, and
  iOS requires every push to show a notification, so the user would see one
  twice a day. Not built; discussed with the user.
- **The download schedule is "first visit after 7am/4pm ET", not a timer.**
  iOS will not wake a web app in the background; a timer would be a promise the
  platform cannot keep.
- **Saved articles are stored whole, not as ids.** An article leaves its feed
  after a few weeks; a bookmark has to outlive that, so the record travels with
  the bookmark and the list renders from it. They are also prepended to the
  offline download targets, which keeps them from being pruned.
- **Settings shows how many articles are on the device, and the last run's
  saved/unavailable counts.** Before this, a download where every article
  failed looked identical to one where every article succeeded — both just
  said "Saved <time>". If offline reading is ever reported broken, that number
  is the first thing to ask for.
- **Dragging a source between feeds is pointer events, not HTML5 drag-and-drop**
  (`components/useSourceDrag.ts`). `dragstart`/`drop` never fire on iOS, and
  this app is used on a phone. It starts from a grip rather than the whole row,
  so a finger on the row still scrolls the sidebar and a tap still selects the
  source.
- **`touch-action` does not inherit.** `touch-action: none` on the grip button
  was not enough: the finger lands on the SVG inside it, which still said
  `auto`, so the browser claimed the gesture and the drag died on
  `pointercancel` after the first move. The icon needs it too (and
  `pointer-events: none`, so the button is what gets hit).
- **Measure the drawer after it has settled.** It slides in over 0.22s; a
  Playwright `boundingBox()` taken straight after opening it reports the
  sidebar where it *was* (x of -177 on a 390px screen), so synthetic touches
  land on nothing and the failure looks exactly like a broken drag.
- **View mode and collapsed feeds are per-device, not synced.** A phone and a
  desktop want different densities; the feeds are what must match.
- **Saved articles merge; everything else in the document replaces.** They
  were not synced at all to begin with — `saved` was simply never in the
  payload — and adding them wholesale would have been worse than leaving them
  out: bookmarks are added a few at a time on whichever device is to hand, so
  "most recent change wins" means one device's morning bookmarks vanish when
  the other saves something. `mergeSaved` (lib/store.ts) takes the union, each
  article at its earliest save, and removals travel as tombstones because a
  union cannot express a deletion — the device that still has it would put it
  straight back. Tombstones expire at 90 days. The merge is commutative, and
  there is a test asserting both devices settle on the same list.
- **A device can now hold bookmarks and no sources.** That made the first-run
  "Start with one link" state reachable on top of a non-empty Saved list,
  which reads as the bookmarks having been lost. The empty state is now
  conditional on there being nothing to show as well as no sources.
- **Sync resolves by most recent change, not last write.** Each device stamps
  its synced data when the user changes it, the server refuses a write carrying
  an older stamp (409, handing back what is current), and a device applies a
  remote copy only when it is newer than its own. Two guards make it hold:
  nothing is pushed before the first pull has answered — the debounced save
  used to fire ~900ms after load carrying stale local storage, which is exactly
  how a desktop left closed for a week overwrote a phone — and a local change
  stamps `max(now, lastSeen + 1)`, because a stamp pulled from a device whose
  clock runs ahead would otherwise freeze this one out of syncing forever.
- **The stamp lives in a ref as well as state.** An effect that depends on the
  value it sets re-stamps on every render, and the debounced push never
  survives long enough to fire — which looks exactly like sync being broken.
- **Sync codes are stored as SHA-256 hashes**, never the code itself.
- **API keys are encrypted in the browser (`lib/vault.ts`) before they sync.**
  AES-GCM under a PBKDF2 key from the passphrase; the server stores the blob
  and cannot read it. Keys reach the server only in the `x-sr-api-keys` header,
  for the one request that calls that API — never in the URL, so they cannot
  reach a log or a referrer, and never written down server-side. This is the
  same reasoning as the paywall decision: a public deployment must not hold a
  secret that works for whoever opens it.
- **API sources are one string, `api:<provider>?<fields>`**, not a new source
  shape. Refresh, dedupe, offline storage and sync all compare on `feedUrl`;
  keeping that a single string meant none of them changed. `lib/apis.ts` is the
  only place that knows an API was involved.
- **API mappers are tested against recorded response shapes, with `fetch`
  stubbed** — the sandbox cannot reach these APIs, and a suite that depended on
  a dozen third parties' uptime and rate limits would fail for reasons that
  have nothing to do with this code.
- **Reddit posts are read from the post's own `.rss`** (`readRedditPost`). The
  comments page refuses reader view and `www.reddit.com/....json` answers a
  datacenter request with 403 — both measured — but `<permalink>/.rss` is
  served happily and carries the post as the first entry (`t3_`) and every
  reply after it (`t1_`). Bots are filtered; a comment's text is the SC_OFF
  block, not a pattern match on the footer, which by then has been decoded.
- **The sanitiser used to eat nested images.** `exclusiveFilter` dropped
  "empty" containers using `mediaChildren`, which counts only *direct*
  children — so Substack's `div > picture > img` looked empty and went, taking
  eight photos with it. Measured before and after on a real article: 0 images
  became 8. Only `p` and `figcaption` are filtered now; an empty div renders
  as nothing anyway.
- **An article with no picture gets the page's own `og:image`** as a lead. The
  Guardian and AP both keep the lead photo outside the article body, so their
  stories arrived as walls of text.
- **A page with nothing to extract falls back to a preview card** rather than
  an error: title, picture and description from its metadata. For YouTube and
  Vimeo the card comes from oEmbed, because their pages serve a script shell
  whose og:title is literally "- YouTube".
- **Reddit's feeds work from Vercel** — measured, not assumed; no key, no
  OAuth, just `reddit.com/r/<name>/.rss`. What does not work is its comments
  page: it refuses reader view, so pointing articles there (as the feed does)
  would make every item unreadable. `tidyRedditPost` unpicks each entry
  instead: a link post is pointed at what it links to and enrichment then
  fetches a real summary and image from the destination, a self post keeps its
  own text, and the thread is kept on `Article.comments` for the Discussion
  link. Without this every summary reads "submitted by /u/x [link] [comments]".
- **Comment threads are removed before Readability runs** (`stripDiscussion`,
  `lib/article.ts`). Readability scores containers by how much text they hold,
  so a short post with a busy comment section comes back as somebody's comment,
  printed under the author's name and the post's title. Melanie Mitchell's "On
  AI and Jagged Intelligence" is the case that found it: a 458-character note
  under 1,732 characters of replies. The strip skips anything that is, or
  contains, a known article-body container, so a post about comments survives.
  `charThreshold` is also lowered to 250: Readability's default of 500 discards
  a genuinely short post and falls back to scraping the whole page.
- **CourtListener's opinion pages cannot be scraped.** A non-browser request
  gets a 2KB stub, so Readability had nothing to work with and the reader was
  blank. The text lives in the API (`/api/rest/v4/opinions/<id>/`), which needs
  a token — the search endpoint does not, which is why listing worked while
  reading did not. `ApiProvider.reader` is the general hook for this: an
  article from an API gets its text from that API, before any scraping.
- **Every request that can need an API key must send the key header.** The
  keys reached `/api/feed` and `/api/discover` but not `/api/article`, so a
  CourtListener source listed fine and then refused to show text with a token
  set — the reader, the hover prefetch, the offline download and the file
  preview all call that route. If a key "does not work", check which fetch is
  missing `keyHeadersFrom`. Memoise it: it goes into the reader's effect
  dependencies, and a fresh object each render refetches forever.
- **Court opinions arrive as one `<pre>` slab.** CourtListener's
  `html_with_citations` is fixed-width text, hard-wrapped at whatever the court
  used, with citation links inside — unreadable on a phone whether it scrolls
  sideways or merely wraps ragged. `reflowPreformatted` undoes the hard
  wrapping (blank lines separate paragraphs, single newlines are the court's
  line breaks) and keeps the links. The filed PDF is offered at the top of the
  reader for anything the reflow cannot help with; a phone's own viewer handles
  a court PDF better than this app will.
- **API sources follow their own paging.** CourtListener's search returns 20
  per page whatever you ask for — measured, with a `next` cursor and 99,443
  matches behind it — so a source stopped at 20 and looked finished. Providers
  declare `nextPage` and `fetchApiSource` follows it up to four pages.
- **Attachments come only from what a publication actually links** — an
  enclosure, or a file link in the item's own text. Deriving one from a record
  field (the Federal Register's `pdf_url`) put a chip under every single item
  and made files look like the norm.
- **`pdfjs-dist` also needs `outputFileTracingIncludes`.** Marking it external
  is not enough: the worker is only ever imported dynamically, so file tracing
  leaves it out of the function and every PDF fails in the deployed app while
  passing under `next start`. Both settings are load-bearing; check a PDF
  against the deployment, not just locally.
- **A file is read into the same shape as an article**, by `/api/article`
  itself rather than a second endpoint. That is what lets the reader, the
  offline download, the cache and Saved treat a PDF like a story with no case
  of their own — the alternative was a parallel path through all four.
- **`pdfjs-dist` is in `serverExternalPackages`.** It resolves its worker
  relative to its own file on disk; bundled into a server chunk that path does
  not exist and every PDF fails with "Setting up fake worker failed". This
  passed tests and only broke in the built app, so check a PDF against
  `next start`, not just `npm test`.
- **pdf.js detaches the buffer it is handed.** Read `byteLength` before
  parsing or the reported file size is always 0.
- **A version bump has to purge, not just ignore.** `EXTRACT_VERSION` made
  older copies unreadable, but they stayed in the store and still counted
  towards the download marks — so an article showed a check and then went to
  the network anyway, or showed nothing at all offline. `purgeStaleVersion`
  clears them at startup and clears the slot too, so the next visit refills
  the device instead of waiting for 7am.
- **The reader must always resolve.** It had no timeout: a request that never
  answered left the loading skeleton up for good. There is now a notice at 8s
  with a link to the site, and a 35s timeout — above the route's own 30s
  ceiling, so a server-side failure still arrives with its own message.
- **Cached articles carry an `EXTRACT_VERSION`.** The download skips anything
  already stored, so without a version a wrongly extracted article would stay
  wrong on the device forever. Bump it whenever extraction changes what a page
  yields; older copies are then treated as a miss and re-fetched.
- **Every dialog's content must live inside `.dialog-body`.** It is the only
  part that scrolls; anything placed between it and `.dialog-foot` overflows a
  sheet that is `overflow: hidden` and pushes the footer — the way out — off
  the bottom of the screen. That is what trapped a phone user in Settings: the
  Offline block had always been outside, and adding the API-key panel made the
  Done button unreachable. `.dialog-body` also needs `min-height: 0`, because a
  flex item defaults to `min-height: auto` and refuses to shrink.
- **Check dialogs at phone size, and check position rather than visibility.**
  Playwright's `isVisible()` returns true for an element sitting 700px below
  the fold; compare its `boundingBox()` against the viewport height instead.
  Every dialog now also carries a header close button, so there is a way out
  that does not depend on the footer being reachable.
- **The reader sanitises to an allowlist.** It injects third-party HTML;
  scripts, styles, iframes, event handlers and non-http(s) URLs are stripped.
  There is a test asserting nothing executable survives — keep it.

- **Extraction picks between four candidate bodies, not one.** The page, the
  publisher's schema.org `articleBody`, the feed's `content:encoded`, and an
  AMP copy fetched only when the first pass came back thin. The page wins at
  comparable length because it carries the pictures and links; a challenger
  needs to be 1.5× **and** +80 words. Both conditions are load-bearing: the
  ratio alone promotes a 40-word difference on a short post, the absolute
  alone promotes a feed's boilerplate footer on a long one. Measured on the
  metered fixture through the real route: 53 words → 518.
- **The feed copy is now a candidate, not a catch.** It used to be reached for
  only when the page *threw*. The commoner failure by far is a page that
  answers, extracts perfectly, and holds three paragraphs of nine — which
  errored nothing and said nothing. `/api/article` fetches the feed copy
  whenever the extraction is short or marked partial.
- **`partial` is the publisher's own statement, not a guess.**
  `isAccessibleForFree: false` and `article:content_tier`. A long body is
  never partial whatever the page says: if the feed carried the whole article,
  the wall on the page it came from says nothing about what the reader holds.
- **Freshness is a discount on the total, not a fifth weighted signal.** It
  was written as a weighted part first and that was wrong in an instructive
  way: inside a 48-hour window it scores 1 for nearly everything, so it
  amounted to a flat +15 on the whole corpus and every band moved past the
  thresholds it was tuned to. `test/pulse.test.ts` caught it. Being current is
  not evidence a story is big; having gone quiet is evidence it stopped.
- **Aggregators are excluded from breadth and placement, not from the corpus.**
  Hacker News on the front page is readers voting, not a twelfth editor. Its
  comment count still counts, in engagement, where it belongs.
- **Reddit engagement is matched by headline as well as URL.** A community
  links whichever copy someone found; the panel recorded a different one. The
  threshold (0.62) is deliberately above the 0.55 used for a reader's own
  articles — a false match credits one story with another's audience, which is
  worse than missing the signal. Needed a `title` column on `corpus_reddit`,
  added with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` rather than in the
  `CREATE`, since an existing deployment's table is never recreated.
- **A sitemap entry with no date is dropped, not sorted last.** A sitemap has
  no order, so an undated entry cannot be placed; a feed ordered by the CMS's
  internals is worse than a shorter honest one.
- **Sitemaps are parsed by regex, not by the XML parser.** They reach
  megabytes and 50,000 entries; a full parse builds an object graph for every
  one of them and nothing here needs more than four fields per block.
- **`looksLikeSitemap` has to be tested before `looksLikeFeed` in
  `/api/feed`.** The latter only asks whether the body opens with XML, and a
  sitemap does.
- **A bare `@handle` stays X.** Instagram takes `instagram.com/nasa` or
  `ig:nasa`. Silently changing what `@nasa` resolves to would be worse than
  asking for four more characters.
- **Reddit reads retry against `old.reddit.com`.** www answers a datacenter
  request with 403/429 often enough to matter; old serves the identical feed
  from a different tier. The stored `feedUrl` stays the canonical www one —
  it is the source's identity, and every fetch retries the same way.
- **Every outbound fetch goes through `lib/net.ts`, and that is load-bearing.**
  The check used to live in `/api/article`, which was three kinds of not
  enough: `/api/discover` and `/api/feed` fetch arbitrary URLs and had none,
  `fetch` followed redirects so the checked URL was not the fetched one, and
  the IPv6 test matched `::1` only — so `[::ffff:a9fe:a9fe]`, the cloud
  metadata address as IPv4-mapped IPv6, went through. All three were
  reproduced against the built app first. If you add a code path that reaches
  the network, route it through `safeFetchText`/`safeFetchBytes` rather than
  calling `fetch`; the guard is below the callers precisely so nobody has to
  remember.
- **The guard resolves DNS, so it fails closed on an unresolvable host.** That
  is deliberate — a host that cannot be checked cannot be fetched — and it is
  why `npm test` sets `ALLOW_PRIVATE_HOSTS=1`: the fixtures are on 127.0.0.1,
  which is exactly what it blocks. `test/net.test.ts` clears the variable so
  the guard is actually exercised, and asserts on the *message* for the DNS
  case, because "unresolvable" and "resolves to something private" are both
  refusals and a test that accepted either would pass without resolving
  anything.
- **`[^>]{0,400}`, never `[^>]*`, in a tag regex followed by a literal.** The
  unbounded form backtracks from every position the literal fails at, which is
  quadratic on a page whose tags never close: measured at 91,774ms on a 4MB
  page against routes allowed 30 seconds, and these parsers run on whatever a
  feed points at, so nobody has to click anything. Bounded it is 13ms.
  `test/security.test.ts` holds the regression at a deliberately loose 5s —
  the failure it catches is three orders of magnitude, not a few percent.
- **A stubbed `fetch` in a test must return a real `Response`.** The API tests
  used an object shaped like one, which had no `headers` and no `body`, so it
  sailed past the streaming size cap the real code depends on. A double that
  skips the part under test hides whether it works.
- **Slices have different deadlines, and their order is what sets them.**
  Front pages lead, then subreddits, then section timelines, so a slice holds
  one kind of thing and can have one deadline: 15 minutes, 30, 45. Sweeping is
  driven by traffic at two slices a request, so on a quiet day the budget is
  real — and a front page changes several times an hour while a section
  timeline gains a couple of items in order. `dueSlices` sorts by how far past
  its *own* deadline a slice is, not by age; raw age would always run the
  slowest-moving slices first simply because they are allowed to be older.
  Note this reordering changes which sources a given slice number covers, so
  the first cycle after deploying it re-sweeps against stale `slice-N` marks.
- **A sweep records per-source health.** Breadth is a count, so a dead panel
  feed lowers every score silently and forever. `/api/outlets/health` is how
  that is found; `/api/outlets/audit` cannot, because a single live check
  never catches an intermittent failure.
- **Ports 8793-8795 join the fixture list** (thin pages, sitemap site, fake
  Instagram). Back-to-back `npm test` runs still collide on them — the
  previous run's servers are still closing. `fuser -k <port>/tcp` first, as
  before.

### Which feeds actually carry full text

Measured against live feeds (median prose characters per item; the fallback
accepts a feed copy at 1200+):

| Feed | Median chars | Full text |
| --- | --- | --- |
| astralcodexten.substack.com | 45,846 | yes |
| whitehouse.gov/news | 6,756 | yes |
| stratechery.com | 3,888 | yes, on free posts only |
| simonwillison.net | 2,680 | yes (in Atom `summary`, not `content:encoded`) |
| arstechnica.com | 1,165 | borderline — some items pass, some do not |
| daringfireball.net | 889 | no |
| theverge.com | 688 | no |
| blog.google | 277 | no |
| sec.gov | 254 | no |
| fbi.gov | 199 | no |
| nytimes.com | 192 | no |
| openai.com | 0 | no — the feed carries no body at all |

The pattern: independent blogs and newsletters syndicate full text;
advertising- and subscription-funded outlets syndicate an excerpt, because the
pageview is the product. Government and corporate PR feeds are usually short
announcements — whitehouse.gov is the exception only because its WordPress
ships the whole rendered page.

## Security, and what is still open

Reviewed in full before this was handed to colleagues; the findings and their
fixes are in the commit "Close the SSRF, and stop a hostile page burning 92
seconds of CPU". What remains open, in the order it would matter:

1. **Nothing is rate-limited, and the deployment is public.** A serverless
   in-process limiter would be theatre — instances are not shared — so the
   answer is platform-level: Vercel project → Settings → Deployment
   Protection. Until that is on, anyone with the URL can spend the
   deployment's compute fetching pages. This is the single highest-value
   thing the user can do, and it is a dashboard toggle, not code.
2. **DNS rebinding is not stopped.** `lib/net.ts` resolves, validates, then
   fetches; a name whose answer changes in between defeats that. Fixing it
   properly means pinning the connection to the checked address, which needs
   `undici`'s `Agent` with a custom `connect.lookup` — a dependency this
   project does not have. Worth doing if the app ever sits inside a network
   with anything sensitive on it.
3. **API keys in the deployment's environment apply to everyone who opens the
   URL.** That is what the browser-side vault exists to avoid, and it is
   unchanged; behind access control it stops mattering.
4. **`npm audit` is clean** and there are no secrets in the repository
   history — both checked, both worth rechecking before a release.

## Where the line is on blocked content

Settled explicitly with the user, more than once:

- **Yes:** using full text a publisher syndicates in their own feed
  (`content:encoded`). That is the existing fallback when a page is blocked.
- **No:** archive.is mirrors, crawler impersonation, proxying, or storing the
  user's subscription credentials. Note the deployment is **public** (Vercel
  Authentication is off so it works on the phone) — a subscription cookie on
  the server would be usable by anyone with the URL.
- **The compromise that shipped:** "Always open `<host>` on the site" in the
  reader's error state. Subscription sources keep headlines, summaries and
  images in-app; the body is one tap away in a signed-in browser.

Don't re-litigate this without the user asking.

---

## Outstanding

1. **Sync is built but off** — needs a database. Vercel dashboard → Storage →
   Create Database → **Neon Postgres** (free), connect to this project, which
   adds `POSTGRES_URL`, then redeploy. The table creates itself. Until then
   `/api/sync` returns a clean 503 and everything else works. *This is the one
   thing waiting on the user.*
2. **X accounts need `X_BEARER_TOKEN`** (paid X API tier). Without it, pasting
   `@handle` returns an actionable message and nothing else is affected.
   The user was advised this is probably not worth $100/mo for personal use.
3. **Edge caching of `/api/article` is unverified.** Headers are set correctly
   (`CDN-Cache-Control`), but repeat requests still showed
   `x-vercel-cache: MISS`. Either dynamic route handlers aren't edge-cached, or
   the tool used to check bypasses the CDN. Don't claim it works until a HIT is
   actually observed. Client-side caching (IndexedDB) is verified and is what
   actually makes articles fast.
4. **Sources added before a fix keep their old resolution.** Feed URLs are
   stored per source, so anything added before the section-scope fix or the
   Bing switch needs deleting and re-adding.
5. **OPML import/export** never built; the natural next feature for portability.
   Worth more now than before: the app can follow considerably more kinds of
   thing, so a feed list is worth more to move.
6. **The API directory is verified only against recorded shapes.** Every
   provider builds the request it should and maps its fixture correctly, and
   the dialog was driven end to end in a browser — but no live API has been
   called, because the sandbox cannot reach them. Response shapes drift; check
   each one against the deployment before trusting it. Congress.gov and
   Regulations.gov need an `api.data.gov` key before they answer at all.

7. **Everything in this round was verified against fixtures and the local
   build, not the live web** — the sandbox cannot reach it. Specifically
   unverified: that any given publisher's JSON-LD carries `articleBody` (the
   shape is standard, the coverage is not), that Reddit's user/multi/domain/
   search `.rss` endpoints answer from Vercel, that Meta's Business Discovery
   response matches the fixture, and that X's list and recent-search endpoints
   are included in whatever tier the token has. Check each against the
   deployment before trusting it, the way the API directory was.
8. **`INSTAGRAM_ACCESS_TOKEN` / `INSTAGRAM_USER_ID` are not set anywhere.**
   Instagram sources return an actionable message until they are, and nothing
   else is affected. Note Meta's long-lived tokens expire every 60 days.

## Ideas raised but not built

Full-text search, read-later/boards, per-article notes, keyboard shortcuts.
The user compared this to Feedly Pro ($6/mo) and chose to keep using this.

---

## Working style that fit this user

- They report bugs from real use ("images are getting missed", "it's ingesting
  all of blog.google"). Reproduce against the **live deployment** first — the
  diagnosis was different from the guess almost every time.
- A temporary diagnostic route (`/api/debug-*`), deployed, inspected, then
  removed in the same session, was the most effective debugging tool here. Used
  three times; remove it before finishing.
- They value being told what *didn't* work and what is unverified. Several
  turns ended by correcting an overclaim rather than leaving it.
