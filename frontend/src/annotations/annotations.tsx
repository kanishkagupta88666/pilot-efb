import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ContentBlock } from "../types/api";

export type AnnotationKind = "bookmark" | "highlight" | "note";

/**
 * Where an annotation sits: the block's permanent node ID, which piece of text inside it
 * (the paragraph, a list item, a table cell or a checklist line), and the selected words.
 * Never anchored to a number or page.
 */
export interface TextAnchor {
  nodeId: string;
  /** "text", "item-<n>", "cell-<row>-<column>" or "<check id>:challenge" / ":response". */
  part: string;
  start: number;
  end: number;
  /** The selected words. */
  quote: string;
  /** A few words either side, used to find the quote again in a later revision. */
  prefix: string;
  suffix: string;
  /** The whole piece of text when it was annotated, shown if a later revision changes it. */
  text: string;
}

export interface Annotation extends TextAnchor {
  id: string;
  kind: AnnotationKind;
  docId: string;
  revision: number;
  topicId: string;
  note?: string;
}

export type AnnotationTarget = Omit<Annotation, "id" | "kind" | "note">;

interface AnnotationStore {
  annotations: Annotation[];
  add: (kind: AnnotationKind, target: AnnotationTarget, note?: string) => void;
  /** Saves a note's text; empty text removes the note. */
  updateNote: (id: string, note: string) => void;
  remove: (id: string) => void;
  /** Re-attaches an annotation to a newer revision's wording. */
  keep: (id: string, revision: number, anchor: TextAnchor) => void;
}

const AnnotationContext = createContext<AnnotationStore | undefined>(undefined);

let nextId = 1;

/**
 * PROVISIONAL: annotations are kept in memory only and are lost on reload.
 * Replace the state below with API calls once the backend can store annotations.
 */
export function AnnotationProvider({
  children,
  initial = [],
}: {
  children: ReactNode;
  /** Annotations to start with, e.g. ones loaded from storage. */
  initial?: Annotation[];
}) {
  const [annotations, setAnnotations] = useState<Annotation[]>(initial);

  const store = useMemo<AnnotationStore>(
    () => ({
      annotations,
      add: (kind, target, note) =>
        setAnnotations((previous) => [
          ...previous,
          { id: `annotation-${nextId++}`, kind, ...target, ...(note ? { note } : {}) },
        ]),
      updateNote: (id, note) =>
        setAnnotations((previous) =>
          note.trim()
            ? previous.map((annotation) =>
                annotation.id === id ? { ...annotation, note: note.trim() } : annotation,
              )
            : previous.filter((annotation) => annotation.id !== id),
        ),
      remove: (id) =>
        setAnnotations((previous) => previous.filter((annotation) => annotation.id !== id)),
      keep: (id, revision, anchor) =>
        setAnnotations((previous) =>
          previous.map((annotation) =>
            annotation.id === id ? { ...annotation, ...anchor, revision } : annotation,
          ),
        ),
    }),
    [annotations],
  );

  return <AnnotationContext.Provider value={store}>{children}</AnnotationContext.Provider>;
}

/** Undefined outside an AnnotationProvider; blocks then render without annotation controls. */
export function useAnnotations(): AnnotationStore | undefined {
  return useContext(AnnotationContext);
}

/** Every piece of selectable text in a block, in reading order. */
export function blockParts(block: ContentBlock): { part: string; text: string }[] {
  switch (block.type) {
    case "para":
    case "note":
    case "caution":
    case "warning":
      return [{ part: "text", text: block.segments.map((segment) => segment.text).join("") }];
    case "list":
      return block.items.map((item, index) => ({ part: `item-${index}`, text: item }));
    case "table":
      return block.rows.flatMap((row, rowIndex) =>
        row.cells.map((cell, cellIndex) => ({ part: `cell-${rowIndex}-${cellIndex}`, text: cell })),
      );
    case "checklist":
      return block.checks.flatMap((check) => [
        { part: `${check.id}:challenge`, text: check.challenge },
        { part: `${check.id}:response`, text: check.response },
      ]);
  }
}

export function partText(block: ContentBlock | undefined, part: string): string | undefined {
  return block ? blockParts(block).find((entry) => entry.part === part)?.text : undefined;
}

const CONTEXT_LENGTH = 32;

/** Builds the stored anchor for a selection of text[start, end). */
export function anchorFor(
  nodeId: string,
  part: string,
  text: string,
  start: number,
  end: number,
): TextAnchor {
  return {
    nodeId,
    part,
    start,
    end,
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: text.slice(end, end + CONTEXT_LENGTH),
    text,
  };
}

function sharedEnd(a: string, b: string): number {
  let count = 0;
  while (count < a.length && count < b.length && a[a.length - 1 - count] === b[b.length - 1 - count]) {
    count++;
  }
  return count;
}

function sharedStart(a: string, b: string): number {
  let count = 0;
  while (count < a.length && count < b.length && a[count] === b[count]) count++;
  return count;
}

/**
 * Finds an annotation's words in the given text: at the same place if unchanged, otherwise
 * wherever the quote appears with the best-matching surrounding words. Undefined if gone.
 */
export function resolveRange(
  anchor: Pick<TextAnchor, "start" | "end" | "quote" | "prefix" | "suffix">,
  text: string,
): { start: number; end: number } | undefined {
  if (!anchor.quote) return undefined;
  if (text.slice(anchor.start, anchor.end) === anchor.quote) {
    return { start: anchor.start, end: anchor.end };
  }
  let best: { start: number; score: number } | undefined;
  for (let index = text.indexOf(anchor.quote); index !== -1; index = text.indexOf(anchor.quote, index + 1)) {
    const score =
      sharedEnd(text.slice(0, index), anchor.prefix) +
      sharedStart(text.slice(index + anchor.quote.length), anchor.suffix) -
      Math.abs(index - anchor.start) / 1000;
    if (!best || score > best.score) best = { start: index, score };
  }
  return best && { start: best.start, end: best.start + anchor.quote.length };
}

/** Shortens text for previews. */
export function shorten(text: string, length = 60): string {
  return text.length > length ? `${text.slice(0, length).trimEnd()}…` : text;
}
