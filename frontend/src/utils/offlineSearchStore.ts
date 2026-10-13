/**
 * The downloaded search index, kept in IndexedDB so search works offline.
 *
 * One record per document holds the revision it was downloaded from. Saving
 * replaces all records in one transaction, so a failed or interrupted
 * download leaves the previous index in place instead of a partial one.
 */
import type { SearchIndexDocument } from "../types/api";

const DATABASE = "pilot-efb";
const STORE = "search-index";
const VERSION = 1;

export interface SavedIndex {
  documents: SearchIndexDocument[];
  savedAt: string;
}

interface SavedRecord {
  docId: string;
  document: SearchIndexDocument;
  savedAt: string;
}

export function offlineStorageAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "docId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function saveIndex(documents: SearchIndexDocument[]): Promise<SavedIndex> {
  const database = await open();
  const savedAt = new Date().toISOString();
  try {
    const transaction = database.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    store.clear();
    for (const document of documents) {
      const record: SavedRecord = { docId: document.docId, document, savedAt };
      store.put(record);
    }
    await done(transaction);
  } finally {
    database.close();
  }
  return { documents, savedAt };
}

export async function loadIndex(): Promise<SavedIndex | undefined> {
  const database = await open();
  try {
    const transaction = database.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).getAll();
    const records = await new Promise<SavedRecord[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as SavedRecord[]);
      request.onerror = () => reject(request.error);
    });
    if (!records.length) return undefined;
    records.sort((a, b) => a.docId.localeCompare(b.docId));
    return {
      documents: records.map((record) => record.document),
      savedAt: records[0].savedAt,
    };
  } finally {
    database.close();
  }
}
