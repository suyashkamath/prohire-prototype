import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'

import './styles.css'
import { ToastHost } from './components/ui/toast.jsx'
import ConsoleApp from './console/App.jsx'
import InterviewApp from './interview/App.jsx'
import InterestPage from './interview/InterestPage.jsx'
import SharedReport from './interview/SharedReport.jsx'
import ConsentPage from './interview/ConsentPage.jsx'

// Two front-ends, one bundle, separated at the route.
//
// `/interview/*`, `/interest/*`, `/consent/*` and
// `/share-report/*` are the CANDIDATE and public surfaces: no login, no navigation into the ATS, nothing about other
// candidates. Everything else is the recruiter console behind a sign-in. The
// design has these as separate deployments; in a prototype they share a bundle,
// but they share no components, and the boundary is kept visible here so it is
// easy to split later.

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ToastHost>
        <Routes>
          <Route path="/interview/:token" element={<InterviewApp />} />
          <Route path="/interest/:token" element={<InterestPage />} />
          <Route path="/share-report/:token" element={<SharedReport />} />
          <Route path="/consent/:token" element={<ConsentPage />} />
          <Route path="/*" element={<ConsoleApp />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastHost>
    </BrowserRouter>
  </StrictMode>,
)
