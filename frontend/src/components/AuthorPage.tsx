import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  addDraftBlockFromApi,
  addDraftTopicFromApi,
  deleteDraftBlockFromApi,
  deleteDraftTopicFromApi,
  discardDraftFromApi,
  getDraftFromApi,
  getDraftTopicFromApi,
  publishDraftFromApi,
  renameDraftTopicFromApi,
  startDraftFromApi,
  updateDraftBlockFromApi,
  type ApiClientError,
  type ApiResult,
} from "../api/client";
import type {
  BlockChange,
  ContentBlock,
  DraftResponse,
  EditableBlockType,
  NodeChangesResponse,
} from "../types/api";
import { blockText } from "./ChangeMarkers";
import { ApiErrorState, LoadingState } from "./RequestStates";

const EDITABLE: EditableBlockType[] = ["para", "note", "caution", "warning"];
const TYPE_LABEL: Record<string, string> = {
  para: "Paragraph",
  note: "Note",
  caution: "Caution",
  warning: "Warning",
  list: "List",
  table: "Table",
  checklist: "Checklist",
};

type DraftState =
  | { status: "loading" }
  | { status: "none" }
  | { status: "error"; error: ApiClientError }
  | { status: "ready"; draft: DraftResponse };

function isEditable(block: ContentBlock): block is Extract<ContentBlock, { segments: unknown }> {
  return (EDITABLE as string[]).includes(block.type);
}

function hasLinks(block: ContentBlock): boolean {
  return "segments" in block && block.segments.some((segment) => segment.type === "xref");
}

function firstTopicId(draft: DraftResponse): string | undefined {
  for (const chapter of draft.chapters) {
    for (const section of chapter.sections) {
      if (section.topics[0]) return section.topics[0].id;
    }
  }
  return undefined;
}

function TypeSelect({
  value,
  onChange,
  id,
}: {
  value: EditableBlockType;
  onChange: (value: EditableBlockType) => void;
  id: string;
}) {
  return (
    <select
      className="author-select"
      id={id}
      onChange={(event) => onChange(event.target.value as EditableBlockType)}
      value={value}
    >
      {EDITABLE.map((type) => (
        <option key={type} value={type}>{TYPE_LABEL[type]}</option>
      ))}
    </select>
  );
}

function BlockEditor({
  initialText,
  initialType,
  submitLabel,
  warning,
  onSubmit,
  onCancel,
  idPrefix,
}: {
  initialText: string;
  initialType: EditableBlockType;
  submitLabel: string;
  warning?: string;
  onSubmit: (text: string, type: EditableBlockType) => Promise<string | undefined>;
  onCancel: () => void;
  idPrefix: string;
}) {
  const [text, setText] = useState(initialText);
  const [type, setType] = useState(initialType);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(await onSubmit(text, type));
    setSaving(false);
  };
  return (
    <form className="author-editor" onSubmit={(event) => void submit(event)}>
      <label className="author-field" htmlFor={`${idPrefix}-type`}>
        Type
        <TypeSelect id={`${idPrefix}-type`} onChange={setType} value={type} />
      </label>
      <label className="author-field" htmlFor={`${idPrefix}-text`}>
        Text
        <textarea
          autoFocus
          id={`${idPrefix}-text`}
          maxLength={4000}
          onChange={(event) => setText(event.target.value)}
          rows={Math.min(12, Math.max(4, Math.ceil(text.length / 90)))}
          value={text}
        />
      </label>
      {warning && <p className="author-warning">{warning}</p>}
      {error && <p className="author-error" role="alert">{error}</p>}
      <div className="author-actions">
        <button className="button button--primary" disabled={saving || !text.trim()} type="submit">
          {saving ? "Saving…" : submitLabel}
        </button>
        <button className="button button--secondary" onClick={onCancel} type="button">Cancel</button>
      </div>
    </form>
  );
}

