import { useState } from "react";
import { Link } from "react-router-dom";
import type { DocumentRevision } from "../types/api";
import { acknowledgeRevision, findAcknowledgment } from "../utils/acknowledgments";
import { formatDate } from "../utils/formatDate";
import { CheckIcon } from "./Icons";

/**
 * The pilot confirms they have seen a new revision. Saved on this device for now.
 * It never blocks reading: the banner and its other button stay as they are.
 */
function AcknowledgeButton({ docId, revision }: { docId: string; revision: number }) {
  const [acknowledged, setAcknowledged] = useState(() => findAcknowledgment(docId, revision));
  if (acknowledged) {
    return (
      <span className="revision-alert__acknowledged">
        <CheckIcon />
        {/* en-CA gives the local date as YYYY-MM-DD, the form formatDate reads. */}
        Acknowledged on {formatDate(new Date(acknowledged.acknowledgedAt).toLocaleDateString("en-CA"))}
      </span>
    );
  }
  return (
    <button
      className="button button--primary"
      onClick={() => setAcknowledged(acknowledgeRevision(docId, revision))}
      type="button"
    >
      Acknowledge
    </button>
  );
}

/**
 * Publish alert: tells the pilot when the revision on screen is not the one in force.
 * Uses the revision status the API already provides. Alerting about a revision published
 * while the app is open needs a backend notification and is not built yet.
 */
export function RevisionAlert({
  docId,
  revision,
  revisions,
}: {
  docId: string;
  revision: number;
  revisions: DocumentRevision[];
}) {
  const shown = revisions.find((entry) => entry.revision === revision);
  const current = revisions.find((entry) => entry.status === "current");
  const upcoming = revisions
    .filter((entry) => entry.status === "upcoming" && entry.revision > revision)
    .sort((a, b) => a.revision - b.revision)[0];
  const readerPath = (target: number) =>
    `/reader/${encodeURIComponent(docId)}/${target}`;

  if (shown?.status === "superseded" && current) {
    return (
      <div className="revision-alert revision-alert--caution" role="status">
        <p>
          <strong>You are reading superseded Revision {revision}.</strong> Revision{" "}
          {current.revision} is in force, effective {formatDate(current.effectiveDate)}.
        </p>
        <Link className="button button--secondary" to={readerPath(current.revision)}>
          Open Revision {current.revision}
        </Link>
      </div>
    );
  }

  if (shown?.status === "upcoming") {
    return (
      <div className="revision-alert revision-alert--caution" role="status">
        <p>
          <strong>Revision {revision} is not in force yet.</strong> It takes effect on{" "}
          {formatDate(shown.effectiveDate)}.
          {current && ` Revision ${current.revision} is the current revision.`}
        </p>
        <div className="revision-alert__actions">
          <AcknowledgeButton docId={docId} key={`${docId}/${revision}`} revision={revision} />
          {current && (
            <Link className="button button--secondary" to={readerPath(current.revision)}>
              Open Revision {current.revision}
            </Link>
          )}
        </div>
      </div>
    );
  }

  if (upcoming) {
    return (
      <div className="revision-alert revision-alert--info" role="status">
        <p>
          <strong>New revision available.</strong> Revision {upcoming.revision} takes effect
          on {formatDate(upcoming.effectiveDate)}.
        </p>
        <div className="revision-alert__actions">
          <AcknowledgeButton
            docId={docId}
            key={`${docId}/${upcoming.revision}`}
            revision={upcoming.revision}
          />
          <Link className="button button--secondary" to={readerPath(upcoming.revision)}>
            View Revision {upcoming.revision}
          </Link>
        </div>
      </div>
    );
  }

  return null;
}
