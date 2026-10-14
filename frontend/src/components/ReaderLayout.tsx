import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { formatDate } from "../utils/formatDate";
import { TopBar } from "./TopBar";

/** The reader's page frame: top bar, contents sidebar, breadcrumbs, content, and the right panel. */
export function ReaderLayout({
  title,
  detail,
  breadcrumbs,
  navigationOpen,
  onNavigationOpenChange,
  outline,
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
  return (
    <main className={`reader-page${navigationOpen ? " reader-page--navigation-open" : ""}`}>
      <TopBar detail={detail} title={title}>
        <Link className="button button--secondary" to="/">Back to library</Link>
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
          <div className="reader-content">{children}</div>
        </section>
        <aside aria-label="On this page" className="reader-aside">
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
