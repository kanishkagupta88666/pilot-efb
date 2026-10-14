import { API_BASE_URL } from "../config/dataSource";
import type {
  Chapter,
  ContentBlock,
  DocumentLibraryResponse,
  DocumentMetadata,
  DocumentRevision,
  DocumentSummary,
  DraftResponse,
  EditableBlockType,
  NodeChangesResponse,
  PdfOutlineResponse,
  PublishResponse,
  SearchFilters,
  SearchIndexResponse,
  SearchResponse,
  ResolveNodeResponse,
  ResolvedNodeType,
  RevisionChangesResponse,
  RevisionNavigationResponse,
  RevisionStatus,
  TopicContentResponse,
} from "../types/api";

export interface ApiClientError {
  kind:
    | "network"
    | "non-json"
    | "invalid-json"
    | "invalid-response"
    | "http"
    | "aborted";
  message: string;
  code: string;
  status?: number;
  details?: Record<string, unknown>;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiClientError };

type ShapeGuard<T> = (value: unknown) => value is T;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isDate(value: unknown): value is string {
  return isString(value) && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isMetadata(value: unknown): value is DocumentMetadata {
  return (
    isRecord(value) &&
    isString(value.docId) &&
    isString(value.title) &&
    isString(value.docType) &&
    isString(value.applicability) &&
    isInteger(value.revision) &&
    isDate(value.revisionDate) &&
    isDate(value.effectiveDate) &&
    isString(value.owner) &&
    isString(value.changeSummary) &&
    isString(value.classification)
  );
}

function isRevisionStatus(value: unknown): value is RevisionStatus {
  return value === "current" || value === "upcoming" || value === "superseded";
}

function isDocumentRevision(value: unknown): value is DocumentRevision {
  return (
    isRecord(value) &&
    isInteger(value.revision) &&
    isDate(value.revisionDate) &&
    isDate(value.effectiveDate) &&
    isRevisionStatus(value.status) &&
    isMetadata(value.metadata)
  );
}

function isDocumentSummary(value: unknown): value is DocumentSummary {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.namespace) &&
    isString(value.docType) &&
    Array.isArray(value.availableRevisions) &&
    value.availableRevisions.every(isDocumentRevision)
  );
}

function isLibraryResponse(value: unknown): value is DocumentLibraryResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.documents) &&
    value.documents.every(isDocumentSummary)
  );
}

function isContentBlock(value: unknown): value is ContentBlock {
  if (!isRecord(value) || !isString(value.id) || !isString(value.type)) {
    return false;
  }

  switch (value.type) {
    case "para":
    case "note":
    case "caution":
    case "warning":
      return (
        Array.isArray(value.segments) &&
        value.segments.every(
          (segment: unknown) =>
            isRecord(segment) &&
            (segment.type === "text"
              ? isString(segment.text)
              : segment.type === "xref" &&
                isString(segment.targetId) &&
                isString(segment.text)),
        )
      );
    case "list":
      return Array.isArray(value.items) && value.items.every(isString);
    case "table":
      return (
        Array.isArray(value.rows) &&
        value.rows.every(
          (row: unknown) =>
            isRecord(row) &&
            (row.header === undefined || typeof row.header === "boolean") &&
            Array.isArray(row.cells) &&
            row.cells.every(isString),
        )
      );
    case "checklist":
      return (
        Array.isArray(value.checks) &&
        value.checks.every(
          (check: unknown) =>
            isRecord(check) &&
            isString(check.id) &&
            isString(check.challenge) &&
            isString(check.response),
        )
      );
    default:
      return false;
  }
}

function isTopicOutline(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.number) &&
    isString(value.title)
  );
}

function isChapter(value: unknown): value is Chapter {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.number) &&
    isString(value.title) &&
    Array.isArray(value.sections) &&
    value.sections.every(
      (section: unknown) =>
        isRecord(section) &&
        isString(section.id) &&
        isString(section.number) &&
        isString(section.title) &&
        Array.isArray(section.topics) &&
        section.topics.every(isTopicOutline),
    )
  );
}

