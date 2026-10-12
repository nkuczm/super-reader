import test from "node:test";
import assert from "node:assert/strict";
import { groupsOf, hostOf, inLanes, isDue, isPaperApi, PAPER_APIS, PAPERS_EVERY_MS } from "../lib/refresh";
import { budget, within } from "../lib/deadline";
import { API_PROVIDERS } from "../lib/apis";
import { readsPages } from "../lib/enrich";
import { OUTLETS, isResearchCategory } from "../lib/outlets";
import { mergeWindow } from "../lib/window";
import { canonicalUrl } from "../lib/url";

const source = (id: string, feedUrl: string) => ({ id, feedUrl });

test("a refresh goes out in groups, each no bigger than the size", () => {
  const sources = Array.from({ length: 20 }, (_, i) => source(`s${i}`, `https://site${i}.example/feed`));
  const groups = groupsOf(sources, 8);
  assert.deepEqual(groups.map((group) => group.length).sort(), [4, 8, 8]);
  // Every source once, none lost.
  assert.deepEqual(groups.flat().map((s) => s.id).sort(), sources.map((s) => s.id).sort());
});

test("sources from one host share a group, and one host's groups are dealt apart", () => {
  const nature = Array.from({ length: 10 }, (_, i) => source(`n${i}`, `https://www.nature.com/j${i}.rss`));
  const others = Array.from({ length: 10 }, (_, i) => source(`o${i}`, `https://other${i}.example/feed`));
  const groups = groupsOf([...others, ...nature], 5);
  // Ten Nature journals fill two groups of their own.
  const natureGroups = groups.filter((group) => group.every((s) => s.id.startsWith("n")));
  assert.equal(natureGroups.length, 2);
  // And those two are not next to each other, so they are not sent together.
  const at = natureGroups.map((group) => groups.indexOf(group));
  assert.ok(Math.abs(at[0] - at[1]) > 1, `Nature's groups sit at ${at}`);
});

test("an API source is grouped by its service", () => {
  assert.equal(hostOf("api:journal?issn=0026-4423&name=Mind"), "api:journal");
  assert.equal(hostOf("https://www.nature.com/neuro.rss"), "nature.com");
});

test("no more requests are in flight than lanes allow, and every one runs", async () => {
  let active = 0;
  let most = 0;
  const done: number[] = [];
  await inLanes([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    active += 1;
    most = Math.max(most, active);
    await new Promise((resolve) => setTimeout(resolve, 5 + (n % 3) * 3));
    done.push(n);
    active -= 1;
  });
  assert.equal(most, 3);
  assert.deepEqual(done.sort(), [1, 2, 3, 4, 5, 6, 7]);
});

test("papers are asked every two hours; news every time", () => {
  const now = Date.parse("2026-10-12T20:00:00Z");
  const journal = source("j", "api:journal?issn=0026-4423&name=Mind");
  const news = source("n", "https://www.theguardian.com/us/rss");
  const recently = { at: now - 30 * 60 * 1000, ok: true };
  assert.equal(isDue(news, recently, now), true);
  assert.equal(isDue(journal, recently, now), false, "asked half an hour ago");
  assert.equal(isDue(journal, { at: now - PAPERS_EVERY_MS, ok: true }, now), true, "two hours on");
  assert.equal(isDue(journal, { at: now - 60_000, ok: false }, now), true, "a failure is asked again straight away");
  assert.equal(isDue(journal, undefined, now), true, "never asked");
  assert.equal(isDue(journal, { at: now + 60 * 60 * 1000, ok: true }, now), true, "a clock set wrong does not freeze it");
});

test("the reader's list of research services is the providers marked Research", () => {
  const research = API_PROVIDERS.filter((provider) => provider.category === "Research").map((provider) => provider.id).sort();
  assert.deepEqual([...PAPER_APIS].sort(), research);
  assert.equal(isPaperApi("api:arxiv?q=cat%3Acs.AI"), true);
  assert.equal(isPaperApi("api:github?repo=a/b"), false);
  assert.equal(isPaperApi("https://arxiv.org/rss/cs.AI"), false);
});

test("slow work gives way to what is in hand when the time is up", async () => {
  const slow = new Promise<string>((resolve) => setTimeout(() => resolve("late"), 200));
  assert.equal(await within(slow, 10, () => "instead"), "instead");
  assert.equal(await within(Promise.resolve("quick"), 1000, () => "instead"), "quick");
  assert.equal(await within(Promise.resolve("quick"), 0, () => "instead"), "instead", "no time at all");
  await assert.rejects(within(Promise.reject(new Error("refused")), 1000, () => "instead"), /refused/);
  let clock = 1000;
  const left = budget(500, () => clock);
  clock += 200;
  assert.equal(left(), 300);
});

test("papers and Google News links are not read page by page", () => {
  const paper = OUTLETS.find((outlet) => isResearchCategory(outlet.category) && outlet.feedUrl.startsWith("https://onlinelibrary.wiley.com"));
  assert.ok(paper, "a Wiley journal in the directory");
  assert.equal(readsPages(paper.feedUrl), false);
  assert.equal(readsPages("https://news.google.com/rss/search?q=site%3Aapnews.com+when%3A2d&hl=en-US&gl=US&ceid=US%3Aen"), false);
  assert.equal(readsPages("https://www.theverge.com/rss/index.xml"), true);
});

test("a refresh without a story's picture does not take away the one already held", () => {
  type Story = { id: string; link: string; sourceId: string; title: string; image?: string; summary?: string };
  const held: Story[] = [{ id: "a", link: "https://example.com/a", sourceId: "s1", title: "A", image: "https://example.com/a.jpg", summary: "Held" }];
  const fetched: Story[] = [{ id: "a", link: "https://example.com/a", sourceId: "s1", title: "A, corrected", image: undefined, summary: "" }];
  const [merged] = mergeWindow(fetched, held, { sources: new Set(["s1"]), canonical: canonicalUrl });
  assert.equal(merged.title, "A, corrected", "the publisher's current copy still wins");
  assert.equal(merged.image, "https://example.com/a.jpg");
  assert.equal(merged.summary, "Held");
});
