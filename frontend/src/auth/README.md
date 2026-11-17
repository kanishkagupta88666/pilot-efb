# Frontend sign-in handoff

## Run the integrated application

Start Vite with `VITE_AUTH_MODE=mock VITE_DATA_SOURCE=api` for independent frontend development, or `VITE_AUTH_MODE=api VITE_DATA_SOURCE=api` for Brendan's login API. Set `API_PROXY_TARGET` to the Django server. Mock authentication is restricted to Vite development mode. Without an auth mode, the existing application behavior remains available for regression testing.

Demo IDs: P-100, P-200, M-001, A-001. Demo password: demo-only. The demo and API sessions use separate storage keys. Demo credentials never authenticate backend requests. Fleet filtering in the live document API requires Brendan's implementation; a mock identity does not grant server permissions.

## Contract

POST /api/auth/login/ receives employeeId and password. A successful response contains token, expiresAt (ISO date), and user with employeeId, displayName, role (pilot, management, admin), fleet. Invalid credentials return 401. Subsequent API requests carry Authorization: Bearer token. No logout or refresh endpoint is assumed; logout removes the local signed token. Server-side token revocation is outside the provided prototype contract.

## Implemented

- Branded sign-in form, password visibility, loading and error states.
- Session validation, localStorage persistence, transient fallback when storage is unavailable, expiry checks.
- Integrated root sign-in redirect and return-path handling.
- Reading routes remain accessible without identity; offline and expired sessions do not cause a forced reading redirect.
- API token headers and server-401 notification; existing API errors preserve the server's 403 message.
- Account menu, pending-note check, sign-out confirmation, retention of local notes.
- Client-side admin page guard. Backend authorization remains mandatory.

## Remaining integration acceptance

Brendan must provide the login endpoint and Bearer authentication, fleet filtering and role enforcement. Hriday's complete document cache is required to reopen manuals offline. The current application has no complete document cache, so allowing a route offline does not make its data available. Sakshi's Checklists landing page is not present; successful login currently returns to the requested URL or the existing library. No fake Checklists destination is introduced.

Existing annotations identify owners using the device profile; login sets that profile to employeeId. Before enabling server annotation sync, confirm that backend ownership uses this stable ID. Existing notes under manually entered names are retained and are not reassigned automatically.

The standalone auth-preview.html remains a development preview. The integrated sign-in is included in the normal production build when VITE_AUTH_MODE=api is supplied at build time.
