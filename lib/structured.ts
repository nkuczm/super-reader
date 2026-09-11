/**
 * What a page says about itself in structured data.
 *
 * Nearly every newsroom, CMS and government publisher embeds schema.org
 * JSON-LD in the page — it is how they describe an article to search engines
 * and to social cards. Three things in it are worth more than anything that
 * can be inferred from the markup:
 *
 *  articleBody          — the full prose, as the publisher wrote it. This
 *                         survives on pages whose rendered body is assembled
 *                         by JavaScript, where Readability finds an empty
 *                         shell and the reader came back blank.
 *  isAccessibleForFree  — the publisher stating, in a machine-readable field,
 *                         that what a non-subscriber receives is partial.
 *                         Believing them is how the reader can say "this is
 *                         the free excerpt" instead of passing a teaser off
 *                         as the article.
 *  the metadata         — headline, byline, date, section. Meta tags carry
 *                         some of this; JSON-LD carries it more often and
 *                         more precisely (a real author list, not "Staff").
 *
 * Nothing here defeats an access control. `articleBody` is what the publisher
 * chose to hand every crawler that asks; where they mark the page partial we
 * say so rather than pretending otherwise.
 */

export type StructuredArticle = {
  headline?: string;
  /** The body as HTML — paragraphs, whether or not the source had markup. */
  body?: string;
  description?: string;
  byline?: string;
  publishedAt?: string;
  modifiedAt?: string;
  section?: string;
  siteName?: string;
  image?: string;
  keywords?: string[];
  /**
   * The publisher's own answer to "does a stranger get all of this?".
   * `undefined` means they did not say, which is not the same as "yes".
   */
  free?: boolean;
};

/**
 * Types worth reading, most specific first. A NewsArticle node beats a
 * WebPage node describing the same URL: both are common on one page, and the
 * WebPage one usually carries the site's boilerplate description where the
 * article node carries the story.
 */
const TYPE_RANK = [
  "newsarticle",
  "reportagenewsarticle",
  "analysisnewsarticle",
  "backgroundnewsarticle",
  "opinionnewsarticle",
  "reviewnewsarticle",
  "liveblogposting",
  "blogposting",
  "techarticle",
  "scholarlyarticle",
  "report",
  "article",
  "socialmediaposting",
  "discussionforumposting",
  "articlepage",
  "itempage",
  "webpage",
];

function typesOf(node: any): string[] {
  const raw = node?.["@type"] ?? node?.type;
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return list
    .filter((value: unknown): value is string => typeof value === "string")
    .map((value) => value.toLowerCase().replace(/^.*[/#]/, ""));
}

function rankOf(node: any) {
  let best = Infinity;
  for (const type of typesOf(node)) {
    const index = TYPE_RANK.indexOf(type);
    if (index >= 0 && index < best) best = index;
  }
  return best;
}

/**
 * JSON-LD blocks, parsed leniently.
 *
 * Publishers ship invalid JSON more often than anyone would like: a stray
 * trailing comma, an HTML comment wrapper left over from an XML-era template,
 * a raw newline inside a string. One malformed block must not cost the others,
 * so each is parsed on its own and a failure is simply skipped.
 */
export function jsonLdNodes(html: string): any[] {
  const nodes: any[] = [];
  const blocks = html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );

  for (const [, raw] of blocks) {
    const text = raw
      .replace(/^\s*<!--/, "")
      .replace(/-->\s*$/, "")
      .replace(/^\s*\/\/\s*<!\[CDATA\[/, "")
      .replace(/\]\]>\s*$/, "")
      .trim();
    if (!text) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      try {
        // A trailing comma before a closing brace or bracket is the single
        // most common way a hand-built template produces invalid JSON.
        parsed = JSON.parse(text.replace(/,\s*([}\]])/g, "$1"));
      } catch {
        continue;
      }
    }

    // A block may be one node, a list of them, or a @graph holding both.
    const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
    while (queue.length > 0) {
      const node: any = queue.shift();
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node)) {
        queue.push(...node);
        continue;
      }
      if (Array.isArray(node["@graph"])) queue.push(...node["@graph"]);
      nodes.push(node);
    }
  }

  return nodes;
}

