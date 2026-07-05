# Afterword — Handoff Document

**Last updated:** July 2026
**Status:** Live, working prototype deployed to production
**Owner:** Vesclard (solo developer)
**Note:** This app was previously named "MeetingMind" during development. It has been rebranded to **Afterword** — filename, in-app branding, `localStorage` key, export filename, and the GitHub repo name are all done. Only the Firebase project ID (`meetingmind-af171`) still references the old name, permanently, by design — see Section 10 for the current rebrand status.
**Firebase status:** Firebase/Firestore has been **intentionally removed** from the app — the plan is to set up a fresh Firebase project and deployment from scratch (rather than keep the old `meetingmind-af171` project) at a later date. Until that happens, the app is **`localStorage`-only**: single-device, no cloud sync, no cross-device access. See Section 6.

---

## 1. What This App Is

Afterword is a personal meeting notes app that solves a specific problem: notes taken during meetings tend to be unstructured, scattered across tools, and impossible to find or act on later. Afterword fixes this by enforcing a consistent note structure, organizing notes by project, and layering in search plus an AI assistant to make everything retrievable.

**Single user by design.** This is not a multi-tenant SaaS product — it's a personal tool for one person's own meeting notes.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Static HTML/CSS/JS (three files: `afterword.html`, `styles.css`, `app.js`) — vanilla JS, no frameworks, no build step |
| Styling | Custom CSS (no Tailwind/Bootstrap), Plus Jakarta Sans + JetBrains Mono fonts (Vesatile brand system, light + dark themes) |
| Database | None currently. Previously Firebase Firestore — removed; a fresh Firebase project will be set up later (see Firebase status note above and Section 6) |
| Storage | Browser `localStorage` only (key: `afterword_v1`, migrated one-time from the old `meetingmind_v1` key) — this is the sole data store right now |
| AI | Anthropic Claude API, called directly from the browser (`claude-sonnet-4-20250514`) |
| Hosting | Vercel, deployed via a GitHub repository (`afterword`) |

**Why this stack:** No installs required on the user's constrained work PC. Everything ships as static files with no build tooling, deployed through web-only interfaces (GitHub web upload → Vercel import).

---

## 3. File Structure

No-build static structure:
- `afterword.html` — markup only: sidebar, note list, detail panel, AI panel, modals, mobile bottom nav. Links to the two files below via `<link rel="stylesheet" href="styles.css">` and `<script type="module" src="app.js">`.
- `styles.css` — all CSS, including a `@media (max-width: 700px)` block for mobile.
- `app.js` — all app logic and state management. Calls `/api/ask` for the AI assistant.
- `vercel.json` — Vercel routing configuration: rewrites `/` to `/afterword.html` (avoiding index.html redirect stubs).
- `/api/ask.js` — Node.js Serverless Function that proxies Claude API requests and injects the `ANTHROPIC_API_KEY` securely.

**Important quirk:** Because `app.js` is loaded as `type="module"`, all functions called from inline `onclick="..."` HTML attributes in `afterword.html` must be explicitly exposed via `window.functionName = functionName` at the bottom of `app.js`. If a new function is added and referenced from HTML, it **must** be added to this list or clicks will silently fail.

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
- Stored as a single JSON blob in `localStorage` (key `afterword_v1`): `{ folders: [...], notes: [...] }`.

---

## 5. Core Features (all working)

- Create / edit / delete meeting notes with structured fields
- Project folders in the sidebar, notes filtered by folder
- Action items with owner + done checkbox
- Full-text search across titles, notes, attendees, and action items
- AI assistant panel — sends all notes as context to Claude, answers natural-language questions
- Export button — downloads all data as a timestamped JSON backup
- Import button — merges an imported JSON file with existing data (does not overwrite; matches by ID)
- `localStorage` as the sole data store — instant load, no network round-trip, but single-device only (no cloud sync currently — see Firebase status note at the top)
- Save status indicator in the top bar ("Saved ✓")
- Responsive mobile layout — bottom nav bar (Notes / New / Projects), slide-in sidebar, single-column note list ↔ detail view switching

---

## 6. Firebase Status

Firebase/Firestore integration has been **removed from the app entirely** — no `firebaseConfig`, no Firestore reads/writes, `app.js` has zero Firebase dependencies. This was a deliberate interim step, not an accident:

- The old Firestore setup (project `meetingmind-af171`) shipped with open, time-cutoff-gated security rules (`allow read, write: if request.time < timestamp.date(2026, 4, 30)`) — anyone with the project's public config could read/write the database. This was flagged as the top security gap in earlier versions of this doc.
- Rather than patch that project, the plan is to **set up Firebase from scratch** later — a new project, proper security rules from day one (likely Firebase Authentication + `allow read, write: if request.auth != null;`), and reconnect the app to it.
- Until that happens, the app runs on **`localStorage` only** (see Sections 2 and 5). This means: single-device, no backup beyond manual Export, and no login/auth surface at all currently — there's nothing to secure because there's no server-side data store.
- When Firebase setup resumes: get the new project's `firebaseConfig` from the Firebase Console (Project Settings → your web app), decide on the security rules approach, then wire both back into `app.js`. The old Firestore read/write functions are still visible in git history (`git log -p -- afterword.html app.js`) as a reference for the previous implementation shape, though the new version should ship with real auth from the start rather than reproducing the old open-rules approach.

