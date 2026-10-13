import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import {
  getPdfOutlineFromApi,
  pdfFileUrl,
  type ApiClientError,
} from "../api/client";
import type { BlockChange, NodeChangesResponse, PdfOutlineResponse } from "../types/api";
import { locateText, type PlacedBox, type TextRun } from "../utils/pdfLocate";
import {
  BlockChangePanel,
  RemovedChangePanel,
  blockText,
  excerpt,
  removedBlockText,
  removedTopicText,
  type ComparedRevisions,
} from "./ChangeMarkers";
import { ApiErrorState, LoadingState } from "./RequestStates";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Topics rarely span more than a few pages; this bounds the work per view. */
const MAX_PAGES = 8;
/**
 * Share of the page height, at top and bottom, that holds running headers and
 * footers. In the sample renditions those baselines sit at 3.6% and 95.5% and
 * body text runs from 9.2% to 91%.
 */
const PAGE_MARGIN = 0.06;
const documents = new Map<string, Promise<PDFDocumentProxy>>();

function loadDocument(url: string): Promise<PDFDocumentProxy> {
  let pending = documents.get(url);
  if (!pending) {
    pending = pdfjs.getDocument({ url }).promise;
    pending.catch(() => documents.delete(url));
    documents.set(url, pending);
  }
  return pending;
}

interface Marker {
  key: string;
  tone: "changed" | "removed" | "target";
  label: string;
  /** One box per page; the badge sits on the first. */
  boxes: PlacedBox[];
  panel?: ReactNode;
}

interface PageMark {
  marker: Marker;
  box: PlacedBox;
  first: boolean;
}

interface Unplaced {
  key: string;
  label: string;
  excerpt: string;
  reason: string;
  panel: ReactNode;
}

const REASONS = {
  "not-found": "its text was not found on the topic's pages",
  ambiguous: "the same text appears more than once on these pages",
  "too-short": "it is too short to locate reliably",
  "no-anchor": "the text around it could not be located",
} as const;

