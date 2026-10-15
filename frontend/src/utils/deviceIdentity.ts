/**
 * Who is using this device, as the person says (there is no sign-in yet).
 *
 * The name and role are self-declared and unverified; the device ID is a
 * random ID made once per browser. Both are kept in localStorage. Every audit
 * event and every authoring request carries them, so the log can show who
 * did what until the airline's SSO provides verified identities.
 */
export type ActorRole = "pilot" | "author" | "reviewer" | "administrator";

export interface Profile {
  name: string;
  role: ActorRole;
}

const DEVICE_KEY = "pilot-efb.device-id";
const PROFILE_KEY = "pilot-efb.profile";
const DEFAULT_PROFILE: Profile = { name: "", role: "pilot" };
const ROLES: ActorRole[] = ["pilot", "author", "reviewer", "administrator"];
let memoryDeviceId: string | undefined;
let memoryProfile: Profile | undefined;

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Fallback for very old browsers: RFC 4122 version 4 from Math.random.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function eventId(): string {
  return newId();
}

export function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = newId();
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    memoryDeviceId ??= newId();
    return memoryDeviceId;
  }
}

export function getProfile(): Profile {
  try {
    const stored = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? "null") as Partial<Profile> | null;
    if (stored && typeof stored.name === "string" && ROLES.includes(stored.role as ActorRole)) {
      return { name: stored.name, role: stored.role as ActorRole };
    }
  } catch {
    // Unreadable or blocked storage: fall through to the in-memory profile.
  }
  return memoryProfile ?? DEFAULT_PROFILE;
}

export function setProfile(profile: Profile): void {
  const cleaned = { name: profile.name.trim().slice(0, 120), role: profile.role };
  memoryProfile = cleaned;
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(cleaned));
  } catch {
    // Kept in memory for this session only.
  }
}

export const ACTOR_ROLES = ROLES;

/** Headers the server reads to record who made a change. */
export function identityHeaders(): Record<string, string> {
  const profile = getProfile();
  return {
    "X-EFB-Actor": profile.name || "Unidentified user",
    "X-EFB-Role": profile.role,
    "X-EFB-Device": deviceId(),
  };
}
