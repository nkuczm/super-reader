/**
 * How a refresh is sent: in small groups, a few at a time, each answering as
 * soon as it can.
 *
 * It used to be one request carrying every source the reader follows. That
 * request lasted as long as the slowest source, and the deployment stops a
 * function at sixty seconds — when it did, the whole refresh answered
 * nothing, the two-second sources along with the slow one. On 12 Oct 2026 a
 * phone's refresh ran into that limit four times in an hour and got nothing
 * new from any source. In groups, a slow source holds up only the few beside
 * it, and the list fills in as each group answers.
 */

/** Sources in one request. */
export const GROUP_SIZE = 8;
/** Requests in flight at once. */
export const IN_FLIGHT = 6;

type Followed = { id: string; feedUrl: string };

/**
 * What a source is asked of: its host, or for an API source the service.
 * Sources from one host go in the same group, where the server asks that
 * host for one or two feeds at a time (lib/feed.ts) — spread across groups,
 * six Nature journals would be six requests to nature.com at once again.
 */
export function hostOf(feedUrl: string): string {
  const api = feedUrl.match(/^api:([\w-]+)/i);
  if (api) return `api:${api[1].toLowerCase()}`;
  try {
    return new URL(feedUrl).hostname.replace(/^www\./, "");
  } catch {
    return feedUrl;
  }
}

/**
 * The sources in groups of `size`, neighbours on the same host kept
 * together, and the groups dealt out host by host — so a host with more
 * sources than one group holds is not asked by several groups at once.
 */
export function groupsOf<T extends Followed>(sources: T[], size = GROUP_SIZE): T[][] {
  const ordered = [...sources].sort((a, b) => hostOf(a.feedUrl).localeCompare(hostOf(b.feedUrl)));
  const byHost = new Map<string, T[][]>();
  for (let i = 0; i < ordered.length; i += size) {
    const group = ordered.slice(i, i + size);
    const host = hostOf(group[0].feedUrl);
    byHost.set(host, [...(byHost.get(host) ?? []), group]);
  }
  const queues = [...byHost.values()];
  const dealt: T[][] = [];
  while (queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const group = queue.shift();
      if (group) dealt.push(group);
    }
  }
  return dealt;
}

/** Run `work` over every item, at most `lanes` at once, in order of the list. */
export async function inLanes<T>(items: T[], lanes: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) await work(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(lanes, items.length) }, lane));
}

/**
 * The research services. Kept in step with the providers marked Research in
 * lib/apis.ts by a test; spelled out here so the reader's own code does not
 * have to carry the whole provider table.
 */
export const PAPER_APIS = ["arxiv", "crossref", "journal", "openalex", "rxiv", "osf"] as const;

/**
 * How often a research service is asked for a source's newest papers.
 *
 * Papers are not filed by the minute, and asking costs: OpenAlex allows a
 * thousand requests a day without a key (measured 12 Oct 2026, §2), and every
 * journal followed by ISSN spends one per refresh. A reader following sixty
 * journals and opening the app twenty times a day would spend it by the
 * afternoon, and the refresh then waits on the slower fallback for every
 * journal. Two hours between asks keeps that inside the budget; what each
 * source holds stays in the list in between.
 */
export const PAPERS_EVERY_MS = 2 * 60 * 60 * 1000;

export function isPaperApi(feedUrl: string): boolean {
  const id = feedUrl.match(/^api:([\w-]+)/i)?.[1]?.toLowerCase();
  return Boolean(id && (PAPER_APIS as readonly string[]).includes(id));
}

/**
 * Whether a source is asked this time. Everything is, except a research
 * service asked successfully within the last two hours. A failure, or a
 * source never asked, is due straight away.
 */
export function isDue(
  source: Followed,
  lastRun: { at: number; ok: boolean } | undefined,
  now = Date.now(),
): boolean {
  if (!isPaperApi(source.feedUrl)) return true;
  return !lastRun || !lastRun.ok || now - lastRun.at >= PAPERS_EVERY_MS || lastRun.at > now;
}
