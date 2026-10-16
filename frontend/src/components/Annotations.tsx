import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { Link } from "react-router-dom";
import { getAnnotationStatusFromApi } from "../api/client";
import type { Annotation, AnnotationStatus, TopicContentResponse } from "../types/api";
import {
  addAnnotation,
  annotationsFor,
  deleteAnnotation,
  subscribeToAnnotations,
  syncAnnotations,
  updateAnnotation,
} from "../utils/annotationStore";
import { recordAudit } from "../utils/auditLog";
import { getProfile, setProfile } from "../utils/deviceIdentity";
import { blockText } from "./ChangeMarkers";
import type { HighlightRange } from "./ContentBlocks";

type Topic = TopicContentResponse["topic"];

export interface Selection {
  blockId: string;
  start: number;
  end: number;
  quote: string;
  /** Where to show the toolbar, in viewport coordinates. */
  top: number;
  left: number;
}

/** The pilot's annotations for a document, and their status in the revision being read. */
export function useAnnotations(docId: string, revision: number | undefined) {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [statuses, setStatuses] = useState<Map<string, AnnotationStatus>>();
  const [checked, setChecked] = useState<"pending" | "done" | "offline">("pending");

  const reload = useCallback(() => {
    void annotationsFor(docId).then(setAnnotations).catch(() => setAnnotations([]));
  }, [docId]);

  useEffect(() => {
    reload();
    return subscribeToAnnotations(reload);
  }, [reload]);

  // Ask the server how each annotation fares in this revision (Q&A #8).
  useEffect(() => {
    if (revision === undefined) return;
    const anchored = annotations.filter((a) => !a.detached);
    if (!anchored.length) {
      setStatuses(new Map());
      setChecked("done");
      return;
    }
    const controller = new AbortController();
    setChecked("pending");
    void getAnnotationStatusFromApi(
      docId,
      revision,
      anchored.map(({ id, nodeId, topicId, topicNumber, anchorText }) => ({ id, nodeId, topicId, topicNumber, anchorText })),
      controller.signal,
    ).then((result) => {
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setChecked(result.error.kind === "network" ? "offline" : "done");
        return;
      }
      setStatuses(new Map(result.data.statuses.map((status) => [status.id, status])));
      setChecked("done");
    });
    return () => controller.abort();
  }, [docId, revision, annotations]);

  return { annotations, statuses, checked };
}

/** Where a highlight sits in the block's current text, or undefined if it cannot be placed. */
function placeRange(annotation: Annotation, text: string): [number, number] | undefined {
  if (annotation.start === null || annotation.end === null || !annotation.quote) return undefined;
  if (text.slice(annotation.start, annotation.end) === annotation.quote) return [annotation.start, annotation.end];
  const at = text.indexOf(annotation.quote);
  return at >= 0 ? [at, at + annotation.quote.length] : undefined;
}

/** Highlight ranges for the blocks of the topic on screen. */
export function highlightsFor(
  topic: Topic,
  annotations: Annotation[],
  statuses: Map<string, AnnotationStatus> | undefined,
): Map<string, HighlightRange[]> {
  const byBlock = new Map<string, HighlightRange[]>();
  const blocks = new Map(topic.blocks.map((block) => [block.id, block]));
  for (const annotation of annotations) {
    if (annotation.detached || annotation.kind === "bookmark") continue;
    const block = blocks.get(annotation.nodeId);
    if (!block) continue;
    const status = statuses?.get(annotation.id);
    if (status?.status === "removed") continue;
    const range = placeRange(annotation, blockText(block));
    if (!range) continue;
    const list = byBlock.get(block.id) ?? [];
    list.push({
      id: annotation.id,
      start: range[0],
      end: range[1],
      hasNote: Boolean(annotation.note),
      flagged: Boolean(status?.changed),
    });
    byBlock.set(block.id, list);
  }
  return byBlock;
}

