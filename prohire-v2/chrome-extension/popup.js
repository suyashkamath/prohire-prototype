// ProHire — Save candidate.
//
// Reads the profile on the current LinkedIn or Naukri tab and opens ProHire's
// /import page with it. Nothing is sent anywhere else: the data travels in the
// URL fragment (#…), which the browser never sends to any server — it goes
// straight from this tab into the ProHire page on your machine.
//
// What it reads:
//   • If you have SELECTED text on the page, exactly that. On a Naukri Resdex
//     search page, select one candidate's card and click the extension.
//   • Otherwise the profile itself: name, headline and location where the page
//     marks them, plus the visible page text for the importer to parse.

const DEFAULT_BASE = 'http://localhost:5173'
const $ = (id) => document.getElementById(id)

function portalOf(url) {
  if (/linkedin\.com/.test(url)) return 'linkedin'
  if (/naukri\.com/.test(url)) return 'naukri'
  return null
}

// Runs inside the page. Must be self-contained.
function scrape() {
  const pick = (...sels) => {
    for (const s of sels) {
      const el = document.querySelector(s)
      const t = el?.innerText?.trim()
      if (t) return t
    }
    return null
  }
  const selection = String(window.getSelection?.() ?? '').trim()
  const main = document.querySelector('main') ?? document.body
  return {
    url: location.href,
    selection: selection.length > 40 ? selection : null,
    name: pick('h1', '.name', '[class*="candidateName"]', '[class*="name"] a'),
    headline: pick('.text-body-medium', '[class*="headline"]', '[class*="designation"]'),
    location: pick('.text-body-small.inline', '[class*="location"]'),
    text: main.innerText,
  }
}

function encode(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj))
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function main() {
  const { base = DEFAULT_BASE } = await chrome.storage.sync.get('base')
  $('base').value = base
  $('base').addEventListener('change', () => chrome.storage.sync.set({ base: $('base').value.replace(/\/+$/, '') || DEFAULT_BASE }))

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const source = portalOf(tab?.url ?? '')
  if (!source) {
    $('where').textContent = 'Open a candidate on LinkedIn or Naukri, then click this again.'
    $('where').className = 'muted warn'
    return
  }
  $('where').textContent = source === 'linkedin' ? 'LinkedIn profile' : 'Naukri'

  let data
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scrape })
    data = result
  } catch (err) {
    $('where').textContent = `Could not read this page: ${err.message}`
    return
  }

  // A selection wins: it is the recruiter saying "this one".
  const payload = data.selection
    ? { source, url: data.url, name: null, headline: null, location: null, text: data.selection }
    : { source, url: data.url, name: data.name, headline: data.headline, location: data.location, text: data.text }

  const shownName = payload.name ?? payload.text.split('\n').map((l) => l.trim()).find(Boolean) ?? 'Candidate'
  $('name').textContent = shownName
  $('headline').textContent = payload.headline ?? (data.selection ? 'Selected text' : '')
  $('preview').hidden = false
  $('tip').textContent = data.selection
    ? 'Sending only the text you selected.'
    : source === 'naukri' ? 'Tip: on a search page, select one candidate’s card first.' : ''
  $('send').disabled = false

  $('send').addEventListener('click', async () => {
    const baseUrl = ($('base').value || DEFAULT_BASE).replace(/\/+$/, '')
    await chrome.tabs.create({ url: `${baseUrl}/import#${encode({ ...payload, text: payload.text.slice(0, 60000) })}` })
    window.close()
  })
}

main()
