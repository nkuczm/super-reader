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

/**
 * Everything on the device, as list rows.
 *
 * The offline store is keyed by the URL an article was filed under, which is
 * not always the link the list holds, so this reads the store itself rather
 * than trying to work out from a feed what ought to be in it. What comes back
 * is what can actually be read with no connection — which is the only honest
 * answer to "what have I got".
 */
export type StoredArticle = {
  url: string;
  title: string;
  siteName?: string;
  byline?: string;
  publishedAt?: string;
  excerpt?: string;
  wordCount: number;
  cachedAt: number;
  /** The link the reader asked for, when the article is filed under another. */
  link: string;
};

export async function storedArticles(): Promise<StoredArticle[]> {
  try {
    const rows = await run<CachedArticle[]>(ARTICLES, "readonly", (s) => s.getAll());
    const index = await linkIndex();
    // Filed URL → the link the list knows it by, so opening a row from here
    // reaches the same article the rest of the app would.
    const askedFor = new Map(Object.entries(index).map(([asked, filed]) => [filed, asked]));

    return (rows ?? [])
      // A copy from an older extraction is not readable — readCached refuses
      // it — so listing it would promise something the reader cannot open.
      .filter((row) => row?.url && row.v === EXTRACT_VERSION)
      .map((row) => ({
        url: row.url,
        title: row.title || row.url,
        siteName: row.siteName,
        byline: row.byline,
        publishedAt: row.publishedAt,
        excerpt: row.excerpt,
        wordCount: row.wordCount ?? 0,
        cachedAt: row.cachedAt ?? 0,
        link: askedFor.get(row.url) ?? row.url,
      }))
      .sort((a, b) => b.cachedAt - a.cachedAt);
  } catch {
    return [];
  }
}

