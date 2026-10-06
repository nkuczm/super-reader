import test from "node:test";
import assert from "node:assert/strict";
import { costAt, MODEL_CHOICES, modelFor, monthlyUsage } from "../lib/models";
import { claudeModel, claudeOptions, claudeSearchTool } from "../lib/claude-model";
import { priceOf } from "../lib/spend";

const DAY = 86_400_000;

test("a month of use is read from the last 30 days, scaled up from at least a week", () => {
  const now = 100 * DAY;
  const rec = (daysAgo: number, input: number, output: number) => ({ at: now - daysAgo * DAY, provider: "anthropic" as const, model: "m", input, output, cost: null });
  assert.deepEqual(monthlyUsage([], now), { input: 0, output: 0, runs: 0, days: 0 });
  // Two days of history counts as a week: scaled by 30/7.
  const young = monthlyUsage([rec(2, 7000, 700), rec(1, 7000, 700)], now);
  assert.equal(young.input, 60000);
  assert.equal(young.runs, 9);
  // Old runs fall out of the window but date the history.
  const old = monthlyUsage([rec(90, 1e9, 1e9), rec(3, 10000, 1000)], now);
  assert.deepEqual([old.input, old.output, old.runs, old.days], [10000, 1000, 1, 30]);
});

test("costs follow each model's price, and every offered model is priced for the ledger", () => {
  const opus = MODEL_CHOICES.anthropic.find((m) => m.id === "claude-opus-5-5")!;
  assert.equal(costAt(opus, { input: 1_000_000, output: 100_000 }), 6);
  for (const list of Object.values(MODEL_CHOICES)) for (const m of list) assert.deepEqual(priceOf(m.id), { input: m.input, output: m.output });
});

test("only offered Claude models are used, with the options each accepts", () => {
  assert.equal(modelFor("anthropic", "claude-made-up"), "claude-opus-5-5");
  assert.equal(claudeModel("claude-sonnet-5-5"), "claude-sonnet-5-5");
  assert.equal(claudeModel(42), "claude-opus-5-5");
  assert.deepEqual(claudeOptions("claude-haiku-4-5", "low"), { effort: {}, fallback: {} });
  assert.equal(claudeOptions("claude-opus-5-5", "medium").effort.effort, "medium");
  assert.equal(claudeSearchTool("claude-haiku-4-5", 3).type, "web_search_20250305");
  assert.equal(claudeSearchTool("claude-sonnet-5-5", 3).type, "web_search_20260209");
});

test("each tier's estimate counts only its own activities, older runs as deep analysis", () => {
  const now = 100 * DAY;
  const r = (activity: string | undefined, input: number) => ({ at: now - 10 * DAY, provider: "anthropic" as const, model: "m", input, output: 0, cost: null, ...(activity ? { activity } : {}) }) as never;
  const records = [r("fact-check", 100), r("insights", 10), r(undefined, 1), r("transcript-search", 1000), r("reading", 10000)];
  assert.equal(monthlyUsage(records, now, "deep").input, 111 * 3);
  assert.equal(monthlyUsage(records, now, "quick").input, 11000 * 3);
});
