# Official career page → ProHire

ProHire does **not** host a career page. The company's official career page
stays as it is. It only needs two small connections:

1. **Read jobs from ProHire.** HR marks a job "List on the official career
   page" in ProHire. The career page shows those jobs.
2. **Send every application to ProHire.** When someone applies on the career
   page, the page forwards the details and resume to ProHire. The candidate
   then shows up in that job's pipeline, tagged **Career portal**, with the
   resume attached.

HR never copies anything by hand.

## Authentication

Every request carries the key shown in **ProHire → Settings → Official career page**:

```
X-ProHire-Key: phk_live_…
```

## 1. Job feed

```
GET /api/v1/career-portal/jobs
```

Returns only jobs that are **Active** and marked for the career page.

```json
[
  {
    "reference": "SLS-0004",
    "title": "Sales Support Executive",
    "department": "Sales",
    "location": { "city": "Chennai", "state": "Tamil Nadu", "mode": "On-site" },
    "employment_type": "Full-time",
    "experience": { "min_years": 1, "max_years": 3 },
    "openings": 2,
    "skills": ["Customer Service", "Motor Insurance", "CRM"],
    "description": "…full job description…",
    "compensation": { "min_lpa": 3, "max_lpa": 4.5 },
    "published_at": "2026-09-25T09:30:00Z"
  }
]
```

`compensation` is included only when HR ticked "Show the range". When a job is
closed, put on hold or unticked, it drops out of the feed. The career page should
refresh the feed at least every 15 minutes.

## 2. Send an application

```
POST /api/v1/career-portal/applications
Content-Type: multipart/form-data
```

| Field                    | Required | Notes                                              |
|--------------------------|----------|----------------------------------------------------|
| `job_reference`          | yes      | From the feed, e.g. `SLS-0004`                     |
| `full_name`              | yes      |                                                    |
| `email` or `phone`       | one of   | Both if available. Phone as 10 digits or +91…     |
| `resume`                 | recommended | PDF, DOC or DOCX, up to 5 MB                    |
| `city`                   | no       |                                                    |
| `total_experience_years` | no       | Number                                             |
| `consent`                | yes      | `true`. The applicant ticked the DPDP consent box |
| `consent_text`           | yes      | The exact consent wording the applicant saw       |
| `external_id`            | no       | The career page's own application ID, for tracing |

Responses:

| Status | Meaning |
|--------|---------|
| `201`  | New application created. Body: `{ "application_id", "candidate_reference" }` |
| `200`  | This person had already applied to this job. Nothing duplicated. Same body |
| `409`  | The job is no longer open (closed, on hold, or unpublished) |
| `422`  | A required field is missing. Body names the field |

ProHire matches people by email, then phone. Someone who applies twice, or who HR
already added from Naukri, stays **one** candidate with both sources on record.

## If the career page can only send email

Fallback: point the career page's "new application" email at a ProHire mailbox
(e.g. `careers-intake@…`). ProHire reads the email and its attachment and files
it under the job reference in the subject line. This is slower and less reliable
than the API, so use it only if the API is not possible.

## Testing today

Until the backend is live, open any job that is listed on the career page →
**Job description** tab → **Test: simulate an application**. It sends exactly
the fields above through the same intake, so the pipeline behaviour is the real
one.
