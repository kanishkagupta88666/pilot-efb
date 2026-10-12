import type { DocumentRevision, RevisionStatus } from "../types/api";

const statusLabels: Record<RevisionStatus, string> = {
  current: "Current",
  upcoming: "Upcoming",
  superseded: "Superseded",
};

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
      <p className="revision-status" aria-label="Revision status">
        {selected ? `${statusLabels[selected.status]} revision ${selected.revision}` : "Revision unavailable"}
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
            {revision.revision} · {statusLabels[revision.status]}
          </option>
        ))}
      </select>
    </label>
  );
}
