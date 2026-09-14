/**
 * Does this article actually match what was asked for?
 *
 * A search source is only worth having if the things in it are things you
 * searched for. The failure mode is not an empty feed — it is a full one:
 * a search wrapper returns forty items, six of them about the subject and
 * the rest about a company with a similar name, and the reader has no way to
 * tell which is which without opening all forty.
 *
 * So matching here is deliberately strict about *whether* something matches
 * and only then interested in how well. Every required term has to appear
 * somewhere in the article's own words; a quoted phrase has to appear intact;
 * an excluded term disqualifies outright. Ranking happens among the survivors.
 *
 * Matching is done on titles and summaries, which is all a listing gives us.
 * That is a real limit and it is the honest one: we do not download every
 * article to decide whether to show it.
 */

export type Query = {
  /** Bare words, all of which must appear. */
  terms: string[];
  /** "quoted phrases", which must appear contiguously. */
  phrases: string[];
  /** -terms, any of which disqualifies. */
  excluded: string[];
  /** Alternatives from `a OR b`; at least one member of each group must hit. */
  anyOf: string[][];
  /** True when the query asked for nothing — everything matches. */
  empty: boolean;
};

/**
 * Words too common to carry meaning. Kept short on purpose: dropping too much
 * turns "war on drugs" into "war drugs" and starts matching pharmacy news.
 */
const STOP = new Set([
  "a", "an", "and", "the", "of", "in", "on", "at", "to", "for", "is", "are",
  "was", "were", "be", "by", "with", "from", "as", "it", "its", "that", "this",
]);

/** Fold case, accents and punctuation so "Crypto's" matches "crypto". */
export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Curly and straight apostrophes vanish rather than splitting the word.
    .replace(/['’ʼ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function words(text: string): string[] {
  const value = normalize(text);
  return value ? value.split(" ") : [];
}

/**
 * Read a search the way someone would write one.
 *
 * Supported because people type them without being told they exist: quoted
 * phrases, a leading minus to exclude, and OR between alternatives. Anything
 * else is a plain term.
 */
export function parseQuery(input: string): Query {
  const query: Query = { terms: [], phrases: [], excluded: [], anyOf: [], empty: false };
  const raw = input.trim();
  if (!raw) return { ...query, empty: true };

  const tokens: string[] = [];
  // Pull quoted phrases out first so their spaces do not split them.
  const rest = raw.replace(/"([^"]+)"|“([^”]+)”/g, (_, a, b) => {
    const phrase = normalize(a ?? b);
    if (phrase) query.phrases.push(phrase);
    return " ";
  });
  for (const token of rest.split(/\s+/)) if (token) tokens.push(token);

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.toUpperCase() === "OR") continue;

    if (token.startsWith("-") && token.length > 1) {
      const term = normalize(token.slice(1));
      if (term) query.excluded.push(term);
      continue;
    }

    const term = normalize(token);
    if (!term) continue;

    // `a OR b OR c` becomes one group where any member satisfies the query.
    const alternatives = [term];
    while (tokens[i + 1]?.toUpperCase() === "OR" && tokens[i + 2]) {
      const next = normalize(tokens[i + 2]);
      if (next) alternatives.push(next);
      i += 2;
    }
    if (alternatives.length > 1) query.anyOf.push(alternatives);
    else if (!STOP.has(term)) query.terms.push(term);
  }

  query.empty =
    query.terms.length === 0 &&
    query.phrases.length === 0 &&
    query.anyOf.length === 0 &&
    query.excluded.length === 0;
  return query;
}

/** A term hits if it appears as a whole word, or as a prefix of a longer one. */
function hits(haystack: string[], term: string): boolean {
  const parts = term.split(" ");
  if (parts.length > 1) return containsPhrase(haystack, parts);
  return haystack.some(
    (word) =>
      word === term ||
      // "bank" matches "banking" and "banks" but not "bankrupt"; requiring a
      // real stem keeps prefix matching from becoming substring matching.
      (word.length > term.length &&
        word.length - term.length <= 3 &&
        word.startsWith(term)),
  );
}

