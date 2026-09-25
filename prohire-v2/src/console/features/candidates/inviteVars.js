// Template variables for the interview-invite email, shared by the invite
// dialog and "Resend interview link".

import { getJob } from '../../../services/jobs.js'
import { formatDate } from '../../../lib/format.js'

export function jobVars(app) {
  const job = getJob(app.job_id)
  return { job_title: job?.title ?? app.job_title, job_reference: app.job_reference }
}

export function inviteVars(app, session, url) {
  return {
    ...jobVars(app),
    link: url,
    duration: session.plan.rules.duration_minutes,
    language: session.plan.persona.language_label,
    persona: session.plan.persona.name,
    expires: formatDate(session.invite.expires_at),
  }
}
