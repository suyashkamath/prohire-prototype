# Frontend

React 19 + Vite single-page app in `frontend/`.

## Module map

```
frontend/src/
├── main.jsx                  Entry point
├── App.jsx                   Providers + page switching (~55 lines)
├── api/                      The only code that talks to the backend
│   ├── client.js             Base URL, bearer token, error normalisation
│   ├── auth.js               login · register · forgot · reset
│   ├── screening.js          analyzeResumes
│   ├── files.js              viewResume · downloadResume
│   └── reports.js            fetchMISSummary · fetchReports
├── app/
│   ├── AuthContext.js        Context + useAuth hook
│   └── AuthProvider.jsx      Session state, login/logout, 401 handling
├── components/
│   ├── layout/Sidebar.jsx
│   └── ui/                   Card · Modal · Select · PageHeader
│                             DecisionBadge · AnalysisText
├── features/                 One folder per screen
│   ├── auth/                 AuthPage + Login/Register/Forgot/Reset forms
│   ├── screening/            ScreeningPage · JobDetailsCard
│   │                         UploadCard · ResultsTable
│   ├── mis/                  MISSummaryPage · RecruiterCard · HistoryTable
│   ├── reports/              DailyReportsPage · ReportCard
│   └── resume-viewer/        ResumeViewerModal · ResumePreview
├── hooks/                    useAsync · useToggleMap
├── lib/                      constants · decision · download · date · notify
└── styles/                   App.css · index.css
```

**The rule:** a feature may import from `api/`, `components/`, `hooks/` and
`lib/`, but never from another feature. Anything two features both need moves
down into `components/ui` or `lib`.

## The API client

`api/client.js` is the single place this app performs a network request. It
owns four things so no feature has to remember them:

- **The base URL** — `VITE_API_URL`, falling back to
  `http://127.0.0.1:8000/backend`.
- **The bearer token** — attached automatically. `FormData` bodies are left
  alone so the browser can set its own multipart boundary.
- **Error shape** — every non-2xx throws an `ApiError` carrying a readable
  message and a `status`. It unwraps `detail`, whether the server sent a string
  or a list of validation errors, and turns a network failure into
  "Cannot reach the server."
- **Expired sessions** — a 401 fires the registered handler, which logs the
  user out, then throws.

Feature modules call `api.get` / `api.post`, never `fetch`.

## Session handling

`AuthProvider` owns the token and pushes it into the API client, rather than
passing it down as a prop. Nothing below has to thread a token through to make
a request.

One subtlety worth preserving: the token is primed inside the `useState`
initialiser, not an effect. **Child effects run before parent effects in
React** — a page that fetches on mount would otherwise race the provider and
send its first request unauthenticated.

`localStorage` access is wrapped in `try/catch` throughout. It throws outright
in some privacy modes, and a session that cannot be persisted should still work
for the current tab.

## Shared hooks

**`useAsync(action)`** wraps an async call with loading state and error
reporting, replacing the try/catch/setLoading block that otherwise repeats in
every feature. Returns `[run, loading]`; `run` resolves to `undefined` when the
action threw.

```jsx
const [submit, loading] = useAsync(login);
// ...
<button disabled={loading}>{loading ? "Logging in..." : "Login"}</button>
```

It takes an `onError` override for cases where a failure is not worth
interrupting the user — the reports page treats a missing report as an empty
day rather than an error.

**`useToggleMap()`** tracks which rows in a collection are expanded. Used twice
on the MIS page, for history panels and detail rows.

## Conventions

**No inline `style` objects.** Layout lives in `styles/App.css`; components
carry class names. The extracted utilities are grouped at the bottom of that
file.

**Dates format in local time.** `lib/date.js` exists because
`date.toISOString().split("T")[0]` converts to UTC first — in IST that returns
*yesterday* before 05:30. Use `toDateInputValue` / `fromDateInputValue`.

**User messages go through `lib/notify.js`.** Still `window.alert` today, but
centralised, so swapping in a toast component is one edit rather than a sweep
through every feature.

**Decision parsing lives in `lib/decision.js`.** The backend sends an explicit
`decision`, but older MIS records only carry the raw write-up, so the helper
falls back to reading it out of `result_text`.

## Making a change

**Adding a screen.** Create `features/<name>/<Name>Page.jsx`, add an entry to
`PAGES` in `lib/constants.js`, add it to `NAV_ITEMS` in `Sidebar.jsx`, render
it in `App.jsx`.

**Adding an endpoint.** Add a function to the matching file in `api/`.

**Adding a role type.** Add it to `HIRING_TYPES` in `lib/constants.js` — and
keep it in step with `HIRING_TYPE_LABELS` in the backend's
`app/utils/constants.py`. The numeric values are what get sent over the wire.

## Commands

```bash
npm install
npm run dev       # http://localhost:5173
npm run lint
npm run build
```

`eslint.config.js` has no `eslint-plugin-react`, so `no-unused-vars` does not
track JSX usage. Destructuring a component out of a map callback
(`({ Icon }) => <Icon />`) will be reported as unused — access it off the item
instead (`<item.Icon />`).
