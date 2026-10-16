import { useEffect, useRef, useState } from "react";
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
  blockText,
  useAnnotations,
  type AnnotationTarget,
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
import { resolveAvailableTargetId } from "../data/mockData";
import { readerPathForResolution } from "../utils/readerLink";

interface BlockProps {
  block: ContentBlock;
  docId: string;
  revision: number;
  dataSource?: "mock" | "api";
  targetNodeId?: string;
  /** Extra classes for annotation state, e.g. highlighted or bookmarked. */
  marks?: string;
}

function InlineSegments({
  segments,
  docId,
  revision,
  dataSource,
}: {
  segments: Extract<ContentBlock, { segments: unknown }>["segments"];
  docId: string;
  revision: number;
  dataSource: "mock" | "api";
}) {
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return <span key={`${index}-text`}>{segment.text}</span>;
        }

        return (
          <XrefSegmentView
            dataSource={dataSource}
            docId={docId}
            key={`${index}-${segment.targetId}`}
            revision={revision}
            segment={segment}
          />
        );
      })}
    </>
  );
}

function XrefSegmentView({
  segment,
  dataSource,
  docId,
  revision,
}: {
  segment: XrefSegment;
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
        {segment.text}
      </Link>
    ) : (
      <span className="xref-unavailable">
        <span>{segment.text}</span>
        <span className="xref-unavailable__message">
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
        <span>{segment.text}</span>
        <span className="xref-unavailable__message">
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
        {segment.text}
      </Link>
      {loading && <span role="status"> Resolving reference…</span>}
      {error && (
        <span className="xref-unavailable" role="alert">
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
        segments={block.segments}
        docId={props.docId}
        revision={props.revision}
        dataSource={dataSource}
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
      <strong className="callout-label">{label}</strong>
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
          <li key={`${block.id}-${index}`}>{item}</li>
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
              {row.cells.map((cell, cellIndex) =>
                row.header ? (
                  <th
                    key={`${block.id}-${rowIndex}-${cellIndex}`}
                    scope="col"
                  >
                    {cell}
                  </th>
                ) : (
                  <td key={`${block.id}-${rowIndex}-${cellIndex}`}>{cell}</td>
                ),
              )}
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
            <label>
              <input
                checked={Boolean(completedChecks[check.id])}
                onChange={() => onToggleCheck(check.id)}
                type="checkbox"
              />
              <span className="checklist-item__challenge">
                {check.challenge}
              </span>
              <span aria-hidden="true" className="checklist-item__leader" />
              <span className="checklist-item__response">{check.response}</span>
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

function NoteEditor({
  blockId,
  initialText,
  onSave,
  onCancel,
}: {
  blockId: string;
  initialText: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initialText);
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave(text);
  };

  return (
    <form className="annotation-editor" onSubmit={save}>
      <label htmlFor={`note-${blockId}`}>Your note</label>
      <textarea
        autoFocus
        id={`note-${blockId}`}
        onChange={(event) => setText(event.target.value)}
        rows={3}
        value={text}
      />
      <div className="annotation-editor__actions">
        <button className="button button--primary" type="submit">Save note</button>
        <button className="button button--secondary" onClick={onCancel} type="button">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Taps on these keep their own behaviour instead of selecting the block. */
const INTERACTIVE = "a, button, input, label, select, textarea";

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
  const [selectedId, setSelectedId] = useState<string>();
  const [editingId, setEditingId] = useState<string>();

  const renderBlock = (block: ContentBlock, marks = ""): ReactNode => {
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

  // A block plus its annotation marks, note card, annotation bar and note editor.
  const renderAnnotated = (block: ContentBlock): ReactNode[] => {
    if (!store) return [renderBlock(block)];
    const mine = store.annotations.filter(
      (annotation) => annotation.docId === docId && annotation.nodeId === block.id,
    );
    const has = (kind: string) => mine.some((annotation) => annotation.kind === kind);
    const note = mine.find((annotation) => annotation.kind === "note");
    const selected = selectedId === block.id;
    const editing = editingId === block.id;
    const marks = [
      has("highlight") ? "content-block--highlighted" : "",
      has("bookmark") ? "content-block--bookmarked" : "",
      selected ? "content-block--selected" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const target: AnnotationTarget = {
      docId,
      revision,
      topicId: topic.id,
      nodeId: block.id,
      text: blockText(block),
    };

    return [
      renderBlock(block, marks),
      note && !editing && (
        <aside aria-label="Your note" className="annotation-note" key={`${block.id}-note`}>
          <span className="annotation-note__label">Your note</span>
          <p>{note.note}</p>
        </aside>
      ),
      selected && !editing && (
        <div
          aria-label="Annotate this block"
          className="annotation-bar"
          key={`${block.id}-bar`}
          role="toolbar"
        >
          <button
            aria-pressed={has("bookmark")}
            className="button button--secondary"
            onClick={() => store.toggle("bookmark", target)}
            type="button"
          >
            {has("bookmark") ? "Remove bookmark" : "Bookmark"}
          </button>
          <button
            aria-pressed={has("highlight")}
            className="button button--secondary"
            onClick={() => store.toggle("highlight", target)}
            type="button"
          >
            {has("highlight") ? "Remove highlight" : "Highlight"}
          </button>
          <button
            className="button button--secondary"
            onClick={() => setEditingId(block.id)}
            type="button"
          >
            {note ? "Edit note" : "Add note"}
          </button>
          <button
            className="button button--secondary annotation-bar__done"
            onClick={() => setSelectedId(undefined)}
            type="button"
          >
            Done
          </button>
        </div>
      ),
      editing && (
        <NoteEditor
          blockId={block.id}
          initialText={note?.note ?? ""}
          key={`${block.id}-editor`}
          onCancel={() => setEditingId(undefined)}
          onSave={(text) => {
            store.saveNote(target, text);
            setEditingId(undefined);
            setSelectedId(undefined);
          }}
        />
      ),
    ];
  };

  // Tapping a block (not a link, checkbox or button inside it) opens its annotation bar.
  const blockIds = new Set(topic.blocks.map((block) => block.id));
  const selectBlock = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest(INTERACTIVE)) return;
    const block = target.closest<HTMLElement>(".content-block");
    if (!block || !blockIds.has(block.id)) return;
    setSelectedId((current) => (current === block.id ? undefined : block.id));
    setEditingId(undefined);
  };

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
  const blocksById = new Map(topic.blocks.map((block) => [block.id, block]));

  return (
    <>
      {store && <AffectedAnnotations docId={docId} revision={revision} topic={topic} />}
      <div
        className={`topic-content${store ? " topic-content--annotatable" : ""}`}
        onClick={store ? selectBlock : undefined}
      >
        {!showChanges || !changes || !comparedRevisions
          ? topic.blocks.map(renderAnnotated)
          : [
              ...changes.map((change) => {
                if (change.status === "removed") {
                  return (
                    <RemovedBlockMarker
                      change={change}
                      onInspect={inspect}
                      key={`removed-${change.id}`}
                      revisions={comparedRevisions}
                    />
                  );
                }
                const block = blocksById.get(change.id);
                if (!block) return null;
                return (
                  <ChangeFrame
                    change={change}
                    key={change.id}
                    onInspect={inspect}
                    revisions={comparedRevisions}
                  >
                    {renderAnnotated(block)}
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
            ]}
      </div>
    </>
  );
}
