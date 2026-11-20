/*
 * "Scan it in yourself": when Super Reader can't read an article (the site
 * refuses its server), its reader opens the original in a new tab with
 * #super-reader-capture on the address. This sees that marker — and only
 * that — waits for the page to settle, reads it the same way the popup's
 * Save does, files it to the reader's inbox, then closes the tab and returns
 * to the tab it came from. The fragment never reaches the publisher's server.
 */

const MARK = "super-reader-capture";
importScripts("server.js"); // resolveServer(): where Super Reader is now
const busy = new Set();

function marked(url) {
  try {
    return new URL(url).hash.replace(/^#/, "").split("&").includes(MARK);
  } catch {
    return false;
  }
}

function withoutMark(url) {
  const u = new URL(url);
  const rest = u.hash.replace(/^#/, "").split("&").filter((p) => p && p !== MARK);
  u.hash = rest.length ? rest.join("&") : "";
  return u.toString();
}

async function capture(tab) {
  if (busy.has(tab.id)) return;
  busy.add(tab.id);
  try {
    // Pages that build the article with JavaScript need a moment after "complete".
    await new Promise((r) => setTimeout(r, 1800));
    const { code = "" } = await chrome.storage.local.get("code");
    // The reader opened this tab from Super Reader, so a Super Reader tab is open:
    // if the saved address has stopped answering, that tab's is the one to use.
    const { server } = await resolveServer(code);
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["vendor/Readability.js", "extract.js"] });
    // A YouTube video: its transcript, as this browser sees it, is the text.
    const youtube = /(^|\.)youtube\.com$/.test(new URL(tab.url).hostname);
    const [{ result: page }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: youtube ? () => window.__superReaderYoutube() : () => window.__superReaderExtract(),
    });
    if (!page || !page.html) {
      await badge(tab.id, "?", youtube ? "This video has no transcript to scan in." : "No article found on this page to scan in.");
      return;
    }
    page.url = withoutMark(page.url);
    page.selection = "";
    const res = await fetch(`${server}/api/inbox`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...(code ? { code } : {}), article: page }),
    });
    if (!res.ok) {
      await badge(tab.id, "!", res.status === 404 ? "Sign in to Super Reader with Google in this browser first." : `Super Reader didn't accept the page (${res.status}).`);
      return;
    }
    // Back to where the reader asked for it; the article is waiting there.
    if (tab.openerTabId != null) {
      try {
        await chrome.tabs.update(tab.openerTabId, { active: true });
      } catch {
        /* the opener has gone; stay */
      }
    }
    await chrome.tabs.remove(tab.id);
  } catch (error) {
    const message = String(error.message || error);
    await badge(
      tab.id,
      "!",
      /cannot access|permission/i.test(message)
        ? "Chrome isn't letting Super Reader read this site. chrome://extensions → Super Reader → Details → Site access → On all sites."
        : /failed to fetch/i.test(message)
          ? "Couldn't reach Super Reader to file this page. Open the extension and press Connect."
          : `Couldn't scan this page: ${message}`,
    );
  } finally {
    busy.delete(tab.id);
  }
}

/** Something went wrong: say so on the toolbar icon, in this tab. */
async function badge(tabId, text, title) {
  try {
    await chrome.action.setBadgeText({ tabId, text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#dc2626" });
    await chrome.action.setTitle({ tabId, title });
  } catch {
    /* tab gone */
  }
}

// A tab is remembered from the moment it is asked for with the marker, not only
// when it finishes loading with it: plenty of publishers' pages tidy their own
// address as they load (history.replaceState), and the marker went with it, so
// the tab finished loading looking like any other and nothing was scanned.
// Kept in session storage, which outlives this worker being put to sleep.
async function remember(tabId) {
  const { captureTabs = [] } = await chrome.storage.session.get("captureTabs");
  if (!captureTabs.includes(tabId)) await chrome.storage.session.set({ captureTabs: [...captureTabs, tabId] });
}

/** Whether this tab was asked for with the marker; forgets it either way once it has loaded. */
async function claim(tabId) {
  const { captureTabs = [] } = await chrome.storage.session.get("captureTabs");
  if (!captureTabs.includes(tabId)) return false;
  await chrome.storage.session.set({ captureTabs: captureTabs.filter((id) => id !== tabId) });
  return true;
}

chrome.tabs.onCreated.addListener((tab) => {
  if (marked(tab.pendingUrl || tab.url || "")) void remember(tab.id);
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.url && marked(info.url)) await remember(tabId);
  if (info.status !== "complete" || !tab.url) return;
  const asked = await claim(tabId);
  if (asked || marked(tab.url)) void capture(tab);
});

chrome.tabs.onRemoved.addListener((tabId) => void claim(tabId));
