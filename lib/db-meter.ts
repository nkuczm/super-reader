/**
 * Counting what each request costs the database: bytes sent to it, bytes
 * read back, queries and time, credited to a part of the app (and an
 * account, where one is signed in). The counting happens in lib/db.ts for
 * every query; lib/db-usage.ts starts a count per request and stores it.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export type Meter = { category: string; account: string | null; bytesIn: number; bytesOut: number; queries: number; ms: number };

export const meterStore = new AsyncLocalStorage<Meter>();

/** Add one query to the request being counted, if any. */
export function record(sent: number, received: number, ms: number) {
  const m = meterStore.getStore();
  if (!m) return;
  m.bytesOut += sent;
  m.bytesIn += received;
  m.queries += 1;
  m.ms += ms;
}

/** Credit the request being counted to this account. */
export function attribute(account: string) {
  const m = meterStore.getStore();
  if (m) m.account = account;
}
