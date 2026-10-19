import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, MouseEvent, ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { resolveNodeFromApi } from "../api/client";
import type {
  BlockChange,
  ContentBlock,
  RemovedTopicChange,
  TopicContentResponse,
  XrefSegment,
} from "../types/api";
import {
  blockLayout,
  resolveRange,
  useAnnotations,
  type Annotation,
  type AnnotationKind,
} from "../annotations/annotations";
import {
  ChangeFrame,
  RemovedBlockMarker,
  RemovedTopicMarker,
  changesMatchBlocks,
  type ComparedRevisions,
} from "./ChangeMarkers";
import { DATA_SOURCE } from "../config/dataSource";
import { recordAudit } from "../utils/auditLog";
import { AffectedAnnotations } from "./AffectedAnnotations";
import { AnnotationIcon } from "./Icons";
import { resolveAvailableTargetId } from "../data/mockData";
import { readerPathForResolution } from "../utils/readerLink";

/** One highlighted range in a block's text (used by Hriday's annotation component). */
export interface HighlightRange {
  id: string;
  start: number;
  end: number;
  hasNote: boolean;
  /** The text changed since it was highlighted: shown, but flagged for review. */
  flagged: boolean;
}

interface BlockProps {
  block: ContentBlock;
  docId: string;
  revision: number;
  dataSource?: "mock" | "api";
  targetNodeId?: string;
  /** Extra classes for annotation state, e.g. bookmarked. */
  marks?: string;
}

/** An annotation placed on a piece of text, after re-attaching it to this revision. */
interface PlacedMark {
  id: string;
  kind: AnnotationKind;
  start: number;
  end: number;
}

/** Looks up the annotations placed on one piece of text in a block. */
const MarkContext = createContext<(nodeId: string, part: string) => PlacedMark[]>(() => []);

/**
 * Splits text that starts at `offset` within its piece into plain runs and <mark> runs.
 * Overlapping annotations share a run and are all listed on it.
 */
function withMarks(text: string, offset: number, marks: PlacedMark[]): ReactNode[] {
  const end = offset + text.length;
  const local = marks.filter((mark) => mark.end > offset && mark.start < end);
  if (local.length === 0) return [text];
  const cuts = new Set([0, text.length]);
  for (const mark of local) {
    cuts.add(Math.max(0, mark.start - offset));
    cuts.add(Math.min(text.length, mark.end - offset));
  }
  const points = [...cuts].sort((a, b) => a - b);
  return points.slice(0, -1).map((from, index) => {
    const to = points[index + 1];
    const piece = text.slice(from, to);
    const covering = local.filter(
      (mark) => mark.start - offset <= from && mark.end - offset >= to,
    );
    if (covering.length === 0) return piece;
    const kinds = new Set(covering.map((mark) => mark.kind));
    return (
      <mark
        className={["annotation-mark", ...[...kinds].map((kind) => `annotation-mark--${kind}`)].join(" ")}
        data-annotation-ids={covering.map((mark) => mark.id).join(" ")}
        key={`${offset + from}-${offset + to}`}
      >
        {piece}
      </mark>
    );
  });
}

/** Wraps one selectable piece of text so a selection inside it can be mapped back to the manual. */
function Anchored({ nodeId, part, text }: { nodeId: string; part: string; text: string }) {
  const lookup = useContext(MarkContext);
  return (
    <span data-anchor-node={nodeId} data-anchor-part={part}>
      {withMarks(text, 0, lookup(nodeId, part))}
    </span>
  );
}

