import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  getDocumentLibraryFromApi,
  getNodeChangesFromApi,
  getRevisionNavigationFromApi,
  getTopicContentFromApi,
  type ApiClientError,
} from "../api/client";
import type {
  Chapter,
  DocumentRevision,
  NodeChangesResponse,
  RevisionNavigationResponse,
  TopicContentResponse,
} from "../types/api";
import { ContentBlocks } from "./ContentBlocks";
import { ApiErrorState, EmptyState, LoadingState } from "./RequestStates";
import { RevisionSelector } from "./RevisionSelector";
import { recordAudit } from "../utils/auditLog";
import {
  AnnotationPanel,
  SelectionToolbar,
  highlightsFor,
  saveHighlight,
  useAnnotations,
  useTextSelection,
  type PendingNote,
} from "./Annotations";

const PdfPrintView = lazy(() => import("./PdfPrintView"));

type PageData =
  | { key: string; status: "loading" }
  | { key: string; status: "error"; error: ApiClientError }
  | {
      key: string;
      status: "ready";
      navigation: RevisionNavigationResponse;
      revisions: DocumentRevision[];
    };

type ChangesData =
  | { status: "none" }
  | { status: "loading" }
  | { status: "unavailable"; message: string }
  | { status: "ready"; changes: NodeChangesResponse };

type TopicData =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: ApiClientError }
  | { status: "ready"; topic: TopicContentResponse["topic"] };

function errorResult(
  code: string,
  message: string,
  status = 404,
): ApiClientError {
  return { kind: "http", code, message, status };
}

