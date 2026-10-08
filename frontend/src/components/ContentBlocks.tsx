import { Link } from "react-router-dom";
import type { ContentBlock, TopicResponse } from "../data/mockData";
import { resolveAvailableTargetId } from "../data/mockData";

interface BlockProps {
  block: ContentBlock;
  docId: string;
  revision: number;
  targetNodeId?: string;
}

function InlineSegments({
  segments,
  docId,
  revision,
}: {
  segments: Extract<ContentBlock, { segments: unknown }>["segments"];
  docId: string;
  revision: number;
}) {
  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return <span key={`${index}-text`}>{segment.text}</span>;
        }

        const target = resolveAvailableTargetId(docId, revision, segment.targetId);
        if (target) {
          return (
            <Link
              className="xref-link"
              key={`${index}-${segment.targetId}`}
              to={`/reader/${encodeURIComponent(docId)}/${revision}?nodeId=${encodeURIComponent(segment.targetId)}`}
            >
              {segment.text}
            </Link>
          );
        }

        return (
          <span className="xref-unavailable" key={`${index}-${segment.targetId}`}>
            <span>{segment.text}</span>
            <span className="xref-unavailable__message">
              {" "}Not available in this prototype.
            </span>
          </span>
        );
      })}
    </>
  );
}

function TextBlockView({ block, ...props }: BlockProps & { block: Extract<ContentBlock, { segments: unknown }> }) {
  const body = (
    <p>
      <InlineSegments
        segments={block.segments}
        docId={props.docId}
        revision={props.revision}
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
  topic: TopicResponse["topic"];
  docId: string;
  revision: number;
  targetNodeId?: string;
  completedChecks: Record<string, boolean>;
  onToggleCheck: (checkId: string) => void;
}

export function ContentBlocks({
  topic,
  docId,
  revision,
  targetNodeId,
  completedChecks,
  onToggleCheck,
}: ContentBlocksProps) {
  return (
    <div className="topic-content">
      {topic.blocks.map((block) => {
        switch (block.type) {
          case "para":
          case "note":
          case "caution":
          case "warning":
            return (
              <TextBlockView
                block={block}
                docId={docId}
                key={block.id}
                revision={revision}
                targetNodeId={targetNodeId}
              />
            );
          case "list":
            return (
              <ListView
                block={block}
                docId={docId}
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
                key={block.id}
                onToggleCheck={onToggleCheck}
                revision={revision}
                targetNodeId={targetNodeId}
              />
            );
        }
      })}
    </div>
  );
}
