/**
 * The device side of the audit log (backend/documents/audit.py).
 *
 * Every event is written to an outbox on the device first (IndexedDB), then
 * sent to the server. Nothing is lost while offline: the outbox is sent when
 * the device comes back online, when the app returns to the foreground, and
 * every 30 seconds while there is anything left. Each event has its own ID,
 * so if a send succeeds but the reply is lost, the resend is recognised by
 * the server and stored once. An event leaves the outbox only after the
 * server has accepted it (or reported it a duplicate or invalid).
 *
 * If IndexedDB is unavailable (private browsing, blocked storage), events are
 * kept in memory and sent the same way, but do not survive a reload.
 */
import { postAuditEventsFromApi } from "../api/client";
import type { AuditEventInput } from "../types/api";
import { deviceId, eventId, getProfile } from "./deviceIdentity";
import {
  AUDIT_OUTBOX_STORE,
  localStorageAvailable,
  openLocalDb,
  requestResult,
  transactionDone,
} from "./localDb";

const BATCH = 100;
const RETRY_MS = 30_000;

export interface AuditFields {
  documentId?: string;
  revision?: number;
  nodeId?: string;
  details?: Record<string, unknown>;
}

export interface OutboxStatus {
  pending: number;
  lastSyncAt?: string;
  lastError?: string;
  online: boolean;
}

// The in-memory outbox, used when IndexedDB is not available.
const memory = new Map<string, AuditEventInput>();
const listeners = new Set<(status: OutboxStatus) => void>();
let status: OutboxStatus = { pending: 0, online: isOnline() };
let flushing: Promise<void> | undefined;
let started = false;

function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

function useIndexedDb(): boolean {
  return localStorageAvailable();
}

function publish(change: Partial<OutboxStatus>): void {
  status = { ...status, ...change };
  for (const listener of listeners) listener(status);
}

export function subscribeToOutbox(listener: (status: OutboxStatus) => void): () => void {
  listeners.add(listener);
  listener(status);
  return () => listeners.delete(listener);
}

async function store(event: AuditEventInput): Promise<void> {
  if (!useIndexedDb()) {
    memory.set(event.id, event);
    return;
  }
  const database = await openLocalDb();
  try {
    const transaction = database.transaction(AUDIT_OUTBOX_STORE, "readwrite");
    transaction.objectStore(AUDIT_OUTBOX_STORE).put(event);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function pendingEvents(): Promise<AuditEventInput[]> {
  let events: AuditEventInput[];
  if (!useIndexedDb()) {
    events = [...memory.values()];
  } else {
    const database = await openLocalDb();
    try {
      const transaction = database.transaction(AUDIT_OUTBOX_STORE, "readonly");
      events = await requestResult(transaction.objectStore(AUDIT_OUTBOX_STORE).getAll());
    } finally {
      database.close();
    }
  }
  return events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

async function remove(ids: string[]): Promise<void> {
  if (!ids.length) return;
  if (!useIndexedDb()) {
    for (const id of ids) memory.delete(id);
    return;
  }
  const database = await openLocalDb();
  try {
    const transaction = database.transaction(AUDIT_OUTBOX_STORE, "readwrite");
    const outbox = transaction.objectStore(AUDIT_OUTBOX_STORE);
    for (const id of ids) outbox.delete(id);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

async function refreshCount(): Promise<void> {
  try {
    publish({ pending: (await pendingEvents()).length });
  } catch {
    // The count is informational; a failed read leaves the last known value.
  }
}

/** Record something the person did on this device. Never throws. */
export async function recordAudit(action: string, fields: AuditFields = {}): Promise<void> {
  const profile = getProfile();
  const event: AuditEventInput = {
    id: eventId(),
    action,
    occurredAt: new Date().toISOString(),
    actor: profile.name || "Unidentified user",
    actorRole: profile.role,
    deviceId: deviceId(),
    recordedOffline: !isOnline(),
    ...fields,
  };
  try {
    await store(event);
  } catch {
    memory.set(event.id, event);
  }
  await refreshCount();
  if (isOnline()) void flushAudit();
}

async function sendAll(): Promise<void> {
  const events = await pendingEvents();
  for (let start = 0; start < events.length; start += BATCH) {
    const batch = events.slice(start, start + BATCH);
    const result = await postAuditEventsFromApi(batch);
    if (!result.ok) {
      // Keep everything; try again later. Nothing in this batch was confirmed.
      publish({ lastError: result.error.message });
      return;
    }
    const { accepted, duplicates, rejected } = result.data;
    for (const item of rejected) {
      console.warn(`Audit event ${item.id} was refused by the server: ${item.reason}`);
    }
    await remove([...accepted, ...duplicates, ...rejected.map((item) => item.id)]);
    publish({ lastSyncAt: new Date().toISOString(), lastError: undefined });
  }
}

/** Send everything waiting in the outbox. Concurrent calls share one send. */
export function flushAudit(): Promise<void> {
  flushing ??= sendAll()
    .catch((error: unknown) => {
      publish({ lastError: error instanceof Error ? error.message : "The outbox could not be sent." });
    })
    .finally(() => {
      flushing = undefined;
      void refreshCount();
    });
  return flushing;
}

/** Start sending the outbox automatically. Safe to call more than once. */
export function startAuditSync(): () => void {
  if (started || typeof window === "undefined") return () => undefined;
  started = true;
  const goOffline = () => {
    publish({ online: false });
    void recordAudit("connectivity.offline");
  };
  const goOnline = () => {
    publish({ online: true });
    void recordAudit("connectivity.online");
  };
  const onVisible = () => {
    if (document.visibilityState === "visible" && isOnline()) void flushAudit();
  };
  window.addEventListener("offline", goOffline);
  window.addEventListener("online", goOnline);
  document.addEventListener("visibilitychange", onVisible);
  const timer = window.setInterval(() => {
    if (isOnline() && status.pending > 0) void flushAudit();
  }, RETRY_MS);
  void refreshCount().then(() => (isOnline() ? flushAudit() : undefined));
  return () => {
    started = false;
    window.removeEventListener("offline", goOffline);
    window.removeEventListener("online", goOnline);
    document.removeEventListener("visibilitychange", onVisible);
    window.clearInterval(timer);
  };
}
