/**
 * Pilots' annotations on this device, synced to the server under their name.
 *
 * Offline-first: every change is written here first and marked unsynced, so
 * highlighting and note-taking work without a connection. When online, the
 * unsynced ones are sent and the server returns the pilot's full set, which
 * replaces the local copy (the newer ``updatedAt`` wins on the server). That
 * is also how annotations made on another device arrive here.
 *
 * Annotations are private to the name set on the device (see deviceIdentity).
 * Without a name they stay on this device only until one is set.
 */
import { syncAnnotationsFromApi } from "../api/client";
import type { Annotation } from "../types/api";
import { eventId, getProfile } from "./deviceIdentity";
import { ANNOTATION_STORE, localStorageAvailable, openLocalDb, requestResult, transactionDone } from "./localDb";

interface Stored extends Annotation {
  /** Changed on this device and not yet confirmed by the server. */
  unsynced: boolean;
  /** Lower-cased owner name, so one device can hold several pilots' sets. */
  ownerKey: string;
}

const memory = new Map<string, Stored>();
const listeners = new Set<() => void>();
let syncing: Promise<void> | undefined;
let started = false;

export function ownerKey(name: string): string {
  return name.split(/\s+/).filter(Boolean).join(" ").toLowerCase();
}

function currentOwner(): string {
  return ownerKey(getProfile().name);
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeToAnnotations(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function all(): Promise<Stored[]> {
  if (!localStorageAvailable()) return [...memory.values()];
  const database = await openLocalDb();
  try {
    const transaction = database.transaction(ANNOTATION_STORE, "readonly");
    return await requestResult(transaction.objectStore(ANNOTATION_STORE).getAll() as IDBRequest<Stored[]>);
  } finally {
    database.close();
  }
}

async function putAll(items: Stored[], removeIds: string[] = []): Promise<void> {
  if (!localStorageAvailable()) {
    for (const id of removeIds) memory.delete(id);
    for (const item of items) memory.set(item.id, item);
    return;
  }
  const database = await openLocalDb();
  try {
    const transaction = database.transaction(ANNOTATION_STORE, "readwrite");
    const store = transaction.objectStore(ANNOTATION_STORE);
    for (const id of removeIds) store.delete(id);
    for (const item of items) store.put(item);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

/** This pilot's live annotations for one document. */
export async function annotationsFor(documentId: string): Promise<Annotation[]> {
  const owner = currentOwner();
  return (await all())
    .filter((item) => item.ownerKey === owner && item.documentId === documentId && !item.deleted)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/** All of this pilot's live annotations, across documents. */
export async function allAnnotations(): Promise<Annotation[]> {
  const owner = currentOwner();
  return (await all())
    .filter((item) => item.ownerKey === owner && !item.deleted)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/** Tests only: forget the in-memory annotations (used when the device has no IndexedDB). */
export function resetAnnotationMemoryForTests(): void {
  memory.clear();
}

export async function unsyncedCount(): Promise<number> {
  const owner = currentOwner();
  return (await all()).filter((item) => item.ownerKey === owner && item.unsynced).length;
}

export type NewAnnotation = Omit<Annotation, "id" | "createdAt" | "updatedAt" | "deleted" | "detached"> &
  Partial<Pick<Annotation, "detached">>;

export async function addAnnotation(fields: NewAnnotation): Promise<Annotation> {
  const now = new Date().toISOString();
  const item: Stored = {
    detached: false,
    ...fields,
    id: eventId(),
    createdAt: now,
    updatedAt: now,
    deleted: false,
    unsynced: true,
    ownerKey: currentOwner(),
  };
  await putAll([item]);
  notify();
  void syncAnnotations();
  return item;
}

export async function updateAnnotation(id: string, change: Partial<Annotation>): Promise<void> {
  const existing = (await all()).find((item) => item.id === id);
  if (!existing) return;
  await putAll([{ ...existing, ...change, id, updatedAt: new Date().toISOString(), unsynced: true }]);
  notify();
  void syncAnnotations();
}

export function deleteAnnotation(id: string): Promise<void> {
  return updateAnnotation(id, { deleted: true });
}

async function syncNow(): Promise<void> {
  const name = getProfile().name;
  const owner = ownerKey(name);
  if (!owner) return;
  const mine = (await all()).filter((item) => item.ownerKey === owner);
  const pending = mine.filter((item) => item.unsynced);
  const result = await syncAnnotationsFromApi(
    name,
    pending.map(({ unsynced: _unsynced, ownerKey: _ownerKey, ...annotation }) => annotation),
  );
  if (!result.ok) return; // Offline or failing: keep everything; try again later.
  const rejected = new Set(result.data.rejected.map((item) => item.id));
  for (const item of result.data.rejected) console.warn(`Annotation ${item.id} was refused: ${item.reason}`);
  // Anything changed here while this sync was in flight stays unsynced.
  const latest = new Map((await all()).map((item) => [item.id, item]));
  const fromServer: Stored[] = result.data.annotations
    .filter((annotation) => {
      const local = latest.get(annotation.id);
      // Compare as instants: the server writes "+00:00" with microseconds, the device "Z".
      return !local || !local.unsynced || Date.parse(local.updatedAt) <= Date.parse(annotation.updatedAt);
    })
    .map((annotation) => ({ ...annotation, unsynced: false, ownerKey: owner }));
  // Rejected changes cannot be stored; drop them rather than retry forever.
  await putAll(fromServer, [...rejected]);
  notify();
}

export function syncAnnotations(): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return Promise.resolve();
  syncing ??= syncNow()
    .catch(() => undefined)
    .finally(() => {
      syncing = undefined;
    });
  return syncing;
}

/** Keep annotations in step with the server whenever the device is online. */
export function startAnnotationSync(): () => void {
  if (started || typeof window === "undefined") return () => undefined;
  started = true;
  const sync = () => void syncAnnotations();
  const onVisible = () => document.visibilityState === "visible" && sync();
  window.addEventListener("online", sync);
  document.addEventListener("visibilitychange", onVisible);
  const timer = window.setInterval(sync, 60_000);
  sync();
  return () => {
    started = false;
    window.removeEventListener("online", sync);
    document.removeEventListener("visibilitychange", onVisible);
    window.clearInterval(timer);
  };
}
