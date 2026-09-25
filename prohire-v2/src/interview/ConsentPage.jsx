import { useState } from 'react'
import { useParams } from 'react-router-dom'

import { findByConsentToken, recordConsentResponse } from '../services/candidates.js'
import { getSettings } from '../services/core.js'
import { ProHireMark } from '../components/Brand.jsx'

/**
 * DPDP consent. Optional for the recruiter to send; when sent, the answer is
 * recorded against the candidate and shown on their profile.
 */
export default function ConsentPage() {
  const { token } = useParams()
  const [c, setC] = useState(() => findByConsentToken(token))
  const org = getSettings().org_name

  const shell = (children) => (
    <div className="interview-shell">
      <div className="interview-card" style={{ maxWidth: 560 }}>
        <div className="interview-head"><ProHireMark size={32} /><strong>{org} · Data consent</strong></div>
        <div className="interview-body">{children}</div>
      </div>
    </div>
  )

  if (!c) return shell(<div className="note bad">This link is not valid. Ask the recruiter to send a new one.</div>)

  const state = c.consent?.data_processing
  if (state === 'granted' || state === 'refused') {
    return shell(
      <>
        <h1 style={{ marginBottom: 8 }}>Thank you</h1>
        <p className="muted">
          {state === 'granted'
            ? 'Your consent is recorded. We will contact you about suitable roles.'
            : 'Noted. We will not keep your profile for future roles, and your data will be deleted.'}
        </p>
      </>,
    )
  }

  const answer = (granted) => setC(recordConsentResponse(token, granted))

  return shell(
    <>
      <h1 style={{ marginBottom: 8 }}>Hello {c.full_name.split(' ')[0]}</h1>
      <p>
        {org} would like to keep your profile in its recruitment database and consider you for current
        and future roles.
      </p>
      <ul className="consent-list">
        <li>We store your name, contact details, resume and interview results.</li>
        <li>Only our recruitment team and hiring managers can see them.</li>
        <li>We never sell or share your data with anyone outside {org}.</li>
        <li>You can withdraw consent at any time, and we will delete your data.</li>
      </ul>
      <div className="row mt" style={{ gap: 10 }}>
        <button className="btn primary lg" style={{ flex: 1 }} onClick={() => answer(true)}>I consent</button>
        <button className="btn lg" style={{ flex: 1 }} onClick={() => answer(false)}>I do not consent</button>
      </div>
      <p className="small muted mt">As per the Digital Personal Data Protection Act, 2023.</p>
    </>,
  )
}
