"use client";

import type { ReadableArticle } from "./article";

/**
 * Articles saved for reading without a connection. IndexedDB rather than
 * localStorage: extracted article bodies run to tens of kilobytes each, well
 * past what localStorage can hold.
 */
const DB_NAME = "super-reader";
const DB_VERSION = 1;
const ARTICLES = "articles";
const META = "meta";

/**
 * Bumped whenever extraction changes what a page yields. A stored copy from an
 * older version is treated as a miss, so the fixed text replaces it on the next
 * read or download.
 *
 * Without this, a wrongly extracted article stays wrong on the device forever:
 * the download skips anything already cached, so it would never be re-fetched.
 * 2: comment threads are no longer mistaken for short posts.
 */
export const EXTRACT_VERSION = 2;

export type CachedArticle = ReadableArticle & {
  cachedAt: number;
  /** Which extraction produced this copy; absent on pre-versioned records. */
  v?: number;
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ARTICLES)) {
        db.createObjectStore(ARTICLES, { keyPath: "url" });
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = work(tx.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

export async function readCached(url: string): Promise<CachedArticle | null> {
  try {
    const direct = await run<CachedArticle>(ARTICLES, "readonly", (s) => s.get(url));
    // Showing the wrong article is worse than fetching it again: a copy from
    // an older extraction is ignored rather than served.
    if (direct) return direct.v === EXTRACT_VERSION ? direct : null;

    // Filed under the URL the server resolved it to, rather than the link
    // that was asked for — a topic source's links go through a redirector.
    // Without this the copy on the device was invisible to the reader that
    // asked for it and to the download that was trying to keep it.
    const storedAs = await filedUnder(url);
    if (!storedAs || storedAs === url) return null;
    const hit = await run<CachedArticle>(ARTICLES, "readonly", (s) => s.get(storedAs));
    if (!hit) return null;
    return hit.v === EXTRACT_VERSION ? hit : null;
  } catch {
    return null;
  }
}

/**
 * `requestedUrl` is the link the app asked for, which is not always the URL
 * the article came back under — see the note on LINKS below.
 */
export async function writeCached(article: ReadableArticle, requestedUrl?: string) {
  try {
    await run(ARTICLES, "readwrite", (s) =>
      s.put({ ...article, cachedAt: Date.now(), v: EXTRACT_VERSION }),
    );
    await rememberLink(requestedUrl ?? article.url, article.url);
  } catch {
    /* storage full or unavailable — reading online still works */
  }
}

export async function cachedUrls(): Promise<string[]> {
  try {
    const keys = await run<IDBValidKey[]>(ARTICLES, "readonly", (s) =>
      s.getAllKeys(),
    );
    return keys.map(String);
  } catch {
    return [];
  }
}

const VERSION_KEY = "extractVersion";

/**
 * Throw away copies made by an older extraction.
 *
 * readCached refuses them, so leaving them in place made the download marks
 * lie: an article showed a check, and then went to the network anyway — or,
 * with no connection, showed nothing at all. Clearing them also clears the
 * slot, so the next download refills the device rather than waiting for the
 * next 7am or 4pm.
 */
export async function purgeStaleVersion(): Promise<number> {
  const stored = await meta<number>(VERSION_KEY);
  if (stored === EXTRACT_VERSION) return 0;

  const stale = (await cachedUrls()).length;
  try {
    await run(ARTICLES, "readwrite", (s) => s.clear());
  } catch {
    /* nothing stored, or storage unavailable */
  }
  await setMeta(LINKS, []);
  await setMeta("slot", null);
  await setMeta(VERSION_KEY, EXTRACT_VERSION);
  return stale;
}

/** Drop anything no longer in the newest set, so the store cannot grow forever. */
export async function pruneTo(keep: Set<string>, keepLinks?: Set<string>) {
  try {
    for (const url of await cachedUrls()) {
      if (!keep.has(url)) {
        await run(ARTICLES, "readwrite", (s) => s.delete(url));
      }
    }
    const links = keepLinks ?? keep;
    const filed = await linkIndex();
    await setMeta(
      LINKS,
      Object.fromEntries(
        Object.entries(filed).filter(([requested]) => links.has(requested)),
      ),
    );
  } catch {
    /* ignore */
  }
}

/**
 * The links whose articles are on the device.
 *
 * Not the same thing as the keys in the article store: a topic source's links
 * point at Bing's redirector, and the server resolves those to the publisher
 * before extracting, so an article is filed under a URL the list has never
 * seen. This records the link that was actually asked for, which is what the
 * list can match against.
 */
const LINKS = "links";

/**
 * Requested link → the URL its article is actually filed under.
 *
 * This was a plain list of requested links, which could say *that* an article
 * was on the device but not *where*. So a link whose article is filed
 * elsewhere looked like a miss on every run: it was fetched again, and if the
 * fetch failed — a dropped connection, a publisher refusing us that minute —
 * the good copy already on the device was not in the run's keep-set and was
 * deleted. A bookmark could lose its text that way while still being a
 * bookmark, which is the one thing saving an article is supposed to prevent.
 *
 * Older devices hold the array; it is read as a map to itself.
 */
type LinkIndex = Record<string, string>;

async function linkIndex(): Promise<LinkIndex> {
  const stored = await meta<LinkIndex | string[]>(LINKS);
  if (!stored) return {};
  if (Array.isArray(stored)) {
    return Object.fromEntries(stored.map((url) => [url, url]));
  }
  return stored;
}

export async function savedLinks(): Promise<string[]> {
  return Object.keys(await linkIndex());
}

/** Where a link's article is filed, when that is not the link itself. */
export async function filedUnder(url: string): Promise<string | null> {
  return (await linkIndex())[url] ?? null;
}

/**
 * Serialised, because the download saves three articles at once: two
 * concurrent read-modify-writes of this index would each start from the same
 * object and the last one to finish would drop the other's link.
 */
let linkWrites: Promise<void> = Promise.resolve();

async function rememberLink(url: string, storedAs: string) {
  linkWrites = linkWrites.then(async () => {
    const current = await linkIndex();
    if (current[url] === storedAs) return;
    await setMeta(LINKS, { ...current, [url]: storedAs });
  });
  await linkWrites;
}

async function meta<T>(key: string): Promise<T | null> {
  try {
    return (await run<T>(META, "readonly", (s) => s.get(key))) ?? null;
  } catch {
    return null;
  }
}

async function setMeta(key: string, value: unknown) {
  try {
    await run(META, "readwrite", (s) => s.put(value, key));
  } catch {
    /* ignore */
  }
}

/**
 * The two daily slots, 07:00 and 16:00 America/New_York. Identifying a slot by
 * name rather than by timestamp sidesteps converting a wall-clock time in a
 * DST-observing zone back to UTC.
 */
export function currentSlot(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = Number(get("hour"));
  const date = `${get("year")}-${get("month")}-${get("day")}`;

  if (hour >= 16) return `${date}-pm`;
  if (hour >= 7) return `${date}-am`;

  // Before 07:00 ET the standing download is still yesterday's afternoon one.
  const yesterday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  return `${yesterday}-pm`;
}

/**
 * The article list itself is fetched from the network, so without a copy the
 * app opens empty offline even when the articles are downloaded.
 */
export async function saveListSnapshot(articles: unknown[]) {
  await setMeta("list", articles);
}

export async function loadListSnapshot<T>(): Promise<T[] | null> {
  return meta<T[]>("list");
}

export async function lastDownloadedSlot() {
  return meta<string>("slot");
}

export async function markSlotDownloaded(slot: string) {
  await setMeta("slot", slot);
  await setMeta("at", Date.now());
}

export async function lastDownloadedAt() {
  return meta<number>("at");
}

export async function isDownloadDue(now = new Date()) {
  return (await lastDownloadedSlot()) !== currentSlot(now);
}

/**
 * Ask the browser to keep this cache rather than evict it under pressure.
 *
 * Safari clears site storage after about a week of not visiting, which is the
 * difference between "downloaded" and "downloaded until you go on holiday".
 * Installing to the Home Screen is what usually earns the grant; asking costs
 * nothing when it does not.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** How many of each source's newest stories are kept for offline reading. */
export const PER_SOURCE = 15;

export type DownloadProgress = {
  done: number;
  total: number;
  /** The article that just landed, when it was saved rather than missed. */
  saved?: string;
};

/** One article to save: its feed lets the server fall back to syndicated text. */
export type OfflineTarget = { url: string; feedUrl?: string; title?: string };

export function articleEndpoint(url: string, feedUrl?: string, title?: string) {
  const params = new URLSearchParams({ url });
  if (feedUrl) params.set("feed", feedUrl);
  if (title) params.set("title", title);
  return `/api/article?${params}`;
}

/**
 * Fetch and store the newest articles so they can be read with no connection.
 * Runs a few at a time: this is a background chore, not something to saturate
 * a phone's radio for.
 */
export async function downloadForOffline(
  targets: OfflineTarget[],
  onProgress?: (progress: DownloadProgress) => void,
  /** API keys, for sources whose text comes from an API that needs one. */
  headers?: HeadersInit,
): Promise<{ saved: number; failed: number }> {
  const seen = new Set<string>();
  const wanted = targets.filter((t) => {
    if (seen.has(t.url)) return false;
    seen.add(t.url);
    return true;
  });
  let saved = 0;
  let failed = 0;
  let settled = 0;
  // What each article was actually filed under, which is not always the link
  // it was asked for. Pruning has to compare against these, or a topic
  // source's articles would be deleted the moment after they were saved.
  const storedKeys = new Set<string>();
  const step = (savedUrl?: string) =>
    onProgress?.({ done: (settled += 1), total: wanted.length, saved: savedUrl });

  const concurrency = 3;
  for (let i = 0; i < wanted.length; i += concurrency) {
    const batch = wanted.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async ({ url, feedUrl, title }) => {
        let stored = false;
        try {
          // Already stored from an earlier run — no need to fetch again.
          const already = await readCached(url);
          if (already) {
            storedKeys.add(already.url);
            saved += 1;
            stored = true;
            return;
          }

          const res = await fetch(articleEndpoint(url, feedUrl, title), { headers });
          if (!res.ok) throw new Error("failed");
          const article = await res.json();
          // The publisher served the preview it shows a stranger. Storing that
          // would put a stub on the device under the headline of the article,
          // and keep serving it after a subscription starts working — the
          // cache is read before the network. Left unstored, it is simply
          // fetched again next time, by which point it may be readable.
          if (article?.paywalled) return;
          await writeCached(article, url);
          storedKeys.add(article.url ?? url);
          saved += 1;
          stored = true;
        } catch {
          failed += 1;
        } finally {
          // Per article rather than per batch: a bar that moves in threes on a
          // slow connection looks stuck between jumps.
          step(stored ? url : undefined);
        }
      }),
    );
  }

  /*
   * Housekeeping, and only on a run that knows enough to do it safely.
   *
   * Pruning deletes everything outside the keep-set, and the keep-set is what
   * this run could account for. A run where some fetches failed — a dropped
   * connection, a publisher refusing us for a minute — cannot tell "no longer
   * wanted" from "could not be reached just now", and deleting on that
   * reading took the text of articles the device still lists away with it.
   * A bookmark losing its copy is the worst version of that: keeping the
   * article readable after it leaves its feed is the whole point of saving
   * it. So a run with any failure leaves the store alone; the next clean run
   * tidies up, and the cost of waiting is a little disk.
   */
  if (failed === 0) {
    // What each wanted link is filed under, for the ones this run skipped
    // because they were already there under a different URL.
    for (const target of wanted) {
      const filed = await filedUnder(target.url);
      if (filed) storedKeys.add(filed);
    }
    await pruneTo(storedKeys, new Set(wanted.map((t) => t.url)));
  }
  return { saved, failed };
}
