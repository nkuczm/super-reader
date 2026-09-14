/**
 * One source, several feeds.
 *
 * Some publishers have no single feed of everything they publish. The Wall
 * Street Journal is the case that forced this: it runs eight section feeds
 * and nothing that carries the paper, so "add the WSJ" used to mean "add
 * World News and call it the WSJ" — every markets, business, tech and opinion
 * story missing by construction, with nothing to say so.
 *
 * A bundle is a feed URL that names several feeds. It follows the shape the
 * API sources already use (lib/apis.ts): everything about the source stays
 * inside one string, so refreshing, de-duplication, offline storage and
 * syncing all keep comparing feed URLs and none of them had to learn
 * anything new.
 */

const PREFIX = "bundle:";

/** Build the one string that stands for several feeds. */
export function bundleOf(feedUrls: string[]): string {
  return PREFIX + feedUrls.map((url) => encodeURIComponent(url)).join("|");
}

/** The feeds inside a bundle, or null if this is an ordinary source. */
export function parseBundle(url: string): string[] | null {
  if (!url.startsWith(PREFIX)) return null;
  const members = url
    .slice(PREFIX.length)
    .split("|")
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    })
    .filter((part) => /^https?:\/\//i.test(part));
  return members.length > 0 ? members : null;
}

export function isBundle(url: string): boolean {
  return parseBundle(url) !== null;
}

/**
 * How many items to take from each feed in a bundle, and how many to keep
 * once they are merged.
 *
 * Per-feed rather than overall, so a fast section cannot crowd out a slow
 * one: a paper's markets feed turns over several times a day while its
 * opinion feed does not, and taking the newest N overall would leave the
 * reader with markets and nothing else.
 */
export const PER_MEMBER = 25;
export const MAX_BUNDLED = 150;

/**
 * Merge what several feeds returned into one source's worth of articles.
 *
 * Sections overlap — a markets story runs in the business feed too — so the
 * same piece must not arrive twice. Kept out of both callers because the
 * preview (lib/discover.ts) and the refresh (app/api/feed) have to agree
 * about what a bundle contains, and because it is the part worth testing.
 */
export function mergeBundled<T extends { link: string }>(
  parts: T[][],
  canonical: (link: string) => string,
  cap = MAX_BUNDLED,
): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const article of parts.flat()) {
    const key = canonical(article.link);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(article);
  }
  return merged.slice(0, cap);
}
