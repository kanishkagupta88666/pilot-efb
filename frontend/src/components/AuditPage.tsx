import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getAuditEventsFromApi,
  getDocumentLibraryFromApi,
  verifyAuditFromApi,
  type ApiClientError,
} from "../api/client";
import type { AuditEvent, AuditEventInput, AuditVerification } from "../types/api";
import {
  flushAudit,
  pendingEvents,
  recordAudit,
  subscribeToOutbox,
  type OutboxStatus,
} from "../utils/auditLog";
import {
  ACTOR_ROLES,
  deviceId,
  getProfile,
  setProfile,
  type ActorRole,
} from "../utils/deviceIdentity";
import { ApiErrorState } from "./RequestStates";

const ROLE_LABEL: Record<string, string> = {
  pilot: "Pilot",
  author: "Author",
  reviewer: "Reviewer",
  administrator: "Administrator",
  system: "System",
};

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** "synced 2 h 5 min later" when an event reached the server well after it happened. */
function delay(event: AuditEvent): string | undefined {
  const minutes = Math.round((Date.parse(event.receivedAt) - Date.parse(event.occurredAt)) / 60000);
  if (minutes < 1) return undefined;
  const hours = Math.floor(minutes / 60);
  return `synced ${hours ? `${hours} h ` : ""}${minutes % 60} min later`;
}

