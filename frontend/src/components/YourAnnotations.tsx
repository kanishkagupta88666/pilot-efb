import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { AnnotationIcon } from "./Icons";
import { shorten, useAnnotations, type AnnotationKind } from "../annotations/annotations";
import type { AnnotationStatus } from "../types/api";
import { syncAnnotations } from "../utils/annotationStore";
import { getProfile, setProfile } from "../utils/deviceIdentity";

const KINDS: { kind: AnnotationKind; label: string }[] = [
  { kind: "highlight", label: "Highlights" },
  { kind: "note", label: "Notes" },
  { kind: "bookmark", label: "Bookmarks" },
];

const SINGULAR: Record<AnnotationKind, string> = {
  highlight: "Highlight",
  note: "Note",
  bookmark: "Bookmark",
};

/** Asks for the pilot's name once, so their annotations follow them to other devices. */
function NamePrompt() {
  const [name, setName] = useState("");
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    setProfile({ ...getProfile(), name });
    window.dispatchEvent(new Event("pilot-efb-profile"));
    // Bring in anything this pilot annotated on other devices.
    void syncAnnotations();
  };
  return (
    <form className="name-prompt" onSubmit={save}>
      <label htmlFor="annotation-owner">Your name</label>
      <p>Add your name so your annotations are saved and follow you to other devices.</p>
      <div className="name-prompt__row">
        <input
          autoComplete="name"
          id="annotation-owner"
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          value={name}
        />
        <button className="button button--primary" disabled={!name.trim()} type="submit">
          Save
        </button>
      </div>
    </form>
  );
}

/**
 * Right-panel section: annotation counts for this manual and jump links for this topic's
 * annotations (bookmarks are made by selecting words). With `statuses` from the server (API mode), it also
 * lists annotations whose text moved to another topic in this revision.
 */
export function YourAnnotations({
  docId,
  revision,
  topic,
  statuses,
  offline = false,
}: {
  docId: string;
  revision?: number;
  topic?: { id: string; number: string };
  statuses?: Map<string, AnnotationStatus>;
  offline?: boolean;
}) {
  const store = useAnnotations();
  const [hasName, setHasName] = useState(() => Boolean(getProfile().name));
  useEffect(() => {
    const refresh = () => setHasName(Boolean(getProfile().name));
    window.addEventListener("pilot-efb-profile", refresh);
    return () => window.removeEventListener("pilot-efb-profile", refresh);
  }, []);
  if (!store) return null;

  const inManual = store.annotations.filter((annotation) => annotation.documentId === docId);
  const live = inManual.filter((annotation) => !annotation.detached);
  const inTopic = live.filter((annotation) => annotation.topicId === topic?.id);
  const kept = inManual.filter((annotation) => annotation.detached);
  const elsewhere = live.filter((annotation) => {
    const status = statuses?.get(annotation.id);
    return status?.changed && status.topicId && status.topicId !== topic?.id;
  });

  const jumpTo = (annotationId: string, nodeId: string) => {
    const target =
      document.querySelector(`[data-annotation-ids~="${annotationId}"]`) ??
      (nodeId ? document.getElementById(nodeId) : null);
    if (typeof target?.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  return (
    <section aria-labelledby="your-annotations-heading" className="your-annotations">
      <h2 id="your-annotations-heading">Your annotations</h2>
      <dl className="your-annotations__counts">
        {KINDS.map(({ kind, label }) => (
          <div key={kind}>
            <dt>
              <AnnotationIcon kind={kind} />
              {label}
            </dt>
            <dd>{live.filter((annotation) => annotation.kind === kind).length}</dd>
          </div>
        ))}
      </dl>
      {!hasName && <NamePrompt />}
      {offline && (
        <p className="page-nav__empty">
          Offline: changes to annotated text are checked when you are back online.
        </p>
      )}
      {inTopic.length === 0 ? (
        <p className="page-nav__empty">
          Select words in the text to highlight, bookmark or add a note.
        </p>
      ) : (
        <ul className="page-nav">
          {inTopic.map((annotation) => (
            <li key={annotation.id}>
              <button
                className={`page-nav__item page-nav__item--${annotation.kind}`}
                onClick={() => jumpTo(annotation.id, annotation.nodeId)}
                type="button"
              >
                <span className="page-nav__label">
                  <AnnotationIcon kind={annotation.kind} />
                  {SINGULAR[annotation.kind]}
                </span>
                <span className="page-nav__preview">
                  {annotation.nodeId ? shorten(annotation.note || annotation.quote) : "Whole topic"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {elsewhere.length > 0 && (
        <div className="your-annotations__group">
          <h3>To review in other topics ({elsewhere.length})</h3>
          <ul className="your-annotations__links">
            {elsewhere.map((annotation) => {
              const status = statuses?.get(annotation.id);
              return (
                <li key={annotation.id}>
                  <Link
                    to={`/reader/${encodeURIComponent(docId)}/${revision}?topicId=${encodeURIComponent(status?.topicId ?? annotation.topicId)}`}
                  >
                    {status?.topicNumber} {status?.topicTitle}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {kept.length > 0 && (
        <div className="your-annotations__group">
          <h3>Kept notes ({kept.length})</h3>
          <ul className="your-annotations__kept">
            {kept.map((annotation) => (
              <li key={annotation.id}>
                <p>{annotation.note}</p>
                <button className="text-button" onClick={() => store.remove(annotation.id)} type="button">
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
