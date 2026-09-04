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

You always see a preview — the source's real recent articles — before deciding
to keep it, and you pick which feed it joins.

**Reading** merges every source in the selected feed newest-first. Click a feed
in the sidebar to see everything in it, or a single source to narrow to it.
Each source shows its favicon, with a letter avatar as fallback.

### Layout

| Path | What it does |
| --- | --- |
| `lib/feed.ts` | Fetch + parse RSS 2.0, Atom, and RDF into one article shape |
| `lib/discover.ts` | Turn a pasted topic/URL/site into a feed |
| `lib/store.ts` | `localStorage` persistence for feeds and read state |
| `app/api/discover` | Preview endpoint used by the add dialog |
| `app/api/feed` | Batch feed refresh |
| `components/Reader.tsx` | Sidebar, article list, feed management |

Feeds are fetched server-side, which sidesteps browser CORS restrictions —
this is why the app needs a Node server rather than being a static page.

## Deployment

Hosted on Vercel, linked to this GitHub repo: every push to
`claude/feedly-clone-custom-feeds-laz6ll` (the repo's default branch) builds
and deploys to production automatically.

The API routes run on Node — they must, since fetching feeds server-side is
what avoids browser CORS limits.

## Notes

- Feeds are stored per-browser. There's no sync between devices yet; an
  OPML import/export would be the natural next step.
- Favicons come from Google's public `s2/favicons` service.
- The site is public (no Vercel login) so it works from any device. Nothing
  personal is exposed by that: feeds never leave your browser, and the server
  keeps no state.
