# API reference

All paths are relative to `API_PREFIX`, which defaults to `/backend`.
Interactive docs are at `/docs` in non-production environments.

Authenticated endpoints expect `Authorization: Bearer <access_token>`.

## Auth

Also mounted without the `/auth` prefix (`/backend/login`, and so on) so older
clients keep working.

### `POST /auth/register`

```json
{ "username": "asha", "email": "asha@example.com", "password": "secret123" }
```

`201` → `{ "msg": "Recruiter registered successfully" }`
`409` if the username or email is taken. Username 3+ characters, password 6–128.

### `POST /auth/login`

Form-encoded (OAuth2 password flow): `username`, `password`.

```json
{ "access_token": "eyJ...", "token_type": "bearer", "recruiter_name": "asha" }
```

`401` on bad credentials. Tokens last `ACCESS_TOKEN_EXPIRE_MINUTES` (7 days).

### `POST /auth/forgot-password`

```json
{ "email": "asha@example.com" }
```

Always returns the same message whether or not the address exists — the
endpoint cannot be used to discover registered emails. `502` if the mail server
rejects the send.

### `POST /auth/reset-password`

```json
{ "token": "eyJ...", "new_password": "newsecret" }
```

`400` if the token is invalid, expired, or already used.

### `GET /auth/verify-reset-token/{token}`

`{ "valid": true, "email": "asha@example.com" }`, or `400`. The frontend calls
this before showing the reset form, so a dead link fails before the recruiter
types a password.

## Screening

### `POST /analyze-resumes/` 🔒

Multipart:

| Field | Type | Notes |
|---|---|---|
| `job_description` | text | Required, non-empty |
| `hiring_type` | text | `1` Sales · `2` IT · `3` Non-Sales · `4` Sales Support |
| `level` | text | `1` Fresher · `2` Experienced |
| `files` | file[] | PDF, DOC, DOCX, or image. Max 50 per request |

```json
{
  "results": [
    {
      "filename": "priya_sharma.pdf",
      "match_percent": 84,
      "decision": "Shortlisted",
      "result_text": "Match %: 84%\nPros:\n- ...",
      "usage": { "prompt_tokens": 1840, "completion_tokens": 210, "total_tokens": 2050 }
    },
    { "filename": "broken.doc", "decision": "Error", "error": "Unable to extract text..." }
  ]
}
```

A file that cannot be read is reported in place with `decision: "Error"`; the
rest of the batch still returns. `413` if the batch exceeds 50 files.

Slow by nature — one model call per resume, plus a vision call per page for
scanned documents.

## Files

### `GET /view-resume/{file_id}` 🔒

```json
{ "filename": "x.pdf", "content_type": "application/pdf", "size": 184320, "content": "<base64>" }
```

### `GET /download-resume/{file_id}` 🔒

The raw bytes with `Content-Disposition: attachment`. Both return `404` for an
unknown or malformed id.

## Reports

All require authentication — they expose every recruiter's activity.

### `GET /mis-summary` 🔒

Per-recruiter totals with full history, newest first.

```json
{
  "summary": [
    {
      "recruiter_name": "asha",
      "uploads": 12,
      "resumes": 47,
      "shortlisted": 15,
      "rejected": 32,
      "history": [ { "resume_name": "...", "counts_per_day": 6, "...": "..." } ]
    }
  ]
}
```

### `GET /reports/{date_type}` 🔒

`date_type` is `today`, `yesterday`, or `YYYY-MM-DD`. Day boundaries are UTC.

```json
{
  "date": "25th August 2025, Monday",
  "date_type": "2025-08-25",
  "reports": [
    { "recruiter_name": "asha", "total_resumes": 8, "shortlisted": 3, "rejected": 5 }
  ]
}
```

`400` on an unparseable date.

### `GET /daily-reports` 🔒 · `GET /previous-day-reports` 🔒

Shortcuts for `today` and `yesterday`.

## Maintenance

### `DELETE /cleanup-expired-tokens` 🔒

`{ "deleted_count": 14 }`. The TTL index does this automatically; this is the
manual trigger.

## Health

### `GET /health`

`{ "status": "ok", "database": "ok" }`, or `503` with
`"status": "degraded"` when MongoDB is unreachable — so a load balancer can pull
a broken instance out of rotation. Point health checks here, not at `/`.

## Errors

Every failure returns the same shape:

```json
{ "detail": "Human-readable message" }
```

Validation errors are flattened into a single sentence rather than pydantic's
array of objects, so clients can render `detail` directly. Unhandled exceptions
log server-side and return an opaque `"Internal server error"`.

| Status | Meaning |
|---|---|
| 400 | Malformed input — bad date, dead reset token |
| 401 | Missing, expired, or invalid token |
| 404 | Unknown file id |
| 409 | Username or email already registered |
| 413 | Batch over 50 files |
| 422 | Request failed validation |
| 502 | Mail server rejected the send |
| 503 | Database unreachable |
