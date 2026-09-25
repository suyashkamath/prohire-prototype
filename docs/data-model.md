# Data model

MongoDB database `resume_screening` (configurable via `MONGODB_DB_NAME`).

## `recruiters`

```js
{
  _id: ObjectId,
  username: "asha",                 // unique, login identifier
  email: "asha@example.com",        // unique among string values
  hashed_password: "$argon2id$...",
  created_at: ISODate,
  password_updated_at: ISODate      // present only after a reset
}
```

Accounts created through the old form-based registration have no `email`, which
is why the unique index on it is partial rather than sparse.

## `reset_tokens`

```js
{
  _id: ObjectId,
  email: "asha@example.com",
  token: "eyJhbGci...",             // the JWT itself, unique
  created_at: ISODate,
  expires_at: ISODate,              // TTL index — Mongo deletes the row
  used: false,
  used_at: ISODate                  // set when consumed
}
```

The JWT proves we issued the token and that it has not expired. The row is what
makes it **single-use** — `resolve_email()` requires both.

## `mis`

One document per screening batch, not per resume.

```js
{
  _id: ObjectId,
  recruiter_name: "asha",
  total_resumes: 3,
  shortlisted: 1,
  rejected: 2,
  timestamp: ISODate,               // sort key for all reporting
  history: [
    {
      resume_name: "priya_sharma.pdf",
      hiring_type: "Sales",         // label, not the numeric code
      level: "Fresher",
      match_percent: 84,
      decision: "Shortlisted",      // Shortlisted | Rejected | Error | "-"
      details: "Match %: 84%\nPros:\n- ...",
      file_id: "66f1a2...",         // GridFS id, null if storage failed
      counts_per_day: 12            // computed at read time, not stored
    }
  ]
}
```

Notes:

- **`hiring_type` and `level` are stored as labels**, so a record stays readable
  if the numeric codes are ever remapped.
- **`file_id` may be null.** File storage is best-effort; the screening still
  completes if GridFS is unavailable.
- **`counts_per_day` is not persisted.** It is added by `build_mis_summary()`
  when assembling a response, grouping by the date portion of `upload_date`.
- **`details` holds the model's write-up after the threshold rule was applied**,
  so history reflects the decision that was actually made.

## GridFS: `fs.files` / `fs.chunks`

The original uploaded resumes, addressed by the `file_id` in each history entry.

```js
{
  _id: ObjectId,
  filename: "priya_sharma.pdf",
  length: 184320,
  uploadDate: ISODate,
  metadata: {
    content_type: "application/pdf",
    upload_date: ISODate,
    recruiter_name: "asha",
    file_size: 184320
  }
}
```

Files are never deleted by the application. Storage grows with every screening —
worth a retention policy before it becomes one.

## Indexes

See [backend.md](backend.md#indexes). All are created on startup and each is
built independently, so one failure does not block the others or stop the app.
