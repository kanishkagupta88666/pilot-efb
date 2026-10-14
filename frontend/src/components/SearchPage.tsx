import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  getDocumentLibraryFromApi,
  getSearchIndexFromApi,
  searchFromApi,
  type ApiClientError,
} from "../api/client";
import type {
  SearchCategory,
  SearchContentType,
  SearchFilters,
  SearchResponse,
  SearchResult,
  SearchableDocument,
} from "../types/api";
import {
  loadIndex,
  offlineStorageAvailable,
  saveIndex,
  type SavedIndex,
} from "../utils/offlineSearchStore";
import { prepareDocument, searchLocal, wordMatches, words } from "../utils/searchIndex";
import { ApiErrorState } from "./RequestStates";

/** Wait this long after the last keystroke before searching. */
const TYPING_DELAY_MS = 200;

const CONTENT_CHIPS: { value: SearchContentType; label: string }[] = [
  { value: "warnings", label: "Warnings" },
  { value: "procedures", label: "Procedures" },
];

const BLOCK_BADGE: Record<string, string> = {
  warning: "Warning",
  caution: "Caution",
  note: "Note",
  checklist: "Procedure",
  table: "Table",
};

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: ApiClientError }
  | { status: "no-offline-index" }
  | {
      status: "ready";
      response: Omit<SearchResponse, "documents">;
      source: "online" | "offline";
      elapsedMs: number;
    };

type IndexState =
  | { status: "unavailable" }
  | { status: "loading" }
  | { status: "none" }
  | { status: "saving" }
  | { status: "saved"; index: SavedIndex }
  | { status: "error"; message: string };

function filtersFrom(params: URLSearchParams): SearchFilters {
  return {
    docTypes: params.getAll("docType"),
    fleet: params.get("fleet") ?? undefined,
    categories: params.getAll("category").filter(
      (value): value is SearchCategory =>
        value === "master" || value === "fleet" || value === "supplemental",
    ),
    contentTypes: params.getAll("contentType").filter(
      (value): value is SearchContentType => value === "warnings" || value === "procedures",
    ),
  };
}

/** Marks the words of ``text`` that a query word matches, as search does. */
function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  const parts: (string | { word: string })[] = [];
  let last = 0;
  for (const match of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const word = match[0];
    if (terms.some((term) => wordMatches(word, term))) {
      parts.push(text.slice(last, match.index), { word });
      last = match.index + word.length;
    }
  }
  parts.push(text.slice(last));
  return (
    <>
      {parts.map((part, index) =>
        typeof part === "string" ? part : <mark key={index}>{part.word}</mark>,
      )}
    </>
  );
}

