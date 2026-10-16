import { useEffect, useRef, useState } from "react";
import { blockText, useAnnotations, type Annotation } from "../annotations/annotations";
import type { TopicContentResponse } from "../types/api";

const KIND_LABEL: Record<Annotation["kind"], string> = {
  note: "Your note",
  highlight: "Your highlight",
  bookmark: "Your bookmark",
};

/**
 * Shown when the open topic is in a different revision from the one an annotation was made in,
 * and the annotated text has changed or is no longer in this topic. Nothing is deleted unless
 * the pilot chooses Delete.
 */
export function AffectedAnnotations({
  docId,
  revision,
  topic,
}: {
  docId: string;
  revision: number;
  topic: TopicContentResponse["topic"];
}) {
  const store = useAnnotations();
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const headingRef = useRef<HTMLHeadingElement>(null);

  const earlier = (store?.annotations ?? []).filter(
    (annotation) =>
      annotation.docId === docId &&
      annotation.topicId === topic.id &&
      annotation.revision !== revision,
  );
  const reviewed = earlier.map((annotation) => {
    const block = topic.blocks.find((entry) => entry.id === annotation.nodeId);
    const current = block ? blockText(block) : undefined;
    const status =
      current === undefined ? "removed" : current === annotation.text ? "unchanged" : "changed";
    return { annotation, current, status } as const;
  });
  const affected = reviewed.filter((entry) => entry.status !== "unchanged");
  const key = `${topic.id}@${revision}`;
  const open = Boolean(store) && affected.length > 0 && !dismissed.has(key);

  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open, key]);

  if (!store || !open) return null;

  return (
    <div className="dialog-backdrop">
      <div aria-labelledby="affected-heading" aria-modal="true" className="dialog" role="dialog">
        <header className="dialog__header">
          <h2 id="affected-heading" ref={headingRef} tabIndex={-1}>
            Annotations affected by this revision
          </h2>
          <p>
            Revision {revision} changed or removed text you annotated in {topic.number}{" "}
            {topic.title}. Nothing has been deleted. Review each one and choose whether to keep it.
          </p>
        </header>
        <ul className="affected-list">
          {affected.map(({ annotation, current, status }) => (
            <li className="affected" key={annotation.id}>
              <span className={`affected__status affected__status--${status}`}>
                {status === "changed" ? "Text changed" : "Removed from this topic"}
              </span>
              <div className="affected__mine">
                <span className="affected__label">{KIND_LABEL[annotation.kind]}</span>
                {annotation.note && <p>{annotation.note}</p>}
              </div>
              <div className="affected__then">
                <span className="affected__label">
                  As it read when you annotated it (Revision {annotation.revision})
                </span>
                <p>{annotation.text}</p>
              </div>
              {current !== undefined && (
                <div className="affected__now">
                  <span className="affected__label">Current text</span>
                  <p>{current}</p>
                </div>
              )}
              <div className="affected__actions">
                {current !== undefined && (
                  <button
                    className="button button--primary"
                    onClick={() => store.keep(annotation.id, revision, current)}
                    type="button"
                  >
                    Keep annotation
                  </button>
                )}
                <button
                  className="button button--secondary"
                  onClick={() => store.remove(annotation.id)}
                  type="button"
                >
                  Delete
                </button>
                <span className="affected__hint">
                  {current !== undefined
                    ? "Keeping re-anchors it to the current wording."
                    : `The text it referred to is not in this topic in Revision ${revision}.`}
                </span>
              </div>
            </li>
          ))}
        </ul>
        <footer className="dialog__footer">
          <span>
            {affected.length} of {earlier.length} annotations affected ·{" "}
            {earlier.length - affected.length} carried over unchanged
          </span>
          <button
            className="button button--secondary"
            onClick={() => setDismissed((previous) => new Set(previous).add(key))}
            type="button"
          >
            Review later
          </button>
        </footer>
      </div>
    </div>
  );
}
