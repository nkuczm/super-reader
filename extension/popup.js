/*
 * Super Reader — save the article in this tab.
 *
 * The page is read here, in the reader's own browser, with Mozilla's
 * Readability (the same library the app uses on its server): the text is
 * the copy this browser was given, subscriptions included. It is posted to
 * the app's inbox under the reader's Google sign-in (the app's own session in
 * this browser) — or, for someone still on an old sync code, that code — and
 * the app files it into Saved and, if one was chosen, a subject.
 */

const DEFAULT_SERVER = "https://super-reader-wine.vercel.app";
const $ = (id) => document.getElementById(id);

let page = null;

async function settings() {
  const { code = "", server = DEFAULT_SERVER } = await chrome.storage.local.get(["code", "server"]);
  return { code, server: server.replace(/\/+$/, "") || DEFAULT_SERVER };
}

function show(id) {
  for (const section of ["setup", "save", "person"]) $(section).hidden = section !== id;
}

/** A LinkedIn profile page: what the popup offers there is "add as a contact". */
function isProfile(url) {
  try {
    const u = new URL(url);
    return /(^|\.)linkedin\.com$/.test(u.hostname) && /^\/in\/[^/]+/.test(u.pathname);
  } catch {
    return false;
  }
}

/**
 * Runs inside the profile page, on what the reader is looking at: the name,
 * the headline under it, and the address of the profile photo. Nothing is
 * fetched from the page's side — this only reads what is already on screen.
 */
function extractProfile() {
  const text = (el) => (el && el.textContent ? el.textContent.replace(/\s+/g, " ").trim() : "");
  const h1 = document.querySelector("main h1") || document.querySelector("h1");
  const name = text(h1) || document.title.replace(/\s*\|\s*LinkedIn.*$/i, "").replace(/^\(\d+\)\s*/, "").trim();
  // The headline sits just after the name block.
  let role = "";
  const section = h1 && (h1.closest("section") || h1.parentElement);
  if (section) {
    const candidate = section.querySelector(".text-body-medium, [data-generated-suggestion-target]");
    role = text(candidate);
  }
  if (!role) {
    const og = document.querySelector('meta[property="og:description"], meta[name="description"]');
    role = og ? (og.getAttribute("content") || "").split("·")[0].trim().slice(0, 160) : "";
  }
  // The profile photo, by its address rather than LinkedIn's class names,
  // which change: their profile pictures are served as "profile-displayphoto".
  // The largest on the page is the person's own; small ones are people in
  // the sidebar.
  const firstWord = name.split(" ")[0] || "";
  const imgs = [...document.querySelectorAll("img")].filter((img) => (img.currentSrc || img.src || "").startsWith("https://"));
  const size = (img) => Math.max(img.naturalWidth || 0, img.getBoundingClientRect().width || 0);
  const byAddress = imgs
    .filter((img) => /profile-displayphoto|profile-framedphoto/i.test(img.currentSrc || img.src))
    .sort((a, b) => size(b) - size(a));
  const byName = imgs
    .filter((img) => firstWord && (img.alt || "").includes(firstWord) && size(img) >= 80)
    .sort((a, b) => size(b) - size(a));
  const pick = byAddress[0] || byName[0];
  const og = document.querySelector('meta[property="og:image"]');
  const ogImage = og && /^https:\/\//.test(og.getAttribute("content") || "") ? og.getAttribute("content") : "";
  const photo = pick ? { src: pick.currentSrc || pick.src } : ogImage ? { src: ogImage } : null;
  const canonical = location.origin + location.pathname.replace(/\/(overlay|details|recent-activity)\/.*$/, "").replace(/\/+$/, "");
  return { name, role: role.slice(0, 200), photo: photo ? photo.src : "", url: canonical };
}

let person = null;

