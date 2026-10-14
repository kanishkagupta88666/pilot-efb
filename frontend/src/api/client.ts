import { API_BASE_URL } from "../config/dataSource";
import type {
  Chapter,
  ContentBlock,
  DocumentLibraryResponse,
  DocumentMetadata,
  DocumentRevision,
  DocumentSummary,
  ResolveNodeResponse,
  ResolvedNodeType,
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
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    const options: RequestInit = { headers: { Accept: "application/json" } };
    if (signal) options.signal = signal;
    response = await fetch(`${API_BASE_URL}${path}`, options);
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
