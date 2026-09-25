import { useState } from 'react'
import { useParams } from 'react-router-dom'

import { findByInterestToken, recordInterest } from '../services/applications.js'
import { getSettings } from '../services/core.js'
import { ProHireMark } from '../components/Brand.jsx'

/**
 * The optional interest check — two buttons, no account, no explanation needed.
 *
 * "Not right now" is given the same visual weight as "Yes". A page that makes
 * declining look like a mistake produces answers you cannot trust.
 */
export default function InterestPage() {
  const { token } = useParams()
  const [app, setApp] = useState(() => findByInterestToken(token))
  const [done, setDone] = useState(() => findByInterestToken(token)?.interest?.response ?? null)

  if (!app) {
    return (
      <Shell><div className="note bad">This link is not valid. Ask your recruiter to send a new one.</div></Shell>
    )
  }

  if (done) {
    return (
      <Shell>
        <h1 style={{ marginBottom: 8 }}>Thank you</h1>
        <p className="muted">
          {done === 'interested'
            ? 'We have let the recruiter know. You will hear from them shortly.'
            : 'Noted — we will not contact you about this role again.'}
        </p>
      </Shell>
    )
  }

  const answer = (response) => {
    recordInterest(token, response)
    setDone(response)
    setApp(findByInterestToken(token))
  }

  return (
    <Shell>
      <h1 style={{ marginBottom: 8 }}>{app.job_title}</h1>
      <p className="muted">Reference {app.job_reference}</p>
      <p style={{ marginTop: 16 }}>
        Hello {app.candidate_name.split(' ')[0]} — we are hiring for this role and thought of you.
        Before we take up any more of your time: are you open to it right now?
      </p>
      <div className="row mt" style={{ gap: 10 }}>
        <button className="btn primary lg" style={{ flex: 1 }} onClick={() => answer('interested')}>
          Yes, I&rsquo;m interested
        </button>
        <button className="btn lg" style={{ flex: 1 }} onClick={() => answer('not_interested')}>
          Not right now
        </button>
      </div>
      <p className="small muted mt">
        Either answer is fine, and neither affects anything else. Saying no simply stops the emails
        for this role.
      </p>
    </Shell>
  )
}

function Shell({ children }) {
  return (
    <div className="interview-shell">
      <div className="interview-card">
        <div className="interview-head">
          <ProHireMark size={32} />
          <strong>{getSettings().org_name} · Careers</strong>
        </div>
        <div className="interview-body">{children}</div>
      </div>
    </div>
  )
}
