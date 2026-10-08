import provisionalSample from "../../../contracts/provisional-sample.json";

export interface Metadata {
  docId: string;
  title: string;
  docType: string;
  applicability: string;
  revision: number;
  revisionDate: string;
  effectiveDate: string;
  owner: string;
  changeSummary: string;
  classification: string;
}

export interface TopicOutline {
  id: string;
  number: string;
  title: string;
  mock?: boolean;
}

export interface SectionOutline {
  id: string;
  number: string;
  title: string;
  topics: TopicOutline[];
  mock?: boolean;
}

export interface ChapterOutline {
  id: string;
  number: string;
  title: string;
  sections: SectionOutline[];
  mock?: boolean;
}

interface TextSegment {
  type: "text";
  text: string;
}

interface XrefSegment {
  type: "xref";
  targetId: string;
  text: string;
}

type Segment = TextSegment | XrefSegment;

interface TextBlock {
  type: "para" | "note" | "caution" | "warning";
  id: string;
  segments: Segment[];
}

interface ListBlock {
  type: "list";
  id: string;
  items: string[];
}

interface TableBlock {
  type: "table";
  id: string;
  rows: Array<{ header?: boolean; cells: string[] }>;
}

interface ChecklistBlock {
  type: "checklist";
  id: string;
  checks: Array<{ id: string; challenge: string; response: string }>;
}

export type ContentBlock =
  | TextBlock
  | ListBlock
  | TableBlock
  | ChecklistBlock;

export interface TopicContent {
  id: string;
  number: string;
  title: string;
  chapterId: string;
  sectionId: string;
  blocks: ContentBlock[];
  mock?: boolean;
}

export interface TopicResponse {
  document: { id: string; namespace: string; docType: string };
  version: { revision: number; revisionDate: string; effectiveDate: string };
  topic: TopicContent;
}

export interface LibraryDocument {
  id: string;
  namespace: string;
  docType: string;
  availableRevisions: Array<{
    revision: number;
    revisionDate: string;
    effectiveDate: string;
    status: string;
    metadata: Metadata;
  }>;
}

export interface NavigationResponse {
  document: { id: string; namespace: string; docType: string };
  version: { revision: number; metadata: Metadata };
  chapters: ChapterOutline[];
}

interface ProvisionalSample {
  documentLibraryExample: { documents: LibraryDocument[] };
  navigationExample: NavigationResponse;
  topicContentExample: TopicResponse;
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
  ...tableExample.sourceTopic,
  blocks: [tableExample.block],
  mock: true,
};

const mockTableChapter: ChapterOutline = {
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

export function getDocumentLibrary(): LibraryDocument[] {
  return sample.documentLibraryExample.documents;
}

export function getNavigationTree(
  docId: string,
  revision: number,
): NavigationResponse {
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