function InlineSegments({
  nodeId,
  segments,
  docId,
  revision,
  dataSource,
}: {
  nodeId: string;
  segments: Extract<ContentBlock, { segments: unknown }>["segments"];
  docId: string;
  revision: number;
  dataSource: "mock" | "api";
}) {
  const lookup = useContext(MarkContext);
  const marks = lookup(nodeId, "text");
  let offset = 0;
  return (
    <span data-anchor-node={nodeId} data-anchor-part="text">
      {segments.map((segment, index) => {
        const start = offset;
        offset += segment.text.length;
        if (segment.type === "text") {
          return <span key={`${index}-text`}>{withMarks(segment.text, start, marks)}</span>;
        }

        return (
          <XrefSegmentView
            dataSource={dataSource}
            docId={docId}
            key={`${index}-${segment.targetId}`}
            label={withMarks(segment.text, start, marks)}
            revision={revision}
            segment={segment}
          />
        );
      })}
    </span>
  );
}

function XrefSegmentView({
  segment,
  label,
  dataSource,
  docId,
  revision,
}: {
  segment: XrefSegment;
  /** The link text, with any annotation marks applied. */
  label: ReactNode;
  dataSource: "mock" | "api";
  docId: string;
  revision: number;
}) {
  const navigate = useNavigate();
  const controller = useRef<AbortController | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ code: string; message: string }>();

  useEffect(() => () => controller.current?.abort(), []);

  if (dataSource === "mock") {
    const target = resolveAvailableTargetId(docId, revision, segment.targetId);
    return target ? (
      <Link
        className="xref-link"
        to={`/reader/${encodeURIComponent(docId)}/${revision}?nodeId=${encodeURIComponent(segment.targetId)}`}
      >
        {label}
      </Link>
    ) : (
      <span className="xref-unavailable">
        <span>{label}</span>
        <span className="xref-unavailable__message" data-anchor-skip>
          {" "}Not available in this prototype.
        </span>
      </span>
    );
  }

  const openHref = `/open?${new URLSearchParams({
    doc: docId,
    node: segment.targetId,
    rev: String(revision),
  }).toString()}`;
  const resolve = async () => {
    if (loading) return;
    controller.current?.abort();
    const requestController = new AbortController();
    controller.current = requestController;
    setLoading(true);
    setError(undefined);

    const result = await resolveNodeFromApi(
      docId,
      segment.targetId,
      revision,
      requestController.signal,
    );
    if (requestController.signal.aborted) return;
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (
      result.data.documentId !== docId ||
      result.data.selectedRevision !== revision ||
      result.data.targetNodeId !== segment.targetId ||
      result.data.topic.id !== result.data.topicId
    ) {
      setError({
        code: "INVALID_RESPONSE",
        message: "The resolver returned a different document revision.",
      });
      return;
    }
    navigate(readerPathForResolution(result.data));
  };
  const activate = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    void resolve();
  };

  if (error?.code === "NODE_NOT_FOUND") {
    return (
      <span className="xref-unavailable">
        <span>{label}</span>
        <span className="xref-unavailable__message" data-anchor-skip>
          {" "}Not available in this revision.
        </span>
      </span>
    );
  }

  return (
    <>
      <Link
        aria-busy={loading}
        className="xref-link"
        onClick={(event) => void activate(event)}
        to={openHref}
      >
        {label}
      </Link>
      {loading && <span data-anchor-skip role="status"> Resolving reference…</span>}
      {error && (
        <span className="xref-unavailable" data-anchor-skip role="alert">
          {" "}Reference could not be resolved: {error.message}{" "}
          <button
            className="xref-retry"
            onClick={() => void resolve()}
            type="button"
          >
            Retry
          </button>
        </span>
      )}
    </>
  );
}

