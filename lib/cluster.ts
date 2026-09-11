/**
 * Grouping the same story as told by different outlets.
 *
 * Ranking by "how many outlets covered this" needs a way to tell that
 * "Iran Is Producing Ballistic Missiles Again" and "Tehran restarts missile
 * production, intelligence finds" are one story. There is no shared id to
 * join on — every outlet writes its own headline — so the join is textual.
 *
 * The method is deliberately boring, because it has to run on every sweep
 * over thousands of headlines inside one request:
 *
 *  1. Normalize the headline: strip the outlet's own furniture ("Opinion |",
 *     " - The Verge", "Live updates:"), fold case and punctuation.
 *  2. Weight each remaining word by how rare it is in the corpus (IDF), so
 *     "Trump" and "says" count for almost nothing and "Bab al-Mandeb"
 *     carries the match.
 *  3. Compare only headlines that share one of their rarest words — the
 *     blocking step. Comparing all pairs is quadratic and would be the
 *     slowest thing in the app; this makes it near-linear in practice.
 *  4. Union-find the pairs that clear the similarity threshold.
 */

/** Words that carry no signal about which story a headline is about. */
const STOPWORDS = new Set(
  ("a an and are as at be been but by can could for from had has have he her his how in into is it its" +
    " may might more most new not of on one or our out over said say says she so than that the their them" +
    " then there these they this those to up us was we were what when where which who why will with would" +
    " you your after before about amid asks could first just like make made now off only report reports" +
    " top under via video watch what's live update updates breaking exclusive analysis opinion review" +
    " here's heres why how's day days week weeks year years time times still back").split(/\s+/),
);

/**
 * Furniture outlets attach to their own headlines. Stripped before matching
 * so an opinion piece and a news story about the same thing can still meet.
 */
const PREFIXES =
  /^(opinion|analysis|editorial|review|exclusive|breaking|live|live updates?|update|updated|watch|video|photos?|column|commentary|explainer|factbox|q&a|profile|obituary|letters?|podcast|transcript|the morning|first thing|in charts?|in pictures?)\s*[:|—–-]\s*/i;

/** " — The Guardian", " | WSJ", " - BBC News": the outlet's own signature. */
const SUFFIX = /\s+[-–—|·]\s+[^-–—|·]{2,40}$/;

