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

// The address the app is used at, and so where the Google sign-in's cookie
// lives: the extension is signed in only where the reader signed in. 1.5.2
// called this address dead (it was measured from a network that could not
// reach it) and the extension then refused it even when typed in.
const DEFAULT_SERVER = "https://super-reader.cloud.run";

/** Cloud Run's own address for the same service: tried when the default does not answer. */
const OTHER_SERVERS = ["https://super-reader-j6zkelkjva-uk.a.run.app"];

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

/**
 * The extension's own sign-in for an address, if it has one. Chrome does not
 * always send the app's cookie with an extension's request (on Nathan's
 * Chrome it did not, 20 Nov 2026), so the extension asks the app for a token
 * of its own and sends it itself. Kept per address, and sent only there.
 */
async function tokenFor(server) {
  const { tokens = {} } = await chrome.storage.local.get("tokens");
  return typeof tokens[server] === "string" ? tokens[server] : "";
}

async function keepToken(server, token) {
  const { tokens = {} } = await chrome.storage.local.get("tokens");
  if (token) tokens[server] = token;
  else delete tokens[server];
  await chrome.storage.local.set({ tokens });
}

/** A request to the app's inbox, signed in by the extension's token where it has one, and by the cookie anyway. */
async function inboxFetch(server, { query = "", ...init } = {}) {
  const token = await tokenFor(server);
  const headers = { ...(init.headers || {}), ...(token ? { authorization: `Bearer ${token}` } : {}) };
  return fetch(`${server}/api/inbox${query}`, { cache: "no-store", credentials: "include", ...init, headers });
}

/**
 * Asks a Super Reader tab at this address for a token. The request runs in
 * the tab's own page, so it is the app asking itself: its cookie, its origin.
 */
async function tokenFromTab(server) {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return "";
  }
  for (const tab of tabs) {
    try {
      if (!tab.url || new URL(tab.url).origin !== server) continue;
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: async () => {
          try {
            const res = await fetch("/api/extension/token", { method: "POST", credentials: "same-origin" });
            return res.ok ? await res.json() : null;
          } catch {
            return null;
          }
        },
      });
      if (result && typeof result.token === "string") {
        await keepToken(server, result.token);
        return result.token;
      }
    } catch {
      /* a tab the extension may not read; try the next */
    }
  }
  return "";
}

async function inboxAnswers(server, code) {
  try {
    const res = await inboxFetch(server, { query: code ? `?code=${encodeURIComponent(code)}` : "" });
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    return Boolean(data && typeof data === "object");
  } catch {
    return false;
  }
}

/** Whether this address is Super Reader with this browser signed in (or holding this sync code). */
async function answers(server, code = "") {
  if (await inboxAnswers(server, code)) return true;
  // Not signed in as far as the extension's request goes: a token from a
  // signed-in Super Reader tab at this address, if one is open.
  if (code) return false;
  if (await tokenFor(server)) await keepToken(server, "");
  return Boolean(await tokenFromTab(server)) && inboxAnswers(server, code);
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
  const candidates = [...(await openAppOrigins()), DEFAULT_SERVER, ...OTHER_SERVERS];
  for (const origin of [...new Set(candidates)]) {
    if (origin === saved || OLD_SERVERS.includes(origin)) continue;
    if (await answers(origin, code)) {
      await chrome.storage.local.set({ server: origin });
      return { server: origin, ok: true };
    }
  }
  return { server: saved, ok: false };
}
