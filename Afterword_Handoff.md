# Afterword — Handoff Document

**Last updated:** July 2026
**Status:** Live, working prototype deployed to production
**Owner:** Vesclard (solo developer)
**Note:** This app was previously named "MeetingMind" during development. It has been rebranded to **Afterword** — filename, in-app branding, `localStorage` key, and export filename are done. The GitHub repo name still reads `meetingmind`, and the Firebase project ID (`meetingmind-af171`) permanently does, by design — see Section 10 for the current rebrand status.

---

## 1. What This App Is

Afterword is a personal meeting notes app that solves a specific problem: notes taken during meetings tend to be unstructured, scattered across tools, and impossible to find or act on later. Afterword fixes this by enforcing a consistent note structure, organizing notes by project, and layering in search plus an AI assistant to make everything retrievable.

**Single user by design.** This is not a multi-tenant SaaS product — it's a personal tool for one person's own meeting notes.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Single self-contained HTML file — vanilla JS, no frameworks, no build step |
| Styling | Custom CSS (no Tailwind/Bootstrap), DM Serif Display + DM Sans fonts |
| Database | Firebase Firestore (Standard edition, Spark/free plan) |
| Local cache | Browser `localStorage` (key: `afterword_v1`, migrated one-time from the old `meetingmind_v1` key) |
| AI | Anthropic Claude API, called directly from the browser (`claude-sonnet-4-20250514`) |
| Hosting | Vercel, deployed via a GitHub repository (still named `meetingmind` — not yet renamed, see Section 10) |
| Firebase region | `asia-southeast1` (Singapore — closest available to Jakarta) |

**Why this stack:** No installs required on the user's constrained work PC. Everything ships as one HTML file with no build tooling, deployed through web-only interfaces (GitHub web upload → Vercel import).

---

## 3. File Structure

There is currently **one file**: `afterword.html`

Everything lives inside it:
- `<style>` block — all CSS, including a `@media (max-width: 700px)` block for mobile
- HTML body — sidebar, note list, detail panel, AI panel, modals, mobile bottom nav
- `<script type="module">` — app logic, Firebase SDK imports (via CDN `gstatic.com` URLs), all state management

**Important quirk:** Because the script uses `type="module"`, all functions called from inline `onclick="..."` HTML attributes must be explicitly exposed via `window.functionName = functionName` at the bottom of the script. If a new function is added and referenced from HTML, it **must** be added to this list or clicks will silently fail.

---

## 4. Data Model

```js
folder = { id, name, color }

note = {
  id, folderId, title, date, attendees,
  body,        // freeform notes text
  actions: [
    { id, text, assignee, done }
  ]
}
```

- Every note belongs to exactly **one folder** (project). Folders are the only categorization method — no tags.
- If a note has no `folderId`, the UI shows an inline prompt forcing the user to assign one before saving.
- Firestore collections: `folders` and `notes`, one document per item, document ID = the item's `id`.

---

## 5. Core Features (all working)

- Create / edit / delete meeting notes with structured fields
- Project folders in the sidebar, notes filtered by folder
- Action items with owner + done checkbox
- Full-text search across titles, notes, attendees, and action items
- AI assistant panel — sends all notes as context to Claude, answers natural-language questions
- Export button — downloads all data as a timestamped JSON backup
- Import button — merges an imported JSON file with existing data (does not overwrite; matches by ID)
- Firestore cloud sync — read on load, write on every save/delete/folder-create
- `localStorage` as an instant-load cache, refreshed from Firestore in the background
- Sync status indicator in the top bar ("Syncing…" / "Saved ✓")
- Responsive mobile layout — bottom nav bar (Notes / New / Projects), slide-in sidebar, single-column note list ↔ detail view switching

---

## 6. Current Firestore Security Rules