---

## 7. Deployment Setup

- **Firebase project:** none currently connected — old project `meetingmind-af171` is disconnected from the app pending a fresh Firebase setup (Section 6)
- **Repo:** GitHub, repository name `afterword`, public visibility
- **Hosting:** Vercel, imported directly from the GitHub repo
- **Deploy flow:** Edit `afterword.html` / `styles.css` / `app.js` locally → commit to GitHub → Vercel auto-redeploys on push
- **No Firebase Hosting or Firebase CLI used** — user's work PC has historically not allowed local installs, so the workflow has been web-only (GitHub web upload + Vercel import), no `npm`, `node`, or `firebase-tools` involved. (Note: some recent iteration used the `git` CLI directly rather than the GitHub web UI — confirm with the user which workflow is current before assuming either.)

---

## 8. Known Constraints / Things a New Agent Should Know

1. **No local dev environment (historically).** The user's work PC has not allowed installing Node, the Firebase CLI, or other local tooling. Confirm this constraint still holds before suggesting CLI-based workflows or a build step.
2. **No cloud sync currently.** Firebase/Firestore was removed (Section 6); the app is `localStorage`-only, single-device, no login system. This is intentional and temporary, not a regression to silently "fix" — wait for the user's go-ahead on the fresh Firebase setup rather than reintroducing the old integration.
3. **The Claude API key is secure** — the AI assistant calls the server-side `/api/ask.js` proxy. The `ANTHROPIC_API_KEY` must be configured as an environment variable in Vercel, keeping it secret.
4. **`type="module"` + inline `onclick`** requires the `window.fn = fn` exposure pattern described in Section 3. Easy to forget when adding features. Applies to `app.js` regardless of it being an external file rather than inline.
5. Categorization is **folders only** (by deliberate user choice) — do not reintroduce tags/auto-categorization without checking with the user first.

---

## 9. Suggested Next Steps for Improvement

### Priority 1 — Security & sync (blocked on fresh Firebase setup)
- **Set up a new Firebase project from scratch** (not the old `meetingmind-af171`) and wire Firestore back into `app.js`. Do this with real security from day one — e.g. Firebase Authentication (Google Sign-In) plus `allow read, write: if request.auth != null;` — rather than reintroducing the old open/time-cutoff rules.
- **Move the Claude API call server-side.** ✅ Completed. Implemented via the Vercel serverless function `/api/ask.js` and local endpoint mapping in `app.js`.

### Priority 2 — Reliability
- **Add conflict handling for concurrent edits.** Once cloud sync is back: if the same note is edited on two devices while offline, the last save would silently overwrite the other. Worth adding a simple `updatedAt` timestamp check with a warning if a conflict is detected.
- **Add loading/error states for remote calls**, once Firestore is reconnected — don't just `console.warn` on failure; surface it to the user.
- **Add a "Reset app" button** (mentioned but not yet built) to clear local (and, later, remote) data cleanly without needing DevTools.

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
- **Firebase project ID** — superseded. The app no longer connects to Firebase at all (Section 6); the old `meetingmind-af171` project is disconnected pending a brand-new Firebase project being set up from scratch, so its name is now moot rather than something to migrate.
- **GitHub repo name** — ✅ Done. Renamed to `afterword` (remote: `git@github.com:Vesclard/afterword.git`). Verify Vercel's deployment connection still triggers on push, since Vercel typically tracks by repo ID and should have followed automatically, but this hasn't been independently confirmed.
- **Handoff doc, devlogs, and any external touchpoints** (portfolio site project card, GitHub description, etc.) — should reference **Afterword** going forward; not tracked as part of this repo.

**Remaining:** nothing left except the Firebase project ID, which stays as-is unless the user explicitly wants to migrate.

---

## 11. Quick Orientation for a New Agent

If picking this project up cold:
1. Read this document fully before touching code.
2. Open `app.js` — this is the entire application logic. `afterword.html` is markup only; `styles.css` is all styling.
3. Note the app currently has **no Firebase/Firestore** — it's `localStorage`-only, single-device, by deliberate interim choice (Section 6). Don't "fix" this by re-adding the old Firestore integration; a fresh Firebase setup is planned and should ship with real auth from the start.
4. Confirm whether the user still lacks local dev tooling before suggesting any CLI-based approach.
5. Treat Priority 1 items (fresh Firebase setup + server-side Claude API call) as the most urgent unless the user explicitly says otherwise.
6. Note the app is called **Afterword** now, not MeetingMind — see Section 10 before renaming any files or infrastructure.
