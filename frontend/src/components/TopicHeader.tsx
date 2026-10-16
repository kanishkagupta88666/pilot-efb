import type { ReactNode } from "react";
import type { RevisionStatus } from "../types/api";
import { RevisionStatusChip } from "./RevisionSelector";
import { formatDate } from "../utils/formatDate";

/** Topic number and title, with the revision details underneath. */
export function TopicHeader({
  number,
  title,
  id,
  targeted = false,
  revisionDate,
  effectiveDate,
  revisionSelector,
  status,
  children,
}: {
  number?: string;
  title: string;
  id?: string;
  targeted?: boolean;
  revisionDate: string;
  effectiveDate: string;
  revisionSelector: ReactNode;
  /** Status of the revision on screen, shown once beside the revision number. */
  status?: RevisionStatus;
  children?: ReactNode;
}) {
  return (
    <div className="document-heading">
      <h1 className={targeted ? "content-block--targeted" : undefined} id={id}>
        {number && <span className="topic-number">{number}</span>}{" "}
        {title}
      </h1>
      <div className="revision-details">
        {revisionSelector}
        {status && <RevisionStatusChip status={status} />}
        <span>
          <span className="meta-label">Revision date</span>{" "}
          <time dateTime={revisionDate}>{formatDate(revisionDate)}</time>
        </span>
        <span>
          <span className="meta-label">Effective date</span>{" "}
          <time dateTime={effectiveDate}>{formatDate(effectiveDate)}</time>
        </span>
      </div>
      {children}
    </div>
  );
}
