import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ContentBlock } from "../types/api";

export type AnnotationKind = "bookmark" | "highlight" | "note";

/** Anchored to the block's permanent node ID, never to its number or page. */
export interface Annotation {
  id: string;
  kind: AnnotationKind;
  docId: string;
  revision: number;
  topicId: string;
  nodeId: string;
  /** The block's text when it was annotated, kept to compare against later revisions. */
  excerpt: string;
  note?: string;
}

export type AnnotationTarget = Pick<
  Annotation,
  "docId" | "revision" | "topicId" | "nodeId" | "excerpt"
>;

interface AnnotationStore {
  annotations: Annotation[];
  toggle: (kind: "bookmark" | "highlight", target: AnnotationTarget) => void;
  /** Saves the note text; empty text removes the note. */
  saveNote: (target: AnnotationTarget, text: string) => void;
}

const AnnotationContext = createContext<AnnotationStore | undefined>(undefined);

let nextId = 1;

/**
 * PROVISIONAL: annotations are kept in memory only and are lost on reload.
 * Replace the state below with API calls once the backend can store annotations.
 */
export function AnnotationProvider({ children }: { children: ReactNode }) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  const store = useMemo<AnnotationStore>(() => {
    const matches = (annotation: Annotation, kind: AnnotationKind, target: AnnotationTarget) =>
      annotation.kind === kind &&
      annotation.docId === target.docId &&
      annotation.nodeId === target.nodeId;

    return {
      annotations,
      toggle: (kind, target) =>
        setAnnotations((previous) =>
          previous.some((annotation) => matches(annotation, kind, target))
            ? previous.filter((annotation) => !matches(annotation, kind, target))
            : [...previous, { id: `annotation-${nextId++}`, kind, ...target }],
        ),
      saveNote: (target, text) =>
        setAnnotations((previous) => {
          const rest = previous.filter((annotation) => !matches(annotation, "note", target));
          const note = text.trim();
          return note
            ? [...rest, { id: `annotation-${nextId++}`, kind: "note", ...target, note }]
            : rest;
        }),
    };
  }, [annotations]);

  return <AnnotationContext.Provider value={store}>{children}</AnnotationContext.Provider>;
}

/** Undefined outside an AnnotationProvider; blocks then render without annotation controls. */
export function useAnnotations(): AnnotationStore | undefined {
  return useContext(AnnotationContext);
}

const EXCERPT_LENGTH = 160;

/** Plain text of a block, shortened, for the excerpt stored with an annotation. */
export function blockExcerpt(block: ContentBlock): string {
  let text: string;
  switch (block.type) {
    case "para":
    case "note":
    case "caution":
    case "warning":
      text = block.segments.map((segment) => segment.text).join("");
      break;
    case "list":
      text = block.items.join(" ");
      break;
    case "table":
      text = block.rows.map((row) => row.cells.join(", ")).join("; ");
      break;
    case "checklist":
      text = block.checks.map((check) => `${check.challenge}: ${check.response}`).join("; ");
      break;
  }
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > EXCERPT_LENGTH ? `${clean.slice(0, EXCERPT_LENGTH).trimEnd()}…` : clean;
}
