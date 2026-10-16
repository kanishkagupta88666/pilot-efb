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
  /** The block's full text when it was annotated, kept to compare against later revisions. */
  text: string;
  note?: string;
}

export type AnnotationTarget = Pick<
  Annotation,
  "docId" | "revision" | "topicId" | "nodeId" | "text"
>;

interface AnnotationStore {
  annotations: Annotation[];
  toggle: (kind: "bookmark" | "highlight", target: AnnotationTarget) => void;
  /** Saves the note text; empty text removes the note. */
  saveNote: (target: AnnotationTarget, text: string) => void;
  /** Re-anchors an annotation to a newer revision's wording. */
  keep: (id: string, revision: number, text: string) => void;
  remove: (id: string) => void;
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
      keep: (id, revision, text) =>
        setAnnotations((previous) =>
          previous.map((annotation) =>
            annotation.id === id ? { ...annotation, revision, text } : annotation,
          ),
        ),
      remove: (id) =>
        setAnnotations((previous) => previous.filter((annotation) => annotation.id !== id)),
    };
  }, [annotations]);

  return <AnnotationContext.Provider value={store}>{children}</AnnotationContext.Provider>;
}

/** Undefined outside an AnnotationProvider; blocks then render without annotation controls. */
export function useAnnotations(): AnnotationStore | undefined {
  return useContext(AnnotationContext);
}

/** Plain text of a block, as stored with an annotation. */
export function blockText(block: ContentBlock): string {
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
  return text.replace(/\s+/g, " ").trim();
}

/** Shortens text for previews. */
export function shorten(text: string, length = 60): string {
  return text.length > length ? `${text.slice(0, length).trimEnd()}…` : text;
}
