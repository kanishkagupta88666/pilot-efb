import { useEffect } from "react";
import type { ApiClientError } from "../api/client";

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * What to tell the pilot about a failed request, in plain words. Being offline and the
 * server being down look alike to the app (it cannot connect), so the iPad's own online
 * state decides which one it is. Other errors keep the server's own message.
 */
export function describeError(
  error: ApiClientError,
  offline = isOffline(),
): { title?: string; detail: string } {
  if (error.kind === "network" && offline) {
    return {
      title: "You're offline.",
      detail: "This page needs a connection. It will load again by itself when the iPad is back online.",
    };
  }
  // In development the proxy answers 500 in plain text when the server is not running;
  // gateways answer 502 to 504.
  const serverUnreachable =
    error.kind === "network" ||
    (error.kind === "non-json" && (error.status ?? 0) >= 500) ||
    [502, 503, 504].includes(error.status ?? 0);
  if (serverUnreachable) {
    return {
      title: "The EFB server is not responding.",
      detail: "Your connection is working, but the server could not be reached. Try again in a moment.",
    };
  }
  if (error.kind === "http" && (error.status ?? 0) >= 500) {
    return { title: "The EFB server had a problem.", detail: error.message };
  }
  return { detail: error.message };
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <p aria-live="polite" className="request-state" role="status">
      {label}
    </p>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <p aria-live="polite" className="request-state request-state--empty" role="status">
      {message}
    </p>
  );
}

export function ApiErrorState({
  error,
  onRetry,
}: {
  error: ApiClientError;
  onRetry: () => void;
}) {
  const { title, detail } = describeError(error);
  const offline = error.kind === "network" && isOffline();

  // Try again by itself once the iPad is back online.
  useEffect(() => {
    if (!offline) return;
    window.addEventListener("online", onRetry);
    return () => window.removeEventListener("online", onRetry);
  }, [offline, onRetry]);

  return (
    <div aria-live="assertive" className="request-state request-state--error" role="alert">
      <p>
        {title && <strong>{title}</strong>} {detail}
      </p>
      <button className="button button--secondary" onClick={onRetry} type="button">
        Retry
      </button>
    </div>
  );
}
