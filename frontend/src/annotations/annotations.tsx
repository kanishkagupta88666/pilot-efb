import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Annotation, AnnotationKind, ContentBlock } from "../types/api";
import {
  addAnnotation,
  allAnnotations,
  deleteAnnotation,
  subscribeToAnnotations,
  updateAnnotation,
  type NewAnnotation,
} from "../utils/annotationStore";

export type { Annotation, AnnotationKind, NewAnnotation };

/**
 * The reader's annotation screens talk to this store. By default it is backed by the shared
 * annotation store (saved on the device first, works offline, synced to the server under the
 * pilot's name). Tests can pass `initial` to use a plain in-memory list instead.
 *
 * Annotations are anchored to the block's permanent node ID plus a character range within the
 * block's whole text (see blockLayout), never to a number or page.
 */
interface AnnotationStore {
  /** Live annotations (deleted ones are left out). */
  annotations: Annotation[];
  add: (fields: NewAnnotation) => void;
  update: (id: string, change: Partial<Annotation>) => void;
  remove: (id: string) => void;
}

const AnnotationContext = createContext<AnnotationStore | undefined>(undefined);

let nextLocalId = 1;

function useLocalStore(initial: Annotation[]): AnnotationStore {
  const [annotations, setAnnotations] = useState<Annotation[]>(initial);
  return useMemo(
    () => ({
      annotations,
      add: (fields) => {
        const now = new Date().toISOString();
        setAnnotations((previous) => [
          ...previous,
          { detached: false, ...fields, id: `local-${nextLocalId++}`, createdAt: now, updatedAt: now, deleted: false },
        ]);
      },
      update: (id, change) =>
        setAnnotations((previous) =>
          previous.map((annotation) => (annotation.id === id ? { ...annotation, ...change } : annotation)),
        ),
      remove: (id) => setAnnotations((previous) => previous.filter((annotation) => annotation.id !== id)),
    }),
    [annotations],
  );
}

function useSharedStore(enabled: boolean): AnnotationStore {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const reload = useCallback(() => {
    void allAnnotations().then(setAnnotations).catch(() => setAnnotations([]));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    reload();
    // A different pilot name on the device shows that pilot's annotations.
    window.addEventListener("pilot-efb-profile", reload);
    const unsubscribe = subscribeToAnnotations(reload);
    return () => {
      window.removeEventListener("pilot-efb-profile", reload);
      unsubscribe();
    };
  }, [enabled, reload]);

  return useMemo(
    () => ({
      annotations,
      add: (fields) => void addAnnotation(fields),
      update: (id, change) => void updateAnnotation(id, change),
      remove: (id) => void deleteAnnotation(id),
    }),
    [annotations],
  );
}

export function AnnotationProvider({
  children,
  initial,
}: {
  children: ReactNode;
  /** Tests: start from these annotations and keep them in memory only. */
  initial?: Annotation[];
}) {
  const local = useLocalStore(initial ?? []);
  const shared = useSharedStore(initial === undefined);
  const store = initial === undefined ? shared : local;
  return <AnnotationContext.Provider value={store}>{children}</AnnotationContext.Provider>;
}

/** Undefined outside an AnnotationProvider; blocks then render without annotation controls. */
export function useAnnotations(): AnnotationStore | undefined {
  return useContext(AnnotationContext);
}

/** One piece of selectable text in a block, and where it starts in the block's whole text. */
export interface BlockPart {
  part: string;
  text: string;
  base: number;
}

/**
 * The block's whole text and its selectable pieces. The whole text joins list items with new
 * lines, table cells with " | " (rows with new lines), and each checklist line as
 * "challenge — response", the same way the revision tools and the server do.
 */
export function blockLayout(block: ContentBlock): { text: string; parts: BlockPart[] } {
  const parts: BlockPart[] = [];
  let text = "";
  const add = (part: string, value: string, after = "") => {
    parts.push({ part, text: value, base: text.length });
    text += value + after;
  };
  switch (block.type) {
    case "para":
    case "note":
    case "caution":
    case "warning":
      add("text", block.segments.map((segment) => segment.text).join(""));
      break;
    case "list":
      block.items.forEach((item, index) => add(`item-${index}`, item, index < block.items.length - 1 ? "\n" : ""));
      break;
    case "table":
      block.rows.forEach((row, rowIndex) =>
        row.cells.forEach((cell, cellIndex) =>
          add(
            `cell-${rowIndex}-${cellIndex}`,
            cell,
            cellIndex < row.cells.length - 1 ? " | " : rowIndex < block.rows.length - 1 ? "\n" : "",
          ),
        ),
      );
      break;
    case "checklist":
      block.checks.forEach((check, index) => {
        add(`${check.id}:challenge`, check.challenge, " — ");
        add(`${check.id}:response`, check.response, index < block.checks.length - 1 ? "\n" : "");
      });
      break;
  }
  return { text, parts };
}

const CONTEXT_LENGTH = 32;

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
 * Finds an annotation's words in a block's current whole text: at the same place if unchanged,
 * otherwise wherever the words appear with the best-matching surrounding words. Undefined if gone,
 * or if the annotation is not on words (a bookmark on a whole topic).
 */
export function resolveRange(
  annotation: Pick<Annotation, "start" | "end" | "quote" | "anchorText">,
  text: string,
): { start: number; end: number } | undefined {
  const { start, end, quote, anchorText } = annotation;
  if (start === null || end === null || !quote) return undefined;
  if (text.slice(start, end) === quote) return { start, end };
  const prefix = anchorText.slice(Math.max(0, start - CONTEXT_LENGTH), start);
  const suffix = anchorText.slice(end, end + CONTEXT_LENGTH);
  let best: { start: number; score: number } | undefined;
  for (let index = text.indexOf(quote); index !== -1; index = text.indexOf(quote, index + 1)) {
    const score =
      sharedEnd(text.slice(0, index), prefix) +
      sharedStart(text.slice(index + quote.length), suffix) -
      Math.abs(index - start) / 1000;
    if (!best || score > best.score) best = { start: index, score };
  }
  return best && { start: best.start, end: best.start + quote.length };
}

/** Shortens text for previews. */
export function shorten(text: string, length = 60): string {
  return text.length > length ? `${text.slice(0, length).trimEnd()}…` : text;
}
