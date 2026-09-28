import { useState } from 'react'

import { Modal, Field, CopyButton } from './ui/index.jsx'
import { getEmailTemplate, getSettings, currentUser } from '../services/core.js'
import { renderEmail, mailtoHref } from '../domain/emailTemplates.js'

/**
 * The last step before anything reaches a candidate: the email, pre-filled
 * from the template, editable here and now.
 *
 * The prototype has no mail server, so sending means handing the finished
 * email to the recruiter's own mail app (or WhatsApp). The real system sends
 * it from the HR mailbox; the compose box stays exactly the same.
 */
export default function EmailCompose({ title, to, phone, templateKey, vars, note, onClose, onSent }) {
  const settings = getSettings()
  const template = getEmailTemplate(templateKey)
  const all = {
    company: settings.org_name,
    persona: settings.persona_name,
    recruiter: currentUser()?.full_name ?? '',
    ...vars,
  }
  const initial = renderEmail(template, all)
  const [f, setF] = useState({ to: to ?? '', cc: initial.cc, subject: initial.subject, body: initial.body })
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  const waNumber = String(phone ?? '').replace(/\D/g, '')
  const waText = `${f.subject}\n\n${f.body}`

  return (
    <Modal
      wide
      title={title ?? template.name}
      onClose={onClose}
      footer={
        <>
          <CopyButton text={`Subject: ${f.subject}\n\n${f.body}`} label="Copy email" className="btn" />
          {waNumber && (
            <a
              className="btn" target="_blank" rel="noreferrer"
              href={`https://wa.me/${waNumber}?text=${encodeURIComponent(waText)}`}
              onClick={() => onSent?.({ ...f, via: 'whatsapp' })}
            >
              Send on WhatsApp
            </a>
          )}
          <a
            className="btn primary"
            href={mailtoHref(f)}
            onClick={() => onSent?.({ ...f, via: 'email' })}
          >
            Open in mail app
          </a>
        </>
      }
    >
      {note && <div className="note good mb">{note}</div>}
      <div className="grid c2">
        <Field label="To"><input type="email" value={f.to} onChange={set('to')} placeholder="candidate@example.com" /></Field>
        <Field label="CC"><input type="text" value={f.cc} onChange={set('cc')} placeholder="hiring.manager@company.com" /></Field>
      </div>
      <Field label="Subject"><input type="text" value={f.subject} onChange={set('subject')} /></Field>
      <Field label="Message" hint="Edit anything here. To change the default wording for everyone, go to Settings → Email templates.">
        <textarea rows={14} value={f.body} onChange={set('body')} />
      </Field>
    </Modal>
  )
}
