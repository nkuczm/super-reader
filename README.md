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

1. **A topic** ("semiconductors") → a Google News search feed for that term.
2. **A feed URL** → parsed directly.
3. **A website** → looks for `<link rel="alternate" type="application/rss+xml">`
   in the page's `<head>`, then falls back to conventional paths (`/feed`,
   `/rss.xml`, `/index.xml`, …) that cover Substack, WordPress, Ghost, Hugo and
   Jekyll.
4. **An X account** (`@OpenAI`, `x.com/OpenAI`, `twitter.com/OpenAI`) → the
   account's posts, via the official X API. See below.
5. **A page with no feed at all** → the page's HTML is read directly and turned
   into a feed (`lib/scrape.ts`). This is how sites like `anthropic.com/news`,
   which never published RSS, become followable.

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

**Reading** merges every source in the selected feed, always newest first
(undated items sort last). Click a headline to read the whole article inside
the app: the server fetches it, extracts the body with Mozilla's Readability,
and **sanitizes the HTML** — scripts, styles, iframes, event handlers and
non-http URLs are stripped before it reaches the page. Cmd/Ctrl-click still
opens the original. Click a feed
in the sidebar to see everything in it, or a single source to narrow to it.
Each source shows its favicon, with a letter avatar as fallback.

## Sidebar

Each feed collapses to hide its sources — click the chevron beside the name.
Which feeds are collapsed is remembered per device. A collapsed feed still
shows its unread count and is still selectable, and collapsing on a phone does
not close the drawer.

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
| `lib/x.ts` | Following an X account through the official API |
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

## On a phone

The layout adapts below 860px: the sidebar becomes an off-canvas drawer behind
a menu button (it used to be hidden outright, which left no way to switch feeds
or reach sync), touch targets grow, dialogs slide up from the bottom, and
safe-area insets keep content clear of the notch and home indicator.

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

Then paste `@handle` or an `x.com/handle` URL like any other source. Without
the key, everything else keeps working and the dialog explains what is missing.
Replies are excluded, and posts carry their images and full text.

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

### Setting it up

Sync needs a Postgres database. Without one the app works exactly as before and
the sync dialog says it is unavailable.

1. In the Vercel dashboard: **Storage → Create Database → Neon Postgres**
   (free tier), and connect it to this project.
2. That adds `POSTGRES_URL` to the project's environment variables.
3. Redeploy. The table is created automatically on first use.

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
