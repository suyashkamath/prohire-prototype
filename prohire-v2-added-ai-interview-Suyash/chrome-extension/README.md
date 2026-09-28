# ProHire — Chrome extension

Saves a candidate from **LinkedIn** or **Naukri** into ProHire in one click.

## Install (developer mode, 1 minute)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this `chrome-extension` folder.
4. Pin "ProHire — Save candidate" to the toolbar.

## Use

- **LinkedIn:** open someone's profile → click the extension → **Send profile**.
- **Naukri (Resdex search results):** select one candidate's card with the mouse
  (from the name down to the key skills) → click the extension → **Send profile**.
- **Naukri profile page:** just click the extension.

ProHire opens on the **Import** page and shows what it found: name, experience,
CTC, location, current and previous role, education, preferred locations and key
skills. Pick a job (or leave it as "Database only") and click **Save candidate**.
If the person is already in ProHire (same email or phone), their record is
updated instead of duplicated.

The first time, set **ProHire address** in the popup if ProHire is not running at
`http://localhost:5173`.

## Privacy

The extension reads the page only when you click it. The profile travels to
ProHire inside the URL fragment (`#…`), which browsers never send to a server,
so it goes only from your tab to your ProHire page.

## Limits

- LinkedIn and Naukri usually hide phone and email until you click "View phone
  number". Add them on the candidate's profile after saving, or reveal them
  first and then send.
- Job *posting* to Naukri is not possible (Naukri's API is paid). LinkedIn
  posting needs the backend integration.
