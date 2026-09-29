// Email templates. Editable in Settings; every email is also editable one last
// time in the compose box before it goes out.
//
// Placeholders are {{like_this}}. Unknown placeholders are left in place rather
// than blanked, so a typo is visible in the preview instead of silently
// producing "Dear ,".

export const PLACEHOLDERS = [
  'candidate_name', 'job_title', 'job_reference', 'company', 'link',
  'duration', 'persona', 'expires', 'recruiter', 'language',
]

export const DEFAULT_TEMPLATES = {
  interview_invite: {
    name: 'Interview invitation',
    cc: '',
    subject: 'Your interview for {{job_title}} at {{company}}',
    body: `Dear {{candidate_name}},

Thank you for your interest in the {{job_title}} role ({{job_reference}}) at {{company}}.

As the next step, please complete a short online video interview with {{persona}}, our AI interviewer. It takes about {{duration}} minutes and will be conducted in {{language}}.

Start your interview here:
{{link}}

Before you begin:
• Use a laptop or phone with a working camera and microphone.
• Sit somewhere quiet and well lit, and keep your device charged.
• Stay on the interview tab. Switching tabs is flagged, and repeated switching ends the interview.
• Answer in your own words — specific examples from your work help most.

The link is valid until {{expires}}.

Regards,
{{recruiter}}
{{company}} — Talent Acquisition`,
  },
  interest_check: {
    name: 'Interest check',
    cc: '',
    subject: 'An opportunity at {{company}}: {{job_title}}',
    body: `Dear {{candidate_name}},

We came across your profile and think you could be a good fit for the {{job_title}} role ({{job_reference}}) at {{company}}.

Would you like to be considered? It takes one click:
{{link}}

If you are interested, we will get in touch about next steps.

Regards,
{{recruiter}}
{{company}} — Talent Acquisition`,
  },
  consent_request: {
    name: 'Data consent (DPDP)',
    cc: '',
    subject: 'Your consent to process your profile — {{company}}',
    body: `Dear {{candidate_name}},

Under the Digital Personal Data Protection Act, 2023, we need your consent to keep your profile in our recruitment database and consider you for current and future roles at {{company}}.

Review and respond here:
{{link}}

You can withdraw your consent at any time by replying to this email.

Regards,
{{recruiter}}
{{company}} — Talent Acquisition`,
  },
}

export function renderTemplate(text, vars) {
  return String(text ?? '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (vars[k] != null && vars[k] !== '' ? String(vars[k]) : m))
}

export function renderEmail(template, vars) {
  return {
    cc: renderTemplate(template.cc ?? '', vars),
    subject: renderTemplate(template.subject, vars),
    body: renderTemplate(template.body, vars),
  }
}

/** A mailto: link — the prototype has no mail server, so the recruiter's own mail app sends it. */
export function mailtoHref({ to, cc, subject, body }) {
  const params = new URLSearchParams()
  if (cc) params.set('cc', cc)
  if (subject) params.set('subject', subject)
  if (body) params.set('body', body)
  // URLSearchParams encodes spaces as "+", which mail clients show literally.
  return `mailto:${encodeURIComponent(to ?? '')}?${params.toString().replace(/\+/g, '%20')}`
}
