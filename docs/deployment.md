# Deployment

## Environment variables

Set these on the host. Never commit a `.env`.

### Backend

| Variable | Required | Default | Notes |
|---|:---:|---|---|
| `ENVIRONMENT` | | `development` | `production` disables `/docs` and `/openapi.json` |
| `DEBUG` | | `false` | Debug-level logging |
| `API_PREFIX` | | `/backend` | Must match the frontend's `VITE_API_URL` |
| `MONGODB_URI` | ✅ | | Connection string |
| `MONGODB_DB_NAME` | | `resume_screening` | |
| `JWT_SECRET` | ✅ | | **32+ characters** or the app refuses to start |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | | `10080` | 7 days |
| `RESET_TOKEN_EXPIRE_MINUTES` | | `30` | |
| `OPENAI_API_KEY` | ✅ | | |
| `OPENAI_MODEL` | | `gpt-4o` | Scoring |
| `OPENAI_VISION_MODEL` | | `gpt-4o` | OCR |
| `MATCH_THRESHOLD` | | `72` | Below this is rejected regardless of the model |
| `SMTP_SERVER` · `SMTP_PORT` | | `587` | Password reset only |
| `EMAIL_USERNAME` · `EMAIL_PASSWORD` | | | |
| `FROM_EMAIL` · `FROM_NAME` | | `ProHire` | |
| `FRONTEND_BASE_URL` | ✅ in prod | `http://localhost:5173` | Used to build reset links |
| `CORS_ORIGINS` | ✅ in prod | `http://localhost:5173` | Comma-separated |

Password reset is the one flow that breaks quietly if misconfigured:
`FRONTEND_BASE_URL` builds the link in the email, so a wrong value sends every
recruiter to the wrong host.

### Frontend

| Variable | Notes |
|---|---|
| `VITE_API_URL` | Full base URL including the prefix, e.g. `https://api.example.com/backend` |

Vite inlines `VITE_*` variables into the bundle at **build** time — changing one
requires a rebuild, and anything placed there is public. Never put a secret in
the frontend environment.

## Backend

Start command:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

System packages needed beyond pip: `poppler-utils` (for `pdf2image`), plus
`build-essential`, `libxml2-dev`, `libxslt1-dev`, `libjpeg-dev` and `zlib1g-dev`
to compile `lxml` and `Pillow` where no wheel is available.

`render.yaml` and `Procfile` in `backend/` already encode this. Health checks
should point at `/backend/health`, which verifies database reachability, rather
than `/`, which only proves the process is alive.

Workers: the service is I/O-bound — most of a request is spent waiting on
OpenAI. A handful of uvicorn workers is plenty; concurrency inside each is
already handled by the threadpool that blocking work is dispatched to.

## Frontend

```bash
npm ci && npm run build      # → dist/
```

`vercel.json` rewrites every path to `/` so client-side routes resolve on
refresh — the password-reset link lands on `/reset-password?token=...`, which
does not exist as a file.

## Going to production

- [ ] `JWT_SECRET` is 32+ random characters and unique to this environment.
- [ ] `ENVIRONMENT=production` — this disables the public API docs.
- [ ] `CORS_ORIGINS` lists only real frontend origins.
- [ ] `FRONTEND_BASE_URL` points at the deployed frontend.
- [ ] MongoDB is authenticated, not publicly reachable, and backed up.
- [ ] Health checks target `/backend/health`.
- [ ] `.env` and `ssl/` are absent from the repository — verify with
      `git check-ignore -v backend/.env ssl`.

**Rotating `JWT_SECRET` signs everyone out.** Tokens are stateless, so every
existing one becomes invalid immediately. Expect a wave of logins; there is no
other consequence.

## Operational notes

**GridFS grows without limit.** Every uploaded resume is stored forever;
nothing deletes them. Plan a retention policy before storage becomes a problem.

**Cost scales with resumes screened.** One GPT-4o call each, plus one vision
call per page for scanned documents. `usage` on each result carries the token
counts if you want to track it.

**Logs go to stdout** in a single-line format, ready for whatever your host
collects. Tracebacks are logged but never returned to clients.
