import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  resolveNodeFromApi,
  type ApiClientError,
} from "../api/client";
import { DATA_SOURCE } from "../config/dataSource";
import { readerPathForResolution } from "../utils/readerLink";
import { ApiErrorState, LoadingState } from "./RequestStates";

function readSingleParameter(
  params: URLSearchParams,
  name: string,
): { value?: string; invalid: boolean } {
  const values = params.getAll(name);
  if (values.length > 1) return { invalid: true };
  return { value: values[0], invalid: false };
}

type OpenRequest =
  | { ok: true; doc: string; node: string; rev?: number }
  | { ok: false; error: string };

function validateOpenRequest(params: URLSearchParams): OpenRequest {
  const doc = readSingleParameter(params, "doc");
  const node = readSingleParameter(params, "node");
  const revision = readSingleParameter(params, "rev");
  if (doc.invalid || node.invalid || revision.invalid) {
    return { ok: false, error: "Each open-link parameter must be provided only once." };
  }
  if (!doc.value || !node.value) {
    return { ok: false, error: "An open link requires both a document ID and a node ID." };
  }

  let rev: number | undefined;
  if (revision.value !== undefined) {
    if (!/^(0|[1-9]\d*)$/.test(revision.value)) {
      return { ok: false, error: "The revision must be a whole number without leading zeroes." };
    }
    rev = Number(revision.value);
    if (!Number.isSafeInteger(rev)) {
      return { ok: false, error: "The revision is outside the supported numeric range." };
    }
  }

  return { ok: true, doc: doc.value, node: node.value, rev };
}

function invalidRequestError(message: string): ApiClientError {
  return {
    kind: "http",
    code: "INVALID_REQUEST",
    message,
    status: 400,
  };
}

export function ApiOpenNodeRoute({
  dataSource = DATA_SOURCE,
}: {
  dataSource?: "mock" | "api";
}) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const search = searchParams.toString();
  const request = validateOpenRequest(new URLSearchParams(search));
  const [error, setError] = useState<ApiClientError>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (dataSource !== "api") return;
    if (!request.ok) {
      setError(invalidRequestError(request.error));
      return;
    }
    const { doc, node, rev } = request;

    const controller = new AbortController();
    setError(undefined);
    void resolveNodeFromApi(
      doc,
      node,
      rev,
      controller.signal,
    ).then((result) => {
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }

      const resolution = result.data;
      if (
        resolution.documentId !== doc ||
        resolution.targetNodeId !== node ||
        resolution.topic.id !== resolution.topicId ||
        (rev !== undefined && resolution.selectedRevision !== rev)
      ) {
        setError({
          kind: "invalid-response",
          code: "INVALID_RESPONSE",
          message: "The resolver returned a different document or revision than requested.",
          status: 502,
        });
        return;
      }

      navigate(
        readerPathForResolution(resolution),
        { replace: true },
      );
    });

    return () => controller.abort();
  }, [
    navigate,
    search,
    attempt,
    dataSource,
  ]);

  if (dataSource !== "api") {
    return (
      <main className="reader-error">
        <h1>Open link unavailable</h1>
        <p>Permanent-ID links require the API data source.</p>
        <Link className="button button--primary" to="/">Back to library</Link>
      </main>
    );
  }

  if (error) {
    return (
      <main className="reader-error">
        <Link className="button button--secondary" to="/">Back to library</Link>
        <h1>Unable to open document</h1>
        <ApiErrorState
          error={error}
          onRetry={() => setAttempt((value) => value + 1)}
        />
        {Array.isArray(error.details?.availableRevisions) && (
          <p role="status">
            This node is available in revision(s):{" "}
            {error.details.availableRevisions.filter(
              (value): value is number => typeof value === "number",
            ).join(", ")}.
          </p>
        )}
      </main>
    );
  }

  return <LoadingState label="Resolving document link…" />;
}

export function OpenNodeRoute() {
  return <ApiOpenNodeRoute />;
}
