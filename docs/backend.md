# Backend

FastAPI service in `backend/`. Python 3.11+.

## Module map

```
backend/
├── app/
│   ├── main.py              App factory, CORS, exception handlers, lifespan
│   ├── core/
│   │   ├── config.py        Every setting, read from the environment
│   │   ├── security.py      Argon2 hashing, JWT issue/verify
│   │   └── logging.py       Log format
│   ├── db/
│   │   └── mongodb.py       Connection lifecycle, collections, GridFS, indexes
│   ├── api/
│   │   ├── deps.py          get_current_recruiter
│   │   └── routes/
│   │       ├── __init__.py  Router aggregation
│   │       ├── auth.py      register · login · forgot/reset password
│   │       ├── screening.py analyze-resumes
│   │       ├── files.py     view · download
│   │       ├── reports.py   mis-summary · daily reports
│   │       ├── maintenance.py
│   │       └── health.py
│   ├── schemas/             Pydantic request/response models
│   ├── services/
│   │   ├── recruiters.py    Accounts, authentication, password changes
│   │   ├── screening.py     The screening pipeline
│   │   ├── reports.py       MIS aggregation, date ranges
│   │   ├── files.py         GridFS storage
│   │   ├── reset_tokens.py  Single-use reset tokens
│   │   ├── email.py         SMTP delivery
│   │   └── templates.py     Email bodies
│   ├── ai/
│   │   ├── client.py        Shared OpenAI client
│   │   ├── prompts.py       The 8 screening prompts
│   │   ├── analysis.py      Scoring, parsing, threshold rule
│   │   └── vision.py        OCR via the vision model
│   ├── extraction/
│   │   ├── dispatcher.py    Route a file to the right extractor
│   │   ├── pdf.py · word.py · images.py
│   │   └── base.py          ExtractionError
│   └── utils/               constants.py · formatting.py
├── scripts/                 One-off maintenance scripts
├── tests/
├── requirements.txt         Pinned runtime dependencies
├── requirements-dev.txt     Adds pytest, ruff
└── run.py                   Development entry point
```

## Startup

`app/main.py` builds the application; `create_app()` is a factory so tests can
build an isolated instance.

The lifespan context runs on startup and shutdown:

1. Configure logging.
2. Connect to MongoDB and ping it — a bad URI fails loudly here, not on the
   first request.
3. Ensure indexes.
4. On shutdown, close the connection.

The client is created during the lifespan rather than at import time. That
matters: a Motor client binds to the event loop it was created on, and creating
it at import binds it to the wrong one.

## Configuration

Everything comes from the environment via `pydantic-settings`. Nothing is
hard-coded, so the same build promotes from local to production unchanged.

Two guards are worth knowing about:

**`JWT_SECRET` must be at least 32 characters.** The app refuses to start
otherwise. This is what stops a placeholder secret reaching production; a weak
one lets anyone forge a token for any recruiter.

**`CORS_ORIGINS` is a plain string, not a list.** `pydantic-settings`
JSON-decodes list-typed fields at the source level, *before* validators run, so
a comma-separated environment variable would fail to parse. Read it through the
`settings.cors_origins` property, which splits it.

Settings are cached with `lru_cache`, so the environment is parsed once per
process.

## Error handling

Domain exceptions are raised by services and translated at the route:

| Exception | Raised by | Becomes |
|---|---|---|
| `RecruiterAlreadyExists` | `services/recruiters.py` | 409 |
| `ExtractionError` | `extraction/` | Recorded per file as `decision: "Error"` |
| `AnalysisError` | `ai/analysis.py` | Recorded per file as `decision: "Error"` |
| `FileNotFound` | `services/files.py` | 404 |
| `InvalidDateType` | `services/reports.py` | 400 |

Two application-wide handlers sit in `main.py`:

- **`RequestValidationError`** is flattened into one readable sentence. Pydantic
  returns `detail` as a list of dicts; clients render `detail` directly, so a
  raw list surfaces to the recruiter as `[object Object]`.
- **Unhandled `Exception`** logs the traceback and returns an opaque
  `"Internal server error"`. Stack traces stay server-side.

## Indexes

`ensure_indexes()` builds each index through `_try_create_index`, which logs
failures instead of raising. An index that cannot be built is a data problem to
fix, not a reason to take the API down.

| Collection | Index | Purpose |
|---|---|---|
| `recruiters` | `username` unique | Login lookup |
| `recruiters` | `email` unique, partial on string | Reset lookup |
| `reset_tokens` | `expires_at` TTL | Mongo expires rows itself |
| `reset_tokens` | `token` unique | One row per token |
| `mis` | `timestamp` desc | Report date ranges |
| `mis` | `recruiter_name` + `timestamp` desc | Per-recruiter history |

The `email` index is **partial**, not sparse. Sparse skips documents *missing*
the field, but `email: null` is a value — and legacy accounts created through
the old form-based registration have exactly that, so a sparse unique index
would collide on the second one.

## Tests

```bash
pytest -q
```

54 tests, no database or API key required. `tests/conftest.py` sets
`ENV_FILE=""` before anything imports the config, so the suite never opens a
real `.env` and never depends on live credentials.

Coverage is deliberately weighted toward logic that is easy to get wrong and
invisible when it breaks: the threshold override, token type separation, the
ordinal date suffixes (`11th`, not `11st`), daily-count grouping, and that all
eight prompts fill their placeholders.

## Making a change

**Adding an endpoint.** Add the route to the right module in `api/routes/`, put
the logic in a service, and describe the payload in `schemas/`. If the route is
more than about fifteen lines, logic has leaked in.

**Adding a role type.** One entry in `PROMPT_TEMPLATES` keyed by
`(hiring_type, level)`, one label in `utils/constants.py`, and the matching
option in the frontend's `lib/constants.js`. `tests/test_prompts.py` picks up
the new template automatically.

**Changing the match threshold.** `MATCH_THRESHOLD` in the environment. It is
read at request time, so no code change is needed.

**Adding a file type.** A module in `extraction/`, wired into
`dispatcher.py` and its extension set.
