import { useEffect, useState } from 'react'

import EmailCompose from '../../../components/EmailCompose.jsx'
import { emailInvite, recordInviteEmail } from '../../../services/interviews.js'
import { botStatus } from '../../../services/interviewBot.js'
import { getCandidate } from '../../../services/candidates.js'
import { inviteVars } from '../candidates/inviteVars.js'

/**
 * The invite email for one interview, addressed to the candidate's email on
 * file. For an AI voice call it is sent from the HR mailbox by the interview
 * server; if that mailbox is not set up yet, the recruiter's mail app opens
 * with the same email ready.
 */
export default function InviteEmail({ application, session, url, title, note, onClose }) {
  const candidate = getCandidate(application.candidate_id)
  const [server, setServer] = useState(null)

  useEffect(() => {
    if (!session.bot) return
    let live = true
    botStatus().then((s) => { if (live) setServer(s) })
    return () => { live = false }
  }, [session.bot])

  const canSend = Boolean(session.bot && server?.email)
  const unavailable = session.bot && server && !server.email
    ? server.reachable
      ? 'Sending from the HR mailbox is not set up yet (SMTP settings in InterviewBot/.env), so “Open in mail app” sends it from your own mailbox instead.'
      : `${server.error} “Open in mail app” still works.`
    : null

  return (
    <EmailCompose
      title={title ?? `Send the interview to ${application.candidate_name}`}
      to={candidate?.email} phone={candidate?.phone}
      templateKey="interview_invite"
      vars={{ candidate_name: candidate?.full_name ?? application.candidate_name, ...inviteVars(application, session, url) }}
      note={note}
      send={canSend ? (email) => emailInvite(session._id, email) : undefined}
      sendUnavailable={unavailable}
      onSent={(email) => recordInviteEmail(session._id, email)}
      onClose={onClose}
    />
  )
}
