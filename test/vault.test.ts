import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeKeysHeader,
  decryptVault,
  encodeKeysHeader,
  encryptVault,
  isVaultBlob,
  WrongPassphrase,
} from "../lib/vault";

const KEYS = {
  courtlistener: "token-abc-123",
  congress: "DEMO_KEY_456",
};

test("keys survive a round trip through the passphrase", async () => {
  const blob = await encryptVault(KEYS, "correct horse battery staple");
  assert.deepEqual(await decryptVault(blob, "correct horse battery staple"), KEYS);
});

test("the blob carries no trace of the keys it holds", async () => {
  const blob = await encryptVault(KEYS, "a passphrase");
  const serialised = JSON.stringify(blob);
  assert.ok(!serialised.includes("token-abc-123"), "no key material in the blob");
  assert.ok(!serialised.includes("courtlistener"), "not even which APIs are set");
  assert.ok(isVaultBlob(JSON.parse(serialised)));
});

test("a wrong passphrase is refused, not silently empty", async () => {
  const blob = await encryptVault(KEYS, "the right one");
  await assert.rejects(
    () => decryptVault(blob, "the wrong one"),
    (error: Error) => error instanceof WrongPassphrase,
  );
});

test("tampered ciphertext is refused", async () => {
  const blob = await encryptVault(KEYS, "passphrase");
  const flipped = { ...blob, ct: `${blob.ct.slice(0, -4)}AAAA` };
  await assert.rejects(() => decryptVault(flipped, "passphrase"), WrongPassphrase);
});

test("every write uses a fresh salt and iv", async () => {
  const one = await encryptVault(KEYS, "passphrase");
  const two = await encryptVault(KEYS, "passphrase");
  assert.notEqual(one.salt, two.salt, "salt is per write");
  assert.notEqual(one.iv, two.iv, "iv is per write — GCM fails badly on reuse");
  assert.notEqual(one.ct, two.ct, "so identical keys do not produce identical bytes");
});

test("an empty vault is still a vault", async () => {
  const blob = await encryptVault({}, "passphrase");
  assert.deepEqual(await decryptVault(blob, "passphrase"), {});
});

test("the keys header survives the trip, and rejects junk", () => {
  assert.deepEqual(decodeKeysHeader(encodeKeysHeader(KEYS)), KEYS);
  assert.deepEqual(decodeKeysHeader(null), {});
  assert.deepEqual(decodeKeysHeader("not base64 at all !!"), {});
  assert.deepEqual(decodeKeysHeader(Buffer.from("[1,2,3]").toString("base64")), {});
  assert.deepEqual(
    decodeKeysHeader(Buffer.from('{"a":"  ","b":2,"c":" k "}').toString("base64")),
    { c: "k" },
    "blank and non-string entries are dropped, values trimmed",
  );
});

test("a vault from a future format is not guessed at", async () => {
  const blob = await encryptVault(KEYS, "passphrase");
  await assert.rejects(
    () => decryptVault({ ...blob, v: 2 as unknown as 1 }, "passphrase"),
    /newer version/,
  );
});