/** The photo, made small and kept as data: a 160px JPEG. */
async function photoData(src) {
  const res = await fetch(src, { credentials: "omit" });
  if (!res.ok) throw new Error(`the image host answered ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob());
  const size = 160;
  const scale = size / Math.min(bitmap.width, bitmap.height);
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 });
  return await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

/** Fills a subject list from scratch — however many times it is asked to. */
async function fillSubjects(select, { required, keep = 0 }) {
  const run = (select.dataset.run = String(Number(select.dataset.run || 0) + 1));
  const { code, server } = await settings();
  let subjects = [];
  try {
    const res = await fetch(`${server}/api/inbox${code ? `?code=${encodeURIComponent(code)}` : ""}`, { cache: "no-store", credentials: "include" });
    const data = res.ok ? await res.json() : {};
    subjects = data.subjects || [];
  } catch {
    /* only "new subject" then */
  }
  // A later fill started while this one waited: let it do the work.
  if (select.dataset.run !== run) return;
  while (select.options.length > keep) select.remove(keep);
  const seen = new Set();
  for (const subject of subjects) {
    if (seen.has(subject.id)) continue;
    seen.add(subject.id);
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
  else if (required && select.options.length) select.selectedIndex = 0;
}

async function startPerson(tab) {
  show("person");
  void fillSubjects($("person-subject"), { required: true }).then(() => {
    $("person-new-subject").hidden = $("person-subject").value !== "__new";
  });
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractProfile });
    person = result;
    $("person-name").value = person.name;
    $("person-role").value = person.role;
    if (person.photo) {
      $("person-photo").src = person.photo;
      $("person-photo").hidden = false;
    } else {
      $("person-with-photo").closest("label").hidden = true;
    }
    $("person-save").disabled = false;
  } catch (error) {
    personStatus("Couldn't read this profile — fill in the name and role yourself.", "error");
    person = { name: "", role: "", photo: "", url: tab.url };
    $("person-save").disabled = false;
  }
}

function personStatus(text, kind = "") {
  const el = $("person-status");
  el.hidden = !text;
  el.textContent = text;
  el.className = `status ${kind}`;
}

$("person-subject").addEventListener("change", () => {
  $("person-new-subject").hidden = $("person-subject").value !== "__new";
  if (!$("person-new-subject").hidden) $("person-new-subject").focus();
});

$("person-save").addEventListener("click", async () => {
  const name = $("person-name").value.trim();
  if (!name) return personStatus("Add their name first.", "error");
  const choice = $("person-subject").value;
  const newSubject = choice === "__new" ? $("person-new-subject").value.trim() : "";
  if (choice === "__new" && !newSubject) return personStatus("Name the new subject.", "error");
  $("person-save").disabled = true;
  let photo;
  let photoProblem = "";
  if (person && $("person-with-photo").checked) {
    if (!person.photo) photoProblem = "No photo found on this profile.";
    else {
      try {
        // Allowed at install (manifest host_permissions), so no prompt here —
        // a prompt opened from a popup can close it and lose the photo.
        photo = await photoData(person.photo);
      } catch (error) {
        photoProblem = `Couldn't fetch their photo (${error.message || error}).`;
      }
    }
  }
  personStatus("Adding…");
  const { code, server } = await settings();
  try {
    const res = await fetch(`${server}/api/inbox`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(code ? { code } : {}),
        subjectId: choice !== "__new" ? choice : undefined,
        newSubject: newSubject || undefined,
        note: $("person-note").value.trim() || undefined,
        contact: { name, role: $("person-role").value.trim(), linkedin: person && person.url, photo },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Could not add (${res.status})`);
    if (choice !== "__new") await chrome.storage.local.set({ lastSubject: choice });
    // Said plainly when the photo did not come along, rather than added
    // without it in silence.
    personStatus(
      `Added ${name} — they'll be in the subject's contacts on your next visit.${photoProblem ? ` ${photoProblem}` : ""}`,
      photoProblem ? "" : "done",
    );
    if (!photoProblem) setTimeout(() => window.close(), 1600);
  } catch (error) {
    personStatus(error.message || String(error), "error");
    $("person-save").disabled = false;
  }
});

function status(text, kind = "") {
  const el = $("status");
  el.hidden = !text;
  el.textContent = text;
  el.className = `status ${kind}`;
}

async function readPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https?:/.test(tab.url || "")) throw new Error("This page can't be saved — open an article first.");
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["vendor/Readability.js", "extract.js"] });
  // On a YouTube video, the transcript is what gets saved, when it has one.
  if (/(^|\.)youtube\.com$/.test(new URL(tab.url).hostname)) {
    const [{ result: video }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.__superReaderYoutube() });
    if (video) return video;
  }
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.__superReaderExtract() });
  return result;
}

async function loadSubjects() {
  await fillSubjects($("subject"), { required: false, keep: 1 });
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
    ...(code ? { code } : {}),
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
      credentials: "include",
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
  try {
    // Another deployment needs permission to talk to it.
    if (server !== DEFAULT_SERVER) {
      const granted = await chrome.permissions.request({ origins: [`${new URL(server).origin}/*`] });
      if (!granted) throw new Error("Permission to reach that server was not given.");
    }
    const res = await fetch(`${server}/api/inbox${code ? `?code=${encodeURIComponent(code)}` : ""}`, { cache: "no-store", credentials: "include" });
    if (!res.ok) {
      throw new Error(
        res.status === 404
          ? code
            ? "That sync code wasn't found. Sign in to Super Reader with Google instead."
            : "Not signed in yet: open Super Reader in this browser and sign in with Google."
          : `Couldn't reach Super Reader (${res.status}).`,
      );
    }
    await chrome.storage.local.set({ code, server });
    void start();
  } catch (e) {
    error.textContent = e.message || String(e);
    error.hidden = false;
  }
});

for (const button of document.querySelectorAll("[data-disconnect]")) {
  button.addEventListener("click", async () => {
    await chrome.storage.local.remove(["code", "lastSubject"]);
    show("setup");
  });
}

/** After connecting, or on opening: a profile gets the contact form, anything else the save form. */
async function start() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && isProfile(tab.url || "")) return startPerson(tab);
  return startSave();
}

/** Signed in to Super Reader in this browser: its session reaches the account's inbox, no code needed. */
async function signedIn(server) {
  try {
    const res = await fetch(`${server}/api/inbox`, { cache: "no-store", credentials: "include" });
    return res.ok;
  } catch {
    return false;
  }
}

(async () => {
  const { code, server } = await settings();
  $("server").value = server;
  if (code || (await signedIn(server))) void start();
  else show("setup");
})();
