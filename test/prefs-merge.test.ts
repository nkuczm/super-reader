import test from "node:test";
import assert from "node:assert/strict";
import { mergePrefs, takeFromAccount } from "../lib/prefs-merge";

test("a device takes each setting and key the account holds newer, one at a time", () => {
  const account = mergePrefs(
    { settings: { aiProvider: "openai", sort: "top" }, settingStamps: { aiProvider: 50, sort: 5 }, keys: { openai: "sk-o", anthropic: "sk-a" }, keyStamps: { openai: 5, anthropic: 5 } },
    {},
  );
  // This device changed `sort` since; it has never chosen a provider, and only knows an old OpenAI key.
  const took = takeFromAccount(
    { settings: { aiProvider: "anthropic", sort: "newest" }, settingStamps: { sort: 60 }, keys: { openai: "sk-old" }, keyStamps: { openai: 1 } },
    account,
  );
  assert.deepEqual(took.settings, { aiProvider: "openai", sort: "newest" });
  assert.deepEqual(took.keys, { openai: "sk-o", anthropic: "sk-a" });
});

test("a removal on the account reaches a device that still holds the key", () => {
  const took = takeFromAccount(
    { settings: {}, settingStamps: {}, keys: { openai: "sk-o", cohere: "c" }, keyStamps: { openai: 5, cohere: 5 } },
    { keys: { openai: "sk-o" }, keyStamps: { openai: 5, cohere: 9 } },
  );
  assert.deepEqual(took.keys, { openai: "sk-o" });
});

test("a whole-stamped copy from an older device never counts a missing key as removed", () => {
  const merged = mergePrefs({ keys: { openai: "sk-o" }, keysAt: 99 }, { keys: { anthropic: "sk-a" }, keyStamps: { anthropic: 3 } });
  assert.deepEqual(merged.keys, { openai: "sk-o", anthropic: "sk-a" });
});

test("the vault is never dropped, and a newer one replaces it", () => {
  const a = { v: 1, ct: "a" };
  const b = { v: 1, ct: "b" };
  assert.deepEqual(mergePrefs({ keys: {} }, { vault: a, vaultAt: 5 }).vault, a);
  assert.deepEqual(mergePrefs({ vault: b, vaultAt: 4 }, { vault: a, vaultAt: 5 }).vault, a);
  assert.deepEqual(mergePrefs({ vault: b, vaultAt: 6 }, { vault: a, vaultAt: 5 }).vault, b);
});