function isIdentity(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.namespace) &&
    isString(value.docType)
  );
}

function isNavigationResponse(
  value: unknown,
): value is RevisionNavigationResponse {
  return (
    isRecord(value) &&
    isIdentity(value.document) &&
    isRecord(value.version) &&
    isInteger(value.version.revision) &&
    isMetadata(value.version.metadata) &&
    Array.isArray(value.chapters) &&
    value.chapters.every(isChapter)
  );
}

function isTopicResponse(value: unknown): value is TopicContentResponse {
  if (
    !isRecord(value) ||
    !isIdentity(value.document) ||
    !isRecord(value.version) ||
    !isInteger(value.version.revision) ||
    !isDate(value.version.revisionDate) ||
    !isDate(value.version.effectiveDate) ||
    !isRecord(value.topic)
  ) {
    return false;
  }

  const topic = value.topic;
  return (
    isString(topic.id) &&
    isString(topic.number) &&
    isString(topic.title) &&
    isString(topic.chapterId) &&
    isString(topic.sectionId) &&
    Array.isArray(topic.blocks) &&
    topic.blocks.every(isContentBlock)
  );
}

const resolvedNodeTypes: ResolvedNodeType[] = [
  "topic",
  "para",
  "note",
  "caution",
  "warning",
  "list",
  "table",
  "checklist",
  "check",
  "chapter",
  "section",
];

function isResolvedNodeType(value: unknown): value is ResolvedNodeType {
  return (
    typeof value === "string" &&
    resolvedNodeTypes.some((nodeType) => nodeType === value)
  );
}

function isResolveNodeResponse(value: unknown): value is ResolveNodeResponse {
  if (
    isRecord(value) &&
    isString(value.documentId) &&
    isInteger(value.selectedRevision) &&
    isString(value.chapterId) &&
    isString(value.sectionId) &&
    isString(value.topicId) &&
    isString(value.targetNodeId) &&
    isResolvedNodeType(value.targetType) &&
    isRecord(value.topic) &&
    isString(value.topic.id) &&
    isString(value.topic.number) &&
    isString(value.topic.title)
  ) {
    if (value.topic.id !== value.topicId) return false;
    if (value.targetType === "topic" && value.targetNodeId !== value.topicId) {
      return false;
    }
    if (
      value.targetType === "chapter" &&
      value.targetNodeId !== value.chapterId
    ) {
      return false;
    }
    if (
      value.targetType === "section" &&
      value.targetNodeId !== value.sectionId
    ) {
      return false;
    }
    return true;
  }
  return false;
}

function isContractError(
  value: unknown,
): value is {
  error: { code: string; message: string; details?: Record<string, unknown> };
} {
  return (
    isRecord(value) &&
    isRecord(value.error) &&
    isString(value.error.code) &&
    isString(value.error.message) &&
    (value.error.details === undefined || isRecord(value.error.details))
  );
}

