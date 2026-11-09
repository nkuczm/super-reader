/**
 * Whether this server's DATA_KEY is the one the saved data was sealed with.
 *
 * Everything an account keeps — subjects, the library, settings and stored
 * keys — is sealed with DATA_KEY (lib/secure.ts). A deployment given a
 * different key cannot open any of it, and worse, would seal what it writes
 * next with the wrong key: a library that mixes two keys cannot be read by
 * either. Moving hosts is exactly when that happens, because Vercel never
 * shows a "sensitive" variable again and a fresh key is the easy mistake.
 *
 * So before any account feature runs, one saved value is opened. If none
 * opens, accounts stay off, nothing is read or written, and the logs say
 * why. A database with nothing sealed in it yet (a new install) passes.
 *
 * Server-only.
 */

import { getSql, isConfigured } from "./db";
import { dataKey, open } from "./secure";

/** True when there is nothing sealed to check, or the key opens what there is. */
export function keyOpens(sealed: string[], key: Buffer | null): boolean {
  if (!key) return false;
  if (sealed.length === 0) return true;
  return sealed.some((value) => {
    try {
      open(value, key);
      return true;
    } catch {
      return false;
    }
  });
}

/** One sealed value from each place an account keeps them. */
async function sampleSealed(): Promise<string[]> {
  const sql = getSql();
  const probes = [
    () => sql`SELECT payload AS sealed FROM account_prefs WHERE payload LIKE 'v1.%' LIMIT 1`,
    () => sql`SELECT payload AS sealed FROM subject_store WHERE payload LIKE 'v1.%' LIMIT 1`,
    () => sql`SELECT payload AS sealed FROM account_items WHERE payload LIKE 'v1.%' LIMIT 1`,
    () => sql`SELECT refresh_token AS sealed FROM accounts WHERE refresh_token LIKE 'v1.%' LIMIT 1`,
  ];
  // All at once: this runs on the first request a new server answers, and
  // four database round trips one after another were added to that wait.
  const answers = await Promise.all(
    probes.map(async (probe) => {
      try {
        const rows = (await probe()) as { sealed: string }[];
        return rows[0]?.sealed ?? null;
      } catch (error) {
        // A table not made yet holds nothing to check; anything else is a real failure.
        if ((error as { code?: string }).code !== "42P01") throw error;
        return null;
      }
    }),
  );
  return answers.filter((sealed): sealed is string => Boolean(sealed));
}

export type KeyStatus = "fits" | "wrong" | "unreachable";

let checked: Promise<KeyStatus> | null = null;

/** Tests change the key or the database between cases. */
export function forgetKeyCheckForTesting() {
  checked = null;
}

/**
 * Checked once per server process. A failed check is not remembered — the
 * database may only have been unreachable — and counts as "no" meanwhile,
 * so a wrong key never gets a write in while the check is retried.
 */
export function keyStatus(): Promise<KeyStatus> {
  if (!isConfigured()) return Promise.resolve("unreachable");
  checked ??= sampleSealed().then(
    (sealed): KeyStatus => {
      if (keyOpens(sealed, dataKey())) return "fits";
      console.error(
        "DATA_KEY does not open the data already saved in the database. Sign-in and every account feature are off until this deployment has the key the data was saved with.",
      );
      return "wrong";
    },
    (error): KeyStatus => {
      checked = null;
      console.warn("DATA_KEY check could not reach the database:", error);
      return "unreachable";
    },
  );
  return checked;
}

export async function dataKeyFits(): Promise<boolean> {
  return (await keyStatus()) === "fits";
}
