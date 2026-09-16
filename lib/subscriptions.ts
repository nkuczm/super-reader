/**
 * Reading an outlet you pay for.
 *
 * The big papers have no full-text feed and no public API for their prose —
 * measured, and written down in docs/COLLECTION.md §8. To a request that is
 * not a signed-in subscriber they serve a stub: a headline, two paragraphs
 * and a wall. The only thing that changes that answer is the session the
 * publisher gave *you* when you paid them.
 *
 * So a subscription here is one stored cookie per site, kept in the same
 * passphrase-encrypted vault as the API keys (lib/vault.ts) and travelling
 * the same way: encrypted at rest, decrypted only in the browser, and sent to
 * the server in a header for the one request that needs it. The server
 * attaches it to that fetch and keeps nothing.
 *
 * Two rules fall out of that and are not negotiable:
 *
 *  - A page fetched with a credential is *that reader's* copy. It must never
 *    reach a shared cache. `app/api/article/route.ts` marks those responses
 *    private and uncacheable, which is the one thing in this feature that
 *    would be a real problem to get wrong.
 *  - A credential is used only for the host it was stored for. Never sent
 *    anywhere else, however the article was linked.
 */

import type { Secrets } from "./vault";
import { jsonLdBlocks } from "./structured";

/** Marks a vault entry as a site credential rather than an API key. */
export const SUB_PREFIX = "sub:";

/** The site a credential belongs to, as it is stored: bare, lowercase, no www. */
export function normaliseHost(input: string): string {
  const raw = input.trim().toLowerCase();
  if (!raw) return "";
  let host = raw;
  try {
    host = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    return "";
  }
  return host.replace(/^www\./, "");
}

export function subscriptionId(host: string): string {
  return `${SUB_PREFIX}${normaliseHost(host)}`;
}

export function hostOfId(id: string): string | null {
  return id.startsWith(SUB_PREFIX) ? id.slice(SUB_PREFIX.length) : null;
}

/** The site credentials in a vault, without the API keys beside them. */
export function subscriptionsIn(secrets: Secrets): { host: string; cookie: string }[] {
  const found: { host: string; cookie: string }[] = [];
  for (const [id, value] of Object.entries(secrets ?? {})) {
    const host = hostOfId(id);
    if (host && value?.trim()) found.push({ host, cookie: value.trim() });
  }
  return found.sort((a, b) => a.host.localeCompare(b.host));
}

/**
 * The credential to send with a request for this URL, if there is one.
 *
 * A stored `wsj.com` covers `www.wsj.com` and `graphics.wsj.com`, because a
 * paper serves one story from several of its own hosts. The dot matters:
 * without it a credential for `wsj.com` would also be sent to `notwsj.com`,
 * which is somebody else's server.
 */
export function credentialFor(
  url: string,
  secrets: Secrets,
): { host: string; cookie: string } | null {
  let target: string;
  try {
    target = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }

  let best: { host: string; cookie: string } | null = null;
  for (const entry of subscriptionsIn(secrets)) {
    if (target !== entry.host && !target.endsWith(`.${entry.host}`)) continue;
    // The most specific match wins, so a credential stored for one desk's
    // host is preferred over the paper's.
    if (!best || entry.host.length > best.host.length) best = entry;
  }
  return best;
}

/**
 * A cookie header, from whatever the reader pasted.
 *
 * What comes out of a browser's dev tools is already `a=1; b=2`, but people
 * paste it with newlines, a `Cookie:` label, or surrounding quotes. Rather
 * than refusing any of that, tidy it: a credential rejected for its punctuation
 * is a feature that does not work.
 */
export function tidyCookie(input: string): string {
  return input
    .trim()
    .replace(/^cookie\s*:\s*/i, "")
    .replace(/^["']|["']$/g, "")
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("; ")
    .replace(/;\s*;+/g, "; ")
    .replace(/;\s*$/, "");
}

/**
 * Did the publisher hand us the walled copy?
 *
 * schema.org's `isAccessibleForFree` is the publisher's own statement about
 * the page, in the page — NYT, WSJ and the FT all ship it — so this is a fact
 * read off the response rather than a guess at what the text looks like. It
 * is what lets the reader say "your subscription did not apply here" instead
 * of quietly showing two paragraphs and leaving you to wonder.
 *
 * `hasPart` carries the same flag for one section of an otherwise free page;
 * that is a partial wall, and it means the same thing to a reader who cannot
 * see the rest.
 */
export function isPaywalled(html: string): boolean {
  const saysWalled = (value: unknown) =>
    value === false || value === "False" || value === "false";

  for (const block of jsonLdBlocks(html)) {
    for (const node of flatten(block)) {
      if (!node || typeof node !== "object") continue;
      const record = node as Record<string, unknown>;
      if (saysWalled(record.isAccessibleForFree)) return true;
      const parts = Array.isArray(record.hasPart) ? record.hasPart : [record.hasPart];
      for (const part of parts) {
        if (part && typeof part === "object") {
          const partRecord = part as Record<string, unknown>;
          if (saysWalled(partRecord.isAccessibleForFree)) return true;
        }
      }
    }
  }
  return false;
}

/** Every node in a JSON-LD block, including `@graph` and nested arrays. */
function flatten(block: unknown): unknown[] {
  if (Array.isArray(block)) return block.flatMap(flatten);
  if (!block || typeof block !== "object") return [];
  const record = block as Record<string, unknown>;
  const graph = record["@graph"];
  return graph ? [record, ...flatten(graph)] : [record];
}
