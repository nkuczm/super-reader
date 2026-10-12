/**
 * What a feed's stories are about right now: the names and phrases that
 * several of its outlets have put in their headlines in the last two days.
 *
 * Read off the feed's own headlines, not the outlet panel's, so a feed of
 * economics journals trends with economics and a feed of local news with
 * the town — the topics are the feed's, not the world's.
 *
 * What makes a topic:
 *
 *  - **Breadth, not volume.** A term counts the outlets that used it, so a
 *    live blog repeating "Gaza" in twenty headlines is one outlet, not twenty.
 *  - **New to the feed.** A term is weighed against how often the whole held
 *    list uses it, so a feed about AI does not trend with "AI" — every
 *    headline in it says that, and a chip for it would filter nothing out.
 *  - **The phrase over its words.** "Supreme Court" rather than "Court", when
 *    the phrase accounts for most of what the word does.
 *  - **One chip a story.** A term whose stories are mostly another chip's is
 *    the same topic under a second name ("Nobel" and "Prize").
 */
import { STOPWORDS, stem } from "./cluster";

type Story = { id: string; title: string; sourceId: string; alsoIn?: string[]; publishedAt?: string; seenAt?: number };

export type Topic = {
  /** What the list is filtered by: a word or a two-word phrase, stemmed. */
  key: string;
  /** How it is shown: the form the headlines use most. */
  label: string;
  /** Outlets that used it in the window. */
  sources: number;
};

/** Words that are in the news every day without being what it is about. */
const GENERIC = new Set(
  ("news people man woman men women police official officials government state states world country city" +
    " group plan deal talks call calls set get gets got take takes give gives show shows know see seen" +
    " big small high low good bad best worst long short old young last next former top latest early late" +
    " million billion percent part home help need want use used using way thing things life lives" +
    " monday tuesday wednesday thursday friday saturday sunday today tonight yesterday tomorrow week" +
    " january february march april may june july august september october november december" +
    " study studies paper papers review evidence effect effects role new using based among between" +
    " find finds found model models data analysis approach").split(/\s+/),
);

/** Two-letter words worth a chip, when written in capitals: AI, EU, UK. */
const ACRONYM = /^[A-Z]{2}$/;

type Term = { key: string; surface: string };

/** The words of a headline in order, with the stopwords marking breaks. */
function wordsOf(title: string): (Term | null)[] {
  const plain = title.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[‘’]/g, "'");
  return plain.split(/[^A-Za-z0-9']+/).map((raw) => {
    const word = raw.replace(/'s$|'$/i, "").replace(/^'+|'+$/g, "");
    const lower = word.toLowerCase();
    if (!word || /^\d+$/.test(word)) return null;
    if (word.length < 3 && !ACRONYM.test(word)) return null;
    if (STOPWORDS.has(lower) || GENERIC.has(lower)) return null;
    return { key: stem(lower), surface: word };
  });
}

/** Every word and two-word phrase a headline can be found under. */
export function termsOf(title: string): Map<string, string> {
  const terms = new Map<string, string>();
  const words = wordsOf(title);
  words.forEach((word, i) => {
    if (!word) return;
    if (!terms.has(word.key)) terms.set(word.key, word.surface);
    const next = words[i + 1];
    if (next && next.key !== word.key) {
      const key = `${word.key} ${next.key}`;
      if (!terms.has(key)) terms.set(key, `${word.surface} ${next.surface}`);
    }
  });
  return terms;
}

/** Whether a headline is about a topic, as the topic's chip means it. */
export function aboutTopic(title: string, key: string) {
  return termsOf(title).has(key);
}

function timeOf(story: Story) {
  const published = story.publishedAt ? Date.parse(story.publishedAt) : NaN;
  return Number.isFinite(published) ? published : story.seenAt ?? 0;
}

/** The form a term is written in most; all-lowercase is given capitals for a chip. */
function labelFor(surfaces: Map<string, number>) {
  const [best] = [...surfaces.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  return best === best.toLowerCase() ? best.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : best;
}

export function trendingTopics(
  stories: Story[],
  { now = Date.now(), hours = 48, max = 8, minSources = 2 }: { now?: number; hours?: number; max?: number; minSources?: number } = {},
): Topic[] {
  type Tally = { stories: Set<string>; sources: Set<string>; all: number; surfaces: Map<string, number> };
  const tallies = new Map<string, Tally>();
  let recentCount = 0;
  for (const story of stories) {
    const recent = now - timeOf(story) <= hours * 3_600_000;
    if (recent) recentCount += 1;
    for (const [key, surface] of termsOf(story.title)) {
      let tally = tallies.get(key);
      if (!tally) tallies.set(key, (tally = { stories: new Set(), sources: new Set(), all: 0, surfaces: new Map() }));
      tally.all += 1;
      if (!recent) continue;
      tally.stories.add(story.id);
      for (const source of [story.sourceId, ...(story.alsoIn ?? [])]) tally.sources.add(source);
      tally.surfaces.set(surface, (tally.surfaces.get(surface) ?? 0) + 1);
    }
  }
  if (recentCount === 0) return [];

  const total = stories.length;
  const candidates: (Topic & { score: number; ids: Set<string> })[] = [];
  for (const [key, tally] of tallies) {
    if (tally.sources.size < minSources || tally.stories.size < 2) continue;
    // What the whole feed is about is not a topic within it.
    if (total >= 30 && tally.all / total > 0.3) continue;
    const lift = tally.stories.size / recentCount / ((tally.all + 1) / (total + 1));
    const phrase = key.includes(" ");
    const score = (tally.sources.size + tally.stories.size / 2) * Math.min(3, Math.max(0.5, lift)) * (phrase ? 1.2 : 1);
    candidates.push({ key, label: labelFor(tally.surfaces), sources: tally.sources.size, score, ids: tally.stories });
  }

  // A phrase that accounts for most of a word's stories names it better.
  const phrases = candidates.filter((topic) => topic.key.includes(" "));
  for (const topic of candidates) {
    if (topic.key.includes(" ")) continue;
    const named = phrases
      .filter((phrase) => phrase.key.split(" ").includes(topic.key) && phrase.ids.size >= 0.6 * topic.ids.size)
      .sort((a, b) => b.ids.size - a.ids.size)[0];
    if (named) topic.label = named.label;
  }

  const picked: typeof candidates = [];
  for (const topic of candidates.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1))) {
    if (picked.length >= max) break;
    const overlaps = picked.some((other) => {
      let shared = 0;
      for (const id of topic.ids) if (other.ids.has(id)) shared += 1;
      return shared >= 0.6 * Math.min(topic.ids.size, other.ids.size) || other.label === topic.label;
    });
    if (!overlaps) picked.push(topic);
  }
  return picked.map(({ key, label, sources }) => ({ key, label, sources }));
}
