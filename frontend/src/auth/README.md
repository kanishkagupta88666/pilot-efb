# Sign-in integration

Run Vite with VITE_AUTH_MODE=api VITE_DATA_SOURCE=api and API_PROXY_TARGET pointing to the Django server. The private local launcher is not included in this branch. Demo IDs are P-100, P-200, M-001 and A-001; the local demonstration password is demo-only. Generated accounts and passwords are ignored by Git.

POST /api/auth/login/ receives username and password and returns token, expires_at and user with id, role and fleet. The client normalizes this into its session model. Null fleet displays as all. Authenticated requests use Authorization: Token. GET /api/auth/me/ checks the account. POST /api/auth/logout/ is stateless; the client discards its token even if offline or the server is unavailable. There is no token revocation endpoint.

The separate local integration accepts signed demo sessions and existing Django API tokens for protected writes. Those backend compatibility changes are not included in this frontend branch and require backend review. Signed pilot and management accounts cannot author or read the audit log. Signed admin accounts have document permissions. Annotation ownership comes from the authenticated ID. Feature flags still control writes; the local integration launcher enables them for synthetic data.

This frontend branch depends on Brendan's feature/backend-auth API. Sakshi's latest Checklists UI and the backend authentication compatibility changes are maintained in the separate local integration; they are not bundled here.

Remaining team dependencies: document APIs currently serve the synthetic library openly and do not enforce account fleet filtering. Complete offline document caching and production SSO are not implemented by this sign-in work. Local route access alone does not guarantee offline content availability.

## Saved reading integration

Visited, validated document API responses are retained in a separate Cache Storage cache, without credentials. The API client can read those responses after a network failure or a 401. A 403 is always shown and never replaced by cached content. The route guard checks for a saved topic in the requested revision before allowing an expired session to continue online. Signing out retains these reading copies and notes. PDF.js now sends the current authorization header as well.

This is a fallback for visited content, not a complete manual download or application-shell cache. Hriday's offline package must provide complete manual storage and offline application startup before the Wi-Fi-off/relaunch acceptance test can pass. Fleet authorization remains Brendan's server responsibility.
