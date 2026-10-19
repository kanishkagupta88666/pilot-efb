import { AnnotationIcon } from "./Icons";
import { shorten, useAnnotations, type AnnotationKind } from "../annotations/annotations";

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

/** Right-panel section: annotation counts for this manual, and jump links for this topic's. */
export function YourAnnotations({ docId, topicId }: { docId: string; topicId?: string }) {
  const store = useAnnotations();
  if (!store) return null;

  const inManual = store.annotations.filter((annotation) => annotation.docId === docId);
  const inTopic = inManual.filter((annotation) => annotation.topicId === topicId);

  const jumpTo = (annotationId: string, nodeId: string) => {
    const target =
      document.querySelector(`[data-annotation-ids~="${annotationId}"]`) ??
      document.getElementById(nodeId);
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
            <dd>{inManual.filter((annotation) => annotation.kind === kind).length}</dd>
          </div>
        ))}
      </dl>
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
                <span className="page-nav__preview">{shorten(annotation.note ?? annotation.quote)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
