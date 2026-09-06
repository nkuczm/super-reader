# Super Reader — handoff

A self-hosted feed reader: paste a site, an RSS URL, an X account or a topic,
and it becomes a source in a named feed. Built from scratch in one session.

- **Live:** https://super-reader-nathan-kuczmarskis-projects.vercel.app
- **Repo:** `nkuczm/super-reader`, branch `claude/feedly-clone-custom-feeds-laz6ll`
  (this branch is the repo's default; every push deploys to production)
- **Vercel project:** `super-reader` — team `nathan-kuczmarskis-projects`
- 36 commits, 47 tests, all passing.

---

## Start here

```bash
npm install
npm test          # 47 tests, ~30s
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

**Kill stale fixture servers before running tests.** Ports 8781/8783–8789 are
used by fixtures; a leftover process causes `EADDRINUSE` and every test hangs
or is cancelled. `fuser -k <port>/tcp` first if tests behave oddly.

---

## How it fits together

| Path | What it does |
| --- | --- |
| `lib/discover.ts` | Turns a pasted string into a source. The brain of the app. |
| `lib/feed.ts` | Fetch + parse RSS/Atom/RDF; entity decoding; link unwrapping |
| `lib/scrape.ts` | Builds a feed from a page that has no RSS |
| `lib/enrich.ts` | Fills missing summaries/images from each article's metadata |
| `lib/article.ts` | Readability extraction + sanitising for the reader |
| `lib/x.ts` | Following an X account via the official API |
| `lib/apis.ts` | The API directory — CourtListener, Federal Register, arXiv… |
| `lib/offline.ts` | IndexedDB store, download schedule, list snapshot |
| `lib/sync.ts` `lib/sync-code.ts` `lib/db.ts` | Cross-device sync |
| `lib/sort.ts` | Newest-first ordering, shared by every path |
| `components/Reader.tsx` | The whole app shell: sidebar, list, state |
| `components/DownloadBar.tsx` | Top-of-screen progress for the offline download |
| `app/api/{discover,feed,article,sync,apis}` | The five endpoints |
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
- **The download schedule is "first visit after 7am/4pm ET", not a timer.**
  iOS will not wake a web app in the background; a timer would be a promise the
  platform cannot keep.
- **View mode and collapsed feeds are per-device, not synced.** A phone and a
  desktop want different densities; the feeds are what must match.
- **Sync codes are stored as SHA-256 hashes**, never the code itself.
- **API sources are one string, `api:<provider>?<fields>`**, not a new source
  shape. Refresh, dedupe, offline storage and sync all compare on `feedUrl`;
  keeping that a single string meant none of them changed. `lib/apis.ts` is the
  only place that knows an API was involved.
- **API mappers are tested against recorded response shapes, with `fetch`
  stubbed** — the sandbox cannot reach these APIs, and a suite that depended on
  a dozen third parties' uptime and rate limits would fail for reasons that
  have nothing to do with this code.
- **The reader sanitises to an allowlist.** It injects third-party HTML;
  scripts, styles, iframes, event handlers and non-http(s) URLs are stripped.
  There is a test asserting nothing executable survives — keep it.

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
6. **The API directory is verified only against recorded shapes.** Every
   provider builds the request it should and maps its fixture correctly, and
   the dialog was driven end to end in a browser — but no live API has been
   called, because the sandbox cannot reach them. Response shapes drift; check
   each one against the deployment before trusting it. Congress.gov and
   Regulations.gov need an `api.data.gov` key before they answer at all.

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
