import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { getSearchIndexFromApi } from "../api/client";
import type { SearchIndexDocument } from "../types/api";
import { loadIndex, offlineStorageAvailable, saveIndex } from "../utils/offlineSearchStore";

export interface ChecklistLink {
  /** Permanent ID of the checklist block; the link lands on it. */
  id: string;
  number: string;
  title: string;
}

export interface ChecklistPhase {
  /** The manual section's number, such as "03.10"; two sections can share a title. */
  number: string;
  /** The section's title, such as "Preflight". */
  title: string;
  checklists: ChecklistLink[];
}

export interface ChecklistManual {
  docId: string;
  title: string;
  revision: number;
  phases: ChecklistPhase[];
}

/** Every checklist in the published revisions, grouped by manual and then by section. */
export function checklistManuals(documents: SearchIndexDocument[]): ChecklistManual[] {
  return documents
    .map((document) => {
      const phases: ChecklistPhase[] = [];
      for (const topic of document.topics) {
        const block = topic.blocks.find(([, type]) => type === "checklist");
        if (!block) continue;
        let phase = phases.find((entry) => entry.number === topic.sectionNumber);
        if (!phase) {
          phase = { number: topic.sectionNumber, title: topic.sectionTitle, checklists: [] };
          phases.push(phase);
        }
        phase.checklists.push({ id: block[0], number: topic.number, title: topic.title });
      }
      return { docId: document.docId, title: document.title, revision: document.revision, phases };
    })
    .filter((manual) => manual.phases.length > 0);
}

type Loaded =
  | { status: "loading" }
  | { status: "ready"; manuals: ChecklistManual[] }
  | { status: "unavailable" };

/**
 * The checklists come from the search index, the same text the offline search uses.
 * The copy saved on the device shows at once (and offline); a fresh copy then replaces it.
 */
function useChecklists(): Loaded {
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    let fromServer = false;

    if (offlineStorageAvailable()) {
      loadIndex().then(
        (saved) => {
          if (saved && !fromServer) {
            setLoaded({ status: "ready", manuals: checklistManuals(saved.documents) });
          }
        },
        () => undefined,
      );
    }

    void getSearchIndexFromApi(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) {
        fromServer = true;
        setLoaded({ status: "ready", manuals: checklistManuals(result.data.documents) });
        if (offlineStorageAvailable()) void saveIndex(result.data.documents).catch(() => undefined);
      } else {
        setLoaded((previous) => (previous.status === "ready" ? previous : { status: "unavailable" }));
      }
    });

    return () => controller.abort();
  }, []);

  return loaded;
}

/** The library's first section: checklists by flight phase, each a link to the checklist itself. */
export function ChecklistSection() {
  const loaded = useChecklists();
  const [docId, setDocId] = useState<string>();
  const [phaseNumber, setPhaseNumber] = useState<string>();
  const listRef = useRef<HTMLUListElement>(null);

  // On an iPad the list opens below the phases, often off screen: bring it into view.
  useEffect(() => {
    if (!phaseNumber) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    listRef.current?.scrollIntoView?.({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
  }, [phaseNumber]);

  if (loaded.status === "loading") {
    return (
      <section aria-labelledby="checklists-heading" className="checklist-section">
        <h2 id="checklists-heading">Checklists</h2>
        <p className="checklist-section__hint">Loading checklists…</p>
      </section>
    );
  }
  if (loaded.status === "unavailable" || loaded.manuals.length === 0) {
    return (
      <section aria-labelledby="checklists-heading" className="checklist-section">
        <h2 id="checklists-heading">Checklists</h2>
        <p className="checklist-section__hint">
          {loaded.status === "unavailable"
            ? "Checklists could not be loaded. Open a manual below to find them."
            : "No checklists in the published manuals."}
        </p>
      </section>
    );
  }

  const manual = loaded.manuals.find((entry) => entry.docId === docId) ?? loaded.manuals[0];
  const phase = manual.phases.find((entry) => entry.number === phaseNumber);

  return (
    <section aria-labelledby="checklists-heading" className="checklist-section">
      <div className="checklist-section__header">
        <h2 id="checklists-heading">Checklists</h2>
        {loaded.manuals.length > 1 && (
          <div aria-label="Manual" className="view-mode" role="group">
            {loaded.manuals.map((entry) => (
              <button
                aria-pressed={entry.docId === manual.docId}
                className="view-mode__option"
                key={entry.docId}
                onClick={() => {
                  setDocId(entry.docId);
                  setPhaseNumber(undefined);
                }}
                title={entry.title}
                type="button"
              >
                {entry.docId}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="checklist-section__hint">
        {manual.title}, Revision {manual.revision}. Choose a phase, then a checklist.
      </p>
      <div className="checklist-phases">
        {manual.phases.map((entry) => (
          <button
            aria-expanded={entry === phase}
            className="checklist-phase"
            key={entry.number}
            onClick={() => setPhaseNumber(entry === phase ? undefined : entry.number)}
            type="button"
          >
            <span>{entry.title}</span>
            <span className="checklist-phase__count">{entry.checklists.length}</span>
          </button>
        ))}
      </div>
      {phase && (
        <ul aria-label={`${phase.title} checklists`} className="checklist-links" ref={listRef}>
          {phase.checklists.map((checklist) => (
            <li key={checklist.id}>
              <Link
                to={`/open?doc=${encodeURIComponent(manual.docId)}&node=${encodeURIComponent(checklist.id)}&rev=${manual.revision}`}
              >
                <span className="outline-number">{checklist.number}</span>
                {checklist.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
