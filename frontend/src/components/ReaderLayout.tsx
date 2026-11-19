import { useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { formatDate } from "../utils/formatDate";
import { PanelIcon } from "./Icons";
import { TopBar } from "./TopBar";

/** A yes/no setting remembered on this device, such as a hidden panel. */
function useStoredFlag(key: string): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(key) === "true";
    } catch {
      return false;
    }
  });
  const update = (next: boolean) => {
    setValue(next);
    try {
      localStorage.setItem(key, String(next));
    } catch {
      // Storage can be unavailable (private browsing); the setting then lasts until reload.
    }
  };
  return [value, update];
}

/** The reader's page frame: top bar, contents sidebar, breadcrumbs, content, and the right panel. */
export function ReaderLayout({
  title,
  detail,
  breadcrumbs,
  navigationOpen,
  onNavigationOpenChange,
  outline,
  actions,
  aside,
  status,
  children,
}: {
  title: string;
  detail: string;
  breadcrumbs: string[];
  navigationOpen: boolean;
  onNavigationOpenChange: (open: boolean) => void;
  outline: ReactNode;
  /** Top-bar buttons before the navigation toggle; defaults to Back to library. */
  actions?: ReactNode;
  aside: ReactNode;
  /** Shown in the status bar pinned to the bottom of the screen. */
  status: {
    number?: string;
    location: string;
    classification: string;
    revision: number;
    effectiveDate: string;
  };
  children: ReactNode;
}) {
  // On wide screens the pilot can hide either side panel so the text uses the full width.
  const [contentsHidden, setContentsHidden] = useStoredFlag("pilot-efb-contents-hidden");
  const [asideHidden, setAsideHidden] = useStoredFlag("pilot-efb-side-panel-hidden");
  const pageClass = [
    "reader-page",
    navigationOpen && "reader-page--navigation-open",
    contentsHidden && "reader-page--contents-hidden",
    asideHidden && "reader-page--aside-hidden",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className={pageClass}>
      <TopBar detail={detail} title={title}>
        {actions ?? <Link className="button button--secondary" to="/">Back to library</Link>}
        <button
          aria-expanded={navigationOpen}
          className="button button--secondary navigation-toggle"
          onClick={() => onNavigationOpenChange(!navigationOpen)}
          type="button"
        >
          {navigationOpen ? "Close navigation" : "Open navigation"}
        </button>
      </TopBar>
      <div className="reader-layout">
        <aside
          aria-label="Document navigation"
          id="reader-contents"
          className={`reader-navigation${navigationOpen ? " reader-navigation--open" : ""}`}
        >
          <div className="navigation-heading">
            <h2>Contents</h2>
            <button
              aria-label="Close navigation"
              className="icon-button navigation-close"
              onClick={() => onNavigationOpenChange(false)}
              type="button"
            >
              ×
            </button>
          </div>
          <p className="navigation-document">{title}</p>
          {outline}
        </aside>
        {navigationOpen && (
          <button
            aria-label="Close navigation drawer"
            className="navigation-backdrop"
            onClick={() => onNavigationOpenChange(false)}
            type="button"
          />
        )}
        <section aria-label="Document content" className="reader-main">
          <div className="reader-main__bar">
            <button
              aria-controls="reader-contents"
              aria-expanded={!contentsHidden}
              className="icon-button panel-toggle panel-toggle--contents"
              onClick={() => setContentsHidden(!contentsHidden)}
              title={contentsHidden ? "Show contents" : "Hide contents"}
              type="button"
            >
              <PanelIcon side="left" />
              <span className="visually-hidden">{contentsHidden ? "Show contents" : "Hide contents"}</span>
            </button>
            <nav aria-label="Breadcrumb" className="breadcrumbs">
              <ol>
                {breadcrumbs.map((crumb, index) => (
                  <li
                    aria-current={index === breadcrumbs.length - 1 ? "page" : undefined}
                    key={`${index}-${crumb}`}
                  >
                    {crumb}
                  </li>
                ))}
              </ol>
            </nav>
            <button
              aria-controls="reader-side-panel"
              aria-expanded={!asideHidden}
              className="icon-button panel-toggle panel-toggle--aside"
              onClick={() => setAsideHidden(!asideHidden)}
              title={asideHidden ? "Show notes panel" : "Hide notes panel"}
              type="button"
            >
              <PanelIcon side="right" />
              <span className="visually-hidden">{asideHidden ? "Show notes panel" : "Hide notes panel"}</span>
            </button>
          </div>
          <div className="reader-content">{children}</div>
        </section>
        <aside aria-label="On this page" className="reader-aside" id="reader-side-panel">
          {aside}
        </aside>
      </div>
      <footer className="status-bar">
        <span className="status-bar__location">
          {status.number && <span className="outline-number">{status.number}</span>}{" "}
          {status.location}
        </span>
        <span className="status-bar__meta">
          <span>{status.classification}</span>
          <span className="status-bar__revision">
            Revision {status.revision} · effective {formatDate(status.effectiveDate)}
          </span>
        </span>
      </footer>
    </main>
  );
}
