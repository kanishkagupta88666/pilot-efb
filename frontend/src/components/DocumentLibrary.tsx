import { Link } from "react-router-dom";
import { getDocumentLibrary } from "../data/mockData";

export function DocumentLibrary() {
  const documents = getDocumentLibrary();

  return (
    <main className="library-page">
      <header className="library-header">
        <p className="eyebrow">Pilot EFB</p>
        <h1>Document library</h1>
        <p className="intro">
          Choose an available manual revision to read.
        </p>
      </header>

      <section className="document-list" aria-label="Available documents">
        {documents.map((document) =>
          document.availableRevisions.map((availableRevision) => (
            <article
              className="document-card"
              key={`${document.id}-${availableRevision.revision}`}
            >
              <div className="document-card__heading">
                <div>
                  <h2>{availableRevision.metadata.title}</h2>
                  <p className="document-id">{document.id}</p>
                </div>
                <span className="document-type">
                  {availableRevision.metadata.docType}
                </span>
              </div>
              <dl className="document-details">
                <div>
                  <dt>Revision</dt>
                  <dd>{availableRevision.revision}</dd>
                </div>
                <div>
                  <dt>Revision date</dt>
                  <dd>{availableRevision.metadata.revisionDate}</dd>
                </div>
                <div>
                  <dt>Effective date</dt>
                  <dd>{availableRevision.metadata.effectiveDate}</dd>
                </div>
                <div>
                  <dt>Document type</dt>
                  <dd>{availableRevision.metadata.docType}</dd>
                </div>
              </dl>
              <Link
                className="button button--primary"
                to={`/reader/${encodeURIComponent(document.id)}/${availableRevision.revision}`}
              >
                Open reader
              </Link>
            </article>
          )),
        )}
      </section>
      <p className="prototype-note">Prototype data from the provisional sample.</p>
    </main>
  );
}