function BlockCard({
  entry,
  editing,
  adding,
  onEdit,
  onAdd,
  onDelete,
  onCancel,
  onSave,
  onInsert,
}: {
  entry: BlockChange;
  editing: boolean;
  adding: boolean;
  onEdit: () => void;
  onAdd: () => void;
  onDelete: () => void;
  onCancel: () => void;
  onSave: (text: string, type: EditableBlockType) => Promise<string | undefined>;
  onInsert: (text: string, type: EditableBlockType) => Promise<string | undefined>;
}) {
  const block = entry.current ?? entry.previous;
  if (!block) return null;
  if (entry.status === "removed") {
    return (
      <li className="author-block author-block--removed">
        <span className="author-block__type">{TYPE_LABEL[block.type]} · Deleted in this draft</span>
        <p className="author-block__text"><del>{blockText(block)}</del></p>
      </li>
    );
  }
  const current = entry.current as ContentBlock;
  return (
    <li className={`author-block author-block--${entry.status}`} id={current.id}>
      <span className="author-block__type">
        {TYPE_LABEL[current.type]}
        {entry.status !== "unchanged" && (
          <span className={`change-badge change-badge--static change-badge--${entry.status}`}>
            {entry.status === "added" ? "New" : "Edited"}
          </span>
        )}
      </span>
      {editing && isEditable(current) ? (
        <BlockEditor
          idPrefix={`edit-${current.id}`}
          initialText={blockText(current)}
          initialType={current.type}
          onCancel={onCancel}
          onSubmit={onSave}
          submitLabel="Save"
          warning={hasLinks(current) ? "Links in this paragraph become plain text when you save it." : undefined}
        />
      ) : (
        <p className="author-block__text">{blockText(current)}</p>
      )}
      {!editing && (
        <div className="author-actions">
          {isEditable(current) && (
            <button className="button button--secondary" onClick={onEdit} type="button">Edit</button>
          )}
          <button className="button button--secondary" onClick={onAdd} type="button">Add below</button>
          <button className="button button--danger" onClick={onDelete} type="button">Delete</button>
        </div>
      )}
      {adding && (
        <BlockEditor
          idPrefix={`add-${current.id}`}
          initialText=""
          initialType="para"
          onCancel={onCancel}
          onSubmit={onInsert}
          submitLabel="Add"
        />
      )}
    </li>
  );
}