function Details({ event }: { event: AuditEvent }) {
  const details = event.details as Record<string, unknown>;
  const before = details.before as { type?: string; text?: string } | string | undefined;
  const after = details.after as { type?: string; text?: string } | string | undefined;
  const rest = Object.entries(details).filter(([key]) => key !== "before" && key !== "after");
  return (
    <div className="audit-details">
      {before !== undefined && after !== undefined && (
        <div className="audit-before-after">
          <div>
            <p className="change-panel__label">Before</p>
            <p><del>{typeof before === "string" ? before : `${before.type ?? ""}: ${before.text ?? ""}`}</del></p>
          </div>
          <div>
            <p className="change-panel__label">After</p>
            <p>{typeof after === "string" ? after : `${after.type ?? ""}: ${after.text ?? ""}`}</p>
          </div>
        </div>
      )}
      {rest.length > 0 && (
        <dl className="audit-fields">
          {rest.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="audit-meta">
        Entry {event.sequence} · event {event.id} · device {event.deviceId || "—"} · received {when(event.receivedAt)}
      </p>
    </div>
  );
}

function EventRow({ event, actions }: { event: AuditEvent; actions: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const late = delay(event);
  return (
    <li className="audit-row">
      <button aria-expanded={open} className="audit-row__summary" onClick={() => setOpen((v) => !v)} type="button">
        <span className="audit-row__time">{when(event.occurredAt)}</span>
        <span className="audit-row__what">
          <strong>{actions[event.action] ?? event.description}</strong>
          {event.documentId && (
            <span className="audit-row__doc">
              {event.documentId}
              {event.revision !== null && ` Rev ${event.revision}`}
              {event.nodeId && ` · ${event.nodeId}`}
            </span>
          )}
        </span>
        <span className="audit-row__who">
          {event.actor}
          {event.actorRole && <span className="audit-row__role">{ROLE_LABEL[event.actorRole] ?? event.actorRole}</span>}
        </span>
        <span className="audit-row__badges">
          <span className={`audit-badge audit-badge--${event.source}`}>{event.source === "server" ? "Server" : "Device"}</span>
          {event.recordedOffline && <span className="audit-badge audit-badge--offline">Recorded offline</span>}
          {late && <span className="audit-row__late">{late}</span>}
        </span>
      </button>
      {open && <Details event={event} />}
    </li>
  );
}

function DeviceStatus() {
  const [profile, setLocalProfile] = useState(getProfile());
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState<OutboxStatus>();
  const [waiting, setWaiting] = useState<AuditEventInput[]>([]);

  useEffect(() => subscribeToOutbox((next) => {
    setStatus(next);
    void pendingEvents().then(setWaiting).catch(() => setWaiting([]));
  }), []);

  return (
    <section aria-label="This device" className="audit-device">
      <form
        className="audit-profile"
        onSubmit={(event) => {
          event.preventDefault();
          const previous = getProfile();
          setProfile(profile);
          setSaved(true);
          void recordAudit("profile.changed", {
            details: { from: `${previous.name || "Unidentified user"} (${previous.role})`, to: `${profile.name.trim() || "Unidentified user"} (${profile.role})` },
          });
        }}
      >
        <h2>Who is using this device</h2>
        <p className="audit-note">
          Recorded with everything done on this device. Self-declared until sign-in exists, so it is not verified.
        </p>
        <div className="audit-profile__fields">
          <label className="author-field" htmlFor="profile-name">
            Name
            <input id="profile-name" maxLength={120} onChange={(e) => { setSaved(false); setLocalProfile({ ...profile, name: e.target.value }); }} value={profile.name} />
          </label>
          <label className="author-field" htmlFor="profile-role">
            Role
            <select className="author-select" id="profile-role" onChange={(e) => { setSaved(false); setLocalProfile({ ...profile, role: e.target.value as ActorRole }); }} value={profile.role}>
              {ACTOR_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABEL[role]}</option>)}
            </select>
          </label>
          <button className="button button--primary" type="submit">{saved ? "Saved" : "Save"}</button>
        </div>
        <p className="audit-meta">Device ID {deviceId()}</p>
      </form>
      <div className="audit-outbox">
        <h2>Waiting to sync</h2>
        <p>
          <span className={`audit-badge ${status?.online ? "audit-badge--server" : "audit-badge--offline"}`}>
            {status?.online ? "Online" : "Offline"}
          </span>{" "}
          {status?.pending ?? 0} {status?.pending === 1 ? "event" : "events"} stored on this device
          {status?.lastSyncAt && ` · last sent ${when(status.lastSyncAt)}`}
        </p>
        {status?.lastError && status.pending > 0 && (
          <p className="audit-note">Not sent yet ({status.lastError}). It will be retried automatically.</p>
        )}
        {waiting.length > 0 && (
          <ul className="audit-waiting">
            {waiting.slice(-5).reverse().map((event) => (
              <li key={event.id}>{when(event.occurredAt)} · {event.action}{event.documentId ? ` · ${event.documentId}` : ""}</li>
            ))}
          </ul>
        )}
        <button className="button button--secondary" disabled={!status?.pending} onClick={() => void flushAudit()} type="button">
          Send now
        </button>
      </div>
    </section>
  );
}

export function AuditPage() {
  const [filters, setFilters] = useState({ documentId: "", action: "", actor: "", source: "", since: "", until: "" });
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [actions, setActions] = useState<Record<string, string>>({});
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [error, setError] = useState<ApiClientError>();
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<string[]>([]);
  const [verification, setVerification] = useState<AuditVerification>();
  const [attempt, setAttempt] = useState(0);
  const [outboxTick, setOutboxTick] = useState(0);

  // Reload the list after the outbox sends, so this device's events appear.
  useEffect(() => subscribeToOutbox((status) => setOutboxTick(Date.parse(status.lastSyncAt ?? "0") || 0)), []);

  useEffect(() => {
    void getDocumentLibraryFromApi().then((result) => result.ok && setDocuments(result.data.documents.map((d) => d.id)));
  }, []);

  const query = (before?: number) => ({
    ...filters,
    since: filters.since ? `${filters.since}T00:00:00` : "",
    until: filters.until ? `${filters.until}T23:59:59` : "",
    limit: "50",
    ...(before ? { before: String(before) } : {}),
  });

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void getAuditEventsFromApi(query(), controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(undefined);
      setEvents(result.data.events);
      setActions(result.data.actions);
      setNextBefore(result.data.nextBefore);
    });
    void verifyAuditFromApi(controller.signal).then((result) => result.ok && setVerification(result.data));
    return () => controller.abort();
    // query() is built from filters, which are listed.
  }, [filters, attempt, outboxTick]);

  const loadMore = async () => {
    if (!nextBefore) return;
    const result = await getAuditEventsFromApi(query(nextBefore));
    if (result.ok) {
      setEvents((previous) => [...previous, ...result.data.events]);
      setNextBefore(result.data.nextBefore);
    }
  };

  const set = (name: keyof typeof filters, value: string) => setFilters((previous) => ({ ...previous, [name]: value }));

  return (
    <main className="audit-page">
      <header className="efb-bar">
        <div className="efb-bar__title">
          <Link className="efb-bar__brand" to="/">EFB content</Link>
          <span aria-hidden="true" className="efb-bar__divider" />
          <span>Activity log</span>
        </div>
        <div className="efb-bar__status">
          {verification && (
            <span className={`audit-badge ${verification.intact ? "audit-badge--server" : "audit-badge--offline"}`} role="status">
              {verification.intact
                ? `Log intact · ${verification.checked} entries verified`
                : `Log altered: ${verification.problem}`}
            </span>
          )}
          <Link className="button button--secondary" to="/">Back to library</Link>
        </div>
      </header>

      <DeviceStatus />

      <section aria-label="Filter the log" className="audit-filters">
        <label className="author-field">
          Document
          <select className="author-select" onChange={(e) => set("documentId", e.target.value)} value={filters.documentId}>
            <option value="">All documents</option>
            {documents.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
        </label>
        <label className="author-field">
          Action
          <select className="author-select" onChange={(e) => set("action", e.target.value)} value={filters.action}>
            <option value="">All actions</option>
            {Object.entries(actions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label className="author-field">
          Person
          <input onChange={(e) => set("actor", e.target.value)} placeholder="Name contains" value={filters.actor} />
        </label>
        <label className="author-field">
          Recorded by
          <select className="author-select" onChange={(e) => set("source", e.target.value)} value={filters.source}>
            <option value="">Server and devices</option>
            <option value="server">Server</option>
            <option value="device">Devices</option>
          </select>
        </label>
        <label className="author-field">
          From
          <input onChange={(e) => set("since", e.target.value)} type="date" value={filters.since} />
        </label>
        <label className="author-field">
          To
          <input onChange={(e) => set("until", e.target.value)} type="date" value={filters.until} />
        </label>
      </section>

      <section aria-label="Log entries" className="audit-list">
        {error && <ApiErrorState error={error} onRetry={() => setAttempt((v) => v + 1)} />}
        {!error && !loading && events.length === 0 && <p className="search-empty">Nothing matches these filters.</p>}
        <ol>
          {events.map((event) => <EventRow actions={actions} event={event} key={event.id} />)}
        </ol>
        {nextBefore && (
          <button className="button button--secondary audit-more" onClick={() => void loadMore()} type="button">
            Show older entries
          </button>
        )}
      </section>
    </main>
  );
}
