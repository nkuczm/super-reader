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

export type CachedArticle = ReadableArticle & { cachedAt: number };

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
    return (await run<CachedArticle>(ARTICLES, "readonly", (s) => s.get(url))) ?? null;
  } catch {
    return null;
  }
}

export async function writeCached(article: ReadableArticle) {
  try {
    await run(ARTICLES, "readwrite", (s) =>
      s.put({ ...article, cachedAt: Date.now() }),
    );
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

/** Drop anything no longer in the newest set, so the store cannot grow forever. */
export async function pruneTo(keep: Set<string>) {
  try {
    for (const url of await cachedUrls()) {
      if (!keep.has(url)) {
        await run(ARTICLES, "readwrite", (s) => s.delete(url));
      }
    }
  } catch {
    /* ignore */
  }
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

/** How many of each source's newest stories are kept for offline reading. */
export const PER_SOURCE = 15;

export type DownloadProgress = { done: number; total: number };

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
): Promise<{ saved: number; failed: number }> {
  const seen = new Set<string>();
  const wanted = targets.filter((t) => {
    if (seen.has(t.url)) return false;
    seen.add(t.url);
    return true;
  });
  let saved = 0;
  let failed = 0;

  const concurrency = 3;
  for (let i = 0; i < wanted.length; i += concurrency) {
    const batch = wanted.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async ({ url, feedUrl, title }) => {
        try {
          // Already stored from an earlier run — no need to fetch again.
          if (await readCached(url)) {
            saved += 1;
            return;
          }
          const res = await fetch(articleEndpoint(url, feedUrl, title));
          if (!res.ok) throw new Error("failed");
          await writeCached(await res.json());
          saved += 1;
        } catch {
          failed += 1;
        }
      }),
    );
    onProgress?.({ done: Math.min(i + concurrency, wanted.length), total: wanted.length });
  }

  await pruneTo(new Set(wanted.map((t) => t.url)));
  return { saved, failed };
}
