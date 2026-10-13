import type { ReactNode } from "react";
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
  children,
}: {
  number?: string;
  title: string;
  id?: string;
  targeted?: boolean;
  revisionDate: string;
  effectiveDate: string;
  revisionSelector: ReactNode;
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