Rules are currently **open with a time-based cutoff**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.time < timestamp.date(2026, 4, 30);
    }
  }
}
```

⚠️ **This is temporary and insecure.** Anyone with the Firebase project's public config (which is embedded in the client-side HTML — unavoidable for a browser app) can currently read/write the database until the cutoff date. This is flagged as priority #1 in the next steps below.

---

## 7. Deployment Setup

- **Firebase project:** `meetingmind-af171`
- **Repo:** GitHub, repository name `meetingmind`, public visibility
- **Hosting:** Vercel, imported directly from the GitHub repo
- **Deploy flow:** Edit `afterword.html` locally → upload/commit to GitHub (via web UI, no git CLI used) → Vercel auto-redeploys on push
- **No Firebase Hosting or Firebase CLI used** — user's work PC does not allow local installs, so the entire workflow is web-only (GitHub web upload + Vercel import), no `npm`, `node`, or `firebase-tools` involved anywhere in this project.

---

## 8. Known Constraints / Things a New Agent Should Know

1. **No local dev environment.** The user cannot install Node, the Firebase CLI, or any other local tooling. All iteration must happen via direct file edits + web-based redeploy (GitHub web editor/upload → Vercel auto-deploy). Do not suggest CLI-based workflows without checking this constraint still holds.
2. **No authentication yet.** There is no login system. The app currently trusts anyone with the URL and open Firestore rules. This is the most urgent gap.
3. **The Claude API key is not yet wired in properly** — the AI assistant fetch call in the code assumes a key is available via the Anthropic API endpoint but does **not** include an explicit key parameter, relying on it being handled by environment/proxy context assumptions. **This needs verification** — if the AI assistant stops working in a real deployed (non-Claude.ai-artifact) context, this is the first place to check, since a real Vercel-hosted static site has no mechanism to inject a server-side API key. This likely needs a small serverless function (Vercel Function) to proxy the Claude API call securely instead of calling it directly from the client.
4. **`type="module"` + inline `onclick`** requires the `window.fn = fn` exposure pattern described in Section 3. Easy to forget when adding features.
5. Categorization is **folders only** (by deliberate user choice) — do not reintroduce tags/auto-categorization without checking with the user first.

---

## 9. Suggested Next Steps for Improvement

### Priority 1 — Security
- **Add authentication.** Wire in Firebase Authentication (Google Sign-In is the fastest option, ~10 minutes of setup) and change Firestore rules to `allow read, write: if request.auth != null;`. This closes the open-database window before the current temporary rule cutoff (April 30, 2026) is reached.
- **Move the Claude API call server-side.** Calling the Anthropic API directly from client-side JS means the API key (if hardcoded) would be exposed to anyone who views the page source. Add a minimal Vercel Serverless Function (`/api/ask.js`) that holds the key server-side and proxies the request. This is a bigger architectural change but important before wider use.

### Priority 2 — Reliability
- **Add conflict handling for concurrent edits.** If the same note is edited on two devices while offline, the last save silently overwrites the other. Worth adding a simple `updatedAt` timestamp check with a warning if a conflict is detected.
- **Add loading/error states for Firestore calls.** Currently failures are caught silently (`console.warn`) with no user-facing feedback beyond the sync status label. A failed save should surface clearly, not just log to console.
- **Add a "Reset app" button** (mentioned but not yet built) to clear local + remote data cleanly without needing DevTools.

### Priority 3 — UX polish
- **Autosave.** Currently requires an explicit "Save" click; a debounced autosave would remove friction and reduce the risk of losing edits.
- **Keyboard shortcuts** for power use — e.g. `Cmd/Ctrl+N` for new note, `Cmd/Ctrl+F` to focus search.
- **Richer text formatting** in the notes body (currently a plain textarea) — even basic markdown rendering would help long-term as note volume grows.
- **Folder management** — currently folders can be created but not renamed, recolored, or deleted from the UI.

### Priority 4 — Possible feature expansion (only if the user wants it)
- **AI-assisted action item extraction** — auto-suggest action items from the freeform notes text using Claude, rather than only manual entry.
- **Calendar integration** — pre-fill meeting title/date/attendees from a connected calendar.
- **Cross-linking notes** — referencing a previous meeting from within a new one, since projects can span many related meetings over time.

---

## 10. Rebrand Checklist — MeetingMind → Afterword

The product is now called **Afterword**. Status as of this update:

- **In-app branding** — ✅ Done. Sidebar logo now renders "After**word**" and the `<title>` tag is "Afterword".
- **Filename** — ✅ Done. Renamed `meetingmind.html` → `afterword.html` (via `git mv`, history preserved).
- **`localStorage` key** — ✅ Done. Now `afterword_v1`. `loadFromLocalStorage()` does a one-time migration: if the new key is empty, it reads the old `meetingmind_v1` key, copies it forward, and deletes the old key. No user data is lost.
- **Export backup filename** — ✅ Done. Downloads are now named `afterword-backup-<date>.json` instead of `meetingmind-backup-<date>.json`.
- **Firebase project ID** — ⏸️ Left as `meetingmind-af171`, per the recommended option below. Cannot be renamed (Firebase project IDs are permanent once created). Code now has a comment explaining this. Only worth migrating to a new `afterword`-named project if the old name bothers the user for more than internal plumbing — that would mean provisioning a new project and migrating all Firestore data.
- **GitHub repo name** — ⏸️ Not yet done. Still `meetingmind` (remote: `git@github.com:Vesclard/meetingmind.git`). This is an external/shared-infrastructure change (affects the GitHub URL and the Vercel deployment link), so it wasn't done automatically — do it via GitHub repo Settings → rename, then verify Vercel's connection still triggers deploys afterward (GitHub repo renames typically keep redirects, and Vercel tracks by repo ID, but confirm after renaming).
- **Handoff doc, devlogs, and any external touchpoints** (portfolio site project card, GitHub description, etc.) — should reference **Afterword** going forward; not tracked as part of this repo.

**Remaining order of operations:** rename the GitHub repo when convenient (low urgency, cosmetic), and leave the Firebase project ID alone unless the user explicitly wants to migrate.

---

## 11. Quick Orientation for a New Agent

If picking this project up cold:
1. Read this document fully before touching code.
2. Open `afterword.html` and locate the `<script type="module">` block — this is the entire application logic.
3. Check the current Firestore rules cutoff date (Section 6) — if it has passed, the app is currently broken for the user and this is the first fix needed.
4. Confirm whether the user still lacks local dev tooling before suggesting any CLI-based approach.
5. Treat Priority 1 (security) items as the most urgent unless the user explicitly says otherwise.
6. Note the app is called **Afterword** now, not MeetingMind — see Section 10 before renaming any files or infrastructure.