export function AuthorPage() {
  const { docId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState<DraftState>({ status: "loading" });
  const [topic, setTopic] = useState<NodeChangesResponse>();
  const [topicError, setTopicError] = useState<ApiClientError>();
  const [mode, setMode] = useState<{ kind: "edit" | "add"; blockId: string } | { kind: "add-first" } | { kind: "add-topic" }>();
  const [message, setMessage] = useState<string>();
  const [titleDraft, setTitleDraft] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const draft = state.status === "ready" ? state.draft : undefined;
  const topicId = params.get("topicId") ?? (draft ? firstTopicId(draft) : undefined);

  useEffect(() => {
    const controller = new AbortController();
    void getDraftFromApi(docId, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) setState({ status: "ready", draft: result.data });
      else if (result.error.code === "NO_DRAFT") setState({ status: "none" });
      else setState({ status: "error", error: result.error });
    });
    return () => controller.abort();
  }, [docId, attempt]);

  const loadTopic = useCallback(() => {
    if (!draft || !topicId) return undefined;
    const controller = new AbortController();
    setTopicError(undefined);
    void getDraftTopicFromApi(docId, topicId, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) setTopic(result.data);
      else setTopicError(result.error);
    });
    return () => controller.abort();
    // The draft's update time changes after every edit, so the topic reloads with it.
  }, [docId, topicId, draft?.updatedAt]);

  useEffect(() => loadTopic(), [loadTopic]);

  const refreshDraft = async () => {
    const result = await getDraftFromApi(docId);
    if (result.ok) setState({ status: "ready", draft: result.data });
  };

  /** Apply a topic edit; returns an error message for the form, if any. */
  const applyTopicEdit = async (call: Promise<ApiResult<NodeChangesResponse>>) => {
    const result = await call;
    if (!result.ok) return result.error.message;
    setTopic(result.data);
    setMode(undefined);
    await refreshDraft();
    return undefined;
  };

  const start = async () => {
    setState({ status: "loading" });
    const result = await startDraftFromApi(docId);
    setState(result.ok ? { status: "ready", draft: result.data } : { status: "error", error: result.error });
  };

  const selectTopic = (id: string) => {
    setMode(undefined);
    setTitleDraft(undefined);
    setParams({ topicId: id }, { replace: true });
  };

  if (state.status === "loading") return <LoadingState label="Loading the draft…" />;
  if (state.status === "error") {
    return (
      <main className="reader-error">
        <Link className="button button--secondary" to="/">Back to library</Link>
        <h1>Author mode unavailable</h1>
        <ApiErrorState error={state.error} onRetry={() => setAttempt((value) => value + 1)} />
      </main>
    );
  }
  if (state.status === "none") {
    return (
      <main className="author-start">
        <p className="eyebrow">Author mode · {docId}</p>
        <h1>Start a new revision</h1>
        <p>
          A draft is a private copy of the latest revision. Your edits change only the draft; pilots keep
          reading the published revisions until you publish it as a new revision.
        </p>
        <div className="author-actions">
          <button className="button button--primary" onClick={() => void start()} type="button">
            Start draft
          </button>
          <Link className="button button--secondary" to="/">Back to library</Link>
        </div>
      </main>
    );
  }

  const ready = state.draft;
  const outlineTopic = ready.chapters
    .flatMap((chapter) => chapter.sections)
    .flatMap((section) => section.topics)
    .find((entry) => entry.id === topicId);

  return (
    <main className="author-page">
      <header className="efb-bar">
        <div className="efb-bar__title">
          <Link className="efb-bar__brand" to="/">EFB content</Link>
          <span aria-hidden="true" className="efb-bar__divider" />
          <span>Author mode · {docId}</span>
        </div>
        <div className="efb-bar__status">
          <span className="efb-chip">Draft of Revision {ready.nextRevision}, from Revision {ready.baseRevision}</span>
          <Link
            className="button button--secondary"
            to={`/reader/${encodeURIComponent(docId)}/${ready.baseRevision}${topicId ? `?topicId=${encodeURIComponent(topicId)}` : ""}`}
          >
            Close
          </Link>
        </div>
      </header>
      {message && <p className="search-notice" role="status">{message}</p>}
      <div className="author-layout">
        <nav aria-label="Draft contents" className="author-outline">
          {ready.chapters.map((chapter) => (
            <section key={chapter.id}>
              <h2>{chapter.number} {chapter.title}</h2>
              {chapter.sections.map((section) => (
                <div key={section.id}>
                  <h3>{section.number} {section.title}</h3>
                  <ul>
                    {section.topics.map((entry) => (
                      <li key={entry.id}>
                        <button
                          aria-current={entry.id === topicId ? "page" : undefined}
                          className="author-outline__topic"
                          onClick={() => selectTopic(entry.id)}
                          type="button"
                        >
                          {entry.number} {entry.title}
                          {entry.id.includes("-new-") && <span className="author-outline__new">New</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </nav>

        <section aria-label="Topic editor" className="author-main">
          {topicError && <ApiErrorState error={topicError} onRetry={() => loadTopic()} />}
          {!topic || !outlineTopic ? (
            !topicError && <LoadingState label="Loading the topic…" />
          ) : (
            <>
              <div className="author-topic-heading">
                {titleDraft === undefined ? (
                  <>
                    <h1>{outlineTopic.number} {outlineTopic.title}</h1>
                    <div className="author-actions">
                      <button className="button button--secondary" onClick={() => setTitleDraft(outlineTopic.title)} type="button">
                        Rename
                      </button>
                      <button className="button button--secondary" onClick={() => setMode({ kind: "add-topic" })} type="button">
                        Add topic after
                      </button>
                      <button
                        className="button button--danger"
                        onClick={async () => {
                          if (!window.confirm(`Delete topic ${outlineTopic.number} ${outlineTopic.title} from the draft?`)) return;
                          const result = await deleteDraftTopicFromApi(docId, outlineTopic.id);
                          if (!result.ok) return setMessage(result.error.message);
                          setState({ status: "ready", draft: result.data });
                          setTopic(undefined);
                          setMessage(`Deleted ${outlineTopic.number} ${outlineTopic.title} from the draft.`);
                          setParams({}, { replace: true });
                        }}
                        type="button"
                      >
                        Delete topic
                      </button>
                    </div>
                  </>
                ) : (
                  <form
                    className="author-editor"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      const error = await applyTopicEdit(renameDraftTopicFromApi(docId, outlineTopic.id, titleDraft));
                      if (error) setMessage(error);
                      else setTitleDraft(undefined);
                    }}
                  >
                    <label className="author-field" htmlFor="topic-title">
                      Topic title
                      <input id="topic-title" maxLength={200} onChange={(event) => setTitleDraft(event.target.value)} value={titleDraft} />
                    </label>
                    <div className="author-actions">
                      <button className="button button--primary" type="submit">Save title</button>
                      <button className="button button--secondary" onClick={() => setTitleDraft(undefined)} type="button">Cancel</button>
                    </div>
                  </form>
                )}
              </div>

              {mode?.kind === "add-topic" && (
                <NewTopicForm
                  onCancel={() => setMode(undefined)}
                  onSubmit={async (title, text) => {
                    const result = await addDraftTopicFromApi(docId, outlineTopic.id, title, text);
                    if (!result.ok) return result.error.message;
                    setState({ status: "ready", draft: result.data });
                    setMode(undefined);
                    selectTopic(result.data.topicId);
                    return undefined;
                  }}
                />
              )}

              <div className="author-actions">
                <button className="button button--secondary" onClick={() => setMode({ kind: "add-first" })} type="button">
                  Add at the start
                </button>
              </div>
              {mode?.kind === "add-first" && (
                <BlockEditor
                  idPrefix="add-first"
                  initialText=""
                  initialType="para"
                  onCancel={() => setMode(undefined)}
                  onSubmit={(text, type) => applyTopicEdit(addDraftBlockFromApi(docId, outlineTopic.id, null, type, text))}
                  submitLabel="Add"
                />
              )}
              <ol className="author-blocks">
                {topic.blocks.map((entry) => (
                  <BlockCard
                    adding={mode?.kind === "add" && mode.blockId === entry.id}
                    editing={mode?.kind === "edit" && mode.blockId === entry.id}
                    entry={entry}
                    key={`${entry.status}-${entry.id}`}
                    onAdd={() => setMode({ kind: "add", blockId: entry.id })}
                    onCancel={() => setMode(undefined)}
                    onDelete={async () => {
                      if (!window.confirm("Delete this block from the draft?")) return;
                      const error = await applyTopicEdit(deleteDraftBlockFromApi(docId, outlineTopic.id, entry.id));
                      if (error) setMessage(error);
                    }}
                    onEdit={() => setMode({ kind: "edit", blockId: entry.id })}
                    onInsert={(text, type) => applyTopicEdit(addDraftBlockFromApi(docId, outlineTopic.id, entry.id, type, text))}
                    onSave={(text, type) => applyTopicEdit(updateDraftBlockFromApi(docId, outlineTopic.id, entry.id, text, type))}
                  />
                ))}
              </ol>
            </>
          )}
        </section>

        <PublishPanel
          draft={ready}
          onDiscard={async () => {
            if (!window.confirm("Discard the whole draft? Your edits cannot be recovered.")) return;
            const result = await discardDraftFromApi(docId);
            if (!result.ok) return setMessage(result.error.message);
            navigate(`/reader/${encodeURIComponent(docId)}/${ready.baseRevision}`);
          }}
          onPublish={async (summary, effectiveDate) => {
            const result = await publishDraftFromApi(docId, summary, effectiveDate);
            if (!result.ok) return result.error.message;
            const target = topicId ? `?topicId=${encodeURIComponent(topicId)}` : "";
            navigate(`/reader/${encodeURIComponent(docId)}/${result.data.revision}${target}`);
            return undefined;
          }}
          onSelectTopic={selectTopic}
        />
      </div>
    </main>
  );
}

function NewTopicForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (title: string, text: string) => Promise<string | undefined>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  return (
    <form
      className="author-editor"
      onSubmit={async (event) => {
        event.preventDefault();
        setError(await onSubmit(title, text));
      }}
    >
      <label className="author-field" htmlFor="new-topic-title">
        New topic title
        <input id="new-topic-title" maxLength={200} onChange={(event) => setTitle(event.target.value)} value={title} />
      </label>
      <label className="author-field" htmlFor="new-topic-text">
        First paragraph
        <textarea id="new-topic-text" maxLength={4000} onChange={(event) => setText(event.target.value)} rows={4} value={text} />
      </label>
      {error && <p className="author-error" role="alert">{error}</p>}
      <div className="author-actions">
        <button className="button button--primary" disabled={!title.trim() || !text.trim()} type="submit">Add topic</button>
        <button className="button button--secondary" onClick={onCancel} type="button">Cancel</button>
      </div>
    </form>
  );
}

function PublishPanel({
  draft,
  onPublish,
  onDiscard,
  onSelectTopic,
}: {
  draft: DraftResponse;
  onPublish: (summary: string, effectiveDate: string) => Promise<string | undefined>;
  onDiscard: () => void;
  onSelectTopic: (topicId: string) => void;
}) {
  const [summary, setSummary] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(draft.earliestEffectiveDate);
  const [error, setError] = useState<string>();
  const [publishing, setPublishing] = useState(false);
  const total = Object.values(draft.summary).reduce((sum, value) => sum + value, 0);
  const blockCount =
    draft.changes.blocks.modified.length + draft.changes.blocks.added.length + draft.changes.blocks.removed.length;
  const changedTopics = [
    ...draft.changes.topics.added.map((topic) => ({ ...topic, kind: "Added" })),
    ...draft.changes.topics.modified.map((topic) => ({ ...topic, kind: "Edited" })),
    ...draft.changes.topics.moved.map((topic) => ({ ...topic, kind: "Moved" })),
  ];
  return (
    <aside aria-label="Draft changes and publishing" className="author-panel">
      <h2>Changes in this draft</h2>
      <p className="author-panel__counts">
        {draft.summary.modified} edited · {draft.summary.added} added · {draft.summary.removed} deleted topics;{" "}
        {blockCount} {blockCount === 1 ? "block" : "blocks"} changed
      </p>
      {changedTopics.length > 0 && (
        <ul className="author-panel__topics">
          {changedTopics.map((topic) => (
            <li key={topic.id}>
              <button className="text-button" onClick={() => onSelectTopic(topic.id)} type="button">
                {topic.number} {topic.title}
              </button>{" "}
              <span className="author-panel__kind">{topic.kind}</span>
            </li>
          ))}
          {draft.changes.topics.removed.map((topic) => (
            <li key={topic.id}>
              <span className="author-panel__deleted">{topic.number} {topic.title}</span>{" "}
              <span className="author-panel__kind">Deleted</span>
            </li>
          ))}
        </ul>
      )}
      <form
        className="author-editor"
        onSubmit={async (event) => {
          event.preventDefault();
          setPublishing(true);
          setError(await onPublish(summary, effectiveDate));
          setPublishing(false);
        }}
      >
        <h2>Publish as Revision {draft.nextRevision}</h2>
        <label className="author-field" htmlFor="change-summary">
          Change summary (shown to pilots)
          <textarea id="change-summary" maxLength={1000} onChange={(event) => setSummary(event.target.value)} rows={3} value={summary} />
        </label>
        <label className="author-field" htmlFor="effective-date">
          Effective date
          <input
            id="effective-date"
            min={draft.earliestEffectiveDate}
            onChange={(event) => setEffectiveDate(event.target.value)}
            type="date"
            value={effectiveDate}
          />
        </label>
        <p className="author-panel__hint">
          On or after {draft.earliestEffectiveDate}. Until that date pilots see it as Upcoming.
        </p>
        {error && <p className="author-error" role="alert">{error}</p>}
        <button className="button button--primary" disabled={publishing || total === 0 || !summary.trim()} type="submit">
          {publishing ? "Publishing…" : `Publish Revision ${draft.nextRevision}`}
        </button>
      </form>
      <button className="button button--danger author-panel__discard" onClick={onDiscard} type="button">
        Discard draft
      </button>
    </aside>
  );
}