function firstString(value: any): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item);
      if (found) return found;
    }
    return undefined;
  }
  if (value && typeof value === "object") {
    return firstString(value.name ?? value.url ?? value["@id"] ?? value["@value"]);
  }
  return undefined;
}

/** Authors, as a byline: "Jane Doe and Sam Roe", however they were listed. */
function bylineOf(node: any): string | undefined {
  const raw = node?.author ?? node?.creator;
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  const names = list
    .map((entry: any) => (typeof entry === "string" ? entry : firstString(entry?.name)))
    .map((name: string | undefined) => name?.trim())
    .filter((name: string | undefined): name is string => Boolean(name))
    // An organisation repeated as its own author adds nothing to a byline.
    .filter((name, index, all) => all.indexOf(name) === index)
    .slice(0, 4);

  if (names.length === 0) return undefined;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function keywordsOf(node: any): string[] | undefined {
  const raw = node?.keywords;
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : [];
  const words = list
    .map((word: unknown) => (typeof word === "string" ? word.trim() : ""))
    .filter(Boolean)
    .slice(0, 12);
  return words.length > 0 ? words : undefined;
}

function freeOf(node: any): boolean | undefined {
  const raw = node?.isAccessibleForFree ?? node?.isAccessibleforFree;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    if (/^(true|yes)$/i.test(raw.trim())) return true;
    if (/^(false|no)$/i.test(raw.trim())) return false;
  }
  return undefined;
}

const BLOCK_TAG = /<(p|div|section|article|h[1-6]|ul|ol|blockquote|figure|br)\b/i;

function escapeText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * `articleBody` is usually plain text with the paragraph breaks left in as
 * newlines. Rendered as-is it is one unreadable slab, so the breaks are turned
 * back into paragraphs. Where a publisher put real markup in the field
 * instead — some do — it is kept and sanitised downstream like any other HTML.
 */
export function bodyToHtml(body: string): string {
  const text = body.trim();
  if (!text) return "";
  if (BLOCK_TAG.test(text)) return text;

  const paragraphs = text
    .split(/\n\s*\n|\r\n\s*\r\n/)
    .map((part) => part.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);

  // No blank lines at all: single newlines are then the paragraph breaks.
  const parts =
    paragraphs.length > 1
      ? paragraphs
      : text
          .split(/\n+/)
          .map((part) => part.trim())
          .filter(Boolean);

  return parts.map((part) => `<p>${escapeText(part)}</p>`).join("\n");
}

/**
 * The best article node a page declares, flattened into one shape.
 *
 * Fields are taken from the highest-ranked node that has them rather than
 * from one node alone: a page routinely describes itself as both a NewsArticle
 * (which carries the body and the byline) and a WebPage (which carries the
 * site name), and taking only one of them throws away half of what was said.
 */
export function structuredArticle(html: string): StructuredArticle | null {
  const nodes = jsonLdNodes(html)
    .map((node) => ({ node, rank: rankOf(node) }))
    .filter((entry) => entry.rank !== Infinity)
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.node);

  if (nodes.length === 0) return null;

  const out: StructuredArticle = {};
  const take = <K extends keyof StructuredArticle>(
    key: K,
    value: StructuredArticle[K] | undefined,
  ) => {
    if (out[key] === undefined && value !== undefined && value !== "") out[key] = value;
  };

  for (const node of nodes) {
    const body = firstString(node.articleBody ?? node.text ?? node.description);
    // `description` is a summary, not the body: only articleBody/text may
    // stand in for the article itself.
    const realBody = firstString(node.articleBody ?? node.text);

    take("headline", firstString(node.headline ?? node.name ?? node.title));
    take("body", realBody ? bodyToHtml(realBody) : undefined);
    take("description", firstString(node.description) ?? (realBody ? undefined : body));
    take("byline", bylineOf(node));
    take("publishedAt", firstString(node.datePublished ?? node.dateCreated ?? node.uploadDate));
    take("modifiedAt", firstString(node.dateModified));
    take("section", firstString(node.articleSection ?? node.genre));
    take("siteName", firstString(node.publisher?.name ?? node.isPartOf?.name ?? node.sourceOrganization));
    take("image", firstString(node.image?.url ?? node.image ?? node.thumbnailUrl));
    take("keywords", keywordsOf(node));
    take("free", freeOf(node));
  }

  return Object.keys(out).length > 0 ? out : null;
}
