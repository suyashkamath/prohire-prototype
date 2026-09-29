// Reading resume files in the browser: PDF, Word (.docx, and old .doc) and text.
//
// The text is all the rest of the pipeline needs — parsing, dedupe and
// screening work on it exactly as on pasted text. The PDF and Word readers are
// loaded only when such a file is picked, so nobody else pays for them.
//
// What cannot work, and says so rather than guessing: a scanned PDF (a picture
// of a page has no text without OCR) and a password-protected PDF.

export const RESUME_ACCEPT = [
  '.pdf', '.docx', '.doc', '.txt', '.md', '.rtf', '.csv',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/*',
].join(',')

/** 'pdf' | 'docx' | 'doc' | 'text' | null (not a resume format we read). */
export function resumeKind(file) {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf'
  if (name.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx'
  if (name.endsWith('.doc') || file.type === 'application/msword') return 'doc'
  if (/\.(txt|md|csv|json|rtf)$/.test(name) || file.type.startsWith('text/')) return 'text'
  return null
}

const letters = (s) => (s.match(/\p{L}/gu) ?? []).length
const MIN_LETTERS = 40   // less than a name and an email: nothing useful was read

/**
 * The text of one resume file.
 * @returns {Promise<{ text: string, kind: string, warning: string | null }>}
 * @throws  Error with a message a recruiter can act on
 */
export async function extractResumeText(file) {
  const kind = resumeKind(file)
  if (!kind) throw new Error('Not a resume format we can read — use PDF, Word or text.')

  let text
  let warning = null
  if (kind === 'text') text = await file.text()
  else if (kind === 'pdf') text = await pdfText(file)
  else if (kind === 'docx') text = await docxText(file)
  else {
    text = oldWordText(await file.arrayBuffer())
    warning = 'Old Word (.doc) is read on a best-effort basis — check the details, or save it as .docx.'
  }

  text = tidy(text)
  if (letters(text) < MIN_LETTERS) {
    throw new Error(kind === 'pdf'
      ? 'No text in this PDF — it is probably a scanned image. Paste the text instead.'
      : 'No readable text in this file. Paste the text instead.')
  }
  return { text, kind, warning }
}

function tidy(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex -- stray control characters from PDF and Word
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// --- PDF ------------------------------------------------------------------------

async function pdfText(file) {
  const pdfjs = await import('pdfjs-dist')
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  let doc
  try {
    doc = await task.promise
  } catch (err) {
    task.destroy()
    if (err?.name === 'PasswordException') throw new Error('This PDF is password-protected. Ask for an unlocked copy, or paste the text.')
    throw new Error('This PDF could not be opened — it may be damaged. Paste the text instead.')
  }

  try {
    const pages = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const { items } = await page.getTextContent()
      pages.push(linesOf(items))
    }
    return pages.join('\n\n')
  } catch {
    throw new Error('The text of this PDF could not be read. Paste the text instead.')
  } finally {
    task.destroy()      // frees the worker; the loading task owns the document
  }
}

/**
 * Rebuild lines from positioned text pieces. A PDF stores words where they are
 * drawn, not as lines, so pieces at the same height form a line, left to right,
 * with a space where there is a visible gap.
 */
function linesOf(items) {
  const rows = new Map()
  for (const it of items) {
    if (!('str' in it) || !it.str) continue
    const y = Math.round(it.transform[5] / 2)       // within ~2 units is the same line
    if (!rows.has(y)) rows.set(y, [])
    rows.get(y).push({ x: it.transform[4], w: it.width ?? 0, s: it.str })
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])                     // top of the page first
    .map(([, row]) => {
      row.sort((a, b) => a.x - b.x)
      let line = ''
      let end = null
      for (const p of row) {
        if (end != null && p.x - end > 1 && !line.endsWith(' ') && !p.s.startsWith(' ')) line += ' '
        line += p.s
        end = p.x + p.w
      }
      return line
    })
    .join('\n')
}

// --- Word -----------------------------------------------------------------------

async function docxText(file) {
  const mod = await import('mammoth')
  const mammoth = mod.default ?? mod
  try {
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    return value
  } catch {
    throw new Error('This Word file could not be opened — it may be damaged or not really a .docx. Paste the text instead.')
  }
}

/**
 * Old Word (.doc, Word 97–2003) is a binary format with no browser reader. Its
 * text is stored as plain runs, either one byte or two bytes per character, so
 * this pulls out readable runs in both readings and keeps the better one. Good
 * enough for names, emails, phones and skills; formatting is lost.
 */
function oldWordText(buffer) {
  const bytes = new Uint8Array(buffer)
  // Latin (incl. accents), Devanagari, digits and common resume punctuation.
  const run = /[A-Za-z0-9À-ɏऀ-ॿ .,;:@()\-+/&'"’“”•|#%\r\t]{8,}/g
  const pick = (decoded) => (decoded.match(run) ?? []).filter((r) => letters(r) >= 4)
  const wide = pick(new TextDecoder('utf-16le').decode(bytes))
  const narrow = pick(new TextDecoder('windows-1252').decode(bytes))
  const best = letters(wide.join('')) >= letters(narrow.join('')) ? wide : narrow
  return best.map((r) => r.replace(/\r/g, '\n')).join('\n')
}
