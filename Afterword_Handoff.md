# Afterword — Handoff Document

**Last updated:** July 2026
**Status:** Live, working prototype deployed to production
**Owner:** Vesclard (solo developer)
**Note:** This app was previously named "MeetingMind" during development. It has been rebranded to **Afterword** — filename, in-app branding, `localStorage` key, export filename, and the GitHub repo name are all done. Only the Firebase project ID (`meetingmind-af171`) still references the old name, permanently, by design — see Section 10 for the current rebrand status.
**Firebase status:** Firebase/Firestore is **reconnected** as of this update, on a brand-new project (`afterword-53cd7`, not the old `meetingmind-af171`). Auth is Google Sign-In only; Firestore rules scope each user to their own `users/{uid}` document (`request.auth.uid == uid`) — not just "any authenticated user," which was a real bug in an earlier version of this setup (see Section 6). The app now requires sign-in and Firestore is the source of truth — `localStorage` is used only for small UI prefs (theme, sidebar collapsed state), not note data. See Section 6.

---

## 1. What This App Is

Afterword is a personal meeting notes app that solves a specific problem: notes taken during meetings tend to be unstructured, scattered across tools, and impossible to find or act on later. Afterword fixes this by enforcing a consistent note structure, organizing notes by project, and layering in search plus an AI assistant to make everything retrievable.

**Single user by design.** This is not a multi-tenant SaaS product — it's a personal tool for one person's own meeting notes.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Static HTML/CSS/JS (three files: `index.html`, `styles.css`, `app.js`) — vanilla JS, no frameworks, no build step |
| Styling | Custom CSS (no Tailwind/Bootstrap), Plus Jakarta Sans + JetBrains Mono fonts (Vesatile brand system, light + dark themes) |
| Database | Firebase Firestore, project `afterword-53cd7` — per-note model in code (`users/{uid}/meta/main` + `users/{uid}/notes/{noteId}`), deploy-gated on a rules update; legacy `users/{uid}` blob kept as backup (see Section 6) |
| Storage | Firestore is the source of truth for note data, gated behind Google Sign-In. `localStorage` is still used for small UI prefs only (`afterword_theme`, `afterword_sidebar_collapsed`) — no note data lives there anymore |
| AI | Anthropic Claude API, called directly from the browser with the **user's own API key** (BYOK, July 2026). Default model `claude-opus-4-8`, user-selectable (Sonnet 5 / Haiku 4.5). Key stored in `localStorage` only, cleared on sign-out. No server proxy. |
| Hosting | Vercel, deployed via a GitHub repository (`afterword`) |

**Why this stack:** No installs required on the user's constrained work PC. Everything ships as static files with no build tooling, deployed through web-only interfaces (GitHub web upload → Vercel import).

---

## 3. File Structure

