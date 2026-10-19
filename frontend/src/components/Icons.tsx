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

/** The Pilot EFB mark: a compass rose. */
export function LogoMark() {
  return (
    <svg aria-hidden="true" className="logo-mark" fill="none" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="11" stroke="currentColor" strokeWidth="1.6" />
      <path d="M16 2v5M16 25v5M2 16h5M25 16h5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
      <path d="m16 7 2.6 6.4L25 16l-6.4 2.6L16 25l-2.6-6.4L7 16l6.4-2.6L16 7Z" fill="currentColor" />
      <circle cx="16" cy="16" r="1.6" fill="var(--surface)" />
    </svg>
  );
}

export function PersonIcon() {
  return (
    <svg {...stroke} className="icon field-icon">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg {...stroke} className="icon field-icon">
      <rect height="10" rx="2" width="16" x="4" y="11" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export function EyeIcon() {
  return (
    <svg {...stroke} className="icon">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOffIcon() {
  return (
    <svg {...stroke} className="icon">
      <path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3 3.9M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
    </svg>
  );
}

export function InfoIcon() {
  return (
    <svg {...stroke} className="icon info-icon">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

export function BookIcon() {
  return (
    <svg {...stroke} className="icon">
      <path d="M5 4h11a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V4Z" />
      <path d="M5 18a2 2 0 0 1 2-2h11M9 8h5" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg {...stroke} className="icon">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function CalendarIcon() {
  return (
    <svg {...stroke} className="icon">
      <rect height="15" rx="2" width="16" x="4" y="5" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </svg>
  );
}

