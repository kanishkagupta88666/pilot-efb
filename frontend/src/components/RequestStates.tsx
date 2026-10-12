import type { ApiClientError } from "../api/client";

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
  return (
    <div aria-live="assertive" className="request-state request-state--error" role="alert">
      <p>{error.message}</p>
      <button className="button button--secondary" onClick={onRetry} type="button">
        Retry
      </button>
    </div>
  );
}