/** Track a text selection inside one paragraph of the topic. */
export function useTextSelection(container: RefObject<HTMLElement | null>) {
  const [selection, setSelection] = useState<Selection>();

  useEffect(() => {
    const read = () => {
      const current = window.getSelection();
      if (!current || current.isCollapsed || current.rangeCount === 0) {
        setSelection(undefined);
        return;
      }
      const range = current.getRangeAt(0);
      const startRoot = (range.startContainer.parentElement ?? null)?.closest<HTMLElement>("[data-annotatable]");
      const endRoot = (range.endContainer.parentElement ?? null)?.closest<HTMLElement>("[data-annotatable]");
      if (!startRoot || startRoot !== endRoot || !container.current?.contains(startRoot)) {
        setSelection(undefined);
        return;
      }
      const before = document.createRange();
      before.selectNodeContents(startRoot);
      before.setEnd(range.startContainer, range.startOffset);
      const start = before.toString().length;
      const quote = range.toString();
      if (!quote.trim()) {
        setSelection(undefined);
        return;
      }
      const rect = range.getBoundingClientRect();
      setSelection({
        blockId: startRoot.dataset.annotatable ?? "",
        start,
        end: start + quote.length,
        quote,
        // Below the selection, so the iPad's own copy menu above it stays usable.
        top: rect.bottom + 8,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 300)),
      });
    };
    let timer: number | undefined;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(read, 120);
    };
    document.addEventListener("selectionchange", schedule);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("selectionchange", schedule);
    };
  }, [container]);

  return [selection, () => {
    window.getSelection()?.removeAllRanges();
    setSelection(undefined);
  }] as const;
}

export function SelectionToolbar({
  selection,
  onHighlight,
  onNote,
  onCancel,
}: {
  selection: Selection;
  onHighlight: () => void;
  onNote: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      aria-label="Annotate the selected text"
      className="selection-toolbar"
      role="toolbar"
      style={{ top: selection.top, left: selection.left }}
    >
      {/* onMouseDown keeps the selection from collapsing before the click. */}
      <button onClick={onHighlight} onMouseDown={(e) => e.preventDefault()} type="button">Highlight</button>
      <button onClick={onNote} onMouseDown={(e) => e.preventDefault()} type="button">Add note</button>
      <button aria-label="Cancel" onClick={onCancel} onMouseDown={(e) => e.preventDefault()} type="button">×</button>
    </div>
  );
}

function NameGate() {
  const [name, setName] = useState("");
  return (
    <form
      className="annotation-name"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        setProfile({ ...getProfile(), name });
        window.dispatchEvent(new Event("pilot-efb-profile"));
        // Bring in anything this pilot annotated on other devices.
        void syncAnnotations();
      }}
    >
      <p>Your highlights and notes are private to you and follow you to other devices. Enter your name to start.</p>
      <label className="author-field" htmlFor="annotation-owner">
        Your name
        <input id="annotation-owner" maxLength={120} onChange={(e) => setName(e.target.value)} value={name} />
      </label>
      <button className="button button--primary" disabled={!name.trim()} type="submit">Continue</button>
    </form>
  );
}

function quoteOf(annotation: Annotation): string {
  return annotation.quote || annotation.anchorText || "";
}

function NoteEditor({
  initial,
  onSave,
  onCancel,
  quote,
}: {
  initial: string;
  onSave: (text: string) => void;
  onCancel: () => void;
  quote?: string;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <form
      className="annotation-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim()) onSave(text.trim());
      }}
    >
      {quote && <blockquote>{quote}</blockquote>}
      <label className="author-field" htmlFor="annotation-note">
        Note
        <textarea id="annotation-note" maxLength={4000} onChange={(e) => setText(e.target.value)} ref={ref} rows={3} value={text} />
      </label>
      <div className="author-actions">
        <button className="button button--primary" disabled={!text.trim()} type="submit">Save note</button>
        <button className="button button--secondary" onClick={onCancel} type="button">Cancel</button>
      </div>
    </form>
  );
}

export interface PendingNote {
  selection: Selection;
}

