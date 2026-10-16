/**
 * The reader's on-device database (IndexedDB), shared by the offline search
 * index, the audit outbox and pilots' annotations. Version 2 added the
 * outbox and version 3 the annotations; upgrading keeps what is stored.
 */
const DATABASE = "pilot-efb";
const VERSION = 3;
export const SEARCH_INDEX_STORE = "search-index";
export const AUDIT_OUTBOX_STORE = "audit-outbox";
export const ANNOTATION_STORE = "annotations";

export function localStorageAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

export function openLocalDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SEARCH_INDEX_STORE)) {
        database.createObjectStore(SEARCH_INDEX_STORE, { keyPath: "docId" });
      }
      if (!database.objectStoreNames.contains(AUDIT_OUTBOX_STORE)) {
        database.createObjectStore(AUDIT_OUTBOX_STORE, { keyPath: "id" });
      }
      if (!database.objectStoreNames.contains(ANNOTATION_STORE)) {
        database.createObjectStore(ANNOTATION_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
