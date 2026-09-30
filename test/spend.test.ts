import test from "node:test";
import assert from "node:assert/strict";
import { costOf, daily, priceOf, summarise, type SpendRecord } from "../lib/spend";
import { encodeKeysHeader, KEYS_HEADER } from "../lib/vault";
import { POST } from "../app/api/subjects/synthesize/route";

test("costs come from list prices, and an unknown model is left unpriced", () => {
  assert.equal(costOf("claude-opus-5-5", 1_000_000, 100_000), 4 + 2);
  assert.ok(priceOf("gpt-4o-mini-2024-07-18"), "a dated snapshot takes its family's price");
  assert.equal(costOf("some-new-model", 1000, 1000), null);
});

test("totals say when some runs could not be priced", () => {
  const records: SpendRecord[] = [
    { at: 1, provider: "anthropic", model: "claude-opus-5-5", input: 10, output: 10, cost: 0.5 },
    { at: 2, provider: "openai", model: "mystery", input: 10, output: 10, cost: null },
  ];
  const sum = summarise(records);
  assert.equal(sum.cost, 0.5);
  assert.equal(sum.unpriced, 1);
  assert.equal(daily(records, 7, 10).length, 7);
});

test("the OpenAI route asks for the JSON shape and reports its usage", async () => {
  const real = globalThis.fetch;
  let sent: Record<string, unknown> | null = null;
  let auth = "";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://api.openai.com/")) {
      sent = JSON.parse(String(init?.body));
      auth = new Headers(init?.headers).get("authorization") ?? "";
      return Response.json({
        model: "gpt-5-mini-2025-08-07",
        choices: [{ message: { content: JSON.stringify({
          insights: [{ type: "connection", text: "Both lean on boards.", refs: ["https://a.com/x", "https://b.com/y"] }],
          reading: [],
        }) } }],
        usage: { prompt_tokens: 1200, completion_tokens: 300 },
      });
    }
    return new Response("no", { status: 404 });
  }) as typeof fetch;
  try {
    const res = await POST(new Request("http://x/api/subjects/synthesize", {
      method: "POST",
      headers: { [KEYS_HEADER]: encodeKeysHeader({ openai: "sk-test" }) },
      body: JSON.stringify({
        provider: "openai",
        model: "gpt-5-mini",
        subject: "Boards",
        cards: [
          { id: "https://a.com/x", title: "A", quotes: [], note: "" },
          { id: "https://b.com/y", title: "B", quotes: [], note: "" },
        ],
        boxes: [],
        known: [],
      }),
    }));
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(auth, "Bearer sk-test");
    assert.equal((sent as { model: string } | null)?.model, "gpt-5-mini");
    assert.equal(((sent as unknown as { response_format: { type: string } }).response_format).type, "json_schema");
    assert.equal(body.insights.length, 1);
    assert.deepEqual(body.usage, { provider: "openai", model: "gpt-5-mini-2025-08-07", input: 1200, output: 300 });
  } finally {
    globalThis.fetch = real;
  }
});

test("without a key for the chosen provider, the route says which key", async () => {
  const res = await POST(new Request("http://x/api/subjects/synthesize", {
    method: "POST",
    headers: { [KEYS_HEADER]: encodeKeysHeader({ anthropic: "sk-ant" }) },
    body: JSON.stringify({ provider: "openai", subject: "s", cards: [], boxes: [], known: [] }),
  }));
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.match(body.error, /OpenAI key/);
});
