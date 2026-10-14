# Frontend issues for Step 5I

## Addressed in API mode

- The library, revision navigation, and topic content load asynchronously with
  loading, empty, error, retry, cancellation, and stale-response handling.
- Permanent-ID resolution supports inbound `/open` links and lazy xref
  activation. Explicit revisions are validated and never silently substituted.
- API navigation does not include the mock-only table chapter.
- API deep links scroll to and temporarily highlight topic, chapter, section,
  block, and nested checklist-check targets.

## Deferred

- Mock-data access remains synchronous by design.
- The mock-only chapter remains visible in mock mode and is labeled MOCK.
- Manually selected topics are not persisted in the Reader URL; resolver-opened
  topics are represented in query parameters.
- Revision parsing in mock mode remains looser than API-mode route validation.
- XML mixed-text whitespace rendering remains ambiguous under the provisional
  contract; API segments are rendered without client-side trimming.
