/**
 * Pilot acknowledgments of a new revision: who confirmed which revision, and when.
 *
 * Kept on this device only for now. The server cannot store them until sign-in and an
 * acknowledgment endpoint exist; each record already holds what the server will need.
 */
import { readSession } from "../auth/session";
import { deviceId, getProfile } from "./deviceIdentity";

const STORAGE_KEY = "pilot-efb.acknowledgments";

export interface Acknowledgment {
  docId: string;
  revision: number;
  /** Signed-in employee ID, or the name given on this device, or "" if neither. */
  personId: string;
  /** Name to show, for example "Demo P-100". */
  personName: string;
  acknowledgedAt: string;
  deviceId: string;
}

let memoryRecords: Acknowledgment[] = [];

/** The person using the device: the signed-in account if there is one, else the name they gave. */
export function currentPerson(): { personId: string; personName: string } {
  const session = readSession();
  if (session) return { personId: session.user.employeeId, personName: session.user.displayName };
  const name = getProfile().name;
  return { personId: name, personName: name };
}

function readAll(): Acknowledgment[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return Array.isArray(stored) ? (stored as Acknowledgment[]) : memoryRecords;
  } catch {
    return memoryRecords;
  }
}

/** This person's acknowledgment of the revision, if they have given one on this device. */
export function findAcknowledgment(docId: string, revision: number): Acknowledgment | undefined {
  const { personId } = currentPerson();
  return readAll().find(
    (record) => record.docId === docId && record.revision === revision && record.personId === personId,
  );
}

/** Records that the person using the device has seen the revision. Returns the record. */
export function acknowledgeRevision(docId: string, revision: number): Acknowledgment {
  const existing = findAcknowledgment(docId, revision);
  if (existing) return existing;
  const record: Acknowledgment = {
    docId,
    revision,
    ...currentPerson(),
    acknowledgedAt: new Date().toISOString(),
    deviceId: deviceId(),
  };
  const records = [...readAll(), record];
  memoryRecords = records;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Storage blocked (private browsing): kept in memory until the page is reloaded.
  }
  return record;
}
