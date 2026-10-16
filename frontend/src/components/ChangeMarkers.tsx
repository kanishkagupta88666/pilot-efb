import { useId, useState } from "react";
import type { ReactNode } from "react";
import type {
  BlockChange,
  ContentBlock,
  DiffRun,
  RemovedTopicChange,
} from "../types/api";

export interface ComparedRevisions {
  from: number;
  to: number;
}

const STATUS_LABEL = {
  modified: "Modified",
  added: "Added",
  removed: "Removed in this revision",
} as const;

/** Plain text of a block, matching the text the backend diffs. */
export function blockText(block: ContentBlock): string {
  switch (block.type) {
    case "para":
    case "note":
    case "caution":
    case "warning":
      return block.segments.map((segment) => segment.text).join("");
    case "list":
      return block.items.join("\n");
    case "table":
      return block.rows.map((row) => row.cells.join(" | ")).join("\n");
    case "checklist":
      return block.checks
        .map((check) => `${check.challenge} — ${check.response}`)
        .join("\n");
  }
}

function DiffText({ runs, side }: { runs: DiffRun[]; side: "previous" | "current" }) {
  const hidden = side === "previous" ? "insert" : "delete";
  return (
    <p className="diff-text">
      {runs
        .filter((run) => run.op !== hidden)
        .map((run, index) =>
          run.op === "equal" ? (
            <span key={index}>{run.text}</span>
          ) : run.op === "delete" ? (
            <del className="diff-text__deleted" key={index}>{run.text}</del>
          ) : (
            <ins className="diff-text__inserted" key={index}>{run.text}</ins>
          ),
        )}
    </p>
  );
}

function RevisionRange({ revisions }: { revisions: ComparedRevisions }) {
  return (
    <span className="change-panel__range">
      Rev {revisions.from} → Rev {revisions.to}
    </span>
  );
}

function ChangePanel({
  tone,
  title,
  revisions,
  onClose,
  previousLabel,
  previous,
  current,
  footer,
}: {
  tone: "changed" | "removed";
  title: string;
  revisions: ComparedRevisions;
  onClose: () => void;
  previousLabel: "Superseded" | "Rescinded";
  previous: ReactNode;
  current: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className={`change-panel change-panel--${tone}`} role="region" aria-label={title}>
      <div className="change-panel__header">
        <strong>{title}</strong>
        <RevisionRange revisions={revisions} />
        <button className="change-panel__close" onClick={onClose} type="button">
          Close
        </button>
      </div>
      <div className="change-panel__columns">
        <div className="change-panel__previous" data-watermark={previousLabel}>
          <p className="change-panel__label">
            Previous <span className={`stamp stamp--${tone}`}>{previousLabel}</span>
          </p>
          {previous}
        </div>
        <div className="change-panel__current">
          <p className="change-panel__label">Current</p>
          {current}
        </div>
      </div>
      <p className="change-panel__footer">
        {footer ?? "Superseded and rescinded text is shown for comparison only and cannot be copied."}
      </p>
    </div>
  );
}

/** The before/after panel for one modified or added block. */
export function BlockChangePanel({
  change,
  revisions,
  onClose,
}: {
  change: BlockChange;
  revisions: ComparedRevisions;
  onClose: () => void;
}) {
  const previousText = change.previous ? blockText(change.previous) : "";
  const currentText = change.current ? blockText(change.current) : "";
  return (
    <ChangePanel
      current={
        <>
          {change.diff ? (
            <DiffText runs={change.diff} side="current" />
          ) : (
            <p className="diff-text">
              <ins className="diff-text__inserted">{currentText}</ins>
            </p>
          )}
          <p className="change-panel__in-force">This is the text in force.</p>
        </>
      }
      onClose={onClose}
      previous={
        change.diff ? (
          <DiffText runs={change.diff} side="previous" />
        ) : (
          <p className="change-panel__empty">
            {previousText || "Not in the previous revision."}
          </p>
        )
      }
      previousLabel="Superseded"
      revisions={revisions}
      title={change.status === "added" ? "Added in this revision" : "Changed in this revision"}
      tone="changed"
    />
  );
}

/** The before/after panel for removed content: the old text, rescinded. */
export function RemovedChangePanel({
  previous,
  revisions,
  onClose,
}: {
  previous: ReactNode;
  revisions: ComparedRevisions;
  onClose: () => void;
}) {
  return (
    <ChangePanel
      current={
        <>
          <p>No replacement text in Revision {revisions.to}.</p>
          <p className="change-panel__withdrawn">
            This content is not part of the revision in force.
          </p>
        </>
      }
      onClose={onClose}
      previous={previous}
      previousLabel="Rescinded"
      revisions={revisions}
      title="Removed in this revision"
      tone="removed"
    />
  );
}

