/**
 * Prompts in empty fields ("Write anything…", "Add notes…") are for someone
 * meeting a feature for the first time. Once a person has used it, the prompt
 * is noise: it shows in every empty box on the page. So each prompt is shown
 * only until that kind of field has been written in once on this device.
 */

const KEY = "super-reader:used-fields";

export type Feature = "text" | "card-note" | "caption" | "section" | "node" | "doc-start" | "quote-note" | "contact-notes";

let used: Set<string> | null = null;

function load(): Set<string> {
  if (used) return used;
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    used = new Set(Array.isArray(list) ? list.filter((f): f is string => typeof f === "string") : []);
  } catch {
    used = new Set();
  }
  return used;
}

/** The prompt to show in an empty field of this kind: the text the first time, nothing after. */
export function hint(feature: Feature, text: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  return load().has(feature) ? undefined : text;
}

/** This kind of field has been written in: its prompt is not shown again. */
export function markUsed(feature: Feature) {
  if (typeof window === "undefined") return;
  const set = load();
  if (set.has(feature)) return;
  set.add(feature);
  try {
    localStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {
    /* not remembered: the prompt shows again next visit */
  }
}
