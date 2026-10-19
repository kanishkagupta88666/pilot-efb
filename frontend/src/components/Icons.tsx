import type { AnnotationKind } from "../annotations/annotations";

const stroke = {
  "aria-hidden": true,
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  strokeWidth: 2,
  viewBox: "0 0 24 24",
} as const;

function HighlightIcon() {
  return (
    <svg {...stroke} className="icon icon--highlight">
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z" fill="currentColor" fillOpacity="0.2" />
      <path d="m14 7 3 3" />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg {...stroke} className="icon icon--note">
      <path
        d="M5 4h14a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-6l-4 3v-3H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"
        fill="currentColor"
        fillOpacity="0.15"
      />
      <path d="M8 9h8M8 12h5" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg {...stroke} className="icon icon--bookmark">
      <path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1Z" fill="currentColor" fillOpacity="0.15" />
    </svg>
  );
}

/** Icon for a kind of annotation: highlighter, note or bookmark. */
export function AnnotationIcon({ kind }: { kind: AnnotationKind }) {
  if (kind === "highlight") return <HighlightIcon />;
  if (kind === "note") return <NoteIcon />;
  return <BookmarkIcon />;
}

export function SunIcon() {
  return (
    <svg {...stroke} className="icon icon--theme">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function MoonIcon() {
  return (
    <svg {...stroke} className="icon icon--theme">
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
    </svg>
  );
}
