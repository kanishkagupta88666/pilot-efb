import { useEffect, useRef, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
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
  ChangeFrame,
  RemovedBlockMarker,
  RemovedTopicMarker,
  changesMatchBlocks,
  type ComparedRevisions,
} from "./ChangeMarkers";
import { DATA_SOURCE } from "../config/dataSource";
import { recordAudit } from "../utils/auditLog";
import { resolveAvailableTargetId } from "../data/mockData";
import { readerPathForResolution } from "../utils/readerLink";

/** One highlighted range in a block's text, from the pilot's annotations. */
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
  highlights?: HighlightRange[];
  onOpenAnnotation?: (id: string) => void;
}

/** Split ``text`` (which starts at ``offset`` in the block) into plain and highlighted pieces. */
function markPieces(
  text: string,
  offset: number,
  highlights: HighlightRange[],
  onOpen?: (id: string) => void,
) {
  const cuts = new Set([0, text.length]);
  for (const range of highlights) {
    for (const point of [range.start - offset, range.end - offset]) {
      if (point > 0 && point < text.length) cuts.add(point);
    }
  }
  const points = [...cuts].sort((a, b) => a - b);
  return points.slice(0, -1).map((from, index) => {
    const to = points[index + 1];
    const piece = text.slice(from, to);
    const covering = highlights.filter((r) => r.start - offset <= from && r.end - offset >= to);
    if (!covering.length) return <span key={from}>{piece}</span>;
    const range = covering[covering.length - 1];
    return (
      <mark
        className={`annotation-mark${range.hasNote ? " annotation-mark--note" : ""}${range.flagged ? " annotation-mark--flagged" : ""}`}
        data-annotation-id={range.id}
        key={from}
        onClick={(event) => {
          if (!onOpen) return;
          event.preventDefault();
          event.stopPropagation();
          onOpen(range.id);
        }}
      >
        {piece}
      </mark>
    );
  });
}

function InlineSegments({
  segments,
  docId,
  revision,
  dataSource,
  highlights = [],
  onOpenAnnotation,
}: {
  segments: Extract<ContentBlock, { segments: unknown }>["segments"];
  docId: string;
  revision: number;
  dataSource: "mock" | "api";
  highlights?: HighlightRange[];
  onOpenAnnotation?: (id: string) => void;
}) {
  let offset = 0;
  return (
    <>
      {segments.map((segment, index) => {
        const start = offset;
        offset += segment.text.length;
        if (segment.type === "text") {
          return highlights.length ? (
            <span key={`${index}-text`}>{markPieces(segment.text, start, highlights, onOpenAnnotation)}</span>
          ) : (
            <span key={`${index}-text`}>{segment.text}</span>
          );
        }

        return (
          <XrefSegmentView
            dataSource={dataSource}
            docId={docId}
            key={`${index}-${segment.targetId}`}
            label={highlights.length ? markPieces(segment.text, start, highlights, onOpenAnnotation) : undefined}
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
  label,
}: {
  segment: XrefSegment;
  dataSource: "mock" | "api";
  docId: string;
  revision: number;
  label?: ReactNode;
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
        {label ?? segment.text}
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
    <p data-annotatable={block.id}>
      <InlineSegments
        segments={block.segments}
        docId={props.docId}
        revision={props.revision}
        dataSource={dataSource}
        highlights={props.highlights}
        onOpenAnnotation={props.onOpenAnnotation}
      />
    </p>
  );
  const isCallout = block.type !== "para";
  const className = [
    "content-block",
    isCallout ? "content-block--callout" : "content-block--paragraph",
    isCallout ? `content-block--${block.type}` : "",
    props.targetNodeId === block.id ? "content-block--targeted" : "",
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

function ListView({ block, targetNodeId }: BlockProps & { block: Extract<ContentBlock, { type: "list" }> }) {
  return (
    <div
      className={`content-block content-block--list${targetNodeId === block.id ? " content-block--targeted" : ""}`}
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

function TableView({ block, targetNodeId }: BlockProps & { block: Extract<ContentBlock, { type: "table" }> }) {
  return (
    <div
      className={`content-block content-block--table${targetNodeId === block.id ? " content-block--targeted" : ""}`}
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
  targetNodeId,
}: BlockProps & {
  block: Extract<ContentBlock, { type: "checklist" }>;
  completedChecks: Record<string, boolean>;
  onToggleCheck: (checkId: string) => void;
}) {
  return (
    <section
      aria-label="Checklist"
      className={`content-block content-block--checklist${targetNodeId === block.id ? " content-block--targeted" : ""}`}
      id={block.id}
    >
      <h3>Checklist</h3>
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
  /** Block changes since an earlier revision; drawn only if they match the blocks. */
  changes?: BlockChange[];
  removedTopicsAfter?: RemovedTopicChange[];
  comparedRevisions?: ComparedRevisions;
  /** The pilot's highlights, by block ID. */
  highlights?: Map<string, HighlightRange[]>;
  onOpenAnnotation?: (id: string) => void;
}

export function ContentBlocks({
  topic,
  docId,
  revision,
  dataSource = DATA_SOURCE,
  targetNodeId,
  completedChecks,
  onToggleCheck,
  changes,
  removedTopicsAfter = [],
  comparedRevisions,
  highlights,
  onOpenAnnotation,
}: ContentBlocksProps) {
  const renderBlock = (block: ContentBlock) => {
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
            highlights={highlights?.get(block.id)}
            key={block.id}
            onOpenAnnotation={onOpenAnnotation}
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
            onToggleCheck={onToggleCheck}
            revision={revision}
            targetNodeId={targetNodeId}
          />
        );
    }
  };

  if (!changes || !comparedRevisions || !changesMatchBlocks(changes, topic.blocks)) {
    return <div className="topic-content">{topic.blocks.map(renderBlock)}</div>;
  }

  const blocksById = new Map(topic.blocks.map((block) => [block.id, block]));
  const inspect = (nodeId: string, status: string) =>
    void recordAudit("change.inspected", {
      documentId: docId,
      revision,
      nodeId,
      details: { status, topicId: topic.id, fromRevision: comparedRevisions.from },
    });
  return (
    <div className="topic-content">
      {changes.map((change) => {
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
          <ChangeFrame change={change} key={change.id} onInspect={inspect} revisions={comparedRevisions}>
            {renderBlock(block)}
          </ChangeFrame>
        );
      })}
      {removedTopicsAfter.map((removed) => (
        <RemovedTopicMarker
          key={`removed-topic-${removed.id}`}
          onInspect={inspect}
          revisions={comparedRevisions}
          topic={removed}
        />
      ))}
    </div>
  );
}