function containsPhrase(haystack: string[], phrase: string[]): boolean {
  if (phrase.length === 0) return false;
  for (let i = 0; i + phrase.length <= haystack.length; i += 1) {
    let all = true;
    for (let j = 0; j < phrase.length; j += 1) {
      if (haystack[i + j] !== phrase[j]) { all = false; break; }
    }
    if (all) return true;
  }
  return false;
}

export type Matchable = { title?: string; summary?: string; link?: string };

export type Match = {
  matches: boolean;
  /** 0 when it does not match; higher is a better answer to the search. */
  score: number;
  /** Why it was rejected, for the places that explain themselves. */
  missing: string[];
};

/**
 * Score one article against a query.
 *
 * Title hits count for more than summary hits, because a summary is often the
 * first two sentences of an article that is mostly about something else. The
 * URL slug counts a little: it is the publisher's own summary of the piece,
 * and it is the only text some listings give us at all.
 */
export function matchOf(article: Matchable, query: Query): Match {
  if (query.empty) return { matches: true, score: 1, missing: [] };

  const title = words(article.title ?? "");
  const summary = words(article.summary ?? "");
  const slug = words(slugTextOf(article.link ?? ""));
  const everywhere = [...title, ...summary, ...slug];

  for (const term of query.excluded) {
    if (hits(everywhere, term)) {
      return { matches: false, score: 0, missing: [`excluded: ${term}`] };
    }
  }

  const missing: string[] = [];
  let score = 0;

  const credit = (term: string, weight: number) => {
    if (hits(title, term)) { score += 3 * weight; return true; }
    if (hits(summary, term)) { score += 1.5 * weight; return true; }
    if (hits(slug, term)) { score += 1 * weight; return true; }
    return false;
  };

  for (const phrase of query.phrases) {
    const parts = phrase.split(" ");
    if (containsPhrase(title, parts)) score += 5;
    else if (containsPhrase(summary, parts)) score += 2.5;
    else if (containsPhrase(slug, parts)) score += 1.5;
    else missing.push(`phrase: ${phrase}`);
  }

  for (const term of query.terms) {
    if (!credit(term, 1)) missing.push(term);
  }

  for (const group of query.anyOf) {
    // Any alternative satisfies the group; the best one sets the score.
    const before = score;
    let any = false;
    for (const term of group) if (credit(term, 1)) any = true;
    if (!any) missing.push(group.join(" OR "));
    else if (score === before) score += 1;
  }

  // Everything asked for has to be present. This is the whole point: a source
  // full of near-misses is worse than a smaller source of real answers.
  if (missing.length > 0) return { matches: false, score: 0, missing };

  // A short, on-topic headline beats a long one that mentions the term once.
  if (title.length > 0 && title.length <= 14) score += 0.5;
  return { matches: true, score, missing: [] };
}

/** The readable part of a URL — the slug, not the host or the file extension. */
export function slugTextOf(link: string): string {
  try {
    const { pathname } = new URL(link);
    return pathname
      .replace(/\.(html?|php|aspx?)$/i, "")
      .split("/")
      .filter(Boolean)
      // Trailing ids and dates are not words anyone searched for.
      .filter((part) => !/^\d+$/.test(part) && !/^[0-9a-f]{6,}$/i.test(part))
      .join(" ")
      // Slugs join words with hyphens; the words are the point.
      .replace(/[-_]+/g, " ");
  } catch {
    return "";
  }
}

/**
 * Keep what matches, best answer first.
 *
 * Sorting by relevance rather than by date is deliberate for a search: the
 * question was "about this", not "since when". Dates break ties so a fresh
 * story wins over an equally relevant old one.
 */
export function rankByRelevance<T extends Matchable & { publishedAt?: string }>(
  articles: T[],
  query: Query,
): T[] {
  if (query.empty) return articles;
  const scored: { article: T; score: number }[] = [];
  for (const article of articles) {
    const match = matchOf(article, query);
    if (match.matches) scored.push({ article, score: match.score });
  }
  return scored
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const at = Date.parse(a.article.publishedAt ?? "");
      const bt = Date.parse(b.article.publishedAt ?? "");
      return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0);
    })
    .map((entry) => entry.article);
}
