import type { ResolveNodeResponse } from "../types/api";

export function readerPathForResolution(resolution: ResolveNodeResponse): string {
  const query = new URLSearchParams({
    topicId: resolution.topicId,
    chapterId: resolution.chapterId,
    sectionId: resolution.sectionId,
    nodeId: resolution.targetNodeId,
    targetType: resolution.targetType,
  });
  return `/reader/${encodeURIComponent(resolution.documentId)}/${resolution.selectedRevision}?${query.toString()}`;
}