No-build static structure:
- `index.html` — markup only: sidebar, note list, detail panel, AI panel, modals, mobile bottom nav. Links to the two files below via `<link rel="stylesheet" href="styles.css">` and `<script type="module" src="app.js">`. (Renamed from `afterword.html` to `index.html` for native Vercel and local browser hosting compatibility).
- `styles.css` — all CSS, including a `@media (max-width: 700px)` block for mobile.
- `app.js` — all app logic and state management. The AI assistant calls `api.anthropic.com` directly from the browser via the shared `callClaude()` helper (BYOK — user's own key).
- `vercel.json` — Vercel configuration: enables clean URLs.
- ~~`/api/ask.js`~~ — **deleted July 2026.** It was an unauthenticated open proxy on the developer's Anthropic key (see `AUDIT.md` S1) and was replaced by the BYOK model. Do not reintroduce a dev-key proxy.

**Important quirk:** Because `app.js` is loaded as `type="module"`, all functions called from inline `onclick="..."` HTML attributes in `index.html` must be explicitly exposed via `window.functionName = functionName` at the bottom of `app.js`. If a new function is added and referenced from HTML, it **must** be added to this list or clicks will silently fail.

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

Firebase/Firestore has been **reconnected**, on a fresh project set up from scratch — not a patch of the old `meetingmind-af171` project:

- **New project:** `afterword-53cd7` (Firebase Console → Project Settings for the full `firebaseConfig`, embedded directly in `app.js` — the web API key is not secret; it's not a credential, just a client identifier, and access is governed entirely by the Firestore rules and auth below).
- **Auth:** Firebase Authentication, Google Sign-In only. The app is gated behind sign-in — no anonymous/offline mode. `app.js` shows a full-screen sign-in overlay (`#signinScreen`) until `onAuthStateChanged` reports a signed-in user.
- **Sign-out forces a full page reload.** `signOutUser()` awaits any in-flight write (tracked via `pendingSave`/`trackSave`), calls `signOut(auth)`, then `location.reload()`. This was added after in-memory state (`state.notes`, `editActions`, populated detail-form fields) proved to leak a previous account's note content into the next signed-in account's session within the same page load, even after multiple attempts to manually reset every relevant variable on sign-out/sign-in. A hard reload closes this class of bug structurally — no JS state can survive a full navigation — rather than relying on remembering to reset every current and future piece of client-side state by hand. Don't remove this to make sign-out feel more "SPA-like" without addressing the underlying state-leak risk it guards against.
- **Security rules:** the canonical, version-controlled source is now **`firestore.rules`** in the repo root — **mode: production/BYOK** (open sign-in, per-uid isolation, no owner email pin), chosen 2026-07-10. It uses a recursive `match /users/{uid}/{document=**}` scoped to `request.auth.uid == uid`, which covers the legacy `users/{uid}` blob *and* the Phase 2.1 subcollections (`meta/main`, `notes/{noteId}`):
  ```
  rules_version = '2';
  service cloud.firestore {
    match /databases/{database}/documents {
      match /users/{uid}/{document=**} {
        allow read, write: if request.auth != null && request.auth.uid == uid;
      }
    }
  }
  ```
  **Published to the console 2026-07-10** (not auto-deployed — no Firebase CLI here; the repo file is the source of truth, publish by hand on change). Per-document scoping to `request.auth.uid == uid` is non-negotiable: an earlier version of this setup used an unscoped `match /{document=**} { allow ... if request.auth != null; }` rule that let *any* signed-in Google account read/write *every* user's document — caught and fixed before real use. Before a public announcement, add Firebase App Check + per-note field-size caps (see `firestore.rules` header, afterword-security §6).
- **Data shape (per-note model — live since 2026-07-10, Masterplan Phase 2.1):** folders in `users/{uid}/meta/main` (`{ folders }`), and one document per note at `users/{uid}/notes/{noteId}` (`{ ...note, updatedAt: serverTimestamp, schemaVersion: 2 }`). `loadUserData` reads the per-note store first; if it's empty it migrates the legacy blob into it (keeping the blob at `users/{uid}` as a one-release backup marked `migratedAt`) or seeds `DEFAULT_DATA`. `saveNote`/`deleteNote` are single-doc writes/deletes; `confirmAddFolder` writes `meta` only; `importData` batch-writes. The matching recursive Firestore rules are published (see the security-rules bullet above). The legacy blob is retained one release as a backup; a later cleanup can drop it once the migration has clearly settled.
  - *Legacy shape (pre-migration):* one document per user at `users/{uid}` holding `{ folders: [...], notes: [...] }`, written whole after every mutation by the old `saveData()`. Retained per-user as a backup after migration.
- **No migration from the old `localStorage` data.** This was a deliberate choice when Firebase was reconnected — Firestore started empty rather than uploading whatever was sitting in the browser's `afterword_v1` key. Any notes that were only ever in `localStorage` before this change are not automatically in Firestore; use Export (while on the old version) / Import (once signed in) if old local notes need to be recovered.
- **Error handling:** Firestore read/write failures don't throw silently — `loadUserData`/`saveData` catch errors and surface a toast (e.g. "⚠ Save failed — check your connection") rather than only `console.warn`. This addresses the old Priority 2 "add loading/error states" item for the parts of it that apply now that sync is back.
- **Conflict handling (Phase 2.2, live & verified 2026-07-10):** each note carries a server `updatedAt`; `saveNoteDoc` runs a transaction that compares the loaded `updatedAt` to the live one and, on mismatch, aborts and shows a sync-conflict modal (Keep-mine overwrites via `forceSaveNoteDoc`; Use-theirs reloads via `reloadConflictNote`). This is *detection*, not automatic merge — last-write-wins is no longer silent. `noteVersions` tracks the known timestamps; it's cleared on `resetLocalState`.
- **Autosave + dirty guard (Phase 2.3, live & verified 2026-07-10):** a shared `persistCurrentNote(manual)` backs both the Save button (validates, toasts) and a ~2s debounced autosave (quiet). `markDirty` (wired to every editor input) bumps `editSeq`; `savedSeq` tracks the last persisted value, so a slow save can't clear edits typed while it was in flight, and `beforeunload` warns whenever they differ. `commitPendingEdits` flushes a dirty note before switching notes/folders and before sign-out. The topbar `#syncStatus` shows Unsaved… / Saving… / Saved ✓ / ⚠ Offline (`setStatus(msg, type)`).
- **Still open:** a "Reset app" button and a post-sign-in loading skeleton (Masterplan Phase 2 items 4–5).

---

## 7. Deployment Setup

- **Firebase project:** `afterword-53cd7`, connected (Section 6). The old `meetingmind-af171` project remains permanently disconnected/unused.
- **Repo:** GitHub, repository name `afterword`, public visibility
- **Hosting:** Vercel, imported directly from the GitHub repo
- **Deploy flow:** Edit `index.html` / `styles.css` / `app.js` locally → commit to GitHub → Vercel auto-redeploys on push
- **No Firebase Hosting or Firebase CLI used** — user's work PC has historically not allowed local installs, so the workflow has been web-only (GitHub web upload + Vercel import), no `npm`, `node`, or `firebase-tools` involved. (Note: some recent iteration used the `git` CLI directly rather than the GitHub web UI — confirm with the user which workflow is current before assuming either.)

---

## 8. Known Constraints / Things a New Agent Should Know

1. **No local dev environment (historically).** The user's work PC has not allowed installing Node, the Firebase CLI, or other local tooling. Confirm this constraint still holds before suggesting CLI-based workflows or a build step.
2. **Cloud sync is back.** Firebase/Firestore is reconnected on the new `afterword-53cd7` project, gated behind Google Sign-In (Section 6). The app now requires sign-in — there's no offline/anonymous mode. `localStorage` is UI-prefs-only now, not a data store.
3. **The AI is BYOK (July 2026)** — each user (including the owner) supplies their own Anthropic API key via the AI-settings modal; it lives only in that device's `localStorage` and is cleared on sign-out. There is **no** `ANTHROPIC_API_KEY` in Vercel anymore — its presence would be a regression. The old key was rotated after the open-proxy finding (AUDIT S1).
4. **`type="module"` + inline `onclick`** requires the `window.fn = fn` exposure pattern described in Section 3. Easy to forget when adding features. Applies to `app.js` regardless of it being an external file rather than inline.
5. Categorization is **folders only** (by deliberate user choice) — do not reintroduce tags/auto-categorization without checking with the user first.

---

## 9. Suggested Next Steps for Improvement

### Priority 1 — Security & sync
- **Set up a new Firebase project from scratch and wire Firestore back into `app.js`.** ✅ Completed. New project `afterword-53cd7`, Google Sign-In auth, Firestore rules scoped per-user via `request.auth.uid == uid` — see Section 6.
- **Move the Claude API call server-side.** ✅ Completed 2025, then **superseded July 2026**: the proxy turned out to be an unauthenticated open endpoint on the dev's key (AUDIT S1), and the production billing decision changed to user-pays. The proxy was deleted and replaced with BYOK direct-browser calls (see Section 12).

### Priority 2 — Reliability
- **Add conflict handling for concurrent edits.** Now that cloud sync is back: if the same note is edited on two devices while offline, the last save still silently overwrites the other. Worth adding a simple `updatedAt` timestamp check with a warning if a conflict is detected. Still open.
- **Add loading/error states for remote calls.** ✅ Partially done — `loadUserData`/`saveData` in `app.js` catch Firestore errors and surface a toast instead of only `console.warn`. Still open: a dedicated loading spinner during the sign-in/data-fetch window (currently just the "Checking your session…" sign-in screen text).
- **Add a "Reset app" button** (mentioned but not yet built) to clear a user's Firestore document cleanly without needing the Firebase Console. Still open.

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
- **Filename** — ✅ Done. Renamed `meetingmind.html` → `index.html` (originally renamed to `afterword.html`, but later changed to `index.html` for clean Vercel hosting and native root path resolution).
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
2. Open `app.js` — this is the entire application logic. `index.html` is markup only; `styles.css` is all styling.
3. Note the app now has **Firebase/Firestore reconnected** on project `afterword-53cd7`, gated behind Google Sign-In, with real security rules from day one (Section 6) — it is no longer `localStorage`-only. Don't remove this integration to "simplify" without checking with the user first.
4. Confirm whether the user still lacks local dev tooling before suggesting any CLI-based approach.
5. Priority 1 (fresh Firebase setup + server-side Claude API call) is now done — see Section 9. Treat Priority 2 (reliability: conflict handling, reset button) as the current focus unless the user says otherwise.
6. Note the app is called **Afterword** now, not MeetingMind — see Section 10 before renaming any files or infrastructure.

---

## 12. Future Improvements

### Mobile App

- **Phase 1 — PWA**: Add `manifest.json` + a service worker to `afterword.vesatile.com`. Enables "Add to Home Screen" on iOS and Android, full-screen mode, and offline support. Minimal effort, no app store required. Good first step.
- **Phase 2 — Capacitor wrapper**: If App Store presence is wanted, use Capacitor (Ionic) to wrap the existing vanilla JS codebase into a native shell (`.ipa` / `.apk`). Code stays the same; native device APIs available via plugins. Requires Xcode (Mac) for iOS builds.

### Claude API — Distribution Problem

- ✅ **Resolved via BYOK (July 2026), superseding the proxy approach.** Every user brings their own Anthropic API key: entered in the AI-settings modal, validated with a free `count_tokens` call, stored only in that device's `localStorage` (`afterword_api_key_v1`), cleared on sign-out, and sent only to `api.anthropic.com` (direct browser calls with the `anthropic-dangerous-direct-browser-access: true` header — Anthropic's official BYOK opt-in). The developer holds no keys and carries no AI cost at any number of users.
- The old `/api/ask.js` proxy was deleted (it was an unauthenticated open endpoint on the dev's key — AUDIT S1) and the dev key rotated. Routing traffic against users' Claude Pro/Max *subscriptions* is prohibited by Anthropic's terms — BYOK Console keys are the compliant path.
- Remaining gate before public distribution: the XSS-hardening work (MASTERPLAN Phase 1.2–1.3) — with a key in `localStorage`, XSS = key theft.
