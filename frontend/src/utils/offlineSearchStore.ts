/**
 * The downloaded search index, kept in IndexedDB so search works offline.
 *
 * One record per document holds the revision it was downloaded from. Saving
 * replaces all records in one transaction, so a failed or interrupted
 * download leaves the previous index in place instead of a partial one.
 */
import type { SearchIndexDocument } from "../types/api";
import {
  SEARCH_INDEX_STORE as STORE,
  localStorageAvailable,
  openLocalDb as open,
  transactionDone as done,
} from "./localDb";

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
  return localStorageAvailable();
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