async function request<T>(
  path: string,
  guard: ShapeGuard<T>,
  signal?: AbortSignal,
  write?: { method: "POST" | "PATCH" | "DELETE"; body?: unknown },
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    const options: RequestInit = { headers: { Accept: "application/json" } };
    if (write) {
      options.method = write.method;
      if (write.body !== undefined) {
        options.headers = { Accept: "application/json", "Content-Type": "application/json" };
        options.body = JSON.stringify(write.body);
      }
    }
    if (signal) options.signal = signal;
    response = await fetch(`${API_BASE_URL}${path}`, options);
    if (write && response.status === 204) {
      // Nothing to read: a successful delete.
      return guard(undefined) ? { ok: true, data: undefined as T } : {
        ok: false,
        error: { kind: "invalid-response", code: "INVALID_RESPONSE", message: "Unexpected empty response.", status: 204 },
      };
    }
  } catch {
    if (signal?.aborted) {
      return {
        ok: false,
        error: {
          kind: "aborted",
          code: "REQUEST_ABORTED",
          message: "The request was cancelled.",
        },
      };
    }
    return {
      ok: false,
      error: {
        kind: "network",
        code: "NETWORK_ERROR",
        message: "Unable to reach the API.",
      },
    };
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!/(?:application\/json|[+\/]json)(?:\s*;|$)/i.test(contentType)) {
    return {
      ok: false,
      error: {
        kind: "non-json",
        code: "NON_JSON_RESPONSE",
        message: `The API returned a non-JSON response (HTTP ${response.status}).`,
        status: response.status,
      },
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      ok: false,
      error: {
        kind: "invalid-json",
        code: "INVALID_JSON",
        message: "The API response body contains invalid JSON.",
        status: response.status,
      },
    };
  }

  if (!response.ok) {
    if (!isContractError(payload)) {
      return {
        ok: false,
        error: {
          kind: "invalid-response",
          code: "INVALID_ERROR_RESPONSE",
          message: "The API error response does not match the contract.",
          status: response.status,
        },
      };
    }
    return {
      ok: false,
      error: {
        kind: "http",
        code: payload.error.code,
        message: payload.error.message,
        status: response.status,
        details: payload.error.details,
      },
    };
  }

  if (!guard(payload)) {
    return {
      ok: false,
      error: {
        kind: "invalid-response",
        code: "INVALID_RESPONSE",
        message: "The API response does not match the expected contract shape.",
        status: response.status,
      },
    };
  }

  return { ok: true, data: payload };
}

export function getDocumentLibraryFromApi(
  signal?: AbortSignal,
): Promise<ApiResult<DocumentLibraryResponse>> {
  return request("/api/documents/", isLibraryResponse, signal);
}

export function getRevisionNavigationFromApi(
  docId: string,
  revision: number,
  signal?: AbortSignal,
): Promise<ApiResult<RevisionNavigationResponse>> {
  return request(
    `/api/documents/${encodeURIComponent(docId)}/revisions/${encodeURIComponent(String(revision))}/navigation/`,
    isNavigationResponse,
    signal,
  );
}

export function getTopicContentFromApi(
  docId: string,
  revision: number,
  topicId: string,
  signal?: AbortSignal,
): Promise<ApiResult<TopicContentResponse>> {
  return request(
    `/api/documents/${encodeURIComponent(docId)}/revisions/${encodeURIComponent(String(revision))}/topics/${encodeURIComponent(topicId)}/`,
    isTopicResponse,
    signal,
  );
}

export function resolveNodeFromApi(
  docId: string,
  nodeId: string,
  revision?: number,
  signal?: AbortSignal,
): Promise<ApiResult<ResolveNodeResponse>> {
  const query = new URLSearchParams({ nodeId });
  if (revision !== undefined) {
    query.set("revision", String(revision));
  }

  return request(
    `/api/documents/${encodeURIComponent(docId)}/resolve-node/?${query.toString()}`,
    isResolveNodeResponse,
    signal,
  );
}

function isNodeChangesResponse(value: unknown): value is NodeChangesResponse {
  return (
    isRecord(value) &&
    isString(value.docId) &&
    isInteger(value.fromRevision) &&
    isInteger(value.toRevision) &&
    isString(value.topicId) &&
    Array.isArray(value.status) &&
    Array.isArray(value.blocks) &&
    value.blocks.every(
      (entry: unknown) =>
        isRecord(entry) &&
        isString(entry.id) &&
        isString(entry.status) &&
        (entry.previous === null || isContentBlock(entry.previous)) &&
        (entry.current === null || isContentBlock(entry.current)),
    ) &&
    Array.isArray(value.removedTopicsAfter)
  );
}

