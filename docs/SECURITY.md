# Security notes

Pilot EFB serves synthetic manuals, so **reading the manuals is open**. Anything
that **changes data** is closed by default and needs a real account, and so
does **reading the audit log**, which names people and what they did.

## What is protected

| Endpoint | Setting that turns it on | Who may use it once on |
|---|---|---|
| `/api/documents/<id>/draft/...` (create, edit, discard a draft; read a draft) | `EFB_AUTHORING_ENABLED` | Token for an account with the draft permissions |
| `/api/documents/<id>/draft/publish/` | `EFB_AUTHORING_ENABLED` | The same, plus permission to add a document version |
| `POST /api/annotations/sync/` | `EFB_ANNOTATION_SYNC_ENABLED` | Any token; the owner is the token's account |
| `POST /api/audit/events/` | `EFB_DEVICE_AUDIT_ENABLED` | Any token; the actor is the token's account |
| `GET /api/audit/events/`, `GET /api/audit/verify/` | none (always on) | Token for an account with `documents.view_auditevent` |

Every setting is off unless its environment variable is `1`, `true`, `yes` or
`on`. With a feature off, its endpoints answer `403 FEATURE_DISABLED` to
everyone, including administrators. With it on, a request with no token or a
wrong token gets `401 AUTHENTICATION_REQUIRED`, and an account without the
needed permission gets `403 FORBIDDEN`. The audit log has no on/off setting.

These stay open: the `GET` endpoints for documents, search and PDF, and
`POST .../annotation-status/`, which stores nothing.

## What is not accepted as proof of identity

- The `X-EFB-Actor` and `X-EFB-Role` headers, and an `owner` or `actor` field in
  a request body. They are ignored; the account behind the token is recorded.
- A Django session cookie. Only the `Authorization: Token ...` header counts, so
  a page opened from the same origin cannot write by itself.
- Anything stored in the browser, such as the name typed on the sign-in page.
  That page is a stub and grants nothing.

## Enabling a write feature for a trial

```sh
python backend/manage.py migrate
python backend/manage.py createsuperuser            # or create an account in /admin/
python backend/manage.py drf_create_token <username>
EFB_AUTHORING_ENABLED=1 python backend/manage.py runserver 127.0.0.1:8000

curl -H "Authorization: Token <token>" -X POST http://127.0.0.1:8000/api/documents/FM-S200/draft/
```

Roles are Django permissions (`documents.change_draft` and related for authors,
`documents.add_documentversion` for publishing). They are recorded in the audit
log as `author` or `administrator`, and `pilot` for any other account.

## Known limits

- **The frontend does not send a token yet.** With the defaults, annotation sync
  and device audit uploads are refused (403); highlights, notes and bookmarks
  stay on the device. Authoring screens will show the refusal.
- Tokens are shared secrets that do not expire, issued by hand. There is no
  sign-in screen that issues them.
- Roles are not the DMS roles (owner, reviewer, approver).
- The reader's activity-log page (`/audit`) shows an error until the frontend sends a token.
- Restart the server after changing a setting.

## Tests

`backend/documents/test_security.py` covers every write route: refused when off,
refused without a token (including with spoofed identity headers, a same-origin
`Origin` and a logged-in session), and permission checks once on.
`frontend/e2e/regression.e2e.ts` repeats the anonymous check against the running
API.
