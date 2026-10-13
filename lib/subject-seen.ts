/**
 * Which stories in a subject are new to the reader: added since the subject
 * was last open on this device. Those are lit on the subject's page, in the
 * document and on the whiteboard, so a story added from the feed — or from
 * the phone — can be found among the rest.
 *
 * Lit for the visit: opening a subject marks it seen, so the next visit lights
 * only what arrives after this one. Kept per device, because what has been
 * seen here is a fact about this device; the stories themselves sync.
 */

const KEY = "super-reader:subject-seen";

type Seen = {
  /** When this device started keeping track; a subject not yet opened here counts from then. */
  since: number;
  /** Subject id → when it was last opened here. */
  opened: Record<string, number>;
};

function load(now: number): Seen {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "null");
    if (raw && typeof raw.since === "number" && raw.opened && typeof raw.opened === "object") return raw as Seen;
  } catch {
    /* start keeping track now */
  }
  const fresh = { since: now, opened: {} };
  save(fresh);
  return fresh;
}

function save(seen: Seen) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(seen));
  } catch {
    /* not remembered: the next visit lights what this one did */
  }
}

/** When a subject was last open on this device, or when tracking began. */
export function lastOpened(subjectId: string, now = Date.now()): number {
  const seen = load(now);
  const at = seen.opened[subjectId];
  return typeof at === "number" ? at : seen.since;
}

export function markOpened(subjectId: string, now = Date.now()) {
  const seen = load(now);
  seen.opened[subjectId] = now;
  save(seen);
}

/** The cards that arrived after `seenAt`. */
export function newSince<T extends { id: string; at: number }>(cards: T[], seenAt: number): Set<string> {
  return new Set(cards.filter((card) => card.at > seenAt).map((card) => card.id));
}