/** Roughly how much room the downloaded articles take up. */
export async function storedBytes(): Promise<number> {
  try {
    const rows = await run<CachedArticle[]>(ARTICLES, "readonly", (s) => s.getAll());
    return (rows ?? []).reduce(
      (total, row) => total + (row?.html?.length ?? 0) + (row?.title?.length ?? 0),
      0,
    );
  } catch {
    return 0;
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
 * Articles the server could not extract, and when it gave up on them.
 *
 * Measured on the deployment, 21 Sep 2026: of 573 logged `/api/article`
 * requests in a week, **373 answered 502 and 36 timed out** — two thirds of
 * everything the reader asked for, and nearly all of it the background
 * top-up. Nothing recorded those failures, so every visit, every return to
 * the foreground and every reconnection asked for the very same dead articles
 * again. One publisher that refuses us, times fifteen articles, times a
 * hundred app switches a week.
 *
 * A failure is worth remembering for a while. Not for ever: a 500 or a
 * timeout is usually the site having a moment, and the story is readable an
 * hour later. A refusal — 401, 403, 404, 451 — is a decision, and asking
 * again tomorrow will not change it.
 */
const FAILURES = "failures";

export type FailureRecord = { at: number; status: number };
type Failures = Record<string, FailureRecord>;

/** How long to leave an article alone after the server could not read it. */
export function retryAfterFor(status: number): number {
  const hour = 3_600_000;
  // A settled refusal. The publisher is not going to change its mind today.
  if ([401, 403, 404, 410, 451].includes(status)) return 7 * 24 * hour;
  // Paywalled, or extraction found no prose: worth another look, but not soon.
  if (status === 422 || status === 402) return 24 * hour;
  // Everything else — 500s, timeouts, a dropped connection — is a bad moment.
  return 6 * hour;
}

async function failures(): Promise<Failures> {
  return (await meta<Failures>(FAILURES)) ?? {};
}

/** Is this one still inside its back-off? */
export function shouldSkip(record: FailureRecord | undefined, now = Date.now()) {
  if (!record) return false;
  return now - record.at < retryAfterFor(record.status);
}

let failureWrites: Promise<void> = Promise.resolve();

async function rememberFailure(url: string, status: number) {
  failureWrites = failureWrites.then(async () => {
    const current = await failures();
    // Bounded: the list only has to outlive the back-off, and a device that
    // has seen ten thousand dead links does not need to remember them all.
    const entries = Object.entries({ ...current, [url]: { at: Date.now(), status } })
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, 2000);
    await setMeta(FAILURES, Object.fromEntries(entries));
  });
  await failureWrites;
}

/** A success clears the record, so a site coming back works straight away. */
async function forgetFailure(url: string) {
  failureWrites = failureWrites.then(async () => {
    const current = await failures();
    if (!(url in current)) return;
    delete current[url];
    await setMeta(FAILURES, current);
  });
  await failureWrites;
}

/** What the device has given up on for now — for the download report. */
export async function skippedLinks(now = Date.now()): Promise<string[]> {
  const current = await failures();
  return Object.entries(current)
    .filter(([, record]) => shouldSkip(record, now))
    .map(([url]) => url);
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

/**
 * Most articles one top-up will fetch. The device catches up across visits
 * instead of asking for everything at once — see the note in
 * downloadForOffline.
 */
export const MAX_PER_RUN = 60;

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
 * The photographs inside an article, put on the device with its text.
 *
 * Must match the cache name in public/sw.js — the worker is what answers the
 * browser's own <img> request from it later.
 */
const PHOTOS = "super-reader-photos-v1";

/**
 * At most this many pictures per article. A long feature can carry dozens,
 * and a downloaded library of them is the reader's storage and mobile data,
 * spent on pictures they may never scroll to. The first few are the ones the
 * article is actually about.
 */
const PHOTOS_PER_ARTICLE = 8;

/**
 * Warm the photo cache for one article.
 *
 * Opaque responses, because a publisher's CDN sends no CORS headers: they
 * cannot be read here, but they can be stored and handed to an <img>, which
 * is all that is needed. Failures are ignored on purpose — a missing picture
 * must never cost the article its download.
 */
export async function cachePhotos(html: string): Promise<number> {
  if (typeof caches === "undefined") return 0;
  const urls = [
    ...new Set(
      [...html.matchAll(/<img[^>]+src="([^"]+)"/g)]
        .map((match) => match[1])
        .filter((src) => /^https?:\/\//.test(src)),
    ),
  ].slice(0, PHOTOS_PER_ARTICLE);
  if (urls.length === 0) return 0;

  let stored = 0;
  try {
    const cache = await caches.open(PHOTOS);
    await Promise.all(
      urls.map(async (url) => {
        try {
          if (await cache.match(url)) return;
          const response = await fetch(url, { mode: "no-cors", credentials: "omit" });
          if (response.ok || response.type === "opaque") {
            await cache.put(url, response);
            stored += 1;
          }
        } catch {
          /* one picture that would not come; the article is still readable */
        }
      }),
    );
  } catch {
    /* no Cache Storage on this device */
  }
  return stored;
}

/** Drop stored photographs for articles the device no longer holds. */
export async function prunePhotos(keepHtml: string[]) {
  if (typeof caches === "undefined") return;
  try {
    const wanted = new Set(
      keepHtml.flatMap((html) =>
        [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((match) => match[1]),
      ),
    );
    const cache = await caches.open(PHOTOS);
    for (const request of await cache.keys()) {
      if (!wanted.has(request.url)) await cache.delete(request);
    }
  } catch {
    /* nothing stored, or storage unavailable */
  }
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
  /** Most articles to fetch in one run — see the note on `wanted` below. */
  limit = MAX_PER_RUN,
): Promise<{ saved: number; failed: number; skipped: number }> {
  const seen = new Set<string>();
  const deduped = targets.filter((t) => {
    if (seen.has(t.url)) return false;
    seen.add(t.url);
    return true;
  });

  /*
   * Leave alone what the server has already failed to read, until its
   * back-off is up. This is the whole of the 502 storm: without it the
   * top-up re-asks for every dead article on every visit, every return to
   * the foreground and every reconnection.
   */
  const known = await failures();
  const now = Date.now();
  const live = deduped.filter((t) => !shouldSkip(known[t.url], now));

  /*
   * A ceiling on one run. Seventy-nine sources at fifteen articles each is
   * about twelve hundred extractions, and the top-up fires on every visit,
   * every return to the foreground and every reconnection — so one reader
   * flicking between apps can ask for more in an afternoon than the whole
   * plan allows in a month. Bookmarks sort first (see offlineTargets), so
   * what matters is fetched first and the rest arrives over the next few
   * visits rather than all at once.
   */
  const wanted = live.slice(0, limit);
  const skipped = deduped.length - wanted.length;

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
          if (!res.ok) {
            // Remembered with its status, because what the status means for
            // trying again differs by an order of magnitude — see
            // retryAfterFor.
            await rememberFailure(url, res.status);
            throw new Error(`failed ${res.status}`);
          }
          const article = await res.json();
          // The publisher served the preview it shows a stranger. Storing that
          // would put a stub on the device under the headline of the article,
          // and keep serving it after a subscription starts working — the
          // cache is read before the network. Left unstored, it is simply
          // fetched again next time, by which point it may be readable.
          if (article?.paywalled) {
            // Not a server failure, but not worth re-asking every hour either.
            await rememberFailure(url, 402);
            return;
          }
          await writeCached(article, url);
          // The pictures too, or a downloaded article opens on a train as a
          // headline, its words, and a column of empty boxes.
          if (typeof article?.html === "string") await cachePhotos(article.html);
          await forgetFailure(url);
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
    for (const target of deduped) {
      const filed = await filedUnder(target.url);
      if (filed) storedKeys.add(filed);
    }
    // Pruning compares against everything this device wants, not just what
    // this run fetched — an article skipped for its back-off is still wanted.
    await pruneTo(storedKeys, new Set(deduped.map((t) => t.url)));
  }
  return { saved, failed, skipped };
}
