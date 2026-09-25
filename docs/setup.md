# Local setup

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Python | 3.11+ | |
| Node | 18+ | |
| MongoDB | 4.4+ | Local, or a connection string to a shared instance |
| poppler | any | `pdf2image` shells out to it — without it, scanned PDFs fail |

```bash
brew install poppler                      # macOS
sudo apt-get install poppler-utils        # Debian/Ubuntu
```

## Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
```

Create the environment file and fill it in:

```bash
cp .env.example .env
python -c "import secrets; print(secrets.token_urlsafe(48))"   # → JWT_SECRET
```

At minimum you need `MONGODB_URI`, `JWT_SECRET` (32+ characters) and
`OPENAI_API_KEY`. Email settings are only needed to exercise password reset.

```bash
python run.py
```

- API: http://127.0.0.1:8000/backend
- Interactive docs: http://127.0.0.1:8000/docs (disabled when
  `ENVIRONMENT=production`)
- Health: http://127.0.0.1:8000/backend/health

> **Build the virtualenv on your own machine.** A `venv/` directory copied from
> another platform will not work — the interpreter path and compiled extensions
> are platform-specific. The symptom is confusing: `python` is not found while
> the venv looks active, and imports silently resolve against system Python.

## Frontend

```bash
cd frontend
npm install
cp .env.example .env.local     # VITE_API_URL, if not the default
npm run dev                    # http://localhost:5173
```

The dev server's origin must appear in the backend's `CORS_ORIGINS`, or every
request fails in the browser with a CORS error while working fine from curl.

## First run

1. Register a recruiter from the login screen.
2. Log in.
3. On **Resume Screening**, pick a hiring type and level, paste a job
   description, upload a PDF or DOCX, and evaluate.
4. Check **MIS Summary** — the batch should appear with its history.

## Tests and linting

```bash
cd backend  && pytest -q      # 54 tests, no database or API key needed
cd frontend && npm run lint && npm run build
```

## Costs

Every screened resume is one GPT-4o call. A scanned PDF adds one vision call
*per page* on top. Batches are capped at 50 files per request
(`MAX_FILES_PER_BATCH` in `api/routes/screening.py`).

Point `OPENAI_MODEL` at a cheaper model while developing if you are iterating
on flows rather than on scoring quality.