function parseRevision(value: string): number | undefined {
  if (!/^(0|[1-9]\d*)$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/** "number title", unless the title already carries the number ("Section 3"). */
function numbered(number: string, title: string): string {
  return title.split(/\s+/).includes(number) ? title : `${number} ${title}`;
}

function firstTopic(chapters: Chapter[]): string | undefined {
  for (const chapter of chapters) {
    for (const section of chapter.sections) {
      if (section.topics[0]) return section.topics[0].id;
    }
  }
  return undefined;
}

function findTopicParents(chapters: Chapter[], topicId: string) {
  for (const chapter of chapters) {
    for (const section of chapter.sections) {
      if (section.topics.some((topic) => topic.id === topicId)) {
        return { chapterId: chapter.id, sectionId: section.id };
      }
    }
  }
  return undefined;
}

function Outline({
  chapters,
  activeTopicId,
  expandedChapters,
  expandedSections,
  targetId,
  onToggleChapter,
  onToggleSection,
  onSelectTopic,
}: {
  chapters: Chapter[];
  activeTopicId: string;
  expandedChapters: Set<string>;
  expandedSections: Set<string>;
  targetId?: string;
  onToggleChapter: (id: string) => void;
  onToggleSection: (id: string) => void;
  onSelectTopic: (id: string) => void;
}) {
  return (
    <ul className="outline-chapter-list">
      {chapters.map((chapter) => {
        const chapterExpanded = expandedChapters.has(chapter.id);
        return (
          <li className="outline-chapter" key={chapter.id}>
            <button
              aria-expanded={chapterExpanded}
              className={`outline-toggle outline-toggle--chapter${targetId === chapter.id ? " content-block--targeted" : ""}`}
              id={chapter.id}
              onClick={() => onToggleChapter(chapter.id)}
              type="button"
            >
              <span aria-hidden="true" className="disclosure-indicator">
                {chapterExpanded ? "−" : "+"}
              </span>
              <span>{chapter.number} {chapter.title}</span>
            </button>
            {chapterExpanded && (
              <ul className="outline-section-list">
                {chapter.sections.map((section) => {
                  const sectionExpanded = expandedSections.has(section.id);
                  return (
                    <li className="outline-section" key={section.id}>
                      <button
                        aria-expanded={sectionExpanded}
                        className={`outline-toggle outline-toggle--section${targetId === section.id ? " content-block--targeted" : ""}`}
                        id={section.id}
                        onClick={() => onToggleSection(section.id)}
                        type="button"
                      >
                        <span aria-hidden="true" className="disclosure-indicator">
                          {sectionExpanded ? "−" : "+"}
                        </span>
                        <span>{section.number} {section.title}</span>
                      </button>
                      {sectionExpanded && (
                        <ul className="outline-topic-list">
                          {section.topics.map((topic) => (
                            <li key={topic.id}>
                              <button
                                aria-current={activeTopicId === topic.id ? "page" : undefined}
                                className={`outline-item${activeTopicId === topic.id ? " outline-item--active" : ""}`}
                                onClick={() => onSelectTopic(topic.id)}
                                type="button"
                              >
                                <span className="outline-item__title">
                                  {numbered(topic.number, topic.title)}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ApiReader() {
  const { docId = "", revision: revisionParam = "" } = useParams();
  const revision = parseRevision(revisionParam);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  // Set when the reader was opened from a search result, so the pilot can
  // go back to the same results.
  const fromSearch =
    typeof (location.state as { fromSearch?: unknown } | null)?.fromSearch === "string"
      ? (location.state as { fromSearch: string }).fromSearch
      : undefined;
  const topicIdParam = searchParams.get("topicId") ?? undefined;
  const targetNodeId = searchParams.get("nodeId") ?? undefined;
  const targetTypeParam = searchParams.get("targetType") ?? undefined;
  const requestedChapterId = searchParams.get("chapterId") ?? undefined;
  const requestedSectionId = searchParams.get("sectionId") ?? undefined;
  const [retryPage, setRetryPage] = useState(0);
  const [retryTopic, setRetryTopic] = useState(0);
  const routeKey = `${docId}/${revisionParam}`;
  const [pageData, setPageData] = useState<PageData>({
    key: "",
    status: "loading",
  });
  const [topicData, setTopicData] = useState<TopicData>({ status: "idle" });
  const [selectedTopicId, setSelectedTopicId] = useState<string>();
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(
    new Set(),
  );
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(),
  );
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [completedChecks, setCompletedChecks] = useState<Record<string, boolean>>({});
  const [highlightedTargetId, setHighlightedTargetId] = useState<string>();
  const [changesData, setChangesData] = useState<ChangesData>({ status: "none" });
  const [showChanges, setShowChanges] = useState(true);
  const [viewMode, setViewMode] = useState<"interactive" | "print">("interactive");

  useEffect(() => {
    if (!docId || revision === undefined) {
      setPageData({
        key: routeKey,
        status: "error",
        error: errorResult(
          "INVALID_REQUEST",
          "The document ID or revision in this URL is invalid.",
          400,
        ),
      });
      return;
    }

    const controller = new AbortController();
    setPageData({ key: routeKey, status: "loading" });
    setTopicData({ status: "idle" });
    setSelectedTopicId(undefined);

    void Promise.all([
      getDocumentLibraryFromApi(controller.signal),
      getRevisionNavigationFromApi(docId, revision, controller.signal),
    ]).then(([libraryResult, navigationResult]) => {
      if (controller.signal.aborted) return;
      if (!libraryResult.ok) {
        setPageData({ key: routeKey, status: "error", error: libraryResult.error });
        return;
      }
      if (!navigationResult.ok) {
        setPageData({ key: routeKey, status: "error", error: navigationResult.error });
        return;
      }

      const document = libraryResult.data.documents.find(
        (entry) => entry.id === docId,
      );
      const selectedRevision = document?.availableRevisions.find(
        (entry) => entry.revision === revision,
      );
      if (!document) {
        setPageData({
          key: routeKey,
          status: "error",
          error: errorResult("DOCUMENT_NOT_FOUND", "The document does not exist."),
        });
        return;
      }
      if (!selectedRevision) {
        setPageData({
          key: routeKey,
          status: "error",
          error: errorResult(
            "REVISION_NOT_FOUND",
            "The revision is not available for this document.",
          ),
        });
        return;
      }
      if (
        navigationResult.data.document.id !== docId ||
        navigationResult.data.version.revision !== revision
      ) {
        setPageData({
          key: routeKey,
          status: "error",
          error: errorResult(
            "INVALID_RESPONSE",
            "The API returned a different document revision than requested.",
            502,
          ),
        });
        return;
      }

      setPageData({
        key: routeKey,
        status: "ready",
        navigation: navigationResult.data,
        revisions: document.availableRevisions,
      });
    });

    return () => controller.abort();
  }, [docId, routeKey, revision, retryPage]);

  const navigation =
    pageData.key === routeKey && pageData.status === "ready"
      ? pageData.navigation
      : undefined;

  useEffect(() => {
    if (!navigation) return;
    const defaultTopicId = firstTopic(navigation.chapters);
    const nextTopicId = topicIdParam ?? defaultTopicId;

    const parents = nextTopicId
      ? findTopicParents(navigation.chapters, nextTopicId)
      : undefined;
    if (nextTopicId && !parents) {
      setSelectedTopicId(undefined);
      setTopicData({
        status: "error",
        error: errorResult(
          "NODE_NOT_FOUND",
          "The selected topic is not available in this document revision.",
        ),
      });
      return;
    }
    if (
      (requestedChapterId && parents?.chapterId !== requestedChapterId) ||
      (requestedSectionId && parents?.sectionId !== requestedSectionId) ||
      (targetTypeParam === "chapter" && targetNodeId !== requestedChapterId) ||
      (targetTypeParam === "section" && targetNodeId !== requestedSectionId) ||
      (targetTypeParam === "topic" && targetNodeId !== nextTopicId)
    ) {
      setSelectedTopicId(undefined);
      setTopicData({
        status: "error",
        error: errorResult(
          "INVALID_RESPONSE",
          "The resolved target does not match the selected outline location.",
          502,
        ),
      });
      return;
    }

    setSelectedTopicId(nextTopicId);
    const chapterId = requestedChapterId ?? parents?.chapterId;
    const sectionId = requestedSectionId ?? parents?.sectionId;
    setExpandedChapters(chapterId ? new Set([chapterId]) : new Set());
    setExpandedSections(sectionId ? new Set([sectionId]) : new Set());
    if (requestedChapterId || requestedSectionId) setNavigationOpen(true);
  }, [
    navigation,
    topicIdParam,
    requestedChapterId,
    requestedSectionId,
    targetNodeId,
    targetTypeParam,
  ]);

  useEffect(() => {
    if (!navigation || !selectedTopicId) return;
    const exists = findTopicParents(navigation.chapters, selectedTopicId);
    if (!exists) return;

    const controller = new AbortController();
    setTopicData({ status: "loading" });
    void getTopicContentFromApi(
      docId,
      navigation.version.revision,
      selectedTopicId,
      controller.signal,
    ).then((result) => {
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setTopicData({ status: "error", error: result.error });
        return;
      }

      const topic = result.data.topic;
      if (
        result.data.document.id !== docId ||
        result.data.version.revision !== navigation.version.revision ||
        topic.id !== selectedTopicId ||
        topic.chapterId !== exists.chapterId ||
        topic.sectionId !== exists.sectionId
      ) {
        setTopicData({
          status: "error",
          error: errorResult(
            "INVALID_RESPONSE",
            "The API returned topic content that does not match the selected outline.",
            502,
          ),
        });
        return;
      }

      setTopicData({ status: "ready", topic });
    });

    return () => controller.abort();
  }, [docId, navigation, selectedTopicId, retryTopic]);

  // The pilot's highlights, notes and bookmarks (private, revision-safe).
  const contentRef = useRef<HTMLDivElement>(null);
  const { annotations, statuses, checked } = useAnnotations(docId, pageData.status === "ready" ? pageData.navigation.version.revision : undefined);
  const [selection, clearSelection] = useTextSelection(contentRef);
  const [pendingNote, setPendingNote] = useState<PendingNote>();
  const [focusedAnnotation, setFocusedAnnotation] = useState<string>();
  const highlights = useMemo(
    () => (topicData.status === "ready" ? highlightsFor(topicData.topic, annotations, statuses) : undefined),
    [topicData, annotations, statuses],
  );
  const focusAnnotation = (id?: string) => {
    setFocusedAnnotation(id);
    if (!id) return;
    const mark = document.querySelector(`[data-annotation-id="${id}"]`);
    mark?.scrollIntoView?.({ block: "center" });
  };

  // Audit: which revision and topic the person had open, and how they got there.
  const loggedView = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (pageData.status !== "ready" || topicData.status !== "ready") return;
    const key = `${docId}/${pageData.navigation.version.revision}/${topicData.topic.id}/${viewMode}`;
    if (loggedView.current === key) return;
    loggedView.current = key;
    const revision = pageData.navigation.version.revision;
    const status = pageData.revisions.find((entry) => entry.revision === revision)?.status;
    void recordAudit(viewMode === "print" ? "pdf.viewed" : "document.opened", {
      documentId: docId,
      revision,
      nodeId: topicData.topic.id,
      details: {
        topicNumber: topicData.topic.number,
        topicTitle: topicData.topic.title,
        revisionStatus: status,
        via: fromSearch ? "search" : targetNodeId ? "link" : "browse",
        ...(targetNodeId && targetNodeId !== topicData.topic.id ? { target: targetNodeId } : {}),
      },
    });
  }, [docId, pageData, topicData, viewMode, fromSearch, targetNodeId]);

  const previousRevision = useMemo(() => {
    if (pageData.status !== "ready" || revision === undefined) return undefined;
    const earlier = pageData.revisions
      .map((entry) => entry.revision)
      .filter((value) => value < revision);
    return earlier.length ? Math.max(...earlier) : undefined;
  }, [pageData, revision]);

  useEffect(() => {
    if (!navigation || !selectedTopicId || previousRevision === undefined) {
      setChangesData({ status: "none" });
      return;
    }
    const controller = new AbortController();
    setChangesData({ status: "loading" });
    void getNodeChangesFromApi(
      docId,
      selectedTopicId,
      previousRevision,
      navigation.version.revision,
      controller.signal,
    ).then((result) => {
      if (controller.signal.aborted) return;
      if (
        !result.ok ||
        result.data.topicId !== selectedTopicId ||
        result.data.toRevision !== navigation.version.revision
      ) {
        setChangesData({
          status: "unavailable",
          message: "Changes since the previous revision could not be loaded.",
        });
        return;
      }
      setChangesData({ status: "ready", changes: result.data });
    });
    return () => controller.abort();
  }, [docId, navigation, selectedTopicId, previousRevision]);

  useEffect(() => {
    if (pageData.status !== "ready" || topicData.status !== "ready" || !targetNodeId) {
      return;
    }
    const targetElement = document.getElementById(targetNodeId);
    if (!targetElement) return;

    if (typeof targetElement.scrollIntoView === "function") {
      targetElement.scrollIntoView({ behavior: "auto", block: "center" });
    }
    setHighlightedTargetId(targetNodeId);
    const timeout = window.setTimeout(
      () => setHighlightedTargetId(undefined),
      2200,
    );
    return () => window.clearTimeout(timeout);
  }, [
    pageData.status,
    topicData,
    targetNodeId,
    expandedChapters,
    expandedSections,
  ]);

  const selectedOutlineTopic = useMemo(() => {
    if (!navigation || !selectedTopicId) return undefined;
    return navigation.chapters
      .flatMap((chapter) => chapter.sections)
      .flatMap((section) => section.topics)
      .find((topic) => topic.id === selectedTopicId);
  }, [navigation, selectedTopicId]);

  const toggle = (set: Set<string>, id: string, update: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };

  const selectTopic = (id: string) => {
    setSelectedTopicId(id);
    setTopicData({ status: "loading" });
    setSearchParams({}, { state: location.state });
    setHighlightedTargetId(undefined);
    setNavigationOpen(false);
  };

  const toggleCheck = (id: string) => {
    setCompletedChecks((previous) => ({ ...previous, [id]: !previous[id] }));
  };

  if (pageData.key !== routeKey || pageData.status === "loading") {
    return <LoadingState label="Loading document navigation…" />;
  }
  if (pageData.status === "error") {
    return (
      <main className="reader-error">
        <Link className="button button--secondary" to="/">Back to library</Link>
        <h1>Document unavailable</h1>
        <ApiErrorState
          error={pageData.error}
          onRetry={() => setRetryPage((value) => value + 1)}
        />
      </main>
    );
  }

  if (
    pageData.navigation.chapters.length === 0 ||
    !firstTopic(pageData.navigation.chapters)
  ) {
    return (
      <main className="reader-error">
        <Link className="button button--secondary" to="/">Back to library</Link>
        <h1>Document unavailable</h1>
        <EmptyState message="No navigation is available for this revision." />
      </main>
    );
  }

  const metadata = pageData.navigation.version.metadata;
  const changes = changesData.status === "ready" ? changesData.changes : undefined;
  const targetIsOutlineNode = pageData.navigation.chapters.some(
    (chapter) =>
      chapter.id === targetNodeId ||
      chapter.sections.some((section) => section.id === targetNodeId),
  );
  const isChapterOrSectionTarget =
    targetIsOutlineNode &&
    Boolean(requestedChapterId || requestedSectionId);

  return (
    <main className={`reader-page${navigationOpen ? " reader-page--navigation-open" : ""}`}>
      <header className="reader-toolbar">
        <Link className="reader-brand" to="/">Pilot EFB</Link>
        {fromSearch ? (
          <Link className="button button--secondary" to={fromSearch}>Back to search results</Link>
        ) : (
          <Link className="button button--secondary" to="/">Back to library</Link>
        )}
        <Link className="button button--secondary" to="/search">Search</Link>
        {pageData.navigation.version.metadata.source !== "pdf-only" && (
          <Link
            className="button button--secondary"
            to={`/author/${encodeURIComponent(docId)}${selectedTopicId ? `?topicId=${encodeURIComponent(selectedTopicId)}` : ""}`}
          >
            Edit
          </Link>
        )}
        <button
          aria-expanded={navigationOpen}
          className="button button--secondary navigation-toggle"
          onClick={() => setNavigationOpen((open) => !open)}
          type="button"
        >
          {navigationOpen ? "Close navigation" : "Open navigation"}
        </button>
      </header>
      <div className="reader-layout">
        <aside
          aria-label="Document navigation"
          className={`reader-navigation${navigationOpen ? " reader-navigation--open" : ""}`}
        >
          <div className="navigation-heading">
            <h2>Contents</h2>
            <button
              aria-label="Close navigation"
              className="icon-button navigation-close"
              onClick={() => setNavigationOpen(false)}
              type="button"
            >
              ×
            </button>
          </div>
          <p className="navigation-document">{metadata.title}</p>
          <Outline
            activeTopicId={selectedTopicId ?? ""}
            chapters={pageData.navigation.chapters}
            expandedChapters={expandedChapters}
            expandedSections={expandedSections}
            onSelectTopic={selectTopic}
            onToggleChapter={(id) =>
              toggle(expandedChapters, id, setExpandedChapters)
            }
            onToggleSection={(id) =>
              toggle(expandedSections, id, setExpandedSections)
            }
            targetId={highlightedTargetId}
          />
        </aside>
        {navigationOpen && (
          <button
            aria-label="Close navigation drawer"
            className="navigation-backdrop"
            onClick={() => setNavigationOpen(false)}
            type="button"
          />
        )}
        <section aria-label="Document content" className="reader-main">
          <div className="document-heading">
            <p className="eyebrow">{docId} · Revision {revision}</p>
            {topicData.status === "ready" ? (
              <h1
                className={highlightedTargetId === topicData.topic.id ? "content-block--targeted" : ""}
                id={topicData.topic.id}
              >
                {numbered(topicData.topic.number, topicData.topic.title)}
              </h1>
            ) : (
              <h1>
                {selectedOutlineTopic
                  ? numbered(selectedOutlineTopic.number, selectedOutlineTopic.title)
                  : metadata.title}
              </h1>
            )}
            {showChanges && changes && changes.status.includes("moved") && changes.previous && (
              <p className="topic-change-note topic-change-note--moved">
                Moved in this revision from {changes.previous.number} (
                {changes.previous.section.number} {changes.previous.section.title}).
              </p>
            )}
            {showChanges && changes && changes.status.includes("added") && (
              <p className="topic-change-note topic-change-note--added">
                New topic in Revision {changes.toRevision}.
              </p>
            )}
            {targetNodeId && !isChapterOrSectionTarget && topicData.status === "ready" &&
              targetNodeId !== topicData.topic.id &&
              !topicData.topic.blocks.some(
                (block) =>
                  block.id === targetNodeId ||
                  (block.type === "checklist" &&
                    block.checks.some((check) => check.id === targetNodeId)),
              ) && (
                <p className="target-unavailable" role="status">
                  This target is not available in the selected revision.
                </p>
              )}
            <div className="revision-details">
              <RevisionSelector
                onChange={(nextRevision) =>
                  navigate(`/reader/${encodeURIComponent(docId)}/${nextRevision}`)
                }
                revisions={pageData.revisions}
                selectedRevision={pageData.navigation.version.revision}
              />
              <span>Revision date {metadata.revisionDate}</span>
              <span>Effective date {metadata.effectiveDate}</span>
            </div>
            <div className="view-mode" role="group" aria-label="View">
              <button
                aria-pressed={viewMode === "interactive"}
                className="view-mode__option"
                onClick={() => setViewMode("interactive")}
                type="button"
              >
                Interactive
              </button>
              <button
                aria-pressed={viewMode === "print"}
                className="view-mode__option"
                onClick={() => setViewMode("print")}
                type="button"
              >
                Print view (PDF)
              </button>
            </div>
          </div>
          {topicData.status === "loading" || topicData.status === "idle" ? (
            <LoadingState label="Loading topic content…" />
          ) : topicData.status === "error" ? (
            <ApiErrorState
              error={topicData.error}
              onRetry={() => setRetryTopic((value) => value + 1)}
            />
          ) : (
            <div className="reader-body" ref={contentRef}>
              {viewMode === "print" ? (
                <Suspense fallback={<LoadingState label="Loading PDF viewer…" />}>
                  <PdfPrintView
                    changes={changes}
                    comparedRevisions={
                      changes
                        ? { from: changes.fromRevision, to: changes.toRevision }
                        : undefined
                    }
                    docId={docId}
                    revision={pageData.navigation.version.revision}
                    showChanges={showChanges}
                    targetNodeId={targetNodeId}
                    topicId={topicData.topic.id}
                  />
                </Suspense>
              ) : (
              <ContentBlocks
                changes={
                  showChanges && changes ? changes.blocks : undefined
                }
                comparedRevisions={
                  changes
                    ? { from: changes.fromRevision, to: changes.toRevision }
                    : undefined
                }
                completedChecks={completedChecks}
                dataSource="api"
                docId={docId}
                onToggleCheck={toggleCheck}
                removedTopicsAfter={
                  showChanges && changes ? changes.removedTopicsAfter : []
                }
                highlights={highlights}
                onOpenAnnotation={focusAnnotation}
                revision={pageData.navigation.version.revision}
                targetNodeId={highlightedTargetId}
                topic={topicData.topic}
              />
              )}
              <div className="reader-side">
              <RevisionRail
                changesData={changesData}
                docId={docId}
                onToggleChanges={() => setShowChanges((value) => !value)}
                approximate={metadata.source === "pdf-only"}
                previousRevision={previousRevision}
                revision={pageData.navigation.version.revision}
                showChanges={showChanges}
              />
              <AnnotationPanel
                annotations={annotations}
                checked={checked}
                docId={docId}
                focusedId={focusedAnnotation}
                onFocus={focusAnnotation}
                onPendingNoteDone={() => setPendingNote(undefined)}
                pendingNote={pendingNote}
                revision={pageData.navigation.version.revision}
                statuses={statuses}
                topic={topicData.topic}
              />
              </div>
              {selection && viewMode === "interactive" && (
                <SelectionToolbar
                  onCancel={clearSelection}
                  onHighlight={() => {
                    void saveHighlight(docId, pageData.navigation.version.revision, topicData.topic, selection);
                    clearSelection();
                  }}
                  onNote={() => {
                    setPendingNote({ selection });
                    clearSelection();
                  }}
                  selection={selection}
                />
              )}
            </div>
          )}
          <footer className="reader-footer">
            <span>{metadata.classification}</span>
            <span>
              Revision {pageData.navigation.version.revision} · Revision date {metadata.revisionDate} ·
              Effective date {metadata.effectiveDate}
            </span>
          </footer>
        </section>
      </div>
    </main>
  );
}

function RevisionRail({
  approximate,
  changesData,
  docId,
  previousRevision,
  revision,
  showChanges,
  onToggleChanges,
}: {
  /** Changes found by comparing PDF text, not by client IDs. */
  approximate: boolean;
  changesData: ChangesData;
  docId: string;
  previousRevision?: number;
  revision: number;
  showChanges: boolean;
  onToggleChanges: () => void;
}) {
  let summary: string;
  let count = 0;
  if (previousRevision === undefined) {
    summary = "This is the earliest revision available, so there is nothing to compare with.";
  } else if (changesData.status === "ready") {
    const changes = changesData.changes;
    count =
      changes.blocks.filter((block) => block.status !== "unchanged").length +
      changes.removedTopicsAfter.length +
      (changes.status.includes("moved") ? 1 : 0);
    summary =
      count === 0
        ? `No changes in this topic since Revision ${previousRevision}.`
        : `${count} ${count === 1 ? "change" : "changes"} in this topic since Revision ${previousRevision}. Select a change badge to compare in place.`;
  } else if (changesData.status === "unavailable") {
    summary = changesData.message;
  } else {
    summary = "Checking for changes…";
  }

  return (
    <aside aria-label="Revision" className="reader-context">
      <h2 className="reader-context__heading">
        Revision <span className="reader-context__count">{count || ""}</span>
      </h2>
      {approximate && (
        <p className="reader-context__approximate">
          PDF-only document: changes are found by comparing the text of the two PDFs, so they are
          approximate. A heavily rewritten paragraph shows as removed and added.
        </p>
      )}
      <p>{summary}</p>
      {previousRevision !== undefined && (
        <div className="reader-context__actions">
          <button className="text-button" onClick={onToggleChanges} type="button">
            {showChanges ? "Hide change bars" : "Show change bars"}
          </button>
          <Link
            to={`/compare/${encodeURIComponent(docId)}?from=${previousRevision}&to=${revision}`}
          >
            Compare with previous
          </Link>
        </div>
      )}
    </aside>
  );
}