export function normalizeTitle(title: string) {
  let text = title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  // A headline can carry two layers, e.g. "Opinion | Analysis: ...".
  for (let i = 0; i < 3; i++) {
    const stripped = text.replace(PREFIXES, "");
    if (stripped === text) break;
    text = stripped;
  }
  text = text.replace(SUFFIX, "");
  return text
    .toLowerCase()
    // Curly quotes and dashes, then everything that is not a word or digit.
    .replace(/[\u2018\u2019\u201c\u201d]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Crude but symmetric singularization, so "missiles" meets "missile".
 * Only the plural ending comes off — "es" is dropped just where English
 * added it (boxes, churches), never from "missiles" or "rates".
 */
function stem(word: string) {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(s|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !/(s|u)s$/.test(word))
    return word.slice(0, -1);
  return word;
}

export function tokensOf(title: string): string[] {
  const seen = new Set<string>();
  for (const word of normalizeTitle(title).split(" ")) {
    if (!word || word.length < 2) continue;
    if (STOPWORDS.has(word)) continue;
    seen.add(stem(word));
  }
  return [...seen];
}

export type Clusterable = {
  /** Stable identity of the individual story. */
  id: string;
  title: string;
  /** Same-outlet items are never merged: an outlet running two pieces is two. */
  outlet?: string;
};

/**
 * Inverse document frequency per token, over the corpus being clustered.
 * Computed from the corpus itself rather than a fixed list, so it adapts —
 * during an election "election" stops being distinctive on its own.
 */
export function idfOver(docs: string[][], { minDocs = 400 } = {}) {
  const counts = new Map<string, number>();
  for (const tokens of docs) {
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  // The corpus size is floored. Over a handful of headlines a word used once
  // scores three times the weight of a word used three times, which drowns
  // the shared words that identify the story; over the real panel that ratio
  // is about 1.2. Pretending the corpus is at least a few hundred headlines
  // makes a small feed behave the way the whole panel does, so the threshold
  // means one thing everywhere.
  const total = Math.max(docs.length, minDocs);
  const idf = new Map<string, number>();
  for (const [token, count] of counts) {
    idf.set(token, Math.log((total + 1) / (count + 0.5)));
  }
  return idf;
}

/**
 * How alike two headlines are, 0..1.
 *
 * Not Jaccard: outlets describe the same event at very different lengths, so
 * a wire brief ("Powell signals cut") shares all of its words with a feature
 * headline that has ten more, and Jaccard would score that pair low. This is
 * a Tversky-style ratio instead — the shared weight against the shared
 * weight plus what is left over, with the shorter side's leftovers counting
 * for more than the longer side's. Adding detail is normal; disagreeing about
 * the few words you did use is not.
 */
export function similarity(
  a: string[],
  b: string[],
  idf: Map<string, number>,
) {
  const weightOf = (token: string) => idf.get(token) ?? 1;
  const [small, large] =
    a.length <= b.length ? [new Set(a), new Set(b)] : [new Set(b), new Set(a)];

  let shared = 0;
  let sharedCount = 0;
  let smallOnly = 0;
  for (const token of small) {
    const weight = weightOf(token);
    if (large.has(token)) {
      shared += weight;
      sharedCount += 1;
    } else {
      smallOnly += weight;
    }
  }
  let largeOnly = 0;
  for (const token of large) {
    if (!small.has(token)) largeOnly += weightOf(token);
  }
  if (shared === 0) return 0;

  // One word in common is never enough, however rare that word is. CBC's
  // "IN PHOTOS | TIFF movies and moments" reduces to the single word
  // "photo", and on that alone it matched the Washington Post's convention
  // picture gallery — and through it, the whole convention story.
  if (sharedCount < 2) return 0;

  return shared / (shared + 0.55 * smallOnly + 0.25 * largeOnly);
}

class Union {
  private parent = new Map<string, string>();
  find(id: string): string {
    const seen = this.parent.get(id);
    if (seen === undefined || seen === id) return id;
    const root = this.find(seen);
    this.parent.set(id, root);
    return root;
  }
  join(a: string, b: string) {
    const [ra, rb] = [this.find(a), this.find(b)];
    if (ra !== rb) this.parent.set(rb, ra);
  }
}

export type Cluster<T> = { key: string; members: T[] };

/**
 * What share of the pairs between two established clusters must clear the
 * similarity threshold before the clusters are merged. Half means a
 * majority of each side recognises the other; one bridging headline out of
 * six pairs does not.
 */
const MUTUAL_SHARE = 0.5;

/**
 * Group stories that tell the same story.
 *
 * The default threshold was chosen by measurement, not by feel: swept over
 * the real fixture (test/fixtures/headlines.mjs), everything from 0.42 to
 * 0.47 joins every story that should be joined, and the only false merge
 * anywhere in that band is between two filings from the *same* newsroom —
 * which cannot overstate breadth, since breadth counts newsrooms. At 0.48
 * the Supreme Court decision copies (0.491 and 0.494 apart) start falling
 * out and real stories get undercounted. 0.46 sits in the middle of the
 * band that works.
 */
export function clusterStories<T extends Clusterable>(
  stories: T[],
  { threshold = 0.46, blockLimit = 40 }: { threshold?: number; blockLimit?: number } = {},
): Cluster<T>[] {
  const tokens = new Map<string, string[]>();
  for (const story of stories) tokens.set(story.id, tokensOf(story.title));
  const idf = idfOver([...tokens.values()]);
  // A headline carrying one distinctive word or none cannot identify a
  // story, so it stays on its own rather than attaching to whatever shares
  // that word.
  const clusterable = (id: string) => (tokens.get(id)?.length ?? 0) >= 2;

  // Index every headline under each of its words, then compare only inside a
  // word's bucket. Buckets for common words are skipped rather than sampled:
  // "market" on a Tuesday holds hundreds of unrelated headlines, and any pair
  // that really is one story shares a rarer word than that too. This is what
  // keeps the comparison count near-linear instead of quadratic.
  //
  // Blocking on only each headline's rarest few words is the obvious
  // optimisation and is wrong: the WSJ's "Iran Is Producing Ballistic
  // Missiles Again" and Reuters' "Iran restarts ballistic missile
  // production, intelligence finds" have disjoint rarest-four sets, so the
  // pair was never compared and the story looked like two.
  const blocks = new Map<string, string[]>();
  const keyTokens = new Map<string, string[]>();
  for (const story of stories) {
    if (!clusterable(story.id)) continue;
    const ranked = [...(tokens.get(story.id) ?? [])].sort(
      (a, b) => (idf.get(b) ?? 0) - (idf.get(a) ?? 0),
    );
    keyTokens.set(story.id, ranked.slice(0, 4));
    for (const token of ranked) {
      const bucket = blocks.get(token) ?? [];
      bucket.push(story.id);
      blocks.set(token, bucket);
    }
  }

  const byId = new Map(stories.map((s) => [s.id, s]));
  const compared = new Set<string>();

  const score = (a: string, b: string) =>
    similarity(tokens.get(a)!, tokens.get(b)!, idf);

  // Collect the candidate pairs first, then decide which to believe. Doing
  // it in one pass means the result depends on which pair happened to be
  // visited first, and that is what put an oil-price story inside a Red Sea
  // port story.
  const edges: { a: string; b: string; score: number }[] = [];
  for (const [, bucket] of blocks) {
    // A word used by hundreds of headlines says nothing on its own, and its
    // bucket would cost a full pairwise pass.
    if (bucket.length > blockLimit) continue;
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const [a, b] = [bucket[i], bucket[j]];
        const pair = a < b ? `${a}|${b}` : `${b}|${a}`;
        if (compared.has(pair)) continue;
        compared.add(pair);
        const value = score(a, b);
        if (value < threshold) continue;
        edges.push({ a, b, score: value });
      }
    }
  }

  /**
   * Join strongest pair first, and refuse a merge that would be much weaker
   * than the two clusters' own internal agreement.
   *
   * This is the fix for chaining. "Red Sea shipping disrupted as Houthis
   * take Mokha and oil prices climb" is genuinely about two stories and
   * matches both; joining every pair it turns up in welded the port story to
   * the oil-price story. Because the strongest pairs go first, such a
   * headline lands in whichever story it fits best while it is still a
   * single item — and the later, weaker edge into the other story is then a
   * merge of two established clusters, which has to clear their cohesion to
   * happen.
   *
   * Measured against real headlines (test/fixtures/headlines.mjs), the
   * highest-scoring pair that must NOT merge sits at 0.497 and the weakest
   * link that must hold a story together at 0.502. There is no daylight
   * between them, which is why mutual recognition decides the close calls
   * rather than a threshold on its own.
   */
  const union = new Union();
  const members = new Map<string, string[]>(stories.map((story) => [story.id, [story.id]]));

  /**
   * Do most members of the two clusters recognise each other?
   *
   * Strength is the wrong test, and trying it proved so: four copies of one
   * story phrased two ways ("Iran restarts ballistic missile production" /
   * "Iran producing ballistic missiles again") form two tight pairs joined
   * only moderately, and a strength bar kept them apart. Density separates
   * the cases properly — in that story every copy matches every other copy,
   * while a bridge headline is the single connection between two clusters
   * whose other members score near zero against each other.
   */
  const mutual = (listA: string[], listB: string[]) => {
    const sampleA = listA.slice(0, 4);
    const sampleB = listB.slice(0, 4);
    let clearing = 0;
    for (const a of sampleA) {
      for (const b of sampleB) if (score(a, b) >= threshold) clearing += 1;
    }
    return clearing / (sampleA.length * sampleB.length);
  };

  edges.sort((a, b) => b.score - a.score || (a.a < b.a ? -1 : 1));
  for (const edge of edges) {
    const [rootA, rootB] = [union.find(edge.a), union.find(edge.b)];
    if (rootA === rootB) continue;
    const listA = members.get(rootA) ?? [rootA];
    const listB = members.get(rootB) ?? [rootB];

    // Two established clusters merge only on mutual recognition, not on one
    // link between them.
    if (listA.length > 1 && listB.length > 1 && mutual(listA, listB) < MUTUAL_SHARE) {
      continue;
    }

    union.join(edge.a, edge.b);
    const merged = [...listA, ...listB];
    members.delete(rootA);
    members.delete(rootB);
    members.set(union.find(edge.a), merged);
  }

  const grouped = new Map<string, T[]>();
  for (const story of stories) {
    const root = union.find(story.id);
    const bucket = grouped.get(root) ?? [];
    bucket.push(story);
    grouped.set(root, bucket);
  }

  return [...grouped.entries()].map(([root, members]) => ({
    // The key is derived from content, not from row ids, so a cluster keeps
    // its identity across sweeps as members come and go.
    key: clusterKeyFor(members, keyTokens, byId.get(root)!),
    members,
  }));
}

/**
 * A stable name for a cluster: its rarest shared words. Recomputed each
 * sweep, and stable as long as the story is the same story.
 */
function clusterKeyFor<T extends Clusterable>(
  members: T[],
  keyTokens: Map<string, string[]>,
  seed: T,
) {
  const counts = new Map<string, number>();
  for (const member of members) {
    for (const token of keyTokens.get(member.id) ?? []) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  const shared = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 3)
    .map(([token]) => token)
    .sort();
  return shared.length > 0 ? shared.join("-") : `solo-${seed.id}`;
}
