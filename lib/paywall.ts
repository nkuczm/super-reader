/**
 * Telling a free article from the free *part* of one.
 *
 * The failure this exists to stop is quiet: a metered site serves the first
 * three paragraphs to everyone, Readability extracts them perfectly, and the
 * reader shows a confident, complete-looking article that stops mid-thought.
 * Nothing errored, so nothing said anything — and the reader had no way to
 * know there were another nine paragraphs behind a subscription.
 *
 * So the page is asked whether what it handed over is everything. Publishers
 * answer this in public, machine-readable ways, because search engines require
 * it of them: `isAccessibleForFree: false` in schema.org, and the
 * `article:content_tier` Open Graph property. Where they do not say it
 * outright, the wall itself is usually in the markup under its own name.
 *
 * This detects; it never circumvents. Knowing an article is partial is what
 * lets the reader offer the publisher's own syndicated copy when there is one,
 * and otherwise say plainly that the rest is on the site.
 */

/** Meta tags where a publisher declares the tier a page sits behind. */
const TIER_META =
  /<meta\b[^>]*(?:property|name)=["'](?:article:content_tier|article:content-tier|tier)["'][^>]*content=["']([^"']+)["']/i;

/**
 * Markup that is the wall itself. Matched on whole words: "paywall-free" and
 * "no-paywall" are things pages actually say, and a class list containing
 * "unpaywalled" must not read as a wall.
 */
const WALL_MARKUP = [
  /class=["'][^"']*\bpaywall\b[^"']*["']/i,
  /\bid=["'][^"']*\bpaywall\b[^"']*["']/i,
  /data-paywall\s*=\s*["'](?:true|1|yes)["']/i,
  /class=["'][^"']*\b(?:subscriber-only|subscription-wall|premium-gate|meter-gate|regwall)\b/i,
  // Piano and Tinypass, the two most widely deployed metering vendors.
  /\btp-modal\b|\bpiano-paywall\b|cxenseparse|\btp-container-inner\b/i,
];

/**
 * Sentences a wall says. Deliberately narrow — a story *about* subscriptions
 * must not be marked partial — so each pattern is a call to action rather
 * than a topic, and they are only consulted for short extractions.
 */
const WALL_PROSE = [
  /subscribe (?:now )?to (?:continue|keep) reading/i,
  /to continue reading[,.]? (?:please )?(?:subscribe|sign in|log in)/i,
  /this (?:article|story|content) is (?:for|available to) subscribers/i,
  /already a (?:subscriber|member)\?\s*(?:sign|log) in/i,
  /you(?:'ve| have) reached your (?:free )?article limit/i,
  /(?:sign|log) in to read the full (?:story|article)/i,
  /this is a subscriber[- ]only (?:article|story|newsletter)/i,
];

export type PaywallVerdict = {
  /** The publisher said, in a field meant to be read, that this is gated. */
  declared: boolean;
  /** The page carries a wall, whether or not it declared one. */
  marked: boolean;
  /** Why, in the publisher's own words where possible — for the reader. */
  reason?: string;
};

/**
 * Read a page's own account of whether it is free.
 *
 * `free` is what structured data said, passed in rather than re-parsed: the
 * caller has already read the JSON-LD and it is the strongest signal here.
 */
export function paywallVerdict(
  html: string,
  free?: boolean,
): PaywallVerdict {
  if (free === false) {
    return {
      declared: true,
      marked: true,
      reason: "The publisher marks this article as subscriber-only.",
    };
  }

  const tier = html.match(TIER_META)?.[1]?.trim().toLowerCase();
  if (tier && tier !== "free" && tier !== "public") {
    return {
      declared: true,
      marked: true,
      reason:
        tier === "metered"
          ? "The publisher meters this article — this is the part it serves for free."
          : "The publisher marks this article as subscriber-only.",
    };
  }

  // `free === true` is the publisher saying the opposite, and outranks
  // whatever vendor markup their template happens to ship on every page.
  if (free === true) return { declared: true, marked: false };

  const head = html.slice(0, 250_000);
  if (WALL_MARKUP.some((pattern) => pattern.test(head))) {
    return {
      declared: false,
      marked: true,
      reason: "This page carries a subscription wall.",
    };
  }

  return { declared: false, marked: false };
}

/**
 * Does the extracted text look like it stopped at a wall?
 *
 * Only asked of short extractions, and only about the end of the text, so an
 * article whose subject is paywalls is not itself marked partial: the prompt
 * is the last thing on the page when the rest has been withheld.
 */
export function endsAtWall(text: string) {
  const tail = text.slice(-600);
  return WALL_PROSE.some((pattern) => pattern.test(tail));
}

/** A full article is rarely this short; below it, "partial" is worth testing. */
export const SHORT_ARTICLE_WORDS = 220;
