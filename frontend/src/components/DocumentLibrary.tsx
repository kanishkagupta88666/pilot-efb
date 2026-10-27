import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import deepLinkSamples from "../../../sample-data/deep_link_samples.json";
import { getDocumentLibrary } from "../data/mockData";
import { getDocumentLibraryFromApi, type ApiClientError } from "../api/client";
import { DATA_SOURCE } from "../config/dataSource";
import type { DocumentSummary } from "../types/api";
import { ApiErrorState, EmptyState, LoadingState } from "./RequestStates";
import { RevisionSelector } from "./RevisionSelector";

type DeepLinkSample = (typeof deepLinkSamples.links)[number];

function DocumentCard({
  document,
}: {
  document: DocumentSummary;
}) {
  const initialRevision =
    document.availableRevisions.find((revision) => revision.status === "current") ??
    document.availableRevisions[0];
  const [selectedRevision, setSelectedRevision] = useState(
    initialRevision?.revision,
  );
  const selected = document.availableRevisions.find(
    (revision) => revision.revision === selectedRevision,
  );

  if (!selected) {
    return (
      <article className="document-card">
        <h2>{document.id}</h2>
        <p role="status">No revisions are available.</p>
      </article>
    );
  }

  return (
    <article className="document-card" key={document.id}>
      <div className="document-card__heading">
        <div>
          <h2>{selected.metadata.title}</h2>
          <p className="document-id">{document.id}</p>
        </div>
        <span className="document-type">{selected.metadata.docType}</span>
      </div>
      <dl className="document-details">
        <div>
          <dt>Revision</dt>
          <dd>{selected.revision}</dd>
        </div>
        <div>
          <dt>Revision date</dt>
          <dd>{selected.metadata.revisionDate}</dd>
        </div>
        <div>
          <dt>Effective date</dt>
          <dd>{selected.metadata.effectiveDate}</dd>
        </div>
        <div>
          <dt>Document type</dt>
          <dd>{selected.metadata.docType}</dd>
        </div>
      </dl>
      <RevisionSelector
        onChange={setSelectedRevision}
        revisions={document.availableRevisions}
        selectedRevision={selected.revision}
      />
      <Link
        className="button button--primary"
        to={`/reader/${encodeURIComponent(document.id)}/${selected.revision}`}
      >
        Open reader
      </Link>
    </article>
  );
}

function LibraryContent({ documents }: { documents: DocumentSummary[] }) {
  return (
    <section className="document-list" aria-label="Available documents">
      {documents.map((document) => (
        <DocumentCard document={document} key={document.id} />
      ))}
    </section>
  );
}

function ExternalLinkExamples({
  documents,
}: {
  documents: DocumentSummary[];
}) {
  const documentIds = new Set(documents.map((document) => document.id));
  const examples = deepLinkSamples.links.filter((link) =>
    documentIds.has(link.docId),
  );

  if (examples.length === 0) return null;

  return (
    <section
      aria-labelledby="external-link-examples-heading"
      className="external-link-examples"
    >
      <h2 id="external-link-examples-heading">
        Simulated external application links
      </h2>
      <p>
        Open a sample permanent-ID link as if it came from another application.
        These examples omit the revision so the resolver selects the current
        effective revision.
      </p>
      <ul>
        {examples.map((link: DeepLinkSample) => {
          const query = new URLSearchParams({
            doc: link.docId,
            node: link.nodeId,
          });
          return (
            <li key={link.nodeId}>
              <Link to={`/open?${query.toString()}`}>
                {link.expectedNumber} — {link.expectedTitle}
              </Link>
              <span className="external-link-example__id">{link.nodeId}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function LibraryFrame({ children }: { children: ReactNode }) {
  return (
    <main className="library-page">
      <header className="library-header">
        <p className="eyebrow">Pilot EFB</p>
        <h1>Document library</h1>
        <p className="intro">Choose an available manual revision to read.</p>
      </header>
      {children}
    </main>
  );
}

function MockDocumentLibrary() {
  const documents = getDocumentLibrary();

  return (
    <LibraryFrame>
      <LibraryContent documents={documents} />
      <p className="prototype-note">Prototype data from the provisional sample.</p>
    </LibraryFrame>
  );
}

export function ApiDocumentLibrary() {
  const [documents, setDocuments] = useState<DocumentSummary[]>();
  const [error, setError] = useState<ApiClientError>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(undefined);
    setDocuments(undefined);

    void getDocumentLibraryFromApi(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) {
        setDocuments(result.data.documents);
      } else {
        setError(result.error);
      }
    });

    return () => controller.abort();
  }, [attempt]);

  if (error) {
    return (
      <LibraryFrame>
        <ApiErrorState error={error} onRetry={() => setAttempt((value) => value + 1)} />
      </LibraryFrame>
    );
  }

  if (!documents) {
    return (
      <LibraryFrame>
        <LoadingState label="Loading documents…" />
      </LibraryFrame>
    );
  }

  return (
    <LibraryFrame>
      {documents.length === 0 ? (
        <EmptyState message="No documents are available." />
      ) : (
        <>
          <LibraryContent documents={documents} />
          <ExternalLinkExamples documents={documents} />
        </>
      )}
    </LibraryFrame>
  );
}

export function DocumentLibrary() {
  return DATA_SOURCE === "api" ? <ApiDocumentLibrary /> : <MockDocumentLibrary />;
}