function isRevisionChangesResponse(
  value: unknown,
): value is RevisionChangesResponse {
  return (
    isRecord(value) &&
    isString(value.docId) &&
    isInteger(value.fromRevision) &&
    isInteger(value.toRevision) &&
    isRecord(value.summary) &&
    isRecord(value.topics) &&
    ["modified", "added", "removed", "moved"].every(
      (status) =>
        isRecord(value.topics) &&
        Array.isArray(value.topics[status]) &&
        (value.topics[status] as unknown[]).every(isTopicOutline),
    )
  );
}

function comparisonQuery(from?: number, to?: number): string {
  const query = new URLSearchParams();
  if (from !== undefined) query.set("from", String(from));
  if (to !== undefined) query.set("to", String(to));
  const text = query.toString();
  return text ? `?${text}` : "";
}

export function getRevisionChangesFromApi(
  docId: string,
  from?: number,
  to?: number,
  signal?: AbortSignal,
): Promise<ApiResult<RevisionChangesResponse>> {
  return request(
    `/api/documents/${encodeURIComponent(docId)}/changes/${comparisonQuery(from, to)}`,
    isRevisionChangesResponse,
    signal,
  );
}

export function getNodeChangesFromApi(
  docId: string,
  nodeId: string,
  from?: number,
  to?: number,
  signal?: AbortSignal,
): Promise<ApiResult<NodeChangesResponse>> {
  return request(
    `/api/documents/${encodeURIComponent(docId)}/changes/nodes/${encodeURIComponent(nodeId)}/${comparisonQuery(from, to)}`,
    isNodeChangesResponse,
    signal,
  );
}

function isPdfOutlineResponse(value: unknown): value is PdfOutlineResponse {
  return (
    isRecord(value) &&
    isString(value.documentId) &&
    isInteger(value.revision) &&
    isInteger(value.pageCount) &&
    isRecord(value.nodes) &&
    Object.values(value.nodes).every(
      (entry) =>
        isRecord(entry) &&
        isInteger(entry.page) &&
        isInteger(entry.endPage) &&
        isString(entry.heading),
    ) &&
    Array.isArray(value.unmatched)
  );
}

export function pdfFileUrl(docId: string, revision: number): string {
  return `${API_BASE_URL}/api/documents/${encodeURIComponent(docId)}/revisions/${revision}/pdf/`;
}

export function getPdfOutlineFromApi(
  docId: string,
  revision: number,
  signal?: AbortSignal,
): Promise<ApiResult<PdfOutlineResponse>> {
  return request(
    `/api/documents/${encodeURIComponent(docId)}/revisions/${revision}/pdf/outline/`,
    isPdfOutlineResponse,
    signal,
  );
}

function isSearchResponse(value: unknown): value is SearchResponse {
  return (
    isRecord(value) &&
    isString(value.query) &&
    isInteger(value.total) &&
    Array.isArray(value.results) &&
    value.results.every(
      (result: unknown) =>
        isRecord(result) &&
        isString(result.docId) &&
        isInteger(result.revision) &&
        isString(result.topicId) &&
        isString(result.nodeId) &&
        isString(result.number) &&
        isString(result.title) &&
        isString(result.snippet),
    ) &&
    Array.isArray(value.documents)
  );
}

function isSearchIndexResponse(value: unknown): value is SearchIndexResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.documents) &&
    value.documents.every(
      (document: unknown) =>
        isRecord(document) &&
        isString(document.docId) &&
        isInteger(document.revision) &&
        Array.isArray(document.topics),
    )
  );
}

export function searchFromApi(
  query: string,
  filters: SearchFilters,
  signal?: AbortSignal,
): Promise<ApiResult<SearchResponse>> {
  const params = new URLSearchParams({ q: query });
  for (const docType of filters.docTypes ?? []) params.append("docType", docType);
  for (const category of filters.categories ?? []) params.append("category", category);
  for (const contentType of filters.contentTypes ?? []) params.append("contentType", contentType);
  if (filters.fleet) params.set("fleet", filters.fleet);
  return request(`/api/search/?${params.toString()}`, isSearchResponse, signal);
}