function formatSaved(savedAt: string): string {
  return new Date(savedAt).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const query = params.get("q") ?? "";
  const filterKey = params.toString();
  const filters = useMemo(() => filtersFrom(new URLSearchParams(filterKey)), [filterKey]);
  const [draft, setDraft] = useState(query);
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const [documents, setDocuments] = useState<SearchableDocument[]>([]);
  const [indexState, setIndexState] = useState<IndexState>({
    status: offlineStorageAvailable() ? "loading" : "unavailable",
  });
  const [attempt, setAttempt] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const typedQuery = useRef(query);

  // Keep the field in step with the URL when it changes from outside the
  // field (back and forward, links into search), never while typing.
  useEffect(() => {
    if (query !== typedQuery.current) {
      typedQuery.current = query;
      setDraft(query);
    }
  }, [query]);
  useEffect(() => inputRef.current?.focus(), []);

  // Search as the pilot types, once typing pauses.
  useEffect(() => {
    if (draft === query || (!draft.trim() && !query)) return;
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(params);
      if (draft.trim()) next.set("q", draft);
      else next.delete("q");
      typedQuery.current = draft.trim() ? draft : "";
      setParams(next, { replace: true });
    }, TYPING_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [draft, query, params, setParams]);

  useEffect(() => {
    if (!offlineStorageAvailable()) return;
    loadIndex().then(
      (index) => setIndexState(index ? { status: "saved", index } : { status: "none" }),
      () => setIndexState({ status: "error", message: "The saved search index could not be read." }),
    );
  }, []);

  const saved = indexState.status === "saved" ? indexState.index : undefined;
  const prepared = useMemo(() => saved?.documents.map(prepareDocument), [saved]);

  useEffect(() => {
    const controller = new AbortController();
    void getDocumentLibraryFromApi(controller.signal).then((result) => {
      if (controller.signal.aborted || !result.ok) return;
      setDocuments(
        result.data.documents.flatMap((document) => {
          const current = document.availableRevisions.find((entry) => entry.status === "current");
          if (!current) return [];
          const applicability = current.metadata.applicability;
          return [{
            docId: document.id,
            title: current.metadata.title,
            docType: document.docType,
            applicability,
            category:
              current.metadata.source === "pdf-only"
                ? "supplemental"
                : applicability.trim().toUpperCase() === "ALL"
                  ? "master"
                  : "fleet",
            revision: current.revision,
            effectiveDate: current.effectiveDate,
          } satisfies SearchableDocument];
        }),
      );
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!words(query).length) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    const started = performance.now();
    setState((previous) => (previous.status === "ready" ? previous : { status: "loading" }));
    void searchFromApi(query, filters, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) {
        const { documents: searched, ...response } = result.data;
        setDocuments(searched);
        setState({
          status: "ready",
          response,
          source: "online",
          elapsedMs: performance.now() - started,
        });
        return;
      }
      if (result.error.kind !== "network") {
        setState({ status: "error", error: result.error });
        return;
      }
      // No connection: search the index saved on this device, by the same rules.
      if (prepared) {
        const localStart = performance.now();
        const response = searchLocal(query, prepared, filters);
        setState({
          status: "ready",
          response,
          source: "offline",
          elapsedMs: performance.now() - localStart,
        });
      } else if (indexState.status !== "loading") {
        setState({ status: "no-offline-index" });
      }
    });
    return () => controller.abort();
  }, [query, filters, prepared, indexState.status, attempt]);

  const filterDocuments = documents.length ? documents : (saved?.documents ?? []);
  const docTypes = [...new Set(filterDocuments.map((document) => document.docType))].sort();
  const fleets = [
    ...new Set(
      filterDocuments
        .filter((document) => document.category === "fleet")
        .map((document) => document.applicability),
    ),
  ].sort();
  const outdated = saved && documents.length
    ? documents.filter((document) => {
        const savedDocument = saved.documents.find((entry) => entry.docId === document.docId);
        return !savedDocument || savedDocument.revision !== document.revision;
      })
    : [];

  const update = (change: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(params);
    change(next);
    setParams(next, { replace: true });
  };
  const selectDocType = (docType?: string) =>
    update((next) => {
      next.delete("docType");
      if (docType) next.set("docType", docType);
    });
  const toggleContent = (contentType: SearchContentType) =>
    update((next) => {
      const current = next.getAll("contentType");
      next.delete("contentType");
      const kept = current.includes(contentType)
        ? current.filter((value) => value !== contentType)
        : [...current, contentType];
      for (const value of kept) next.append("contentType", value);
    });
  const setSingle = (name: string, value: string) =>
    update((next) => {
      next.delete(name);
      if (value) next.set(name, value);
    });

  const saveForOffline = async () => {
    setIndexState({ status: "saving" });
    const result = await getSearchIndexFromApi();
    if (!result.ok) {
      setIndexState(
        saved
          ? { status: "saved", index: saved }
          : { status: "error", message: `Download failed: ${result.error.message}` },
      );
      return;
    }
    try {
      setIndexState({ status: "saved", index: await saveIndex(result.data.documents) });
    } catch {
      setIndexState({ status: "error", message: "The index could not be saved on this device." });
    }
  };

  const open = (result: SearchResult) => {
    const target = new URLSearchParams({ topicId: result.topicId, nodeId: result.nodeId });
    navigate(`/reader/${encodeURIComponent(result.docId)}/${result.revision}?${target.toString()}`, {
      state: { fromSearch: `${location.pathname}${location.search}` },
    });
  };

  const activeDocType = filters.docTypes?.[0];
  return (
    <main className="search-page">
      <header className="efb-bar">
        <div className="efb-bar__title">
          <Link className="efb-bar__brand" to="/">EFB content</Link>
          <span aria-hidden="true" className="efb-bar__divider" />
          <span>Search</span>
        </div>
        <div className="efb-bar__status">
          <OfflineIndexChip indexState={indexState} onSave={() => void saveForOffline()} />
          <span className="efb-bar__synthetic">Synthetic sample — not for operational use</span>
        </div>
      </header>

      <div className="search-box">
        <label className="visually-hidden" htmlFor="search-query">Search published documents</label>
        <input
          autoComplete="off"
          autoCorrect="off"
          enterKeyHint="search"
          id="search-query"
          maxLength={200}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          placeholder="Search titles and text"
          ref={inputRef}
          spellCheck={false}
          type="search"
          value={draft}
        />
        {state.status === "ready" && (
          <span aria-live="polite" className="search-box__meta">
            {state.response.total} {state.response.total === 1 ? "result" : "results"} ·{" "}
            {Math.max(1, Math.round(state.elapsedMs))} ms
          </span>
        )}
      </div>

      <div aria-label="Filter results" className="search-chips" role="group">
        <span className="search-chips__label">Filter</span>
        <button
          aria-pressed={!activeDocType}
          className="search-chip"
          onClick={() => selectDocType(undefined)}
          type="button"
        >
          All documents
        </button>
        {docTypes.map((docType) => (
          <button
            aria-pressed={activeDocType === docType}
            className="search-chip"
            key={docType}
            onClick={() => selectDocType(activeDocType === docType ? undefined : docType)}
            type="button"
          >
            {docType}
          </button>
        ))}
        {CONTENT_CHIPS.map((chip) => (
          <button
            aria-pressed={filters.contentTypes?.includes(chip.value) ?? false}
            className="search-chip"
            key={chip.value}
            onClick={() => toggleContent(chip.value)}
            type="button"
          >
            {chip.label}
          </button>
        ))}
        <span className="search-chips__selects">
          <label className="visually-hidden" htmlFor="search-fleet">Fleet</label>
          <select
            className="search-select"
            id="search-fleet"
            onChange={(event) => setSingle("fleet", event.target.value)}
            value={filters.fleet ?? ""}
          >
            <option value="">All fleets</option>
            {fleets.map((fleet) => <option key={fleet} value={fleet}>{fleet}</option>)}
          </select>
          <label className="visually-hidden" htmlFor="search-category">Category</label>
          <select
            className="search-select"
            id="search-category"
            onChange={(event) => setSingle("category", event.target.value)}
            value={filters.categories?.[0] ?? ""}
          >
            <option value="">All categories</option>
            <option value="master">Master documents</option>
            <option value="fleet">Fleet manuals</option>
            <option value="supplemental">Supplemental documents</option>
          </select>
        </span>
      </div>

      {state.status === "ready" && state.source === "offline" && saved && (
        <p className="search-notice" role="status">
          No connection. Results come from the index saved on this device on {formatSaved(saved.savedAt)}.
        </p>
      )}
      {saved && outdated.length > 0 && (
        <p className="search-notice search-notice--warning" role="status">
          Newer revisions are published ({outdated.map((d) => `${d.docId} Revision ${d.revision}`).join(", ")}).
          Update the offline index while connected.
        </p>
      )}
      {indexState.status === "error" && (
        <p className="search-notice search-notice--warning" role="alert">{indexState.message}</p>
      )}

      <section aria-label="Search results" className="search-rows-wrap">
        {state.status === "idle" && (
          <p className="search-empty">Search the published revision of every document by title or text.</p>
        )}
        {state.status === "loading" && <p className="search-empty" role="status">Searching…</p>}
        {state.status === "error" && (
          <div className="search-empty">
            <ApiErrorState error={state.error} onRetry={() => setAttempt((value) => value + 1)} />
          </div>
        )}
        {state.status === "no-offline-index" && (
          <p className="search-empty" role="alert">
            No connection, and no search index is saved on this device. Save one for offline search the
            next time you are connected.
          </p>
        )}
        {state.status === "ready" && state.response.total === 0 && (
          <p className="search-empty">No results. Every word must appear; try fewer or shorter words.</p>
        )}
        {state.status === "ready" && state.response.total > 0 && (
          <>
            <ol className="search-rows">
              {state.response.results.map((result) => {
                const badge = BLOCK_BADGE[result.nodeType];
                return (
                  <li key={`${result.docId}-${result.topicId}`}>
                    <button className="search-row" onClick={() => open(result)} type="button">
                      <span className="search-row__path">
                        <span className="search-row__doc">{result.docType}</span>
                        <span className="search-row__number">{result.section.number}</span>
                        <span className="search-row__trail">
                          {result.section.title} &gt;{" "}
                          <Highlighted terms={state.response.terms} text={result.title} />
                        </span>
                        {badge && <span className="search-row__badge">{badge}</span>}
                      </span>
                      {result.snippet && (
                        <span className="search-row__snippet">
                          <Highlighted terms={state.response.terms} text={result.snippet} />
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>
            {state.response.total > state.response.results.length && (
              <p className="search-more">
                Showing the {state.response.results.length} best of {state.response.total} results. Add a
                word or a filter to narrow them.
              </p>
            )}
          </>
        )}
      </section>
    </main>
  );
}

function OfflineIndexChip({ indexState, onSave }: { indexState: IndexState; onSave: () => void }) {
  if (indexState.status === "unavailable" || indexState.status === "loading") return null;
  const saved = indexState.status === "saved" ? indexState.index : undefined;
  return (
    <button
      className={`efb-chip${saved ? "" : " efb-chip--action"}`}
      disabled={indexState.status === "saving"}
      onClick={onSave}
      title={saved ? "Download the index again to include the latest revisions" : undefined}
      type="button"
    >
      {indexState.status === "saving" ? (
        "Saving index…"
      ) : saved ? (
        <>
          <span className="efb-chip__label">Offline</span> index {formatSaved(saved.savedAt)}
        </>
      ) : (
        "Save for offline search"
      )}
    </button>
  );
}
