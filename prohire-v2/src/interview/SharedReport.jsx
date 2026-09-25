import { useParams } from 'react-router-dom'

import { getReportByShareToken, getSession } from '../services/interviews.js'
import { getCandidate } from '../services/candidates.js'
import ReportView from '../components/ReportView.jsx'
import { ProHireMark } from '../components/Brand.jsx'

/**
 * The one surface a non-user ever sees.
 *
 * A hiring manager opens it with no account — the pattern the walkthrough
 * pointed at. It shows the report and nothing else: no pipeline, no other
 * candidates, no transcript, no way into the ATS.
 */
export default function SharedReport() {
  const { token } = useParams()
  const report = getReportByShareToken(token)

  if (!report) {
    return (
      <div className="page" style={{ margin: '0 auto' }}>
        <div className="note bad">This report link is not valid or has been revoked.</div>
      </div>
    )
  }

  const session = getSession(report.session_id)
  const candidate = getCandidate(report.candidate_id)

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
      <div className="row mb">
        <ProHireMark size={32} />
        <div>
          <strong>Interview report</strong>
          <div className="small muted">Shared link — no account needed</div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn no-print" onClick={() => window.print()}>Download PDF</button>
      </div>
      <ReportView report={report} session={session} candidate={candidate} variant="public" />
    </div>
  )
}
