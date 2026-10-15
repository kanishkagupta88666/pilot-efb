import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  getNodeChangesFromApi,
  getRevisionChangesFromApi,
  type ApiClientError,
} from "../api/client";
import type {
  BlockChange,
  ManifestTopic,
  NodeChangesResponse,
  RevisionChangesResponse,
} from "../types/api";
import { blockText } from "./ChangeMarkers";
import { recordAudit } from "../utils/auditLog";
import { ApiErrorState, LoadingState } from "./RequestStates";

type Kind = "modified" | "added" | "removed" | "moved";
const KINDS: Kind[] = ["modified", "added", "removed", "moved"];

interface Row {
  topic: ManifestTopic;
  kinds: Kind[];
}

function parseRevision(value: string | null): number | undefined {
  return value !== null && /^(0|[1-9]\d*)$/.test(value) ? Number(value) : undefined;
}

/** Sort key for a dotted number such as 05.10.16. */
function numberKey(value: string): number[] {
  return value.split(".").map((part) => Number(part));
}

function compareNumbers(a: string, b: string): number {
  const left = numberKey(a);
  const right = numberKey(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? -1) - (right[index] ?? -1);
    if (difference) return difference;
  }
  return 0;
}

function BlockSide({ change, side }: { change: BlockChange; side: "previous" | "current" }) {
  const block = side === "previous" ? change.previous : change.current;
  if (!block) return <div className="compare-block compare-block--empty" />;
  const hidden = side === "previous" ? "insert" : "delete";
  return (
    <div className={`compare-block compare-block--${change.status}`}>
      {change.status !== "unchanged" && (
        <span className={`change-badge change-badge--static change-badge--${change.status}`}>
          {change.status}
        </span>
      )}
      <p className={side === "previous" ? "compare-block__text compare-block__text--previous" : "compare-block__text"}>
        {change.diff
          ? change.diff
              .filter((run) => run.op !== hidden)
              .map((run, index) =>
                run.op === "equal" ? (
                  <span key={index}>{run.text}</span>
                ) : run.op === "delete" ? (
                  <del className="diff-text__deleted" key={index}>{run.text}</del>
                ) : (
                  <ins className="diff-text__inserted" key={index}>{run.text}</ins>
                ),
              )
          : blockText(block)}
      </p>
    </div>
  );
}

function TopicComparison({ docId, row, from, to }: { docId: string; row: Row; from: number; to: number }) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "error"; error: ApiClientError } | { status: "ready"; data: NodeChangesResponse }
  >({ status: "loading" });
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void getNodeChangesFromApi(docId, row.topic.id, from, to, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setState(result.ok ? { status: "ready", data: result.data } : { status: "error", error: result.error });
    });
    return () => controller.abort();
  }, [docId, row.topic.id, from, to, attempt]);

  if (state.status === "loading") return <LoadingState label="Loading comparison…" />;
  if (state.status === "error") {
    return <ApiErrorState error={state.error} onRetry={() => setAttempt((value) => value + 1)} />;
  }

  const { data } = state;
  const unchanged = data.blocks.filter((block) => block.status === "unchanged").length;
  const visible = showUnchanged ? data.blocks : data.blocks.filter((block) => block.status !== "unchanged");
  return (
    <div className="compare-detail">
      <div className="compare-columns compare-columns--heading">
        <p>
          {data.previous ? `${data.previous.number} ${data.previous.title}` : "Not in this revision"}
        </p>
        <p>
          {data.current ? `${data.current.number} ${data.current.title}` : "Removed in this revision"}
        </p>
      </div>
      {visible.map((change) => (
        <div className="compare-columns" key={change.id}>
          <BlockSide change={change} side="previous" />
          <BlockSide change={change} side="current" />
        </div>
      ))}
      <div className="compare-detail__actions">
        {unchanged > 0 && (
          <button className="text-button" onClick={() => setShowUnchanged((value) => !value)} type="button">
            {showUnchanged ? "Hide" : "Show"} {unchanged} unchanged {unchanged === 1 ? "block" : "blocks"}
          </button>
        )}
        {data.current && (
          <Link to={`/open?doc=${encodeURIComponent(docId)}&node=${encodeURIComponent(data.topicId)}&rev=${to}`}>
            Open in reader
          </Link>
        )}
      </div>
    </div>
  );
}

