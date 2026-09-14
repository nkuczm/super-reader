import test from "node:test";
import assert from "node:assert/strict";
import { auditApiSlice } from "../lib/sweep";
import { API_PROVIDERS } from "../lib/apis";

/**
 * The live half of "is everything from a source showing up".
 *
 * test/coverage.test.ts guards our end: every record a recorded response
 * holds must become an article. What it cannot catch is the other end
 * moving — a renamed field leaves the request answering 200 while every
 * record falls out of the mapper, and the source empties with no error
 * anywhere. That is what this audit is for, so what it must get right is
 * calling an empty answer a failure.
 */

const realFetch = globalThis.fetch;
test.afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answers everything with a body carrying no records. */
function answerEmpty() {
  globalThis.fetch = (async (input: any) =>
    ({
      ok: true,
      status: 200,
      statusText: "",
      url: String(input),
      json: async () => ({}),
      text: async () => "<feed></feed>",
    }) as any) as typeof fetch;
}

test("every provider has sample inputs to be checked with", () => {
  // Required, because a provider nobody can make an example request to is a
  // provider nobody can check.
  for (const provider of API_PROVIDERS) {
    assert.ok(provider.sample, `${provider.id} has a sample`);
    for (const param of provider.params) {
      if (!param.required) continue;
      assert.ok(
        provider.sample[param.key]?.trim(),
        `${provider.id}'s sample fills in ${param.key}, which is required`,
      );
    }
  }
});

test("an answer carrying no articles is a failure, not a pass", () => {
  // The whole point: a 200 with nothing in it is exactly what a renamed
  // field looks like from here.
  answerEmpty();
  return auditApiSlice(0).then((result) => {
    assert.ok(result.checked.length > 0, "it checked some providers");
    for (const entry of result.checked) {
      if (entry.skipped) continue;
      assert.equal(entry.ok, false, `${entry.id} reported broken`);
      assert.match(entry.error ?? "", /no articles|needs|key/i);
    }
  });
});

test("the slices cover the whole directory", async () => {
  answerEmpty();
  const first = await auditApiSlice(0);
  assert.ok(first.slices >= 1);

  const seen = new Set<string>();
  for (let slice = 0; slice < first.slices; slice += 1) {
    for (const entry of (await auditApiSlice(slice)).checked) seen.add(entry.id);
  }
  assert.deepEqual(
    [...seen].sort(),
    API_PROVIDERS.map((provider) => provider.id).sort(),
    "every provider is reached by some slice",
  );
});

test("a provider whose key this deployment lacks is skipped, not called broken", async () => {
  // Otherwise the ones that really are broken are buried under the ones that
  // were never configured here.
  answerEmpty();
  const needsKey = API_PROVIDERS.filter((p) => p.envKey && !p.keyOptional);
  assert.ok(needsKey.length > 0, "some providers do need a key");

  const reports = new Map<string, { ok: boolean; skipped?: string }>();
  const { slices } = await auditApiSlice(0);
  for (let slice = 0; slice < slices; slice += 1) {
    for (const entry of (await auditApiSlice(slice)).checked) reports.set(entry.id, entry);
  }

  for (const provider of needsKey) {
    if (process.env[provider.envKey!]) continue;
    assert.equal(reports.get(provider.id)?.skipped, "no key", `${provider.id} is skipped`);
    assert.equal(reports.get(provider.id)?.ok, true, "and not counted as broken");
  }
});

test("a provider that answers properly passes with a count", async () => {
  globalThis.fetch = (async (input: any) =>
    ({
      ok: true,
      status: 200,
      statusText: "",
      url: String(input),
      json: async () => ({
        results: [
          {
            document_number: "2026-0001",
            title: "Rule on emissions",
            html_url: "https://www.federalregister.gov/documents/2026/0001",
            publication_date: "2026-01-05",
          },
        ],
      }),
      text: async () => "",
    }) as any) as typeof fetch;

  const { slices } = await auditApiSlice(0);
  for (let slice = 0; slice < slices; slice += 1) {
    const entry = (await auditApiSlice(slice)).checked.find(
      (e) => e.id === "federal-register",
    );
    if (!entry) continue;
    assert.equal(entry.ok, true);
    assert.equal(entry.items, 1, "and says how many came back");
    return;
  }
  assert.fail("the Federal Register was never checked");
});
