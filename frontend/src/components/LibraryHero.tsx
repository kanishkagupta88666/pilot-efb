import type { DocumentSummary } from "../types/api";
import { formatDate } from "../utils/formatDate";
import { BookIcon, CalendarIcon, CheckIcon } from "./Icons";

function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** A blueprint-style top view of an airliner, drawn in lines. Decorative only. */
function AircraftBlueprint() {
  return (
    <svg aria-hidden="true" className="library-hero__blueprint" fill="none" viewBox="0 0 540 236">
      <path className="blueprint-centre" d="M14 100h520" />
      <path d="M40 100c0-8 20-11 50-11h360c30 0 50 6 55 11-5 5-25 11-55 11H90c-30 0-50-3-50-11Z" />
      <path d="M478 93q10 7 0 14" />
      <path d="M332 89 232 12h-26l64 77M332 111l-100 77h-26l64-77" />
      <ellipse cx="282" cy="54" rx="20" ry="6" />
      <ellipse cx="282" cy="146" rx="20" ry="6" />
      <path d="M98 89 62 48H49l25 41M98 111l-36 41H49l25-41" />
      <path className="blueprint-dimension" d="M40 214h465M40 206v16M505 206v16" />
      <text className="blueprint-label" textAnchor="middle" x="272" y="232">Length</text>
    </svg>
  );
}

/** The banner at the top of the library. */
export function LibraryHero() {
  return (
    <header className="library-hero">
      <div className="library-hero__text">
        <p className="library-hero__greeting">{greeting(new Date().getHours())}</p>
        <h1>Document library</h1>
        <p className="library-hero__intro">Choose a manual revision to read.</p>
      </div>
      <AircraftBlueprint />
    </header>
  );
}

/** Three summary cards: how many manuals, how many are in force, and the next revision due. */
export function LibrarySummary({ documents }: { documents: DocumentSummary[] }) {
  const inForce = documents.filter((document) =>
    document.availableRevisions.some((revision) => revision.status === "current"),
  ).length;
  const next = documents
    .flatMap((document) =>
      document.availableRevisions
        .filter((revision) => revision.status === "upcoming")
        .map((revision) => ({ document, revision })),
    )
    .sort((a, b) => a.revision.effectiveDate.localeCompare(b.revision.effectiveDate))[0];

  return (
    <section aria-label="Library summary" className="library-summary">
      <div className="summary-card">
        <span className="summary-card__icon summary-card__icon--blue"><BookIcon /></span>
        <div>
          <p className="summary-card__label">Manuals installed</p>
          <p className="summary-card__value">{documents.length}</p>
        </div>
      </div>
      <div className="summary-card">
        <span className="summary-card__icon summary-card__icon--green"><CheckIcon /></span>
        <div>
          <p className="summary-card__label">Revisions in force</p>
          <p className="summary-card__value">
            {inForce} of {documents.length}
          </p>
        </div>
      </div>
      <div className="summary-card">
        <span className="summary-card__icon summary-card__icon--amber"><CalendarIcon /></span>
        <div>
          <p className="summary-card__label">Next revision</p>
          {next ? (
            <>
              <p className="summary-card__value summary-card__value--mono">
                {next.document.id} · Rev {next.revision.revision}
              </p>
              <p className="summary-card__hint">
                Takes effect {formatDate(next.revision.effectiveDate)}
              </p>
            </>
          ) : (
            <p className="summary-card__value">None scheduled</p>
          )}
        </div>
      </div>
    </section>
  );
}
