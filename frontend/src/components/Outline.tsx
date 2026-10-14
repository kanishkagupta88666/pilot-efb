import { useEffect, useRef } from "react";
import type { Chapter, Section, Topic } from "../types/api";

type OutlineTopic = Topic & { mock?: true };
type OutlineSection = Omit<Section, "topics"> & {
  topics: OutlineTopic[];
  mock?: true;
};
export type OutlineChapter = Omit<Chapter, "sections"> & {
  sections: OutlineSection[];
  mock?: true;
};

/** Titles from the chapter down to the given topic, for the breadcrumb line. */
export function topicTrail(chapters: OutlineChapter[], topicId?: string): string[] {
  for (const chapter of chapters) {
    for (const section of chapter.sections) {
      const topic = section.topics.find((entry) => entry.id === topicId);
      if (topic) return [chapter.title, section.title, topic.title];
    }
  }
  return [];
}

function OutlineLabel({
  number,
  title,
  mock,
}: {
  number: string;
  title: string;
  mock?: true;
}) {
  return (
    <>
      <span className="outline-label">
        <span className="outline-number">{number}</span>{" "}
        <span>{title}</span>
      </span>
      {mock && <span className="mock-badge">MOCK</span>}
    </>
  );
}

function Disclosure() {
  return (
    <span aria-hidden="true" className="disclosure-indicator">›</span>
  );
}

export function Outline({
  chapters,
  activeTopicId,
  expandedChapters,
  expandedSections,
  targetId,
  onToggleChapter,
  onToggleSection,
  onSelectTopic,
}: {
  chapters: OutlineChapter[];
  activeTopicId: string;
  expandedChapters: Set<string>;
  expandedSections: Set<string>;
  targetId?: string;
  onToggleChapter: (id: string) => void;
  onToggleSection: (id: string) => void;
  onSelectTopic: (id: string) => void;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);

  // Keep the open topic visible in the sidebar, e.g. after a deep link opens a topic far down the list.
  useEffect(() => {
    const button = activeRef.current;
    const panel = button?.closest<HTMLElement>(".reader-navigation");
    if (!button || !panel) return;
    const buttonBox = button.getBoundingClientRect();
    const panelBox = panel.getBoundingClientRect();
    if (buttonBox.top < panelBox.top || buttonBox.bottom > panelBox.bottom) {
      panel.scrollTop += buttonBox.top - panelBox.top - panelBox.height / 3;
    }
  }, [activeTopicId, expandedSections]);

  return (
    <ul className="outline-chapter-list">
      {chapters.map((chapter) => {
        const chapterExpanded = expandedChapters.has(chapter.id);
        return (
          <li className="outline-chapter" key={chapter.id}>
            <button
              aria-expanded={chapterExpanded}
              className={`outline-toggle outline-toggle--chapter${targetId === chapter.id ? " content-block--targeted" : ""}`}
              id={chapter.id}
              onClick={() => onToggleChapter(chapter.id)}
              type="button"
            >
              <Disclosure />
              <OutlineLabel {...chapter} />
            </button>
            {chapterExpanded && (
              <ul className="outline-section-list">
                {chapter.sections.map((section) => {
                  const sectionExpanded = expandedSections.has(section.id);
                  return (
                    <li className="outline-section" key={section.id}>
                      <button
                        aria-expanded={sectionExpanded}
                        className={`outline-toggle outline-toggle--section${targetId === section.id ? " content-block--targeted" : ""}`}
                        id={section.id}
                        onClick={() => onToggleSection(section.id)}
                        type="button"
                      >
                        <Disclosure />
                        <OutlineLabel {...section} />
                      </button>
                      {sectionExpanded && (
                        <ul className="outline-topic-list">
                          {section.topics.map((topic) => (
                            <li key={topic.id}>
                              <button
                                aria-current={activeTopicId === topic.id ? "page" : undefined}
                                className={`outline-item${activeTopicId === topic.id ? " outline-item--active" : ""}`}
                                onClick={() => onSelectTopic(topic.id)}
                                ref={activeTopicId === topic.id ? activeRef : undefined}
                                type="button"
                              >
                                <OutlineLabel {...topic} />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The right-hand panel: the topics that share a section with the open topic. */
export function SectionTopics({
  chapters,
  activeTopicId,
  onSelectTopic,
}: {
  chapters: OutlineChapter[];
  activeTopicId: string;
  onSelectTopic: (id: string) => void;
}) {
  const section = chapters
    .flatMap((chapter) => chapter.sections)
    .find((entry) => entry.topics.some((topic) => topic.id === activeTopicId));
  if (!section) return null;

  return (
    <>
      <h2>In this section</h2>
      <p className="section-topics__section">
        <span className="outline-number">{section.number}</span>{" "}
        {section.title}
      </p>
      <ul className="section-topics">
        {section.topics.map((topic) => (
          <li key={topic.id}>
            <button
              aria-current={topic.id === activeTopicId ? "true" : undefined}
              onClick={() => onSelectTopic(topic.id)}
              type="button"
            >
              <span className="outline-number">{topic.number}</span>{" "}
              {topic.title}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
