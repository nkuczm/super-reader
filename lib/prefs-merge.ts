/**
 * Settings and API keys, merged one at a time.
 *
 * They used to merge as two halves — all the settings, all the keys — each
 * going to whichever device changed it last. So a browser whose data had
 * been cleared, where someone typed their OpenAI key back in before signing
 * in, had the newest "keys", and signing in replaced every other key the
 * account held with that one. Now each setting and each key carries its own
 * change time, and only a key someone actually removed is removed.
 *
 * Pure and client-safe: the server merges with it, the device applies with it.
 */

export type Stamps = Record<string, number>;

export type AccountPrefs = {
  settings?: Record<string, unknown>;
  /** When each setting last changed. */
  settingStamps?: Stamps;
  /** The whole settings' change time, from before each was stamped. */
  settingsAt?: number;
  keys?: Record<string, string>;
  /** When each key last changed — a key stamped but absent was removed then. */
  keyStamps?: Stamps;
  /** The whole key set's change time, from before each was stamped. */
  keysAt?: number;
  /** The passphrase-locked key vault (ciphertext only). */
  vault?: unknown;
  vaultAt?: number;
};

const at = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** When a setting last changed: its own stamp, or the whole settings' from an older copy. */
export function settingStamp(prefs: AccountPrefs, field: string): number {
  return at(prefs.settingStamps?.[field]) || at(prefs.settingsAt);
}

/**
 * When a key last changed. Only a key's own stamp can say it was removed: in
 * an older copy, stamped as a whole, a key it lacks was simply never there.
 */
export function keyStamp(prefs: AccountPrefs, name: string): number {
  return at(prefs.keyStamps?.[name]) || (prefs.keys && name in prefs.keys ? at(prefs.keysAt) : 0);
}

export const vaultStamp = (prefs: AccountPrefs) => at(prefs.vaultAt) || (prefs.vault ? at(prefs.keysAt) : 0);

export const vaultOk = (v: unknown) => !!v && typeof v === "object" && JSON.stringify(v).length < 20_000;

/** Keys as they may be stored: short names, string values. */
export function cleanKeys(keys: unknown): Record<string, string> {
  return keys && typeof keys === "object" && !Array.isArray(keys)
    ? (Object.fromEntries(
        Object.entries(keys as Record<string, unknown>)
          .filter(([k, v]) => /^[a-z0-9_-]{1,40}$/i.test(k) && typeof v === "string" && v.length < 400)
          .slice(0, 40),
      ) as Record<string, string>)
    : {};
}

/**
 * A device's copy merged into the account's. Each setting and key goes to
 * whichever side changed it last; a tie keeps what the account holds, unless
 * only the device has it. The vault is never dropped for want of one.
 */
export function mergePrefs(incoming: AccountPrefs, held: AccountPrefs): AccountPrefs {
  const out: AccountPrefs = {};

  const inSettings = incoming.settings && typeof incoming.settings === "object" && !Array.isArray(incoming.settings) ? incoming.settings : {};
  const heldSettings = held.settings ?? {};
  const settings: Record<string, unknown> = {};
  const settingStamps: Stamps = {};
  for (const field of new Set([...Object.keys(heldSettings), ...Object.keys(inSettings)])) {
    const mine = settingStamp(incoming, field);
    const theirs = settingStamp(held, field);
    const hasMine = field in inSettings;
    const hasHeld = field in heldSettings;
    if (hasMine && (!hasHeld || mine > theirs)) {
      settings[field] = inSettings[field];
      settingStamps[field] = mine;
    } else if (hasHeld) {
      settings[field] = heldSettings[field];
      settingStamps[field] = theirs;
    }
  }
  if (Object.keys(settings).length) {
    out.settings = settings;
    out.settingStamps = settingStamps;
  }

  const inKeys = cleanKeys(incoming.keys);
  const heldKeys = held.keys ?? {};
  const keys: Record<string, string> = {};
  const keyStamps: Stamps = {};
  const names = new Set([
    ...Object.keys(heldKeys),
    ...Object.keys(held.keyStamps ?? {}),
    ...Object.keys(inKeys),
    ...Object.keys(incoming.keyStamps ?? {}).filter((k) => /^[a-z0-9_-]{1,40}$/i.test(k)),
  ]);
  for (const name of names) {
    const mine = keyStamp({ ...incoming, keys: inKeys }, name);
    const theirs = keyStamp(held, name);
    const takeMine = mine > theirs || (mine === theirs && !(name in heldKeys) && name in inKeys);
    const side = takeMine ? inKeys : heldKeys;
    const stamp = takeMine ? mine : theirs;
    if (name in side) keys[name] = side[name];
    if (stamp > 0) keyStamps[name] = stamp;
  }
  out.keys = keys;
  if (Object.keys(keyStamps).length) out.keyStamps = keyStamps;

  const mineVault = vaultOk(incoming.vault) ? incoming.vault : undefined;
  if (mineVault && (!held.vault || vaultStamp(incoming) > vaultStamp(held))) {
    out.vault = mineVault;
    out.vaultAt = vaultStamp(incoming);
  } else if (held.vault) {
    out.vault = held.vault;
    out.vaultAt = vaultStamp(held);
  }
  return out;
}

/** Keys the account held that a change takes away, or replaces with another value. */
export function keysLost(before: AccountPrefs, after: AccountPrefs): string[] {
  const now = after.keys ?? {};
  return Object.entries(before.keys ?? {})
    .filter(([name, value]) => now[name] !== value)
    .map(([name]) => name);
}

/** What a device should take from the account's copy: each setting and key newer there, or held there and never chosen here. */
export function takeFromAccount(
  mine: { settings: Record<string, unknown>; settingStamps: Stamps; keys: Record<string, string>; keyStamps: Stamps },
  theirs: AccountPrefs,
): { settings: Record<string, unknown> | null; settingStamps: Stamps; keys: Record<string, string> | null; keyStamps: Stamps } {
  const settingStamps = { ...mine.settingStamps };
  let settings: Record<string, unknown> | null = null;
  for (const [field, value] of Object.entries(theirs.settings ?? {})) {
    if (!(field in mine.settings)) continue; // a setting this version does not know
    const t = settingStamp(theirs, field);
    const m = at(mine.settingStamps[field]);
    const differs = JSON.stringify(value) !== JSON.stringify(mine.settings[field]);
    if (differs && (t > m || m === 0)) {
      settings ??= { ...mine.settings };
      settings[field] = value;
      settingStamps[field] = t;
    }
  }
  const keyStamps = { ...mine.keyStamps };
  let keys: Record<string, string> | null = null;
  const names = new Set([...Object.keys(theirs.keys ?? {}), ...Object.keys(theirs.keyStamps ?? {})]);
  for (const name of names) {
    const t = keyStamp(theirs, name);
    const m = at(mine.keyStamps[name]);
    const value = theirs.keys?.[name];
    if (value === mine.keys[name]) {
      if (t > m) keyStamps[name] = t;
      continue;
    }
    if (t > m || (m === 0 && value !== undefined)) {
      keys ??= { ...mine.keys };
      if (value === undefined) delete keys[name];
      else keys[name] = value;
      keyStamps[name] = t;
    }
  }
  return { settings, settingStamps, keys, keyStamps };
}
