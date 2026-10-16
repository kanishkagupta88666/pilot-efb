import { useEffect, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getDocumentLibrary } from "../data/mockData";
import { getDocumentLibraryFromApi, type ApiClientError } from "../api/client";
import { DATA_SOURCE } from "../config/dataSource";
import type { DocumentSummary, RevisionStatus } from "../types/api";
import { formatDate } from "../utils/formatDate";
import { ApiErrorState, EmptyState, LoadingState } from "./RequestStates";
import { RevisionSelector } from "./RevisionSelector";
import { TopBar } from "./TopBar";

const statusLabels: Record<RevisionStatus, string> = {
  current: "Current",
  upcoming: "Upcoming",
  superseded: "Superseded",
};

function DocumentRow({ document }: { document: DocumentSummary }) {
  const navigate = useNavigate();
  const initialRevision = document.availableRevisions[0];
  const [selectedRevision, setSelectedRevision] = useState(
    initialRevision?.revision,
  );
  const selected = document.availableRevisions.find(
    (revision) => revision.revision === selectedRevision,
  );

  if (!selected) {
    return (
      <tr>
        <td className="document-table__type">{document.docType}</td>
        <td>
          <h2>{document.id}</h2>
        </td>
        <td colSpan={5} role="status">No revisions are available.</td>
      </tr>
    );
  }

  const readerPath = `/reader/${encodeURIComponent(document.id)}/${selected.revision}`;
  // The whole row opens the reader; taps on the link or revision selector keep their own behaviour.
  const openFromRow = (event: MouseEvent<HTMLTableRowElement>) => {
    if ((event.target as HTMLElement).closest("a, select, label")) return;
    navigate(readerPath);
  };

  return (
    <tr className="document-table__row" onClick={openFromRow}>
      <td className="document-table__type">{selected.metadata.docType}</td>
      <td>
        <h2>{selected.metadata.title}</h2>
        <p className="document-id">{document.id}</p>
      </td>
      <td className="document-table__revision">
        {document.availableRevisions.length > 1 ? (
          <RevisionSelector
            onChange={setSelectedRevision}
            revisions={document.availableRevisions}
            selectedRevision={selected.revision}
          />
        ) : (
          selected.revision
        )}
      </td>
      <td>
        <time dateTime={selected.metadata.revisionDate}>
          {formatDate(selected.metadata.revisionDate)}
        </time>
      </td>
      <td>
        <time dateTime={selected.metadata.effectiveDate}>
          {formatDate(selected.metadata.effectiveDate)}
        </time>
      </td>
      <td>
        <span className={`status-chip status-chip--${selected.status}`}>
          {statusLabels[selected.status]}
        </span>
      </td>
      <td className="document-table__open">
        <Link
          aria-label={`Open ${selected.metadata.title}`}
          className="button button--primary"
          to={readerPath}
        >
          Open
        </Link>
      </td>
    </tr>
  );
}

function LibraryContent({ documents }: { documents: DocumentSummary[] }) {
  return (
    <section className="document-list" aria-label="Available documents">
      <table className="document-table">
        <thead>
          <tr>
            <th colSpan={2} scope="col">Document</th>
            <th scope="col">Revision</th>
            <th scope="col">Revision date</th>
            <th scope="col">Effective date</th>
            <th scope="col">Status</th>
            <th scope="col"><span className="visually-hidden">Open</span></th>
          </tr>
        </thead>
        <tbody>
          {documents.map((document) => (
            <DocumentRow document={document} key={document.id} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function LibraryFrame({ children }: { children: ReactNode }) {
  return (
    <main className="library-page">
      <TopBar title="Library" />
      <div className="library-body">
        <header className="library-header">
          <h1>Document library</h1>
          <p className="intro">Choose an available manual revision to read.</p>
          <p className="library-links">
            <Link to="/audit">Activity log</Link>
          </p>
          <form action="/search" className="search-form search-form--library" role="search">
            <label className="visually-hidden" htmlFor="library-search">Search published documents</label>
            <input
              autoComplete="off"
              enterKeyHint="search"
              id="library-search"
              maxLength={200}
              name="q"
              placeholder="Search all published documents"
              type="search"
            />
            <button className="button button--primary" type="submit">Search</button>
          </form>
        </header>
        {children}
      </div>
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
        <LibraryContent documents={documents} />
      )}
    </LibraryFrame>
  );
}

export function DocumentLibrary() {
  return DATA_SOURCE === "api" ? <ApiDocumentLibrary /> : <MockDocumentLibrary />;
}