/** "Your annotations": this topic's, the ones to review, and the removed ones. */
export function AnnotationPanel({
  docId,
  revision,
  topic,
  annotations,
  statuses,
  checked,
  pendingNote,
  onPendingNoteDone,
  focusedId,
  onFocus,
}: {
  docId: string;
  revision: number;
  topic: Topic;
  annotations: Annotation[];
  statuses?: Map<string, AnnotationStatus>;
  checked: "pending" | "done" | "offline";
  pendingNote?: PendingNote;
  onPendingNoteDone: () => void;
  focusedId?: string;
  onFocus: (id?: string) => void;
}) {
  const [hasName, setHasName] = useState(Boolean(getProfile().name));
  const [editing, setEditing] = useState<string>();
  useEffect(() => {
    const refresh = () => setHasName(Boolean(getProfile().name));
    window.addEventListener("pilot-efb-profile", refresh);
    return () => window.removeEventListener("pilot-efb-profile", refresh);
  }, []);

  const statusOf = (a: Annotation) => statuses?.get(a.id);
  const inTopic = annotations.filter((a) => {
    if (a.detached) return false;
    const status = statusOf(a);
    if (status?.status === "removed") return false;
    return (status?.topicId ?? a.topicId) === topic.id;
  });
  const bookmark = inTopic.find((a) => a.kind === "bookmark");
  const marks = inTopic.filter((a) => a.kind !== "bookmark");
  const removed = annotations.filter((a) => !a.detached && statusOf(a)?.status === "removed");
  const reviewElsewhere = annotations.filter((a) => {
    const status = statusOf(a);
    return status?.changed && status.topicId !== topic.id;
  });
  const kept = annotations.filter((a) => a.detached);
  const counts = useMemo(() => ({
    highlights: annotations.filter((a) => a.kind === "highlight" && !a.detached).length,
    notes: annotations.filter((a) => a.kind === "note").length,
    bookmarks: annotations.filter((a) => a.kind === "bookmark").length,
  }), [annotations]);

  if (!hasName) {
    return (
      <aside aria-label="Your annotations" className="reader-context annotation-panel">
        <h2 className="reader-context__heading">Your annotations</h2>
        <NameGate />
      </aside>
    );
  }

  const confirm = (annotation: Annotation) => {
    const status = statusOf(annotation);
    if (!status) return;
    const text = status.currentText ?? annotation.anchorText;
    const at = annotation.quote ? text.indexOf(annotation.quote) : -1;
    void updateAnnotation(annotation.id, {
      revision,
      anchorText: text,
      topicId: status.topicId ?? annotation.topicId,
      topicNumber: status.topicNumber ?? annotation.topicNumber,
      ...(at >= 0 ? { start: at, end: at + annotation.quote.length } : {}),
    });
  };

  const toggleBookmark = async () => {
    if (bookmark) {
      await deleteAnnotation(bookmark.id);
      void recordAudit("annotation.removed", { documentId: docId, revision, nodeId: topic.id, details: { kind: "bookmark" } });
      return;
    }
    await addAnnotation({
      kind: "bookmark",
      documentId: docId,
      revision,
      topicId: topic.id,
      topicNumber: topic.number,
      nodeId: "",
      start: null,
      end: null,
      quote: "",
      anchorText: "",
      note: "",
    });
    void recordAudit("annotation.added", { documentId: docId, revision, nodeId: topic.id, details: { kind: "bookmark" } });
  };

  return (
    <aside aria-label="Your annotations" className="reader-context annotation-panel">
      <h2 className="reader-context__heading">Your annotations</h2>
      <dl className="annotation-counts">
        <div><dt>Highlights</dt><dd>{counts.highlights}</dd></div>
        <div><dt>Notes</dt><dd>{counts.notes}</dd></div>
        <div><dt>Bookmarks</dt><dd>{counts.bookmarks}</dd></div>
      </dl>
      <button
        aria-pressed={Boolean(bookmark)}
        className={`button ${bookmark ? "button--primary" : "button--secondary"} annotation-bookmark`}
        onClick={() => void toggleBookmark()}
        type="button"
      >
        {bookmark ? "Bookmarked" : "Bookmark this topic"}
      </button>
      <p className="annotation-hint">Select text in the topic to highlight it or add a note.</p>
      {checked === "offline" && (
        <p className="annotation-hint">Offline: changes to annotated text are checked when you are back online.</p>
      )}

      {pendingNote && (
        <NoteEditor
          initial=""
          onCancel={onPendingNoteDone}
          onSave={async (text) => {
            const { selection } = pendingNote;
            const block = topic.blocks.find((b) => b.id === selection.blockId);
            await addAnnotation({
              kind: "note",
              documentId: docId,
              revision,
              topicId: topic.id,
              topicNumber: topic.number,
              nodeId: selection.blockId,
              start: selection.start,
              end: selection.end,
              quote: selection.quote,
              anchorText: block ? blockText(block) : "",
              note: text,
            });
            void recordAudit("annotation.added", { documentId: docId, revision, nodeId: selection.blockId, details: { kind: "note" } });
            onPendingNoteDone();
          }}
          quote={pendingNote.selection.quote}
        />
      )}

      {marks.length > 0 && (
        <ul className="annotation-list">
          {marks.map((annotation) => {
            const status = statusOf(annotation);
            return (
              <li
                className={`annotation-item${focusedId === annotation.id ? " annotation-item--focused" : ""}`}
                key={annotation.id}
              >
                <button className="annotation-item__quote" onClick={() => onFocus(annotation.id)} type="button">
                  <span className={`annotation-swatch${annotation.note ? " annotation-swatch--note" : ""}`} />
                  “{quoteOf(annotation).slice(0, 120)}{quoteOf(annotation).length > 120 ? "…" : ""}”
                </button>
                {status?.moved && (
                  <p className="annotation-flag annotation-flag--moved">
                    Moved here from {status.previousTopicNumber} in this revision.
                  </p>
                )}
                {status?.changed && (
                  <div className="annotation-flag">
                    The text you annotated changed in Revision {revision}. Check it still applies.
                    <div className="author-actions">
                      <button className="button button--secondary" onClick={() => confirm(annotation)} type="button">
                        Still applies
                      </button>
                    </div>
                  </div>
                )}
                {editing === annotation.id ? (
                  <NoteEditor
                    initial={annotation.note}
                    onCancel={() => setEditing(undefined)}
                    onSave={(text) => {
                      void updateAnnotation(annotation.id, { note: text, kind: "note" });
                      setEditing(undefined);
                    }}
                  />
                ) : (
                  annotation.note && <p className="annotation-item__note">{annotation.note}</p>
                )}
                {editing !== annotation.id && (
                  <div className="author-actions">
                    <button className="button button--secondary" onClick={() => setEditing(annotation.id)} type="button">
                      {annotation.note ? "Edit note" : "Add note"}
                    </button>
                    <button
                      className="button button--danger"
                      onClick={() => {
                        void deleteAnnotation(annotation.id);
                        void recordAudit("annotation.removed", { documentId: docId, revision, nodeId: annotation.nodeId, details: { kind: annotation.kind } });
                      }}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {reviewElsewhere.length > 0 && (
        <section className="annotation-section">
          <h3>To review elsewhere ({reviewElsewhere.length})</h3>
          <ul className="annotation-links">
            {reviewElsewhere.map((annotation) => {
              const status = statusOf(annotation);
              return (
                <li key={annotation.id}>
                  <Link to={`/reader/${encodeURIComponent(docId)}/${revision}?topicId=${encodeURIComponent(status?.topicId ?? annotation.topicId)}&nodeId=${encodeURIComponent(annotation.nodeId)}`}>
                    {status?.topicNumber} {status?.topicTitle}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {removed.length > 0 && (
        <section className="annotation-section annotation-section--removed">
          <h3>Removed from Revision {revision} ({removed.length})</h3>
          <p className="annotation-hint">The text these were on is no longer in the manual.</p>
          <ul className="annotation-list">
            {removed.map((annotation) => (
              <li className="annotation-item" key={annotation.id}>
                <p className="annotation-item__removed">
                  {annotation.topicNumber}: <del>{quoteOf(annotation).slice(0, 200)}</del>
                </p>
                {annotation.note && <p className="annotation-item__note">{annotation.note}</p>}
                <div className="author-actions">
                  <button
                    className="button button--secondary"
                    onClick={() => void updateAnnotation(annotation.id, {
                      detached: true,
                      kind: "note",
                      note: annotation.note || `Kept from ${annotation.topicNumber}: “${quoteOf(annotation).slice(0, 300)}”`,
                    })}
                    type="button"
                  >
                    Keep as note
                  </button>
                  <button className="button button--danger" onClick={() => void deleteAnnotation(annotation.id)} type="button">
                    Discard
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {kept.length > 0 && (
        <section className="annotation-section">
          <h3>Kept notes ({kept.length})</h3>
          <ul className="annotation-list">
            {kept.map((annotation) => (
              <li className="annotation-item" key={annotation.id}>
                <p className="annotation-item__note">{annotation.note}</p>
                <button className="button button--danger" onClick={() => void deleteAnnotation(annotation.id)} type="button">
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}

/** Save a highlight on the selected text. */
export async function saveHighlight(docId: string, revision: number, topic: Topic, selection: Selection) {
  const block = topic.blocks.find((b) => b.id === selection.blockId);
  await addAnnotation({
    kind: "highlight",
    documentId: docId,
    revision,
    topicId: topic.id,
    topicNumber: topic.number,
    nodeId: selection.blockId,
    start: selection.start,
    end: selection.end,
    quote: selection.quote,
    anchorText: block ? blockText(block) : "",
    note: "",
  });
  void recordAudit("annotation.added", { documentId: docId, revision, nodeId: selection.blockId, details: { kind: "highlight" } });
}
