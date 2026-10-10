/**
 * How big a node's name can be and still sit inside its circle: wrapped
 * onto as many lines as it needs, the type shrinking only as far as it has
 * to — and never below a floor, past which the name is left to run on
 * (scrolling, while it is written in) rather than becoming too small to read.
 *
 * The live label measures itself (components/SubjectPage.tsx, NodeLabel);
 * this estimates the same thing without a page to measure on, for the
 * board's zoomed-out view and the subject thumbnails, and gives the label
 * its first guess.
 */

/** The largest a node's name is set, in px at the board's own scale. */
export const NODE_FONT_MAX = 19;
/** The smallest: below this a name stops shrinking and runs on instead. */
export const NODE_FONT_MIN = 12;
const LINE = 1.15;
/** An average letter's width, as a share of the type size (bold sans). */
const LETTER = 0.58;

/**
 * The lines a name breaks into at a given width in letters, words kept
 * whole where they fit, and broken only when one word is wider than the line.
 */
export function wrapWords(text: string, perLine: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (let word of text.trim().split(/\s+/).filter(Boolean)) {
    while (word.length > perLine) {
      if (line) {
        lines.push(line);
        line = "";
      }
      lines.push(word.slice(0, perLine));
      word = word.slice(perLine);
    }
    const next = line ? `${line} ${word}` : word;
    if (next.length > perLine && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * The type size for a name in a circle `diameter` across, between `max` and
 * `min`. The writing sits in the square inside the circle (its padding is
 * 14% each side), so lines are measured against that.
 */
export function nodeFontSize(text: string, diameter: number, max = NODE_FONT_MAX, min = NODE_FONT_MIN): number {
  const inner = diameter * 0.72;
  if (!text.trim()) return max;
  for (let size = max; size > min; size -= 0.5) {
    const perLine = Math.max(1, Math.floor(inner / (size * LETTER)));
    const lines = wrapWords(text, perLine).length;
    if (lines * size * LINE <= inner) return size;
  }
  return min;
}
