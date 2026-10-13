/**
 * Find where a block's text is printed in a PDF rendition.
 *
 * The PDF has no node IDs, so a block is located by searching its opening
 * words within the pages of its own topic. A match is accepted only when it
 * is the single occurrence in that range: a change bar on the wrong
 * paragraph is worse than no change bar, so an ambiguous or missing match is
 * reported as unplaced instead of guessed.
 */

export interface TextRun {
  /** Page number, starting at 1. */
  page: number;
  text: string;
  /** Box in page CSS pixels at the rendered scale. */
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PlacedBox {
  page: number;
  top: number;
  bottom: number;
}

export type Placement =
  /** One box per page the block covers, in page order. */
  | { placed: true; boxes: PlacedBox[] }
  | { placed: false; reason: "not-found" | "ambiguous" | "too-short" };

/** Lengths, in words, of the opening phrase tried in turn until one is unique. */
const NEEDLE_LENGTHS = [10, 20, 40, 80];
const TAIL_WORDS = 10;
const MIN_NEEDLE_WORDS = 3;

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function words(text: string): string[] {
  return normalizeText(text).split(" ").filter(Boolean);
}

/** The opening words searched for first. Cell and line breaks count as spaces. */
export function needleFor(text: string): string | undefined {
  const all = words(text);
  if (all.length < MIN_NEEDLE_WORDS) return undefined;
  return all.slice(0, NEEDLE_LENGTHS[0]).join(" ");
}

interface Haystack {
  text: string;
  /** For each character of ``text``, the index of the run it came from. */
  owners: number[];
}

/**
 * Join runs into one searchable string, one space between runs. Hyphens are
 * normalized to spaces on both sides of the search, so "Anti-Ice" split as
 * "Anti-" and "Ice" across two lines still matches.
 */
export function buildHaystack(runs: TextRun[]): Haystack {
  let text = "";
  const owners: number[] = [];
  runs.forEach((run, index) => {
    const piece = normalizeText(run.text);
    if (!piece) return;
    if (text) {
      text += " ";
      owners.push(index);
    }
    text += piece;
    for (let i = 0; i < piece.length; i += 1) owners.push(index);
  });
  return { text, owners };
}

function occurrences(haystack: string, needle: string): number[] {
  const found: number[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return found;
    // Whole words only: "range" must not match inside "rangefinder".
    const before = at === 0 || haystack[at - 1] === " ";
    const end = at + needle.length;
    const after = end === haystack.length || haystack[end] === " ";
    if (before && after) found.push(at);
    from = at + 1;
  }
}

/** Boxes covering the matched runs, one per page. */
function boxesFor(runs: TextRun[], owners: number[], start: number, end: number): PlacedBox[] {
  const byPage = new Map<number, PlacedBox>();
  for (const index of new Set(owners.slice(start, end))) {
    const run = runs[index];
    const box = byPage.get(run.page);
    if (box) {
      box.top = Math.min(box.top, run.top);
      box.bottom = Math.max(box.bottom, run.top + run.height);
    } else {
      byPage.set(run.page, { page: run.page, top: run.top, bottom: run.top + run.height });
    }
  }
  return [...byPage.values()].sort((left, right) => left.page - right.page);
}

/**
 * Locate a block by its opening words, which must occur exactly once. When
 * they occur more than once (boilerplate openings are common), a longer
 * opening is tried, up to the whole block. The box is then extended to the
 * block's closing words when they follow within reach; if they are not found,
 * only the opening is marked, which is still the right block.
 */
export function locateText(runs: TextRun[], blockText: string): Placement {
  const all = words(blockText);
  if (all.length < MIN_NEEDLE_WORDS) return { placed: false, reason: "too-short" };
  const haystack = buildHaystack(runs);

  const lengths = [...new Set([...NEEDLE_LENGTHS, all.length])]
    .filter((length) => length <= all.length)
    .sort((left, right) => left - right);
  let needle = "";
  let found: number[] = [];
  let sawSeveral = false;
  for (const length of lengths) {
    needle = all.slice(0, length).join(" ");
    found = occurrences(haystack.text, needle);
    if (found.length <= 1) break;
    sawSeveral = true;
  }
  if (found.length > 1 || (found.length === 0 && sawSeveral)) {
    // A longer opening can vanish across a page break; the shorter one was
    // still not unique, so this block cannot be told apart from another.
    return { placed: false, reason: "ambiguous" };
  }
  if (found.length === 0) return { placed: false, reason: "not-found" };

  const start = found[0];
  let end = start + needle.length;
  const tail = all.slice(-TAIL_WORDS).join(" ");
  const reach = start + all.join(" ").length * 1.2 + 40;
  const tailAt = occurrences(haystack.text, tail).find(
    (position) => position >= start && position <= reach,
  );
  if (tailAt !== undefined) end = Math.max(end, tailAt + tail.length);
  return { placed: true, boxes: boxesFor(runs, haystack.owners, start, end) };
}
