/**
 * Links in writing, as a Google Doc has them. A pasted address goes in as
 * the address, linked — never as a story of the subject on its own. Clicking
 * it offers what it could be instead: a chip (the page's headline, set off
 * as one piece of linked text, but still words the writer can edit) or a
 * story card. Either way it opens in the reader, unless the writer marked it
 * to open on the site itself.
 *
 * In the saved HTML a chip is an ordinary link marked `data-link="chip"`,
 * and a link that opens on its site carries `data-web`. Both survive the
 * sanitiser (lib/subjects.ts), copy, paste and sync as any link does.
 */

import { EXTRACT_VERSION } from "./offline";

/** A link in writing was opened: the subject page shows it in the reader. Cancelled when handled. */
export const LINK_OPEN_EVENT = "super-reader:link-open";

export type LinkInfo = { title?: string; site?: string };

/** The site a link goes to, for showing: "nytimes.com". */
export function hostOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}

const known = new Map<string, Promise<LinkInfo>>();

/**
 * A page's headline and site name, read once per address for as long as the
 * app is open. Through the article route, whose answers are cached at the
 * edge, so a link previewed twice or on two devices is read once. Nothing is
 * kept when the page will not answer: the preview shows its address instead.
 */
export function linkInfo(href: string): Promise<LinkInfo> {
  const held = known.get(href);
  if (held) return held;
  const asked = (async (): Promise<LinkInfo> => {
    try {
      const res = await fetch(`/api/article?url=${encodeURIComponent(href)}&x=${EXTRACT_VERSION}`);
      if (!res.ok) return {};
      const data = (await res.json()) as { title?: string; siteName?: string };
      return {
        title: data.title?.replace(/\s+/g, " ").trim().slice(0, 300) || undefined,
        site: data.siteName?.replace(/\s+/g, " ").trim().slice(0, 120) || undefined,
      };
    } catch {
      return {};
    }
  })();
  known.set(href, asked);
  return asked;
}

/**
 * Open a link from writing: in the reader, where the subject page is there
 * to show it, or on its site — in a new tab — when it is marked to, or when
 * nothing answered the event.
 */
export function openLink(href: string, title: string, web: boolean) {
  if (!web && typeof window !== "undefined") {
    const event = new CustomEvent(LINK_OPEN_EVENT, { detail: { href, title }, cancelable: true });
    if (!window.dispatchEvent(event)) return;
  }
  window.open(href, "_blank", "noopener,noreferrer");
}
