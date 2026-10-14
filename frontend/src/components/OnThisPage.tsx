import type { ContentBlock } from "../types/api";

const SNIPPET_LENGTH = 60;

function shorten(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > SNIPPET_LENGTH ? `${clean.slice(0, SNIPPET_LENGTH).trimEnd()}…` : clean;
}

/** A label and a short preview for the blocks worth jumping to; paragraphs and lists are skipped. */
function describe(block: ContentBlock): { label: string; preview: string } | undefined {
  switch (block.type) {
    case "note":
    case "caution":
    case "warning":
      return {
        label: `${block.type.charAt(0).toUpperCase()}${block.type.slice(1)}`,
        preview: shorten(block.segments.map((segment) => segment.text).join("")),
      };
    case "table":
      return {
        label: "Table",
        preview: shorten((block.rows.find((row) => row.header) ?? block.rows[0])?.cells.join(", ") ?? ""),
      };
    case "checklist":
      return {
        label: "Checklist",
        preview: `${block.checks.length} ${block.checks.length === 1 ? "item" : "items"}`,
      };
    default:
      return undefined;
  }
}

/** The right-hand panel: jump links to the notes, cautions, warnings, tables and checklists in the open topic. */
export function OnThisPage({ blocks }: { blocks: ContentBlock[] }) {
  const entries = blocks.flatMap((block) => {
    const description = describe(block);
    return description ? [{ id: block.id, type: block.type, ...description }] : [];
  });

  const jumpTo = (id: string) => {
    const target = document.getElementById(id);
    if (typeof target?.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <>
      <h2>On this page</h2>
      {entries.length === 0 ? (
        <p className="page-nav__empty">No notes, cautions, tables or checklists in this topic.</p>
      ) : (
        <ul className="page-nav">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                className={`page-nav__item page-nav__item--${entry.type}`}
                onClick={() => jumpTo(entry.id)}
                type="button"
              >
                <span className="page-nav__label">{entry.label}</span>
                <span className="page-nav__preview">{entry.preview}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
