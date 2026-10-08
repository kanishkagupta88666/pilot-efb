import { useEffect, useState } from "react";
import {
  Link,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  getDocumentLibrary,
  getNavigationTree,
  getTopic,
  resolveAvailableTargetId,
  type ChapterOutline,
  type SectionOutline,
  type TopicOutline,
} from "../data/mockData";
import { ContentBlocks } from "./ContentBlocks";

function OutlineTopic({
  topic,
  active,
  onSelect,
}: {
  topic: TopicOutline;
  active: boolean;
  onSelect: (topicId: string) => void;
}) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={`outline-item${active ? " outline-item--active" : ""}`}
      onClick={() => onSelect(topic.id)}
      type="button"
    >
      <span className="outline-item__title">
        <span>{topic.number} {topic.title}</span>
        {topic.mock && <span className="mock-badge">MOCK</span>}
      </span>
    </button>
  );
}

function OutlineSection({
  section,
  activeTopicId,
  expanded,
  onToggle,
  onSelectTopic,
}: {
  section: SectionOutline;
  activeTopicId: string;
  expanded: boolean;
  onToggle: (sectionId: string) => void;
  onSelectTopic: (topicId: string) => void;
}) {
  return (
    <li className="outline-section" key={section.id}>
      <button
        aria-expanded={expanded}
        className="outline-toggle outline-toggle--section"
        onClick={() => onToggle(section.id)}
        type="button"
      >
        <span aria-hidden="true" className="disclosure-indicator">
          {expanded ? "−" : "+"}
        </span>
        <span>{section.number} {section.title}</span>
        {section.mock && <span className="mock-badge">MOCK</span>}
      </button>
      {expanded && (
        <ul className="outline-topic-list">
          {section.topics.map((topic) => (
            <li key={topic.id}>
              <OutlineTopic
                active={activeTopicId === topic.id}
                onSelect={onSelectTopic}
                topic={topic}
              />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function OutlineChapter({
  chapter,
  activeTopicId,
  expanded,
  expandedSections,
  onToggleChapter,
  onToggleSection,
  onSelectTopic,
}: {
  chapter: ChapterOutline;
  activeTopicId: string;
  expanded: boolean;
  expandedSections: Set<string>;
  onToggleChapter: (chapterId: string) => void;
  onToggleSection: (sectionId: string) => void;
  onSelectTopic: (topicId: string) => void;
}) {
  return (
    <li className="outline-chapter" key={chapter.id}>
      <button
        aria-expanded={expanded}
        className="outline-toggle outline-toggle--chapter"
        onClick={() => onToggleChapter(chapter.id)}
        type="button"
      >
        <span aria-hidden="true" className="disclosure-indicator">
          {expanded ? "−" : "+"}
        </span>
        <span>{chapter.number} {chapter.title}</span>
        {chapter.mock && <span className="mock-badge">MOCK</span>}
      </button>
      {expanded && (
        <ul className="outline-section-list">
          {chapter.sections.map((section) => (
            <OutlineSection
              activeTopicId={activeTopicId}
              expanded={expandedSections.has(section.id)}
              key={section.id}
              onSelectTopic={onSelectTopic}
              onToggle={onToggleSection}
              section={section}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function firstTopicId(chapters: ChapterOutline[]): string {
  for (const chapter of chapters) {
    for (const section of chapter.sections) {
      if (section.topics[0]) {
        return section.topics[0].id;
      }
    }
  }
  return "";
}

export function Reader() {
  const { docId = "", revision: revisionParam = "" } = useParams();
  const revision = Number(revisionParam);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTargetId = searchParams.get("nodeId") ?? undefined;

  const pageData = (() => {
    try {
      const document = getDocumentLibrary().find((item) => item.id === docId);
      if (!Number.isInteger(revision)) {
        throw new Error("The selected revision is invalid.");
      }
      const navigation = getNavigationTree(docId, revision);
      return {
        document,
        navigation,
        error: undefined,
      };
    } catch (error) {
      return {
        document: undefined,
        navigation: undefined,
        error: error instanceof Error ? error.message : "Unable to load this revision.",
      };
    }
  })();

  if (pageData.error || !pageData.document || !pageData.navigation) {
    return (
      <main className="reader-error">
        <Link className="text-link" to="/">Back to document library</Link>
        <h1>Document unavailable</h1>
        <p role="alert">{pageData.error ?? "This document revision is unavailable."}</p>
      </main>
    );
  }

  return (
    <ReaderWorkspace
      docId={docId}
      navigation={pageData.navigation}
      requestedTargetId={requestedTargetId}
      revision={revision}
      setSearchParams={setSearchParams}
      title={pageData.document.availableRevisions.find(
        (entry) => entry.revision === revision,
      )?.metadata.title ?? docId}
    />
  );
}

function ReaderWorkspace({
  docId,
  navigation,
  requestedTargetId,
  revision,
  setSearchParams,
  title,
}: {
  docId: string;
  navigation: ReturnType<typeof getNavigationTree>;
  requestedTargetId?: string;
  revision: number;
  setSearchParams: ReturnType<typeof useSearchParams>[1];
  title: string;
}) {
  const resolution = requestedTargetId
    ? resolveAvailableTargetId(docId, revision, requestedTargetId)
    : undefined;
  const [selectedTopicId, setSelectedTopicId] = useState(
    () => resolution?.topicId ?? firstTopicId(navigation.chapters),
  );
  const [expandedChapters, setExpandedChapters] = useState(
    () => new Set(navigation.chapters.slice(0, 1).map((chapter) => chapter.id)),
  );
  const [expandedSections, setExpandedSections] = useState(
    () =>
      new Set(
        navigation.chapters
          .slice(0, 1)
          .flatMap((chapter) => chapter.sections.slice(0, 1))
          .map((section) => section.id),
      ),
  );
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [completedChecks, setCompletedChecks] = useState<Record<string, boolean>>({});
  const [highlightedTargetId, setHighlightedTargetId] = useState<string>();
  const targetNodeId = resolution?.targetNodeId;
  const topicResponse = getTopic(docId, revision, selectedTopicId);
  const metadata = navigation.version.metadata;

  useEffect(() => {
    if (!resolution) {
      return;
    }

    setSelectedTopicId(resolution.topicId);
    for (const chapter of navigation.chapters) {
      const matchingSection = chapter.sections.find((section) =>
        section.topics.some((topic) => topic.id === resolution.topicId),
      );
      if (matchingSection) {
        setExpandedChapters((previous) => new Set(previous).add(chapter.id));
        setExpandedSections((previous) => new Set(previous).add(matchingSection.id));
        break;
      }
    }
  }, [navigation.chapters, resolution?.topicId]);

  useEffect(() => {
    if (!targetNodeId) {
      return;
    }

    const targetElement = document.getElementById(targetNodeId);
    if (!targetElement) {
      return;
    }

    targetElement.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedTargetId(targetNodeId);
    const timeout = window.setTimeout(() => setHighlightedTargetId(undefined), 2200);
    return () => window.clearTimeout(timeout);
  }, [targetNodeId, topicResponse.topic.id]);

  const onToggleChapter = (chapterId: string) => {
    setExpandedChapters((previous) => {
      const next = new Set(previous);
      if (next.has(chapterId)) next.delete(chapterId);
      else next.add(chapterId);
      return next;
    });
  };

  const onToggleSection = (sectionId: string) => {
    setExpandedSections((previous) => {
      const next = new Set(previous);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };

  const selectTopic = (topicId: string) => {
    setSelectedTopicId(topicId);
    setSearchParams({});
    setHighlightedTargetId(undefined);
    setNavigationOpen(false);
  };

  const toggleCheck = (checkId: string) => {
    setCompletedChecks((previous) => ({
      ...previous,
      [checkId]: !previous[checkId],
    }));
  };

  const selectedOutline = navigation.chapters
    .flatMap((chapter) => chapter.sections)
    .flatMap((section) => section.topics)
    .find((topic) => topic.id === selectedTopicId);

  return (
    <main className={`reader-page${navigationOpen ? " reader-page--navigation-open" : ""}`}>
      <header className="reader-toolbar">
        <Link className="reader-brand" to="/">Pilot EFB</Link>
        <Link className="button button--secondary" to="/">
          Back to library
        </Link>
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
          <p className="navigation-document">{title}</p>
          <ul className="outline-chapter-list">
            {navigation.chapters.map((chapter) => (
              <OutlineChapter
                activeTopicId={selectedTopicId}
                chapter={chapter}
                expanded={expandedChapters.has(chapter.id)}
                expandedSections={expandedSections}
                key={chapter.id}
                onSelectTopic={selectTopic}
                onToggleChapter={onToggleChapter}
                onToggleSection={onToggleSection}
              />
            ))}
          </ul>
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
            <h1>{topicResponse.topic.number} {topicResponse.topic.title}</h1>
            {topicResponse.topic.mock && (
              <span className="mock-badge mock-badge--large">Mock table example</span>
            )}
            {requestedTargetId && !resolution && (
              <p className="target-unavailable" role="status">
                This target is not available in this prototype.
              </p>
            )}
            <div className="revision-details">
              <span>Revision {revision}</span>
              <span>Revision date {metadata.revisionDate}</span>
              <span>Effective date {metadata.effectiveDate}</span>
            </div>
          </div>
          {selectedOutline?.mock && (
            <p className="mock-notice">
              MOCK — separate table example from the provisional contract.
            </p>
          )}
          <ContentBlocks
            completedChecks={completedChecks}
            docId={docId}
            onToggleCheck={toggleCheck}
            revision={revision}
            targetNodeId={highlightedTargetId}
            topic={topicResponse.topic}
          />
          <footer className="reader-footer">
            <span>{metadata.classification}</span>
            <span>
              Revision {revision} · Revision date {metadata.revisionDate} ·
              Effective date {metadata.effectiveDate}
            </span>
          </footer>
        </section>
      </div>
    </main>
  );
}