export function removedBlockText(change: BlockChange): ReactNode {
  const text = change.previous ? blockText(change.previous) : "";
  return <p className="diff-text"><del className="diff-text__deleted">{text}</del></p>;
}

export function removedTopicText(topic: RemovedTopicChange): ReactNode {
  return topic.blocks.map((entry) =>
    entry.previous ? (
      <p className="diff-text" key={entry.id}>
        <del className="diff-text__deleted">{blockText(entry.previous)}</del>
      </p>
    ) : null,
  );
}

/** A current block with a change bar and a badge that opens the comparison. */
export function ChangeFrame({
  change,
  revisions,
  children,
  onInspect,
}: {
  change: BlockChange;
  revisions: ComparedRevisions;
  children: ReactNode;
  /** Called when the person opens the comparison (for the audit log). */
  onInspect?: (blockId: string, status: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  if (change.status !== "modified" && change.status !== "added") {
    return <>{children}</>;
  }

  return (
    <div className={`change-frame change-frame--${change.status}${open ? " change-frame--open" : ""}`}>
      <button
        aria-controls={panelId}
        aria-expanded={open}
        className={`change-badge change-badge--${change.status}`}
        onClick={() => {
          if (!open) onInspect?.(change.id, change.status);
          setOpen((value) => !value);
        }}
        type="button"
      >
        {STATUS_LABEL[change.status]}
      </button>
      {children}
      {open && (
        <div id={panelId}>
          <BlockChangePanel change={change} onClose={() => setOpen(false)} revisions={revisions} />
        </div>
      )}
    </div>
  );
}

function RemovedMarker({
  heading,
  previous,
  revisions,
  onOpen,
}: {
  heading: ReactNode;
  previous: ReactNode;
  revisions: ComparedRevisions;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className={`change-frame change-frame--removed${open ? " change-frame--open" : ""}`}>
      <div className="removed-marker">
        <span className="removed-marker__heading">{heading}</span>
        <button
          aria-controls={panelId}
          aria-expanded={open}
          className="change-badge change-badge--removed"
          onClick={() => {
            if (!open) onOpen?.();
            setOpen((value) => !value);
          }}
          type="button"
        >
          {STATUS_LABEL.removed}
        </button>
      </div>
      {open && (
        <div id={panelId}>
          <RemovedChangePanel
            onClose={() => setOpen(false)}
            previous={previous}
            revisions={revisions}
          />
        </div>
      )}
    </div>
  );
}

export function excerpt(text: string, words = 12): string {
  const parts = text.split(/\s+/).filter(Boolean);
  return parts.length > words ? `${parts.slice(0, words).join(" ")}…` : text;
}

export function RemovedBlockMarker({
  change,
  revisions,
  onInspect,
}: {
  change: BlockChange;
  revisions: ComparedRevisions;
  onInspect?: (blockId: string, status: string) => void;
}) {
  const text = change.previous ? blockText(change.previous) : "";
  return (
    <RemovedMarker
      heading={<s className="removed-marker__excerpt">{excerpt(text)}</s>}
      onOpen={() => onInspect?.(change.id, "removed")}
      previous={removedBlockText(change)}
      revisions={revisions}
    />
  );
}

export function RemovedTopicMarker({
  topic,
  revisions,
  onInspect,
}: {
  topic: RemovedTopicChange;
  revisions: ComparedRevisions;
  onInspect?: (nodeId: string, status: string) => void;
}) {
  return (
    <RemovedMarker
      heading={
        <>
          <span className="removed-marker__number">{topic.number}</span> {topic.title}
        </>
      }
      onOpen={() => onInspect?.(topic.id, "removed")}
      previous={removedTopicText(topic)}
      revisions={revisions}
    />
  );
}

/**
 * True when the comparison describes exactly the blocks being shown, in order.
 * A stale or mismatched comparison is never drawn over the content.
 */
export function changesMatchBlocks(
  changes: BlockChange[],
  blocks: ContentBlock[],
): boolean {
  const currentIds = changes
    .filter((change) => change.status !== "removed")
    .map((change) => change.id);
  return (
    currentIds.length === blocks.length &&
    currentIds.every((id, index) => blocks[index].id === id)
  );
}