export function getSearchIndexFromApi(
  signal?: AbortSignal,
): Promise<ApiResult<SearchIndexResponse>> {
  return request("/api/search/index/", isSearchIndexResponse, signal);
}

function isDraftResponse(value: unknown): value is DraftResponse {
  return (
    isRecord(value) &&
    isString(value.docId) &&
    isInteger(value.baseRevision) &&
    isInteger(value.nextRevision) &&
    Array.isArray(value.chapters) &&
    value.chapters.every(isChapter) &&
    isRecord(value.summary) &&
    isDate(value.earliestEffectiveDate)
  );
}

function isPublishResponse(value: unknown): value is PublishResponse {
  return isRecord(value) && isString(value.docId) && isInteger(value.revision);
}

const draftPath = (docId: string) => `/api/documents/${encodeURIComponent(docId)}/draft/`;
const draftTopicPath = (docId: string, topicId: string) =>
  `${draftPath(docId)}topics/${encodeURIComponent(topicId)}/`;

export function getDraftFromApi(docId: string, signal?: AbortSignal) {
  return request(draftPath(docId), isDraftResponse, signal);
}

export function startDraftFromApi(docId: string) {
  return request(draftPath(docId), isDraftResponse, undefined, { method: "POST" });
}

export function discardDraftFromApi(docId: string) {
  return request(draftPath(docId), (value): value is undefined => value === undefined, undefined, {
    method: "DELETE",
  });
}

export function getDraftTopicFromApi(docId: string, topicId: string, signal?: AbortSignal) {
  return request(draftTopicPath(docId, topicId), isNodeChangesResponse, signal);
}

export function renameDraftTopicFromApi(docId: string, topicId: string, title: string) {
  return request(draftTopicPath(docId, topicId), isNodeChangesResponse, undefined, {
    method: "PATCH",
    body: { title },
  });
}

export function deleteDraftTopicFromApi(docId: string, topicId: string) {
  return request(draftTopicPath(docId, topicId), isDraftResponse, undefined, { method: "DELETE" });
}

export function addDraftTopicFromApi(docId: string, afterTopicId: string, title: string, text: string) {
  return request(
    `${draftPath(docId)}topics/`,
    (value): value is DraftResponse & { topicId: string } =>
      isDraftResponse(value) && isString((value as { topicId?: unknown }).topicId),
    undefined,
    { method: "POST", body: { afterTopicId, title, text } },
  );
}

export function addDraftBlockFromApi(
  docId: string,
  topicId: string,
  afterId: string | null,
  type: EditableBlockType,
  text: string,
) {
  return request(`${draftTopicPath(docId, topicId)}blocks/`, isNodeChangesResponse, undefined, {
    method: "POST",
    body: { afterId, type, text },
  });
}

export function updateDraftBlockFromApi(
  docId: string,
  topicId: string,
  blockId: string,
  text: string,
  type: EditableBlockType,
) {
  return request(
    `${draftTopicPath(docId, topicId)}blocks/${encodeURIComponent(blockId)}/`,
    isNodeChangesResponse,
    undefined,
    { method: "PATCH", body: { text, type } },
  );
}

export function deleteDraftBlockFromApi(docId: string, topicId: string, blockId: string) {
  return request(
    `${draftTopicPath(docId, topicId)}blocks/${encodeURIComponent(blockId)}/`,
    isNodeChangesResponse,
    undefined,
    { method: "DELETE" },
  );
}

export function publishDraftFromApi(docId: string, changeSummary: string, effectiveDate: string) {
  return request(`${draftPath(docId)}publish/`, isPublishResponse, undefined, {
    method: "POST",
    body: { changeSummary, effectiveDate },
  });
}
