import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Confirm } from '../../../components/ui/index.jsx'
import { useToast } from '../../../components/ui/toastContext.js'
import EmailCompose from '../../../components/EmailCompose.jsx'
import {
  setCandidateFlag, requestConsent, deleteCandidate, resumeFile,
} from '../../../services/candidates.js'
import { moveStage, sendInterestCheck, removeApplication } from '../../../services/applications.js'
import { sessionsFor, resendInvite } from '../../../services/interviews.js'
import { STAGES } from '../../../domain/stages.js'
import { downloadText } from '../../../lib/csv.js'
import InviteDialog from '../jobs/InviteDialog.jsx'
import { MoveStage, NoteDialog, TagsDialog, FlagDialog, ShareDialog, MoveJobDialog, TagToJob } from './CandidateActions.jsx'
import { inviteVars, jobVars } from './inviteVars.js'

/**
 * Every action a recruiter can take on a candidate, in one place, so the
 * pipeline row and the candidate page offer exactly the same menu.
 *
 *   const actions = useCandidateActions()
 *   <Menu items={actions.itemsFor(candidate, application)} />
 *   {actions.element}
 */
export function useCandidateActions() {
  const navigate = useNavigate()
  const toast = useToast()
  const [dialog, setDialog] = useState(null)
  const open = (kind, candidate, app, extra) => setDialog({ kind, candidate, app, ...extra })
  const close = () => setDialog(null)

  function itemsFor(candidate, app) {
    if (!candidate) return []
    const latest = app ? sessionsFor(app._id)[0] : null
    const closed = app && STAGES[app.stage]?.terminal
    return [
      { label: 'View profile', onClick: () => navigate(`/candidates/${candidate._id}`) },
      app && { label: 'Change stage…', onClick: () => open('stage', candidate, app) },
      '-',
      app && !closed && (latest?.state === 'invited'
        ? { label: 'Resend interview link', onClick: () => {
            const { url } = resendInvite(latest._id)
            open('email', candidate, app, { template: 'interview_invite', vars: inviteVars(app, latest, url), title: 'Resend interview link' })
          } }
        : { label: 'Send AI interview…', onClick: () => open('invite', candidate, app) }),
      app && !closed && !app.interest && {
        label: 'Ask if interested (email)',
        hint: 'Optional — skip it if you already spoke to them',
        onClick: () => {
          const { url } = sendInterestCheck(app._id)
          open('email', candidate, app, { template: 'interest_check', vars: { ...jobVars(app), link: url }, title: 'Ask if interested' })
        },
      },
      app && { label: 'Add note…', onClick: () => open('note', candidate, app) },
      !app && { label: 'Add to a job…', onClick: () => open('tagjob', candidate, null) },
      app && { label: 'Move to another job…', onClick: () => open('move', candidate, app) },
      '-',
      { label: 'Tags…', onClick: () => open('tags', candidate, app) },
      { label: candidate.flag ? 'Remove flag' : 'Flag…', onClick: () => (candidate.flag ? (setCandidateFlag(candidate._id, null), toast('Flag removed.')) : open('flag', candidate, app)) },
      { label: 'Share profile…', onClick: () => open('share', candidate, app) },
      { label: 'Download resume', onClick: () => { const f = resumeFile(candidate); downloadText(f.filename, f.text) } },
      {
        label: candidate.consent?.data_processing === 'granted' ? 'Data consent: given ✓' : 'Request data consent (DPDP)',
        disabled: candidate.consent?.data_processing === 'granted',
        onClick: () => {
          const { url } = requestConsent(candidate._id)
          open('email', candidate, app, { template: 'consent_request', vars: { link: url }, title: 'Request data consent' })
        },
      },
      '-',
      app && !closed && { label: 'Withdraw', hint: 'Candidate pulled out', onClick: () => { moveStage(app._id, 'withdrawn', 'Candidate withdrew'); toast(`${candidate.full_name} marked as withdrawn.`) } },
      app && !closed && { label: 'Reject', tone: 'bad', onClick: () => open('stage', candidate, app, { preset: 'rejected' }) },
      app && { label: 'Remove from this job', tone: 'bad', onClick: () => open('remove', candidate, app) },
      { label: 'Delete candidate…', tone: 'bad', onClick: () => open('delete', candidate, app) },
    ]
  }

  let element = null
  if (dialog) {
    const { kind, candidate, app } = dialog
    if (kind === 'stage') element = <MoveStage ids={[app._id]} current={app.stage} preset={dialog.preset} onClose={close} />
    if (kind === 'invite') element = <InviteDialog application={app} onClose={close} />
    if (kind === 'email') {
      element = (
        <EmailCompose
          title={dialog.title} to={candidate.email} phone={candidate.phone}
          templateKey={dialog.template}
          vars={{ candidate_name: candidate.full_name, ...dialog.vars }}
          onClose={close}
        />
      )
    }
    if (kind === 'note') element = <NoteDialog app={app} onClose={close} />
    if (kind === 'tags') element = <TagsDialog candidate={candidate} onClose={close} />
    if (kind === 'flag') element = <FlagDialog candidate={candidate} onClose={close} />
    if (kind === 'share') element = <ShareDialog candidate={candidate} app={app} onClose={close} />
    if (kind === 'move') element = <MoveJobDialog candidate={candidate} app={app} onClose={close} />
    if (kind === 'tagjob') element = <TagToJob candidate={candidate} onClose={close} />
    if (kind === 'remove') {
      element = (
        <Confirm
          title={`Remove ${candidate.full_name} from ${app.job_reference}?`}
          confirmLabel="Remove from job" tone="danger" onClose={close}
          onConfirm={() => { removeApplication(app._id); toast('Removed from the job. They are still in the database.') }}
          body={<p>They stay in the candidate database and can be added back any time. Their notes on this job are deleted.</p>}
        />
      )
    }
    if (kind === 'delete') {
      element = (
        <Confirm
          title={`Delete ${candidate.full_name}?`}
          confirmLabel="Delete permanently" tone="danger" onClose={close}
          onConfirm={() => { deleteCandidate(candidate._id); toast(`${candidate.full_name} deleted.`); if (window.location.pathname.startsWith('/candidates/')) navigate('/candidates') }}
          body={<p>This removes the candidate, their resume, every job they are on, and all interview reports. It cannot be undone. Use it when a candidate asks for their data to be erased.</p>}
        />
      )
    }
  }

  return { itemsFor, element, open }
}
