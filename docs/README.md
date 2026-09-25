# ProHire Documentation

AI-assisted resume screening. Recruiters paste a job description, upload a batch
of resumes, and get a match percentage plus a shortlist/reject decision for each
one — with every screening recorded for reporting.

## Start here

| Document | What it covers |
|---|---|
| [prohire-ats-system-design.md](prohire-ats-system-design.md) | **V2 design:** the ATS + AI interviewer — scope, data model, interview engine, security, delivery plan |
| [prohire-v2-prototype.md](prohire-v2-prototype.md) | **V2 prototype (built):** what `prohire-v2/` does today — HR requirement → feature map, candidate & recruiter flows, extension, what still needs the backend |
| [career-portal-integration.md](career-portal-integration.md) | **For the official career page's developer:** job feed + application API so career-page applicants land in ProHire |
| [end-to-end-flow.md](end-to-end-flow.md) | **The flow:** what happens when, and who does it — setup → source → screen → invite → interview → report |
| [system-design.md](system-design.md) | Diagrams of every flow, how data and resumes are stored, scaling and failure modes |
| [prohire-end-to-end-flow.excalidraw](prohire-end-to-end-flow.excalidraw) | **Whiteboard:** the end-to-end flow as an editable Excalidraw canvas — open at excalidraw.com |
| [prohire-system-design.excalidraw](prohire-system-design.excalidraw) | **Whiteboard:** the system design as an editable Excalidraw canvas — clients → API → domain → worker → data → AI |
| [architecture.md](architecture.md) | How the pieces fit together, and what happens during a screening |
| [backend.md](backend.md) | FastAPI service: layers, modules, and where to make a change |
| [frontend.md](frontend.md) | React app: features, API layer, session handling |
| [setup.md](setup.md) | Getting both halves running locally |
| [api.md](api.md) | Endpoint reference |
| [data-model.md](data-model.md) | MongoDB collections and document shapes |
| [deployment.md](deployment.md) | Environment variables and deploy configuration |
| [troubleshooting.md](troubleshooting.md) | Startup failures and their fixes |

## The stack

| Layer | Choice | Why |
|---|---|---|
| Backend | Python 3.11+ / FastAPI | The document-parsing ecosystem — `pdfplumber`, `python-docx`, `mammoth` — is the reason. Resume extraction is the hardest part of this app and Python is where those libraries live. |
| AI | OpenAI GPT-4o | Scoring and vision OCR for scanned resumes |
| Database | MongoDB (Motor) | Screening records are nested, variable documents; GridFS stores the resume files |
| Frontend | React 19 + Vite | Single-page dashboard |

## Repository layout

```
ProHire/
├── backend/        FastAPI service — see backend.md
├── frontend/       React dashboard — see frontend.md
├── prohire-v2/     V2 prototype: ATS + AI interviewer — see prohire-v2-prototype.md
├── docs/           You are here
└── ssl/            Certificates (never committed)
```

## Conventions

- **Secrets live in the environment**, never in code. Both halves ship a
  `.env.example`; neither `.env` is committed.
- **One direction of dependency.** On the backend, `routes → services →
  (ai | extraction | db) → core`. On the frontend, a feature may use `api/`,
  `components/`, `hooks/` and `lib/`, but never another feature.
- **Nothing calls `fetch` or the database directly from a UI component or a
  route handler.** Those go through `api/` and `services/` respectively.
