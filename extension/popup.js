/*
 * Super Reader — save the article in this tab.
 *
 * The page is read here, in the reader's own browser, with Mozilla's
 * Readability (the same library the app uses on its server): the text is
 * the copy this browser was given, subscriptions included. It is posted to
 * the app's inbox under the reader's sync code; the app files it into Saved
 * and, if one was chosen, a subject, the next time it syncs.
 */

const DEFAULT_SERVER = "https://super-reader-wine.vercel.app";
const $ = (id) => document.getElementById(id);

let page = null;

async function settings() {
  const { code = "", server = DEFAULT_SERVER } = await chrome.storage.local.get(["code", "server"]);
  return { code, server: server.replace(/\/+$/, "") || DEFAULT_SERVER };
}

function show(id) {
  for (const section of ["setup", "save"]) $(section).hidden = section !== id;
}

function status(text, kind = "") {
  const el = $("status");
  el.hidden = !text;
  el.textContent = text;
  el.className = `status ${kind}`;
}

/** Runs inside the page: the article as Readability reads it, and any selection. */
function extractArticle() {
  const meta = (names) => {
    for (const name of names) {
      const el = document.querySelector(`meta[property="${name}"], meta[name="${name}"], meta[itemprop="${name}"]`);
      const value = el && el.getAttribute("content");
      if (value) return value.trim();
    }
    return undefined;
  };
  const selection = String(window.getSelection() || "").replace(/\s+/g, " ").trim();
  let parsed = null;
  try {
    // A copy: Readability rearranges the document it is given.
    parsed = new Readability(document.cloneNode(true), { charThreshold: 250 }).parse();
  } catch (error) {
    parsed = null;
  }
  const time = document.querySelector("time[datetime]");
  return {
    url: location.href,
    title: (parsed && parsed.title) || meta(["og:title", "twitter:title"]) || document.title,
    byline: (parsed && parsed.byline) || meta(["author", "article:author"]),
    siteName: (parsed && parsed.siteName) || meta(["og:site_name"]),
    publishedAt:
      (parsed && parsed.publishedTime) ||
      meta(["article:published_time", "datePublished", "date"]) ||
      (time && time.getAttribute("datetime")) ||
      undefined,
    html: parsed && parsed.content ? parsed.content : "",
    excerpt: (parsed && parsed.excerpt) || meta(["og:description", "description"]),
    selection: selection.slice(0, 4000),
  };
}

async function readPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/.test(tab.url || "")) throw new Error("This page can't be saved — open an article first.");
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["vendor/Readability.js"] });
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractArticle });
  return result;
}

async function loadSubjects() {
  const { code, server } = await settings();
  try {
    const res = await fetch(`${server}/api/inbox?code=${encodeURIComponent(code)}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    const select = $("subject");
    for (const subject of data.subjects || []) {
      const option = document.createElement("option");
      option.value = subject.id;
      option.textContent = subject.name;
      select.appendChild(option);
    }
    const make = document.createElement("option");
    make.value = "__new";
    make.textContent = "+ New subject…";
    select.appendChild(make);
    const { lastSubject } = await chrome.storage.local.get("lastSubject");
    if (lastSubject && [...select.options].some((o) => o.value === lastSubject)) select.value = lastSubject;
  } catch {
    /* saving still works without the list */
  }
}

async function startSave() {
  show("save");
  void loadSubjects();
  try {
    page = await readPage();
    $("title").textContent = page.title || page.url;
    $("meta").textContent = [page.siteName, page.byline].filter(Boolean).join(" · ") || new URL(page.url).hostname;
    if (page.selection) {
      $("quote-wrap").hidden = false;
      $("quote").textContent = `“${page.selection}”`;
    }
    if (!page.html) status("Couldn't find an article on this page — it will be saved by its link.", "");
    $("save-btn").disabled = false;
  } catch (error) {
    $("title").textContent = "Can't read this page";
    status(error.message || String(error), "error");
  }
}

$("subject").addEventListener("change", () => {
  $("new-subject").hidden = $("subject").value !== "__new";
  if (!$("new-subject").hidden) $("new-subject").focus();
});

$("save-btn").addEventListener("click", async () => {
  if (!page) return;
  const { code, server } = await settings();
  const choice = $("subject").value;
  const body = {
    code,
    article: page,
    subjectId: choice && choice !== "__new" ? choice : undefined,
    newSubject: choice === "__new" ? $("new-subject").value.trim() || undefined : undefined,
    quote: page.selection || undefined,
    note: $("note").value.trim() || undefined,
  };
  $("save-btn").disabled = true;
  status("Saving…");
  try {
    const res = await fetch(`${server}/api/inbox`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Could not save (${res.status})`);
    await chrome.storage.local.set({ lastSubject: choice === "__new" ? "" : choice });
    status("Saved — it will appear in Super Reader on your next visit.", "done");
    setTimeout(() => window.close(), 1400);
  } catch (error) {
    status(error.message || String(error), "error");
    $("save-btn").disabled = false;
  }
});

$("connect").addEventListener("click", async () => {
  const code = $("code").value.trim();
  const server = ($("server").value.trim() || DEFAULT_SERVER).replace(/\/+$/, "");
  const error = $("setup-error");
  error.hidden = true;
  if (!code) return;
  try {
    // Another deployment needs permission to talk to it.
    if (server !== DEFAULT_SERVER) {
      const granted = await chrome.permissions.request({ origins: [`${new URL(server).origin}/*`] });
      if (!granted) throw new Error("Permission to reach that server was not given.");
    }
    const res = await fetch(`${server}/api/inbox?code=${encodeURIComponent(code)}`, { cache: "no-store" });
    if (!res.ok) throw new Error(res.status === 404 ? "That sync code wasn't found." : `Couldn't reach Super Reader (${res.status}).`);
    await chrome.storage.local.set({ code, server });
    void startSave();
  } catch (e) {
    error.textContent = e.message || String(e);
    error.hidden = false;
  }
});

$("disconnect").addEventListener("click", async () => {
  await chrome.storage.local.remove(["code", "lastSubject"]);
  show("setup");
});

(async () => {
  const { code, server } = await settings();
  $("server").value = server;
  if (code) void startSave();
  else show("setup");
})();
