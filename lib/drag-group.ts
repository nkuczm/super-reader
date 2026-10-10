/**
 * What moves on the whiteboard when a block is dragged.
 *
 * A section label carries what is linked to it — its stories, notes and
 * pictures — as it always has. Between nodes, size says which hangs from
 * which: a node carries the nodes linked to it that are smaller than it
 * (and what hangs from them in turn), never one its own size or larger. So
 * a big hub dragged takes its satellites; a satellite dragged moves alone;
 * two nodes of a size each move by themselves.
 *
 * Pure: the board passes in its links and how to tell what each block is.
 */

export type BlockKind = "node" | "label" | "block";

export function dragGroup(
  start: Iterable<string>,
  links: { from: string; to: string }[],
  kindOf: (id: string) => BlockKind,
  sizeOf: (id: string) => number,
): Set<string> {
  const group = new Set<string>(start);
  const neighbours = new Map<string, string[]>();
  for (const { from, to } of links) {
    neighbours.set(from, [...(neighbours.get(from) ?? []), to]);
    neighbours.set(to, [...(neighbours.get(to) ?? []), from]);
  }
  // Only labels and nodes carry anything; a node carries further down, a label one step.
  const queue = [...group].filter((id) => kindOf(id) !== "block");
  const expanded = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (expanded.has(id)) continue;
    expanded.add(id);
    const kind = kindOf(id);
    for (const other of neighbours.get(id) ?? []) {
      if (group.has(other)) continue;
      const otherKind = kindOf(other);
      if (kind === "node" && otherKind === "node") {
        // Only a smaller node hangs from this one — and brings what hangs from it.
        if (sizeOf(other) < sizeOf(id)) {
          group.add(other);
          queue.push(other);
        }
        continue;
      }
      group.add(other);
    }
  }
  return group;
}
