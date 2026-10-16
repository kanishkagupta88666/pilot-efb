import type { DocumentRevision, RevisionStatus } from "../types/api";

export const statusLabels: Record<RevisionStatus, string> = {
  current: "Current",
  upcoming: "Upcoming",
  superseded: "Superseded",
};

export function RevisionStatusChip({ status }: { status: RevisionStatus }) {
  return <span className={`status-chip status-chip--${status}`}>{statusLabels[status]}</span>;
}

/**
 * Revision number only; the status (current, upcoming, superseded) is shown once,
 * next to it, by the caller.
 */
export function RevisionSelector({
  revisions,
  selectedRevision,
  onChange,
}: {
  revisions: DocumentRevision[];
  selectedRevision: number;
  onChange: (revision: number) => void;
}) {
  const selected = revisions.find((revision) => revision.revision === selectedRevision);

  if (revisions.length <= 1) {
    return (
      <p className="revision-status">
        {selected ? `Revision ${selected.revision}` : "Revision unavailable"}
      </p>
    );
  }

  return (
    <label className="revision-selector">
      <span>Revision</span>
      <select
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        value={selected ? selected.revision : ""}
      >
        {!selected && <option value="">Select revision</option>}
        {revisions.map((revision) => (
          <option key={revision.revision} value={revision.revision}>
            {revision.revision}
          </option>
        ))}
      </select>
    </label>
  );
}