function PdfPage({
  pdf,
  pageNumber,
  width,
  markers,
  openKey,
  onToggle,
  onRuns,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  width: number;
  markers: PageMark[];
  openKey?: string;
  onToggle: (key: string) => void;
  onRuns: (page: number, runs: TextRun[]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ width: number; height: number }>();

  useEffect(() => {
    let cancelled = false;
    let task: RenderTask | undefined;
    void pdf.getPage(pageNumber).then(async (page: PDFPageProxy) => {
      if (cancelled || !canvasRef.current) return;
      const scale = width / page.getViewport({ scale: 1 }).width;
      const viewport = page.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      const canvas = canvasRef.current;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      setSize({ width: viewport.width, height: viewport.height });
      const context = canvas.getContext("2d");
      if (!context) return;
      // One render per canvas at a time: a second render on the same canvas
      // while the first is running fails, so the previous task is cancelled.
      task = page.render({
        canvasContext: context,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      try {
        await task.promise;
      } catch {
        return;
      }
      const content = await page.getTextContent();
      if (cancelled) return;
      // Running headers and footers sit in the top and bottom margins. They are
      // left out so a paragraph that crosses a page break reads as one text.
      const margin = viewport.height * PAGE_MARGIN;
      const runs: TextRun[] = content.items
        .filter((item): item is TextItem => "str" in item && item.str.trim() !== "")
        .map((item) => {
          const transformed = pdfjs.Util.transform(viewport.transform, item.transform);
          const height = Math.hypot(transformed[2], transformed[3]);
          return {
            page: pageNumber,
            text: item.str,
            left: transformed[4],
            top: transformed[5] - height,
            width: item.width * scale,
            height,
          };
        })
        .filter((run) => {
          const baseline = run.top + run.height;
          return baseline > margin && baseline < viewport.height - margin;
        });
      onRuns(pageNumber, runs);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, pageNumber, width, onRuns]);

  const open = markers.find(({ marker, first }) => first && marker.key === openKey && marker.panel)?.marker;
  return (
    <div className="pdf-page">
      <div className="pdf-page__sheet" style={size}>
        <canvas aria-label={`PDF page ${pageNumber}`} ref={canvasRef} style={size} />
        {markers.map(({ marker, box, first }) => (
          <div
            className={`pdf-mark pdf-mark--${marker.tone}`}
            key={marker.key}
            style={{ top: box.top - 3, height: Math.max(box.bottom - box.top + 6, 4) }}
          >
            {first && marker.panel ? (
              <button
                aria-expanded={openKey === marker.key}
                className={`change-badge pdf-mark__badge change-badge--${marker.tone === "removed" ? "removed" : "modified"}`}
                onClick={() => onToggle(marker.key)}
                type="button"
              >
                {marker.label}
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <p className="pdf-page__number">Page {pageNumber}</p>
      {open && <div className="pdf-page__panel">{open.panel}</div>}
    </div>
  );
}

function boxBelow(boxes: PlacedBox[]): PlacedBox[] {
  const box = boxes[boxes.length - 1];
  return [{ page: box.page, top: box.bottom + 2, bottom: box.bottom + 6 }];
}

function boxAbove(boxes: PlacedBox[]): PlacedBox[] {
  const box = boxes[0];
  return [{ page: box.page, top: box.top - 8, bottom: box.top - 4 }];
}

export default function PdfPrintView({
  docId,
  revision,
  topicId,
  targetNodeId,
  changes,
  comparedRevisions,
  showChanges,
}: {
  docId: string;
  revision: number;
  topicId: string;
  targetNodeId?: string;
  changes?: NodeChangesResponse;
  comparedRevisions?: ComparedRevisions;
  showChanges: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [outline, setOutline] = useState<
    { status: "loading" } | { status: "error"; error: ApiClientError } | { status: "ready"; data: PdfOutlineResponse }
  >({ status: "loading" });
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [pdfError, setPdfError] = useState<string>();
  const [runsByPage, setRunsByPage] = useState<Record<number, TextRun[]>>({});
  const [openKey, setOpenKey] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = (value: number) => setWidth(Math.min(Math.floor(value), 900));
    // Measure now as well: a resize observer only reports once the page paints.
    measure(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => measure(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setOutline({ status: "loading" });
    void getPdfOutlineFromApi(docId, revision, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setOutline(result.ok ? { status: "ready", data: result.data } : { status: "error", error: result.error });
    });
    return () => controller.abort();
  }, [docId, revision, attempt]);

  useEffect(() => {
    let cancelled = false;
    setPdfError(undefined);
    loadDocument(pdfFileUrl(docId, revision)).then(
      (loaded) => !cancelled && setPdf(loaded),
      () => !cancelled && setPdfError("The PDF rendition could not be opened."),
    );
    return () => {
      cancelled = true;
    };
  }, [docId, revision]);

  const location = outline.status === "ready" ? outline.data.nodes[topicId] : undefined;
  const pages = useMemo(() => {
    if (!location) return [];
    const last = Math.min(location.endPage, location.page + MAX_PAGES - 1);
    return Array.from({ length: last - location.page + 1 }, (_, index) => location.page + index);
  }, [location]);

  useEffect(() => {
    setRunsByPage({});
    setOpenKey(undefined);
  }, [topicId, revision, width]);

  const onRuns = useMemo(
    () => (page: number, runs: TextRun[]) =>
      setRunsByPage((previous) => ({ ...previous, [page]: runs })),
    [],
  );

  const allRuns = useMemo(() => {
    if (!pages.length || pages.some((page) => !runsByPage[page])) return undefined;
    return pages.flatMap((page) => runsByPage[page]);
  }, [pages, runsByPage]);

  const { markers, unplaced } = useMemo(() => {
    const placedMarkers: Marker[] = [];
    const notPlaced: Unplaced[] = [];
    if (!allRuns) return { markers: placedMarkers, unplaced: notPlaced };

    if (targetNodeId && targetNodeId !== topicId && changes) {
      const target = changes.blocks.find((entry) => entry.id === targetNodeId && entry.current);
      if (target?.current) {
        const placement = locateText(allRuns, blockText(target.current));
        if (placement.placed) {
          placedMarkers.push({ key: `target-${target.id}`, tone: "target", label: "Linked", boxes: placement.boxes });
        }
      }
    }

    if (!showChanges || !changes || !comparedRevisions) {
      return { markers: placedMarkers, unplaced: notPlaced };
    }

    const close = () => setOpenKey(undefined);
    const blocks = changes.blocks;
    // First pass: locate every current block, changed or not, so removed
    // content can be anchored to its neighbours.
    const placements = blocks.map((entry) =>
      entry.current ? locateText(allRuns, blockText(entry.current)) : undefined,
    );
    const placedAt = (index: number) => {
      const placement = placements[index];
      return placement?.placed ? placement.boxes : undefined;
    };
    // The heading of whatever follows this topic in the outline marks where
    // the topic ends. Headings carry unique numbers, so they locate reliably.
    const outlineIds = outline.status === "ready" ? Object.keys(outline.data.nodes) : [];
    const nextId = outlineIds[outlineIds.indexOf(topicId) + 1];
    const nextHeading =
      nextId && outline.status === "ready"
        ? locateText(allRuns, outline.data.nodes[nextId].heading)
        : undefined;
    const topicEnd = nextHeading?.placed ? nextHeading.boxes : undefined;

    /** Below the nearest located block before ``index``, else above the next one. */
    const anchorFor = (index: number): PlacedBox[] | undefined => {
      for (let i = index - 1; i >= 0; i -= 1) {
        if (blocks[i].status === "removed") continue;
        const before = placedAt(i);
        if (before) return boxBelow(before);
        break;
      }
      for (let i = index + 1; i < blocks.length; i += 1) {
        if (blocks[i].status === "removed") continue;
        const after = placedAt(i);
        if (after) return boxAbove(after);
        break;
      }
      return index === blocks.length - 1 && topicEnd ? boxAbove(topicEnd) : undefined;
    };

    blocks.forEach((entry: BlockChange, index) => {
      if (entry.status === "removed") {
        const panel = (
          <RemovedChangePanel onClose={close} previous={removedBlockText(entry)} revisions={comparedRevisions} />
        );
        const boxes = anchorFor(index);
        if (boxes) {
          placedMarkers.push({ key: entry.id, tone: "removed", label: "Removed", boxes, panel });
        } else {
          notPlaced.push({
            key: entry.id,
            label: "Removed",
            excerpt: excerpt(entry.previous ? blockText(entry.previous) : ""),
            reason: REASONS["no-anchor"],
            panel,
          });
        }
        return;
      }
      if (!entry.current || (entry.status !== "modified" && entry.status !== "added")) return;

      const placement = placements[index];
      const label = entry.status === "added" ? "Added" : "Modified";
      const panel = <BlockChangePanel change={entry} onClose={close} revisions={comparedRevisions} />;
      if (placement?.placed) {
        placedMarkers.push({ key: entry.id, tone: "changed", label, boxes: placement.boxes, panel });
      } else if (placement) {
        notPlaced.push({
          key: entry.id,
          label,
          excerpt: excerpt(blockText(entry.current)),
          reason: REASONS[placement.reason],
          panel,
        });
      }
    });

    changes.removedTopicsAfter.forEach((topic) => {
      const panel = (
        <RemovedChangePanel onClose={close} previous={removedTopicText(topic)} revisions={comparedRevisions} />
      );
      if (topicEnd) {
        placedMarkers.push({
          key: `topic-${topic.id}`,
          tone: "removed",
          label: "Removed",
          boxes: boxAbove(topicEnd),
          panel,
        });
      } else {
        notPlaced.push({
          key: `topic-${topic.id}`,
          label: "Removed",
          excerpt: `${topic.number} ${topic.title}`,
          reason: REASONS["no-anchor"],
          panel,
        });
      }
    });
    return { markers: placedMarkers, unplaced: notPlaced };
  }, [allRuns, changes, comparedRevisions, outline, showChanges, targetNodeId, topicId]);

  useEffect(() => {
    const target = markers.find((marker) => marker.tone === "target");
    if (!target || !containerRef.current) return;
    const element = containerRef.current.querySelector(".pdf-mark--target");
    element?.scrollIntoView?.({ block: "center" });
  }, [markers]);

  const toggle = (key: string) => setOpenKey((current) => (current === key ? undefined : key));
  const openUnplaced = unplaced.find((item) => item.key === openKey);

  return (
    <div className="pdf-view" ref={containerRef}>
      <p className="pdf-view__notice">
        Print view of the PDF rendition, Revision {revision}. Change bars are placed by matching
        text on the page; changes that cannot be placed with certainty are listed below the page.
      </p>
      {outline.status === "loading" && <LoadingState label="Loading PDF outline…" />}
      {outline.status === "error" && (
        <ApiErrorState error={outline.error} onRetry={() => setAttempt((value) => value + 1)} />
      )}
      {outline.status === "ready" && !location && (
        <p className="target-unavailable">This topic has no entry in the PDF outline.</p>
      )}
      {pdfError && <p className="target-unavailable" role="alert">{pdfError}</p>}
      {pdf && width > 0 &&
        pages.map((page) => (
          <PdfPage
            key={`${revision}-${page}-${width}`}
            markers={markers.flatMap((marker) =>
              marker.boxes
                .map((box, index) => ({ marker, box, first: index === 0 }))
                .filter(({ box }) => box.page === page),
            )}
            onRuns={onRuns}
            onToggle={toggle}
            openKey={openKey}
            pageNumber={page}
            pdf={pdf}
            width={width}
          />
        ))}
      {unplaced.length > 0 && (
        <section aria-label="Changes not shown on the page" className="pdf-unplaced">
          <h3>Not shown on the page ({unplaced.length})</h3>
          <ul>
            {unplaced.map((item) => (
              <li key={item.key}>
                <button
                  aria-expanded={openKey === item.key}
                  className={`change-badge change-badge--${item.label.startsWith("Removed") ? "removed" : "modified"}`}
                  onClick={() => toggle(item.key)}
                  type="button"
                >
                  {item.label}
                </button>{" "}
                <span>{item.excerpt}</span>
                <span className="pdf-unplaced__reason"> Not placed: {item.reason}.</span>
              </li>
            ))}
          </ul>
          {openUnplaced && <div className="pdf-page__panel">{openUnplaced.panel}</div>}
        </section>
      )}
    </div>
  );
}
