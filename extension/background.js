/*
 * "Scan it in yourself": when Super Reader can't read an article (the site
 * refuses its server), its reader opens the original in a new tab with
 * #super-reader-capture on the address. This sees that marker — and only
 * that — waits for the page to settle, reads it the same way the popup's
 * Save does, files it to the reader's inbox, then closes the tab and returns
 * to the tab it came from. The fragment never reaches the publisher's server.
 */

const MARK = "super-reader-capture";
const DEFAULT_SERVER = "https://super-reader-wine.vercel.app";
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
    const { code = "", server = DEFAULT_SERVER } = await chrome.storage.local.get(["code", "server"]);
    if (!code) {
      await badge(tab.id, "!", "Open the Super Reader extension and paste your sync code first.");
      return;
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["vendor/Readability.js", "extract.js"] });
    const [{ result: page }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.__superReaderExtract(),
    });
    if (!page || !page.html) {
      await badge(tab.id, "?", "No article found on this page to scan in.");
      return;
    }
    page.url = withoutMark(page.url);
    page.selection = "";
    const res = await fetch(`${server.replace(/\/+$/, "")}/api/inbox`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, article: page }),
    });
    if (!res.ok) {
      await badge(tab.id, "!", `Super Reader didn't accept the page (${res.status}).`);
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
    await badge(tab.id, "!", `Couldn't scan this page: ${error.message || error}`);
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

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "complete" && tab.url && marked(tab.url)) void capture(tab);
});
