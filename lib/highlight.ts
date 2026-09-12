/**
 * Finding a quote again inside the article it came from.
 *
 * A quote is stored as the reader saw it — whitespace collapsed, the
 * layout's line breaks gone (see cleanQuoteText). The article it is being
 * looked for in still has all of that, spread across whatever elements the
 * publisher used, so the search happens on a normalised copy of the text with
 * an index back to the nodes it came from. A quote that runs across two
 * paragraphs, or through a link or an italic, is one match either way.
 */

type Point = { node: Text; offset: number };

/**
 * Tags that end a run of text whether or not the HTML has whitespace around
 * them. `<p>One.</p><p>Two.</p>` reads as two sentences and has to index as
 * two, or a quote spanning both would have to be stored without the space.
 */
const BLOCKS = new Set([
  "P", "DIV", "LI", "UL", "OL", "BLOCKQUOTE", "PRE", "SECTION", "ARTICLE",
  "H1", "H2", "H3", "H4", "H5", "H6", "FIGURE", "FIGCAPTION", "TD", "TH",
  "TR", "TABLE", "BR", "HR", "HEADER", "FOOTER", "ASIDE", "MAIN", "DD", "DT",
]);

function blockOf(node: Node, root: Element): Element {
  let element = node.parentElement;
  while (element && element !== root && !BLOCKS.has(element.tagName)) {
    element = element.parentElement;
  }
  return element ?? root;
}

/** Whitespace, as it appears once collapsed. */
function normalizeNeedle(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Walk the text nodes, building the normalised string and, for every
 * character in it, where that character actually lives.
 */
function indexText(root: Element) {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
  let text = "";
  const points: Point[] = [];
  let lastWasSpace = true; // so leading whitespace is dropped, like a trim
  let lastBlock: Element | null = null;

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const value = node.nodeValue ?? "";
    const block = blockOf(node, root);
    // Crossing into another paragraph is a space even where the markup has
    // none, which minified HTML frequently does not.
    if (lastBlock && block !== lastBlock && !lastWasSpace) {
      lastWasSpace = true;
      text += " ";
      points.push({ node: node as Text, offset: 0 });
    }
    lastBlock = block;
    for (let i = 0; i < value.length; i += 1) {
      const char = value[i];
      if (/\s/.test(char)) {
        if (lastWasSpace) continue;
        lastWasSpace = true;
        text += " ";
        points.push({ node: node as Text, offset: i });
        continue;
      }
      lastWasSpace = false;
      text += char;
      points.push({ node: node as Text, offset: i });
    }
  }

  return { text, points };
}

/**
 * Where a quote sits in the article, as a Range — or null if this copy of the
 * article does not contain it, which happens when the page has been edited
 * since, or when the quote came from the feed's summary rather than the page.
 *
 * A long quote that no longer matches in full still matches on its opening,
 * so an article that gained a correction mid-paragraph still jumps to roughly
 * the right place rather than nowhere at all.
 */
export function findQuoteRange(root: Element | null, quote: string): Range | null {
  if (!root || !quote) return null;
  const needle = normalizeNeedle(quote);
  if (!needle) return null;

  const { text, points } = indexText(root);
  if (points.length === 0) return null;

  let at = text.indexOf(needle);
  let length = needle.length;

  if (at === -1) {
    // As much of the opening as this copy still has. Binary search rather
    // than one fixed prefix: an article that gained a correction after the
    // first clause and one that changed a word near the end both want the
    // longest run that still matches, and they are nowhere near each other.
    const FLOOR = 25; // shorter than this and a match means nothing
    if (needle.length < FLOOR) return null;
    let low = FLOOR;
    let high = needle.length;
    let best = -1;
    let bestLength = 0;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const found = text.indexOf(needle.slice(0, mid));
      if (found === -1) {
        high = mid - 1;
      } else {
        best = found;
        bestLength = mid;
        low = mid + 1;
      }
    }
    if (best === -1) return null;
    at = best;
    length = bestLength;
  }

  const start = points[at];
  const end = points[Math.min(at + length - 1, points.length - 1)];
  if (!start || !end) return null;

  const range = root.ownerDocument.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return range;
}
