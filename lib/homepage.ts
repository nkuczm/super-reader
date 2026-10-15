/**
 * A source's own website — the publisher's home page, not the feed and not
 * an aggregator that happens to deliver it. Null where there is no such
 * place: a topic search, or a source that is only an API.
 */

/** Hosts that deliver other people's stories: their home page is not the source's. */
const AGGREGATORS = /(^|\.)(news\.google\.com|bing\.com|feeds\.feedburner\.com)$/i;

const web = (value: string | undefined) => {
  try {
    const url = new URL(value ?? "");
    return (url.protocol === "https:" || url.protocol === "http:") && !AGGREGATORS.test(url.hostname) ? url : null;
  } catch {
    return null;
  }
};

export function homepageOf(source: { kind?: string; siteUrl?: string; feedUrl: string }): string | null {
  if (source.kind === "topic") return null;
  const site = web(source.siteUrl);
  if (site) return site.toString();
  // No site recorded: the site the feed itself is served from.
  const feed = web(source.feedUrl);
  return feed ? feed.origin + "/" : null;
}
