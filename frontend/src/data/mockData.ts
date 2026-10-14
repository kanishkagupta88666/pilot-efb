import provisionalSample from "../../../contracts/provisional-sample.json";
import type {
  Chapter,
  DocumentLibraryResponse,
  DocumentSummary,
  RevisionNavigationResponse,
  Section,
  TableBlock,
  Topic,
  TopicContentResponse,
} from "../types/api";

export type TopicContent = TopicContentResponse["topic"] & { mock?: true };
export type TopicResponse = Omit<TopicContentResponse, "topic"> & {
  topic: TopicContent;
};

export type MockTopicOutline = Topic & { mock?: true };
export type MockSectionOutline = Omit<Section, "topics"> & {
  topics: MockTopicOutline[];
  mock?: true;
};
export type MockChapterOutline = Omit<Chapter, "sections"> & {
  sections: MockSectionOutline[];
  mock?: true;
};
export type MockNavigationResponse = Omit<
  RevisionNavigationResponse,
  "chapters"
> & {
  chapters: MockChapterOutline[];
};

interface ProvisionalSample {
  documentLibraryExample: DocumentLibraryResponse;
  navigationExample: RevisionNavigationResponse;
  topicContentExample: TopicContentResponse;
  tableExample: {
    sourceTopic: {
      chapterId: string;
      sectionId: string;
      topicId: string;
      number: string;
      title: string;
    };
    block: TableBlock;
  };
}

const sample = provisionalSample as ProvisionalSample;
const tableExample = sample.tableExample;

const mockTableTopic: TopicContent = {
  id: tableExample.sourceTopic.topicId,
  number: tableExample.sourceTopic.number,
  title: tableExample.sourceTopic.title,
  chapterId: tableExample.sourceTopic.chapterId,
  sectionId: tableExample.sourceTopic.sectionId,
  blocks: [tableExample.block],
  mock: true,
};

const mockTableChapter: MockChapterOutline = {
  id: tableExample.sourceTopic.chapterId,
  number: "MOCK",
  title: "Examples",
  mock: true,
  sections: [
    {
      id: tableExample.sourceTopic.sectionId,
      number: "MOCK",
      title: "Table renderer example",
      mock: true,
      topics: [
        {
          id: tableExample.sourceTopic.topicId,
          number: tableExample.sourceTopic.number,
          title: tableExample.sourceTopic.title,
          mock: true,
        },
      ],
    },
  ],
};

function assertSelectedVersion(docId: string, revision: number) {
  const document = sample.documentLibraryExample.documents.find(
    (entry) => entry.id === docId,
  );
  const available = document?.availableRevisions.some(
    (entry) => entry.revision === revision,
  );

  if (!document || !available) {
    throw new Error(`Document revision ${docId} revision ${revision} is unavailable.`);
  }
}

export function getDocumentLibrary(): DocumentSummary[] {
  return sample.documentLibraryExample.documents;
}

export function getNavigationTree(
  docId: string,
  revision: number,
): MockNavigationResponse {
  assertSelectedVersion(docId, revision);
  const navigation = sample.navigationExample;

  return {
    ...navigation,
    chapters: [...navigation.chapters, mockTableChapter],
  };
}

export function getTopic(
  docId: string,
  revision: number,
  topicId: string,
): TopicResponse {
  assertSelectedVersion(docId, revision);

  if (topicId === sample.topicContentExample.topic.id) {
    return sample.topicContentExample;
  }

  if (topicId === mockTableTopic.id) {
    return {
      document: sample.topicContentExample.document,
      version: sample.topicContentExample.version,
      topic: mockTableTopic,
    };
  }

  throw new Error(`Topic ${topicId} is unavailable in this prototype.`);
}

export function resolveAvailableTargetId(
  docId: string,
  revision: number,
  targetId: string,
): { topicId: string; targetNodeId?: string } | undefined {
  assertSelectedVersion(docId, revision);

  const availableTopics = [
    sample.topicContentExample.topic,
    mockTableTopic,
  ];

  for (const topic of availableTopics) {
    if (topic.id === targetId) {
      return { topicId: topic.id };
    }

    for (const block of topic.blocks) {
      if (block.id === targetId) {
        return { topicId: topic.id, targetNodeId: targetId };
      }

      if (
        block.type === "checklist" &&
        block.checks.some((check) => check.id === targetId)
      ) {
        return { topicId: topic.id, targetNodeId: targetId };
      }
    }
  }

  return undefined;
}
