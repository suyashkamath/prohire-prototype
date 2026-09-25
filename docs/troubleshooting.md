# Troubleshooting

Real failures hit while getting this running, and what each one actually means.

## `JWT_SECRET must be at least 32 characters`

```
pydantic_core._pydantic_core.ValidationError: 1 validation error for Settings
JWT_SECRET
  Value error, JWT_SECRET must be at least 32 characters.
  [type=value_error, input_value='supersecretkey', input_type=str]
```

Working as intended — a weak signing key lets anyone forge a token for any
recruiter, so the app refuses to start rather than doing it quietly.

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Put the result in `.env` as `JWT_SECRET=`.

If it still reports the old value after editing the file, a shell variable is
shadowing it — environment variables take precedence over `.env`:

```bash
echo "[$JWT_SECRET]"      # non-empty means it is exported somewhere, likely ~/.zshrc
```

Rotating the secret logs everyone out once. That is the only side effect.

## `DuplicateKeyError` on startup

```
pymongo.errors.DuplicateKeyError: Index build failed: ...
index: token_1 dup key: { token: "eyJhbGci..." }
```

The `reset_tokens` collection contains identical tokens, so the unique index
cannot build. The old reset token was signed from email plus expiry with no
random component, so two requests for the same address within one second
produced byte-identical JWTs.

Startup no longer fails on this — the index is skipped and logged. To clear it
properly:

```bash
cd backend
python scripts/cleanup_reset_tokens.py           # dry run, counts only
python scripts/cleanup_reset_tokens.py --apply   # then delete
```

It removes expired tokens and surplus copies of duplicated ones, keeping one row
per token. Both are dead data: an expired token cannot be redeemed, and
identical tokens are the same token. Restart and the index builds cleanly.

## `zsh: command not found: python` inside an active venv

The virtualenv was built on another platform — the committed `venv/` directory
targeted Linux and Python 3.10. Interpreter paths and compiled extensions do not
survive the move.

The dangerous part is what happens next: `python3` silently falls through to
system Python, and imports resolve against user site-packages. It looks like it
works until versions drift. Check which interpreter is really in use by reading
the paths in any traceback.

```bash
cd backend
rm -rf venv
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
```

## Every request fails in the browser, but curl works

CORS. The browser's origin is not in the backend's `CORS_ORIGINS`.

```bash
CORS_ORIGINS=http://localhost:5173,https://prohire.example.com
```

Comma-separated, no spaces needed, no brackets or quotes — it is parsed as a
plain string and split. `API_PREFIX` must also match the path in
`VITE_API_URL`.

## Everyone is suddenly logged out

`JWT_SECRET` changed, or the deployment has more than one instance with
different secrets. Tokens are stateless: signature is the only thing checked, so
every instance must share the same secret.

## Scanned PDFs return no text

`pdf2image` needs poppler as a system package.

```bash
brew install poppler                    # macOS
sudo apt-get install poppler-utils      # Debian/Ubuntu
```

The log line is `Could not rasterise the PDF for OCR`. PDFs with a text layer
keep working — only scanned ones go down the OCR path.

## A resume is rejected with "Unsupported file type"

Allowed: `.pdf`, `.doc`, `.docx`, and images (`.jpg`, `.jpeg`, `.png`, `.gif`,
`.bmp`, `.tiff`, `.webp`). `.txt`, `.pages` and `.rtf` are not — the extension
set is in `app/extraction/dispatcher.py`.

## A `.doc` from a job board extracts as garbage

Naukri and similar exports are HTML wearing a `.doc` extension. The extractor
sniffs for HTML before trusting the extension and falls back through four
strategies. If all four fail, the file is genuinely unreadable — converting to
PDF is the reliable fix.

## `decision: "Error"` on some resumes in a batch

Expected behaviour, not a crash. Extraction or scoring failed for those files
and the rest of the batch continued. The `error` field on each result says why.

## Screening is slow

One GPT-4o call per resume, sequentially, plus one vision call *per page* for
scanned documents. A 20-resume batch takes minutes. The batch cap is
`MAX_FILES_PER_BATCH` in `app/api/routes/screening.py`.

## Reports return 401 that used to work

Deliberate. `/mis-summary`, `/daily-reports`, `/previous-day-reports` and
`/reports/{date}` were previously unauthenticated and exposed every recruiter's
activity to anyone with the URL. They now require a token; the frontend's API
client attaches it automatically.

## Validation errors show as `[object Object]`

Fixed application-wide — `RequestValidationError` is flattened into a sentence
in `app/main.py`. If it reappears, something is bypassing the handler, or a
client is rendering a field other than `detail`.

## Dates are off by one day

`toISOString()` converts to UTC before formatting, which shifts the date for
anyone east or west of Greenwich at the wrong hour — in IST, before 05:30 it
returns yesterday. Use `toDateInputValue` / `fromDateInputValue` from
`frontend/src/lib/date.js`.

Report *ranges* are UTC day boundaries by design, on the backend.

## Where to look

```bash
curl http://127.0.0.1:8000/backend/health     # is the database reachable?
cd backend && pytest -q                       # is the logic intact?
cd frontend && npm run lint && npm run build  # does the UI compile?
```

Backend logs are single-line to stdout:
`timestamp | LEVEL | logger | message`. Tracebacks are logged in full but never
returned to clients.