export function ComparePage() {
  const { docId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const from = parseRevision(searchParams.get("from"));
  const to = parseRevision(searchParams.get("to"));
  const [state, setState] = useState<
    { status: "loading" } | { status: "error"; error: ApiClientError } | { status: "ready"; data: RevisionChangesResponse }
  >({ status: "loading" });
  const [filter, setFilter] = useState<Kind | "all">("all");
  const [openTopic, setOpenTopic] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void getRevisionChangesFromApi(docId, from, to, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setState(result.ok ? { status: "ready", data: result.data } : { status: "error", error: result.error });
      if (result.ok) {
        void recordAudit("revision.compared", {
          documentId: docId,
          revision: result.data.toRevision,
          details: { fromRevision: result.data.fromRevision, summary: result.data.summary },
        });
      }
    });
    return () => controller.abort();
  }, [docId, from, to, attempt]);

  const rows = useMemo(() => {
    if (state.status !== "ready") return [];
    const byId = new Map<string, Row>();
    for (const kind of KINDS) {
      for (const topic of state.data.topics[kind]) {
        const row = byId.get(topic.id) ?? { topic, kinds: [] };
        row.kinds.push(kind);
        byId.set(topic.id, row);
      }
    }
    return [...byId.values()].sort((a, b) => compareNumbers(a.topic.number, b.topic.number));
  }, [state]);

  if (state.status === "loading") return <LoadingState label="Loading revision comparison…" />;
  if (state.status === "error") {
    return (
      <main className="reader-error">
        <Link className="button button--secondary" to="/">Back to library</Link>
        <h1>Comparison unavailable</h1>
        <ApiErrorState error={state.error} onRetry={() => setAttempt((value) => value + 1)} />
      </main>
    );
  }

  const { data } = state;
  const shown = filter === "all" ? rows : rows.filter((row) => row.kinds.includes(filter));
  return (
    <main className="compare-page">
      <header className="reader-toolbar">
        <Link className="reader-brand" to="/">Pilot EFB</Link>
        <Link className="button button--secondary" to={`/reader/${encodeURIComponent(docId)}/${data.toRevision}`}>
          Back to reader
        </Link>
      </header>
      <section className="compare-summary">
        <div>
          <p className="eyebrow">Full revision comparison</p>
          <h1>{data.docId}: Revision {data.fromRevision} → Revision {data.toRevision}</h1>
        </div>
        <div className="compare-filters" role="group" aria-label="Filter changes">
          <button
            aria-pressed={filter === "all"}
            className="compare-filter"
            onClick={() => setFilter("all")}
            type="button"
          >
            All <strong>{rows.length}</strong>
          </button>
          {KINDS.map((kind) => (
            <button
              aria-pressed={filter === kind}
              className={`compare-filter compare-filter--${kind}`}
              key={kind}
              onClick={() => setFilter(kind)}
              type="button"
            >
              {kind} <strong>{data.summary[kind]}</strong>
            </button>
          ))}
        </div>
      </section>
      <ul className="compare-list">
        {shown.map((row) => {
          const open = openTopic === row.topic.id;
          return (
            <li className="compare-row" key={row.topic.id}>
              <button
                aria-expanded={open}
                className="compare-row__toggle"
                onClick={() => setOpenTopic(open ? undefined : row.topic.id)}
                type="button"
              >
                <span className="compare-row__number">{row.topic.number}</span>
                <span className="compare-row__title">{row.topic.title}</span>
                {row.topic.from && (
                  <span className="compare-row__moved">from {row.topic.from}</span>
                )}
                <span className="compare-row__badges">
                  {row.kinds.map((kind) => (
                    <span className={`change-badge change-badge--static change-badge--${kind}`} key={kind}>
                      {kind}
                    </span>
                  ))}
                </span>
              </button>
              {open && (
                <TopicComparison docId={docId} from={data.fromRevision} row={row} to={data.toRevision} />
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
