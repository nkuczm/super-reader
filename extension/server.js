/*
 * Where Super Reader lives, for the popup and the background worker alike.
 *
 * The app moved from Vercel to Cloud Run in November 2026 and its address
 * changed with it. A saved address that no longer answers is the whole
 * failure: nothing says so, the popup just asks to connect again and the
 * scan-in badge says "!". So the address is not taken on trust:
 *
 * - an address the app has left (OLD_SERVERS) is forgotten on sight;
 * - a saved address that does not answer is replaced by one that does,
 *   found among the tabs open in this browser that are Super Reader —
 *   signed in, since that is the only thing the extension can use.
 *
 * Only tabs that call themselves Super Reader are asked, so the extension
 * never sends requests to whatever else happens to be open.
 */

const DEFAULT_SERVER = "https://super-reader.cloud.run";

/** Addresses the app no longer runs at. A device saved with one is moved on. */
const OLD_SERVERS = ["https://super-reader-wine.vercel.app"];

function cleanServer(server) {
  return String(server || "").trim().replace(/\/+$/, "");
}

/** The saved address, or the default — never one the app has left, unless it is all there is. */
async function savedServer() {
  const { server = "" } = await chrome.storage.local.get("server");
  const saved = cleanServer(server);
  if (saved && !OLD_SERVERS.includes(saved)) return saved;
  return DEFAULT_SERVER;
}

/** Whether this address is Super Reader with this browser signed in (or holding this sync code). */
async function answers(server, code = "") {
  try {
    const res = await fetch(`${server}/api/inbox${code ? `?code=${encodeURIComponent(code)}` : ""}`, { cache: "no-store", credentials: "include" });
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    return Boolean(data && typeof data === "object");
  } catch {
    return false;
  }
}

/** Super Reader tabs open in this browser, by their address. */
async function openAppOrigins() {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return [];
  }
  const origins = [];
  for (const tab of tabs) {
    if (!tab.url || !/super reader/i.test(tab.title || "")) continue;
    try {
      const u = new URL(tab.url);
      if (u.protocol !== "https:" && u.hostname !== "localhost") continue;
      if (!origins.includes(u.origin)) origins.push(u.origin);
    } catch {
      /* not an address */
    }
  }
  return origins;
}

/**
 * The address to use: the saved one if it answers, otherwise an open
 * Super Reader tab's that does (saved for next time), otherwise the saved
 * one anyway so the caller can say what failed.
 */
async function resolveServer(code = "") {
  const saved = await savedServer();
  if (await answers(saved, code)) return { server: saved, ok: true };
  for (const origin of await openAppOrigins()) {
    if (origin === saved || OLD_SERVERS.includes(origin)) continue;
    if (await answers(origin, code)) {
      await chrome.storage.local.set({ server: origin });
      return { server: origin, ok: true };
    }
  }
  return { server: saved, ok: false };
}
