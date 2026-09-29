import { useState } from 'react'

import { Modal, Field, CopyButton } from './ui/index.jsx'
import { useToast } from './ui/toastContext.js'
import { getEmailTemplate, getSettings, currentUser } from '../services/core.js'
import { renderEmail, mailtoHref } from '../domain/emailTemplates.js'

/**
 * The last step before anything reaches a candidate: the email, pre-filled
 * from the template, editable here and now.
 *
 * `send`, when given, sends it for real — from the HR mailbox, through the AI
 * voice interview server. Without it (or while that mailbox is not set up,
 * which `sendUnavailable` explains) sending means handing the finished email
 * to the recruiter's own mail app, or WhatsApp. The compose box is the same
 * either way.
 */
export default function EmailCompose({ title, to, phone, templateKey, vars, note, onClose, onSent, send, sendUnavailable }) {
  const toast = useToast()
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
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

  async function sendNow() {
    setSending(true)
    setError(null)
    try {
      await send(f)
      onSent?.({ ...f, via: 'server' })
      toast(`Email sent to ${f.to}.`, 'good')
      onClose?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

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
            className={`btn ${send ? '' : 'primary'}`}
            href={mailtoHref(f)}
            onClick={() => onSent?.({ ...f, via: 'email' })}
          >
            Open in mail app
          </a>
          {send && (
            <button className="btn primary" onClick={sendNow} disabled={sending || !f.to.trim()}>
              {sending ? 'Sending…' : 'Send email'}
            </button>
          )}
        </>
      }
    >
      {note && <div className="note good mb">{note}</div>}
      {sendUnavailable && <div className="note warn mb small">{sendUnavailable}</div>}
      {error && <div className="note bad mb" role="alert">{error}</div>}
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
