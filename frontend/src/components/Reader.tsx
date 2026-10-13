import { useEffect, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  getDocumentLibrary,
  getNavigationTree,
  getTopic,
  resolveAvailableTargetId,
  type MockChapterOutline,
} from "../data/mockData";
import { DATA_SOURCE } from "../config/dataSource";
import type { DocumentRevision } from "../types/api";
import { ApiReader } from "./ApiReader";
import { ContentBlocks } from "./ContentBlocks";
import { Outline, topicTrail } from "./Outline";
import { ReaderLayout } from "./ReaderLayout";
import { RevisionSelector } from "./RevisionSelector";

function firstTopicId(chapters: MockChapterOutline[]): string {
  for (const chapter of chapters) {
    for (const section of chapter.sections) {
      if (section.topics[0]) {
        return section.topics[0].id;
      }
    }
  }
  return "";
}

function MockReader() {
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
      availableRevisions={pageData.document.availableRevisions}
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
  availableRevisions,
  revision,
  setSearchParams,
  title,
}: {
  docId: string;
  navigation: ReturnType<typeof getNavigationTree>;
  requestedTargetId?: string;
  availableRevisions: DocumentRevision[];
  revision: number;
  setSearchParams: ReturnType<typeof useSearchParams>[1];
  title: string;
}) {
  const navigate = useNavigate();
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
    <ReaderLayout
      breadcrumbs={[
        navigation.document.docType,
        ...topicTrail(navigation.chapters, selectedTopicId),
      ]}
      detail={`${docId} · Revision ${revision}`}
      navigationOpen={navigationOpen}
      onNavigationOpenChange={setNavigationOpen}
      outline={
        <Outline
          activeTopicId={selectedTopicId}
          chapters={navigation.chapters}
          expandedChapters={expandedChapters}
          expandedSections={expandedSections}
          onSelectTopic={selectTopic}
          onToggleChapter={onToggleChapter}
          onToggleSection={onToggleSection}
        />
      }
      title={title}
    >
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
          <RevisionSelector
            onChange={(nextRevision) =>
              navigate(`/reader/${encodeURIComponent(docId)}/${nextRevision}`)
            }
            revisions={availableRevisions}
            selectedRevision={revision}
          />
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
    </ReaderLayout>
  );
}

export function Reader() {
  return DATA_SOURCE === "api" ? <ApiReader /> : <MockReader />;
}
