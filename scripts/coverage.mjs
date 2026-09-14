#!/usr/bin/env node
/**
 * Does the app still collect what these sources publish?
 *
 * The unit tests prove the parsing against fixtures that never change. This
 * asks the other question — whether the internet still behaves the way the
 * fixtures say it does — by running the real sources in test/watchlist.json
 * through a deployment and checking what comes back.
 *
 * It needs to reach the sites, so run it from a machine that can: the sandbox
 * this app is built in cannot, which is exactly how a source can quietly stop
 * working without a single test going red.
 *
 *   node scripts/coverage.mjs https://your-deployment.vercel.app
 *   node scripts/coverage.mjs https://... --only wsj      (substring filter)
 *   node scripts/coverage.mjs https://... --json          (for a dashboard)
 *
 * Exits non-zero if any source fails what the watchlist expects of it, so it
 * can be a scheduled job rather than something to remember to run.
 */

import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const base = (args.find((a) => a.startsWith("http")) ?? "").replace(/\/$/, "");
const onlyAt = args.indexOf("--only");
const only = onlyAt === -1 ? undefined : args[onlyAt + 1];
const asJson = args.includes("--json");

if (!base) {
  console.error("Usage: node scripts/coverage.mjs https://your-deployment [--only text] [--json]");
  process.exit(2);
}

const HOUR = 60 * 60 * 1000;

const watchlist = JSON.parse(
  await readFile(new URL("../test/watchlist.json", import.meta.url), "utf8"),
);
const sources = watchlist.sources.filter(
  (source) => !only || source.input.toLowerCase().includes(only.toLowerCase()),
);

/** What the app makes of one input, and what is wrong with it. */
async function check({ input, why, expect = {} }) {
  /**
   * Ask for a hundred, not the preview's default twelve.
   *
   * `minInWindow` and `maxUndated` are counted from the articles that come
   * back, so with twelve of them an expectation of "40 from the last 48 hours"
   * could never be met however well the source was doing — the yardstick was
   * measuring its own request size. `minArticles` reads `total`, which is the
   * real count either way.
   */
  const url = `${base}/api/discover?q=${encodeURIComponent(input)}&limit=100`;
  const started = Date.now();
  let payload;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    const text = await res.text();
    try {
      payload = JSON.parse(text);
    } catch {
      // Not the app answering: usually a proxy or network that cannot reach
      // the deployment, which is a different problem from a failing source.
      return {
        input, why, ok: false,
        problems: [`${res.status} but not the app answering: ${text.slice(0, 80).trim()}`],
      };
    }
    if (!res.ok) {
      return { input, why, ok: false, problems: [`${res.status}: ${payload.error ?? "no reason given"}`] };
    }
  } catch (error) {
    return { input, why, ok: false, problems: [`could not be reached: ${error.message}`] };
  }

  const articles = payload.articles ?? [];
  const now = Date.now();
  const dated = articles
    .map((a) => Date.parse(a.publishedAt ?? ""))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => b - a);
  const newestAgeHours = dated.length ? (Date.now() - dated[0]) / HOUR : null;
  const spanDays = dated.length > 1 ? (dated[0] - dated[dated.length - 1]) / (24 * HOUR) : 0;
  const bundled = payload.feedUrl?.startsWith("bundle:")
    ? payload.feedUrl.slice("bundle:".length).split("|").length
    : 0;

  const problems = [];
  const duplicates = articles.length - new Set(articles.map((a) => a.link)).size;

  /**
   * How many of the returned articles were published inside the window.
   *
   * This, not `total`, is what coverage means: a source returning four
   * hundred articles spanning a year is covering less than one returning
   * fifty from the last day. `minArticles` is kept for sources where the
   * count is the point (a blog with no dates), but `minInWindow` is the
   * expectation worth writing for anything that publishes regularly.
   */
  const windowHours = expect.windowHours ?? 48;
  const inWindow = dated.filter((t) => now - t <= windowHours * HOUR).length;
  const undated = articles.length - dated.length;

  if (expect.minInWindow && inWindow < expect.minInWindow) {
    problems.push(
      `only ${inWindow} articles from the last ${windowHours}h, expected ${expect.minInWindow}+` +
        ` (${articles.length} returned in total, so the volume is there and the freshness is not)`,
    );
  }
  if (expect.minArticles && payload.total < expect.minArticles) {
    problems.push(`only ${payload.total} articles, expected ${expect.minArticles}+`);
  }
  if (expect.maxUndated !== undefined && undated > expect.maxUndated) {
    // Undated items cannot be placed in the window at all, so a source that
    // stops dating its articles silently stops being measurable.
    problems.push(`${undated} articles arrived with no date, expected at most ${expect.maxUndated}`);
  }
  if (expect.maxAgeHours && newestAgeHours !== null && newestAgeHours > expect.maxAgeHours) {
    // The failure that looks like success: a feed answering 200 with old news.
    problems.push(`newest item is ${newestAgeHours.toFixed(1)}h old, expected under ${expect.maxAgeHours}h`);
  }
  if (expect.bundleOfAtLeast && bundled < expect.bundleOfAtLeast) {
    problems.push(`covers ${bundled || 1} feed(s), expected ${expect.bundleOfAtLeast}+`);
  }
  if (expect.scopeIs && payload.scope !== expect.scopeIs) {
    problems.push(`scope is "${payload.scope}", expected "${expect.scopeIs}"`);
  }
  if (expect.kindIs && payload.kind !== expect.kindIs) {
    problems.push(`kind is "${payload.kind}", expected "${expect.kindIs}"`);
  }
  if (expect.titleIs && payload.title !== expect.titleIs) {
    problems.push(`called "${payload.title}", expected "${expect.titleIs}"`);
  }
  if (duplicates > 0) problems.push(`${duplicates} duplicate link(s) in the preview`);
  if (articles.length === 0) problems.push("no articles at all");

  return {
    input,
    why,
    ok: problems.length === 0,
    problems,
    title: payload.title,
    kind: payload.kind,
    scope: payload.scope,
    feeds: bundled || 1,
    total: payload.total,
    inWindow,
    windowHours,
    undated,
    newestAgeHours: newestAgeHours === null ? null : Number(newestAgeHours.toFixed(1)),
    spanDays: Number(spanDays.toFixed(1)),
    tookMs: Date.now() - started,
  };
}

const results = [];
for (const source of sources) {
  // One at a time: several of these sites rate-limit, and a burst from one
  // address reads as a scraper rather than a reader.
  results.push(await check(source));
}

if (asJson) {
  console.log(JSON.stringify({ base, at: new Date().toISOString(), results }, null, 2));
} else {
  for (const r of results) {
    const head = r.ok ? "PASS" : "FAIL";
    console.log(`\n${head}  ${r.input}`);
    console.log(`      ${r.why}`);
    if (r.title) {
      console.log(
        `      ${r.title} · ${r.kind}/${r.scope} · ${r.feeds} feed(s) · ${r.total} items` +
          ` · ${r.inWindow} in last ${r.windowHours}h` +
          (r.undated ? ` · ${r.undated} undated` : "") +
          ` · newest ${r.newestAgeHours ?? "?"}h · spans ${r.spanDays}d · ${r.tookMs}ms`,
      );
    }
    for (const problem of r.problems) console.log(`      - ${problem}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(
    `\n${results.length - failed}/${results.length} sources healthy` +
      (failed ? ` — ${failed} need looking at` : ""),
  );
}

process.exit(results.some((r) => !r.ok) ? 1 : 0);
