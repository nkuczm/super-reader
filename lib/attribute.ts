/**
 * Which source a story belongs to, when more than one delivered it.
 *
 * The list shows a story once — two feeds carrying it under different
 * tracking tags used to put it on screen twice. It used to go to whichever
 * source's feed happened to come first in the refresh, and every other
 * source that delivered it lost it: a news search for "OpenAI" listed
 * before OpenAI's own feed took every story from it, and that source then
 * read as empty while its feed answered with 250 stories — a healthy fetch,
 * nothing held (docs/COLLECTION.md §6, "the plausible substitute" arriving
 * from inside the app).
 *
 * Now a story is still shown once, but it belongs to the publisher whose
 * site it is on when that publisher is one of the sources, and carries the
 * other sources that delivered it in `alsoIn`, so each of their views — and
 * their counts — include it. Two sources following the very same feed URL
 * each get its stories, rather than one of them getting none.
 *
 * Pure: no fetching, so it can be tested on fixtures.
 */

export type Attributable = { link: string; sourceId: string; alsoIn?: string[] };
export type SourceRef = { id: string; feedUrl: string; siteUrl?: string };

const hostOf = (url: string | undefined) => {
  try {
    return url ? new URL(url).hostname.toLowerCase().replace(/^www\./, "") : "";
  } catch {
    return "";
  }
};

/** Whether a source is the publisher of a story: the story's site is the source's, or under it. */
function publishes(source: SourceRef, link: string) {
  const story = hostOf(link);
  if (!story) return false;
  return [hostOf(source.siteUrl), hostOf(source.feedUrl)].some(
    (host) => host && (story === host || story.endsWith(`.${host}`) || host.endsWith(`.${story}`)),
  );
}

/**
 * The refresh's results as one list: each story once, owned by its
 * publisher's source where there is one (otherwise the first to deliver
 * it), with the other sources that delivered it in `alsoIn`.
 */
export function attributeStories<A extends { id: string; link: string }>(
  results: { feedUrl: string; articles?: A[] }[],
  sources: SourceRef[],
  canonical: (url: string) => string,
): (A & Attributable)[] {
  const idsByFeed = new Map<string, string[]>();
  for (const source of sources) idsByFeed.set(source.feedUrl, [...(idsByFeed.get(source.feedUrl) ?? []), source.id]);
  const byId = new Map(sources.map((source) => [source.id, source]));

  const stories = new Map<string, { copies: Map<string, A>; order: number }>();
  let order = 0;
  for (const result of results) {
    for (const sourceId of idsByFeed.get(result.feedUrl) ?? []) {
      for (const article of result.articles ?? []) {
        if (!article?.link) continue;
        const key = canonical(article.link);
        const held = stories.get(key) ?? { copies: new Map<string, A>(), order: order++ };
        if (!held.copies.has(sourceId)) held.copies.set(sourceId, article);
        stories.set(key, held);
      }
    }
  }

  return [...stories.values()]
    .sort((a, b) => a.order - b.order)
    .map(({ copies }) => {
      const ids = [...copies.keys()];
      const owner = ids.find((id) => publishes(byId.get(id)!, copies.get(id)!.link)) ?? ids[0];
      const article = copies.get(owner)!;
      const alsoIn = ids.filter((id) => id !== owner);
      return { ...article, sourceId: owner, id: `${owner}:${article.id}`, ...(alsoIn.length ? { alsoIn } : {}) };
    });
}

/** Whether a story is in a source: delivered by it, whether or not it is the one the story is filed under. */
export function inSource(article: Attributable, sourceId: string): boolean {
  return article.sourceId === sourceId || Boolean(article.alsoIn?.includes(sourceId));
}

/** Whether a story is in any of a set of sources — a folder. */
export function inAnySource(article: Attributable, ids: Set<string>): boolean {
  return ids.has(article.sourceId) || Boolean(article.alsoIn?.some((id) => ids.has(id)));
}