function TextBlockView({ block, ...props }: BlockProps & { block: Extract<ContentBlock, { segments: unknown }> }) {
  const dataSource = props.dataSource ?? DATA_SOURCE;
  const body = (
    <p>
      <InlineSegments
        dataSource={dataSource}
        docId={props.docId}
        nodeId={block.id}
        revision={props.revision}
        segments={block.segments}
      />
    </p>
  );
  const isCallout = block.type !== "para";
  const className = [
    "content-block",
    isCallout ? "content-block--callout" : "content-block--paragraph",
    isCallout ? `content-block--${block.type}` : "",
    props.targetNodeId === block.id ? "content-block--targeted" : "",
    props.marks ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  const label = `${block.type.charAt(0).toUpperCase()}${block.type.slice(1)}`;

  if (!isCallout) {
    return (
      <div className={className} id={block.id}>
        {body}
      </div>
    );
  }

  return (
    <aside
      aria-label={label}
      className={className}
      id={block.id}
    >
      <strong className="callout-label">
        {block.type !== "note" && (
          <svg aria-hidden="true" className="callout-icon" viewBox="0 0 24 24">
            <path d="M12 3 2 21h20L12 3Z" fill="currentColor" />
            <path d="M12 10v5M12 17.5v.5" stroke="var(--surface)" strokeLinecap="round" strokeWidth="2.2" />
          </svg>
        )}
        {label}
      </strong>
      {body}
    </aside>
  );
}

function ListView({ block, targetNodeId, marks }: BlockProps & { block: Extract<ContentBlock, { type: "list" }> }) {
  return (
    <div
      className={`content-block content-block--list${targetNodeId === block.id ? " content-block--targeted" : ""}${marks ? ` ${marks}` : ""}`}
      id={block.id}
    >
      <ul>
        {block.items.map((item, index) => (
          <li key={`${block.id}-${index}`}>
            <Anchored nodeId={block.id} part={`item-${index}`} text={item} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function TableView({ block, targetNodeId, marks }: BlockProps & { block: Extract<ContentBlock, { type: "table" }> }) {
  return (
    <div
      className={`content-block content-block--table${targetNodeId === block.id ? " content-block--targeted" : ""}${marks ? ` ${marks}` : ""}`}
      id={block.id}
      role="region"
      aria-label="Table"
      tabIndex={0}
    >
      <table>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={`${block.id}-row-${rowIndex}`}>
              {row.cells.map((cell, cellIndex) => {
                const content = (
                  <Anchored nodeId={block.id} part={`cell-${rowIndex}-${cellIndex}`} text={cell} />
                );
                return row.header ? (
                  <th key={`${block.id}-${rowIndex}-${cellIndex}`} scope="col">
                    {content}
                  </th>
                ) : (
                  <td key={`${block.id}-${rowIndex}-${cellIndex}`}>{content}</td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChecklistView({
  block,
  completedChecks,
  onToggleCheck,
  onResetChecks,
  targetNodeId,
  marks,
}: BlockProps & {
  block: Extract<ContentBlock, { type: "checklist" }>;
  completedChecks: Record<string, boolean>;
  onToggleCheck: (checkId: string) => void;
  onResetChecks: (checkIds: string[]) => void;
}) {
  const doneCount = block.checks.filter((check) => completedChecks[check.id]).length;
  // Selecting words in a line, or tapping an annotation, should not tick the box.
  const keepTickForTaps = (event: MouseEvent<HTMLLabelElement>) => {
    const selection = window.getSelection();
    if (
      (selection && !selection.isCollapsed) ||
      (event.target as HTMLElement).closest("mark")
    ) {
      event.preventDefault();
    }
  };

  return (
    <section
      aria-label="Checklist"
      className={`content-block content-block--checklist${targetNodeId === block.id ? " content-block--targeted" : ""}${marks ? ` ${marks}` : ""}`}
      id={block.id}
    >
      <div className="checklist-header">
        <h3>Checklist</h3>
        <span aria-live="polite" className="checklist-progress">
          {doneCount} of {block.checks.length}
        </span>
        {doneCount > 0 && (
          <button
            aria-label="Reset checklist"
            className="checklist-reset"
            onClick={() => onResetChecks(block.checks.map((check) => check.id))}
            type="button"
          >
            Reset
          </button>
        )}
      </div>
      <ul>
        {block.checks.map((check) => (
          <li
            className={`checklist-item${targetNodeId === check.id ? " content-block--targeted" : ""}`}
            id={check.id}
            key={check.id}
          >
            <label onClick={keepTickForTaps}>
              <input
                checked={Boolean(completedChecks[check.id])}
                onChange={() => onToggleCheck(check.id)}
                type="checkbox"
              />
              <span className="checklist-item__challenge">
                <Anchored nodeId={block.id} part={`${check.id}:challenge`} text={check.challenge} />
              </span>
              <span aria-hidden="true" className="checklist-item__leader" />
              <span className="checklist-item__response">
                <Anchored nodeId={block.id} part={`${check.id}:response`} text={check.response} />
              </span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface ContentBlocksProps {
  topic: TopicContentResponse["topic"];
  docId: string;
  revision: number;
  dataSource?: "mock" | "api";
  targetNodeId?: string;
  completedChecks: Record<string, boolean>;
  onToggleCheck: (checkId: string) => void;
  onResetChecks: (checkIds: string[]) => void;
  /** Block changes since an earlier revision; drawn only if they match the blocks. */
  changes?: BlockChange[];
  removedTopicsAfter?: RemovedTopicChange[];
  comparedRevisions?: ComparedRevisions;
}

/** Where to draw the floating bar: just below the selection, or above it near the bottom of the screen. */
interface Spot {
  top: number;
  bottom: number;
  centre: number;
}

function spotOf(target: Range | Element): Spot {
  const box =
    typeof target.getBoundingClientRect === "function"
      ? target.getBoundingClientRect()
      : { top: 0, bottom: 0, left: 0, width: 0 };
  return { top: box.top, bottom: box.bottom, centre: box.left + box.width / 2 };
}

function floatingStyle(spot: Spot) {
  const below = spot.bottom + 160 < window.innerHeight;
  const left = Math.min(Math.max(spot.centre, 180), window.innerWidth - 180);
  return below
    ? { top: spot.bottom + 10, left }
    : { top: spot.top - 10, left, transform: "translate(-50%, -100%)" };
}

/** Character offset of a selection boundary within a piece of text, ignoring helper text such as "Not available". */
function offsetWithin(root: HTMLElement, node: Node, nodeOffset: number): number {
  const range = document.createRange();
  range.setStart(root, 0);
  range.setEnd(node, nodeOffset);
  const copy = range.cloneContents();
  copy.querySelectorAll("[data-anchor-skip]").forEach((element) => element.remove());
  return copy.textContent?.length ?? 0;
}

function anchorElement(node: Node): HTMLElement | null {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return element?.closest<HTMLElement>("[data-anchor-part]") ?? null;
}

/** A selection of words, as a range within the block's whole text. */
interface WordAnchor {
  nodeId: string;
  start: number;
  end: number;
  quote: string;
  anchorText: string;
}

type Floating =
  | { kind: "selection"; anchor: WordAnchor; spot: Spot }
  | { kind: "too-wide"; spot: Spot }
  | { kind: "existing"; ids: string[]; spot: Spot }
  | { kind: "note"; spot: Spot; anchor?: WordAnchor; noteId?: string; text: string };

const KIND_NAME: Record<AnnotationKind, string> = {
  highlight: "highlight",
  note: "note",
  bookmark: "bookmark",
};

export function ContentBlocks({
  topic,
  docId,
  revision,
  dataSource = DATA_SOURCE,
  targetNodeId,
  completedChecks,
  onToggleCheck,
  onResetChecks,
  changes,
  removedTopicsAfter = [],
  comparedRevisions,
}: ContentBlocksProps) {
  const store = useAnnotations();
  const containerRef = useRef<HTMLDivElement>(null);
  const [floating, setFloating] = useState<Floating>();
  const blocksById = useMemo(
    () => new Map(topic.blocks.map((block) => [block.id, block])),
    [topic.blocks],
  );

  const layouts = useMemo(
    () => new Map(topic.blocks.map((block) => [block.id, blockLayout(block)])),
    [topic.blocks],
  );

  // Annotations re-attached to this revision's text, by block, as ranges in the block's whole text.
  const placed = useMemo(() => {
    const byBlock = new Map<string, PlacedMark[]>();
    const all: (Annotation & { start: number; end: number })[] = [];
    for (const annotation of store?.annotations ?? []) {
      if (annotation.documentId !== docId || annotation.detached) continue;
      const layout = layouts.get(annotation.nodeId);
      const range = layout && resolveRange(annotation, layout.text);
      if (!range) continue;
      byBlock.set(annotation.nodeId, [
        ...(byBlock.get(annotation.nodeId) ?? []),
        { id: annotation.id, kind: annotation.kind, ...range },
      ]);
      all.push({ ...annotation, ...range });
    }
    return { byBlock, all };
  }, [store?.annotations, docId, layouts]);
  // Marks for one piece of text, shifted to start at that piece.
  const lookup = (nodeId: string, part: string) => {
    const piece = layouts.get(nodeId)?.parts.find((entry) => entry.part === part);
    if (!piece) return [];
    const end = piece.base + piece.text.length;
    return (placed.byBlock.get(nodeId) ?? [])
      .filter((mark) => mark.end > piece.base && mark.start < end)
      .map((mark) => ({ ...mark, start: mark.start - piece.base, end: mark.end - piece.base }));
  };

  // Read the current selection; show the bar if it sits inside one piece of text in this topic.
  const readSelection = () => {
    const root = containerRef.current;
    const selection = window.getSelection();
    if (!root || !selection || selection.rangeCount === 0) return;
    if (selection.isCollapsed) {
      setFloating((current) =>
        current?.kind === "selection" || current?.kind === "too-wide" ? undefined : current,
      );
      return;
    }
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    const from = anchorElement(range.startContainer);
    const to = anchorElement(range.endContainer);
    if (!from || from !== to) {
      setFloating({ kind: "too-wide", spot: spotOf(range) });
      return;
    }
    const nodeId = from.dataset.anchorNode ?? "";
    const layout = layouts.get(nodeId);
    const piece = layout?.parts.find((entry) => entry.part === from.dataset.anchorPart);
    if (!layout || !piece) return;
    let start = offsetWithin(from, range.startContainer, range.startOffset);
    let end = offsetWithin(from, range.endContainer, range.endOffset);
    while (start < end && /\s/.test(piece.text[start])) start++;
    while (end > start && /\s/.test(piece.text[end - 1])) end--;
    if (end <= start) return;
    setFloating({
      kind: "selection",
      anchor: {
        nodeId,
        start: piece.base + start,
        end: piece.base + end,
        quote: piece.text.slice(start, end),
        anchorText: layout.text,
      },
      spot: spotOf(range),
    });
  };

  useEffect(() => {
    if (!store) return;
    const onSelectionChange = () => readSelection();
    const onScroll = () =>
      setFloating((current) => (current?.kind === "note" ? current : undefined));
    document.addEventListener("selectionchange", onSelectionChange);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      window.removeEventListener("scroll", onScroll, true);
    };
  });

  const clearSelection = () => window.getSelection()?.removeAllRanges();
  const target = (anchor: WordAnchor, note = "") => ({
    documentId: docId,
    revision,
    topicId: topic.id,
    topicNumber: topic.number,
    ...anchor,
    note,
  });

  // Tapping an existing mark opens its actions.
  const onContentClick = (event: MouseEvent<HTMLDivElement>) => {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    const mark = (event.target as HTMLElement).closest<HTMLElement>("mark[data-annotation-ids]");
    if (mark) {
      setFloating({
        kind: "existing",
        ids: (mark.dataset.annotationIds ?? "").split(" "),
        spot: spotOf(mark),
      });
    } else if (floating?.kind === "existing") {
      setFloating(undefined);
    }
  };

  const renderBlock = (block: ContentBlock): ReactNode => {
    const bookmarked = placed.all.some(
      (annotation) => annotation.nodeId === block.id && annotation.kind === "bookmark",
    );
    const marks = bookmarked ? "content-block--bookmarked" : "";
    switch (block.type) {
      case "para":
      case "note":
      case "caution":
      case "warning":
        return (
          <TextBlockView
            block={block}
            docId={docId}
            dataSource={dataSource}
            key={block.id}
            marks={marks}
            revision={revision}
            targetNodeId={targetNodeId}
          />
        );
      case "list":
        return (
          <ListView
            block={block}
            docId={docId}
            dataSource={dataSource}
            key={block.id}
            marks={marks}
            revision={revision}
            targetNodeId={targetNodeId}
          />
        );
      case "table":
        return (
          <TableView
            block={block}
            docId={docId}
            dataSource={dataSource}
            key={block.id}
            marks={marks}
            revision={revision}
            targetNodeId={targetNodeId}
          />
        );
      case "checklist":
        return (
          <ChecklistView
            block={block}
            completedChecks={completedChecks}
            docId={docId}
            dataSource={dataSource}
            key={block.id}
            marks={marks}
            onResetChecks={onResetChecks}
            onToggleCheck={onToggleCheck}
            revision={revision}
            targetNodeId={targetNodeId}
          />
        );
    }
  };

  // Change bars from a compared revision wrap each block; removed blocks and topics get markers.
  const showChanges = Boolean(
    changes && comparedRevisions && changesMatchBlocks(changes, topic.blocks),
  );
  const inspect = (nodeId: string, status: string) =>
    void recordAudit("change.inspected", {
      documentId: docId,
      revision,
      nodeId,
      details: { status, topicId: topic.id, fromRevision: comparedRevisions?.from },
    });
  const withChanges = (render: (block: ContentBlock) => ReactNode) => {
    if (!showChanges || !changes || !comparedRevisions) return topic.blocks.map(render);
    return [
      ...changes.map((change) => {
        if (change.status === "removed") {
          return (
            <RemovedBlockMarker
              change={change}
              key={`removed-${change.id}`}
              onInspect={inspect}
              revisions={comparedRevisions}
            />
          );
        }
        const block = blocksById.get(change.id);
        if (!block) return null;
        return (
          <ChangeFrame change={change} key={change.id} onInspect={inspect} revisions={comparedRevisions}>
            {render(block)}
          </ChangeFrame>
        );
      }),
      ...removedTopicsAfter.map((removed) => (
        <RemovedTopicMarker
          key={`removed-topic-${removed.id}`}
          onInspect={inspect}
          revisions={comparedRevisions}
          topic={removed}
        />
      )),
    ];
  };

  if (!store) {
    return <div className="topic-content">{withChanges(renderBlock)}</div>;
  }

  // Notes are listed under the block they belong to, so they stay readable while flying.
  const notesFor = (blockId: string) =>
    placed.all.filter((annotation) => annotation.nodeId === blockId && annotation.kind === "note");

  const existing =
    floating?.kind === "existing"
      ? store.annotations.filter((annotation) => floating.ids.includes(annotation.id))
      : [];

  return (
    <MarkContext.Provider value={lookup}>
      <AffectedAnnotations docId={docId} revision={revision} topic={topic} />
      <div
        className="topic-content topic-content--annotatable"
        onClick={onContentClick}
        onKeyUp={readSelection}
        onMouseUp={readSelection}
        onTouchEnd={readSelection}
        ref={containerRef}
      >
        {withChanges((block) => [
          renderBlock(block),
          ...notesFor(block.id).map((note) => (
            <aside aria-label="Your note" className="annotation-note" key={`${note.id}-note`}>
              <span className="annotation-note__label">Your note</span>
              <q className="annotation-note__quote">{note.quote}</q>
              <p>{note.note}</p>
              <button
                className="text-button annotation-note__edit"
                onClick={(event) =>
                  setFloating({
                    kind: "note",
                    noteId: note.id,
                    spot: spotOf(event.currentTarget),
                    text: note.note ?? "",
                  })
                }
                type="button"
              >
                Edit note
              </button>
            </aside>
          )),
        ])}
      </div>
      {floating && floating.kind !== "note" && (
        <div
          aria-label={floating.kind === "existing" ? "Annotation actions" : "Annotate selection"}
          className="selection-bar"
          onMouseDown={(event) => event.preventDefault()}
          role="toolbar"
          style={floatingStyle(floating.spot)}
        >
          {floating.kind === "too-wide" && (
            <span className="selection-bar__hint">
              Select text within one paragraph, list item, table cell or checklist line.
            </span>
          )}
          {floating.kind === "selection" && (
            <>
              <button
                onClick={() => {
                  store.add({ kind: "highlight", ...target(floating.anchor) });
                  clearSelection();
                  setFloating(undefined);
                }}
                type="button"
              >
                <AnnotationIcon kind="highlight" />
                Highlight
              </button>
              <button
                onClick={() => {
                  clearSelection();
                  setFloating({ kind: "note", anchor: floating.anchor, spot: floating.spot, text: "" });
                }}
                type="button"
              >
                <AnnotationIcon kind="note" />
                Note
              </button>
              <button
                onClick={() => {
                  store.add({ kind: "bookmark", ...target(floating.anchor) });
                  clearSelection();
                  setFloating(undefined);
                }}
                type="button"
              >
                <AnnotationIcon kind="bookmark" />
                Bookmark
              </button>
            </>
          )}
          {floating.kind === "existing" && (
            <>
              {existing.map((annotation) =>
                annotation.kind === "note" ? (
                  <button
                    key={annotation.id}
                    onClick={() =>
                      setFloating({
                        kind: "note",
                        noteId: annotation.id,
                        spot: floating.spot,
                        text: annotation.note ?? "",
                      })
                    }
                    type="button"
                  >
                    Edit note
                  </button>
                ) : (
                  <button
                    key={annotation.id}
                    onClick={() => {
                      store.remove(annotation.id);
                      setFloating(undefined);
                    }}
                    type="button"
                  >
                    Remove {KIND_NAME[annotation.kind]}
                  </button>
                ),
              )}
              <button onClick={() => setFloating(undefined)} type="button">
                Done
              </button>
            </>
          )}
        </div>
      )}
      {floating?.kind === "note" && (
        <NotePopover
          initialText={floating.text}
          key={floating.noteId ?? `${floating.anchor?.nodeId}-${floating.anchor?.start}`}
          onCancel={() => setFloating(undefined)}
          onDelete={
            floating.noteId
              ? () => {
                  store.remove(floating.noteId as string);
                  setFloating(undefined);
                }
              : undefined
          }
          onSave={(text) => {
            if (floating.noteId) {
              if (text.trim()) store.update(floating.noteId, { note: text.trim() });
              else store.remove(floating.noteId);
            } else if (floating.anchor && text.trim()) {
              store.add({ kind: "note", ...target(floating.anchor, text.trim()) });
            }
            setFloating(undefined);
          }}
          quote={
            floating.anchor?.quote ??
            store.annotations.find((annotation) => annotation.id === floating.noteId)?.quote ??
            ""
          }
          style={floatingStyle(floating.spot)}
        />
      )}
    </MarkContext.Provider>
  );
}

function NotePopover({
  quote,
  initialText,
  style,
  onSave,
  onCancel,
  onDelete,
}: {
  quote: string;
  initialText: string;
  style: ReturnType<typeof floatingStyle>;
  onSave: (text: string) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [text, setText] = useState(initialText);
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave(text);
  };

  return (
    <form aria-label="Note" className="note-popover" onSubmit={save} style={style}>
      <q className="annotation-note__quote">{quote}</q>
      <label htmlFor="note-text">Your note</label>
      <textarea
        autoFocus
        id="note-text"
        onChange={(event) => setText(event.target.value)}
        rows={3}
        value={text}
      />
      <div className="note-popover__actions">
        <button className="button button--primary" type="submit">Save note</button>
        <button className="button button--secondary" onClick={onCancel} type="button">
          Cancel
        </button>
        {onDelete && (
          <button className="button button--secondary note-popover__delete" onClick={onDelete} type="button">
            Delete note
          </button>
        )}
      </div>
    </form>
  );
}
