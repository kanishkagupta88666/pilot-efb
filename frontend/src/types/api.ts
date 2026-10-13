export type RevisionStatus = "current" | "upcoming" | "superseded";

export interface DocumentMetadata {
  docId: string;
  title: string;
  /** Duplicates document.docType; the contract lists equality as unresolved. */
  docType: string;
  applicability: string;
  revision: number;
  /** ISO date YYYY-MM-DD: date of the revision, not when it takes effect. */
  revisionDate: string;
  /** ISO date YYYY-MM-DD: date this revision takes effect. */
  effectiveDate: string;
  owner: string;
  changeSummary: string;
  classification: string;
}

export interface DocumentRevision {
  revision: number;
  revisionDate: string;
  effectiveDate: string;
  /** Required by the provisional shape; the API-derived status is authoritative and is not recomputed by the client. */
  status: RevisionStatus;
  metadata: DocumentMetadata;
}

export interface DocumentSummary {
  id: string;
  namespace: string;
  docType: string;
  availableRevisions: DocumentRevision[];
}

export interface DocumentLibraryResponse {
  documents: DocumentSummary[];
}

export interface DocumentIdentity {
  id: string;
  namespace: string;
  /** Duplicates version metadata.docType; equality policy is unresolved. */
  docType: string;
}

export interface TextSegment {
  type: "text";
  /**
   * XML mixed-content whitespace normalization is unresolved. Preserve the
   * supplied string unchanged; retain segment order.
   */
  text: string;
}

export interface XrefSegment {
  type: "xref";
  /** Original xref/@target permanent ID; cross-document reference policy is unresolved. */
  targetId: string;
  text: string;
}

export type ContentSegment = TextSegment | XrefSegment;

export interface TextBlock {
  type: "para" | "note" | "caution" | "warning";
  id: string;
  segments: ContentSegment[];
}

export interface ListBlock {
  type: "list";
  id: string;
  items: string[];
}

export interface TableRow {
  /**
   * Omitted when source row has no header attribute; not equivalent to false.
   */
  header?: boolean;
  cells: string[];
}

export interface TableBlock {
  type: "table";
  id: string;
  rows: TableRow[];
}

export interface ChecklistCheck {
  id: string;
  challenge: string;
  response: string;
}

export interface ChecklistBlock {
  type: "checklist";
  id: string;
  checks: ChecklistCheck[];
}

export type ContentBlock =
  | TextBlock
  | ListBlock
  | TableBlock
  | ChecklistBlock;

export interface Topic {
  id: string;
  number: string;
  title: string;
}

export interface Section {
  id: string;
  number: string;
  title: string;
  topics: Topic[];
}

export interface Chapter {
  id: string;
  number: string;
  title: string;
  sections: Section[];
}

export interface RevisionNavigationResponse {
  document: DocumentIdentity;
  version: {
    revision: number;
    metadata: DocumentMetadata;
  };
  chapters: Chapter[];
}

export interface TopicContentResponse {
  document: DocumentIdentity;
  version: {
    revision: number;
    revisionDate: string;
    effectiveDate: string;
  };
  topic: Topic & {
    chapterId: string;
    sectionId: string;
    blocks: ContentBlock[];
  };
}

export type ResolvedNodeType =
  | "topic"
  | "para"
  | "note"
  | "caution"
  | "warning"
  | "list"
  | "table"
  | "checklist"
  | "check"
  | "chapter"
  | "section";

export interface ResolveNodeResponse {
  documentId: string;
  selectedRevision: number;
  chapterId: string;
  sectionId: string;
  topicId: string;
  targetNodeId: string;
  targetType: ResolvedNodeType;
  topic: Topic;
}

/** Change status of a topic or block between two revisions, by permanent ID. */
export type ChangeStatus = "unchanged" | "modified" | "added" | "removed" | "moved";

export interface DiffRun {
  op: "equal" | "insert" | "delete";
  text: string;
}

export interface BlockChange {
  id: string;
  type: ContentBlock["type"];
  status: Exclude<ChangeStatus, "moved">;
  previous: ContentBlock | null;
  current: ContentBlock | null;
  /** Word-level runs, present only for modified blocks. */
  diff?: DiffRun[];
}

export interface ChangedTopicRef {
  id: string;
  number: string;
  title: string;
  section: { id: string; number: string; title: string };
  chapterId: string;
}

export interface RemovedTopicChange extends ChangedTopicRef {
  status: ChangeStatus[];
  blocks: BlockChange[];
}

export interface NodeChangesResponse {
  docId: string;
  fromRevision: number;
  toRevision: number;
  nodeId: string;
  topicId: string;
  status: ChangeStatus[];
  previous: ChangedTopicRef | null;
  current: ChangedTopicRef | null;
  blocks: BlockChange[];
  /** Topics of the same section removed right after this topic. */
  removedTopicsAfter: RemovedTopicChange[];
}

export interface ManifestTopic {
  id: string;
  number: string;
  title: string;
  sectionId: string;
  chapterId: string;
  /** Present on moved topics. */
  from?: string;
  to?: string;
  fromSectionId?: string;
}

export interface RevisionChangesResponse {
  docId: string;
  fromRevision: number;
  toRevision: number;
  summary: Record<"modified" | "added" | "removed" | "moved", number>;
  topics: Record<"modified" | "added" | "removed" | "moved", ManifestTopic[]>;
  blocks: Record<"modified" | "added" | "removed", string[]>;
}

export interface PdfOutlineResponse {
  documentId: string;
  revision: number;
  pageCount: number;
  /** Node ID -> first and last PDF page (1-based) of its outline entry, in document order. */
  nodes: Record<string, { page: number; endPage: number; heading: string }>;
  unmatched: string[];
}
