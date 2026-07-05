# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Afterword is a single-user personal meeting-notes app: structured notes organized by project folder, with search and an AI assistant over all notes. It is **not** a multi-tenant product — designed and built for one person's own use. The app was originally called "MeetingMind"; in-app branding, filename, `localStorage` key, export filename, and the GitHub repo name have all been rebranded to Afterword.

The app syncs to Firebase Firestore, on a fresh project (`afterword-53cd7`) set up from scratch, gated behind Google Sign-In — not the old, insecure `meetingmind-af171` project. `localStorage` is now used only for small UI prefs (theme, sidebar collapsed state), not note data. See `Afterword_Handoff.md` Section 6 for full status.

Read `Afterword_Handoff.md` in full before making changes — it's the authoritative, up-to-date handoff doc (tech stack, data model, known issues, priorities). Don't duplicate its contents here; this file only covers what a coding agent needs to act inside the codebase.

## Repo structure

Three static files, plus serverless configuration:
- `index.html` — markup only: sidebar, note list, detail panel, AI panel, folder modal, mobile bottom nav, plus `<link>`/`<script src>` tags pulling in the other two files.
- `styles.css` — all CSS, including the `@media (max-width: 700px)` mobile layout.
- `app.js` — entire app logic, loaded as `<script type="module" src="app.js">`. Calls server-side `/api/ask` for the AI assistant.
- `vercel.json` — Vercel configuration: enables clean URLs.
- `/api/ask.js` — Vercel Node.js Serverless Function proxying Anthropic API calls.

No package.json, no dependencies to install, no test suite.

## Development workflow

There is no local dev server, linter, bundler, or test command — none exist in this repo and none should be introduced casually. Iteration is: edit `index.html`/`styles.css`/`app.js` directly, then open `index.html` in a browser to check behavior. Deployment is via GitHub → Vercel auto-deploy (static files, zero build config). The user's environment historically had no Node/npm/Firebase-CLI available, so avoid proposing CLI-based tooling or build steps unless you've confirmed that constraint no longer holds.

## Architecture

**State**: a single in-memory `state` object (`folders`, `notes`, `activeFolder`, `activeNote`, `isNew`, `searchQuery`, `aiOpen`) plus a parallel `editActions` array used while editing a note's action items. There's no framework-level reactivity — every mutation is followed by an explicit `render()` call that re-renders folders, note list, and topbar via `innerHTML`.

**Persistence is Firestore-backed, gated behind Google Sign-In**: the app shows a full-screen sign-in overlay (`#signinScreen`) until `onAuthStateChanged` reports a signed-in user. Notes live in one Firestore document per user at `users/{uid}` (`{ folders, notes }`). `loadUserData(uid)` reads it on sign-in and seeds `DEFAULT_DATA` if the doc doesn't exist yet (first-ever login); `saveData()` writes the whole document after every mutation (called from `saveNote`/`deleteNote`/`confirmAddFolder`/`importData`), returning a boolean so callers can toast a "⚠ Save failed" message on failure instead of silently swallowing errors. `localStorage` is only used for UI prefs now (`afterword_theme`, `afterword_sidebar_collapsed`) — no note data lives there.

**Critical quirk — inline `onclick` + ES module**: because the script is `type="module"`, its functions are scoped to the module and invisible to inline `onclick="..."` HTML handlers. Every function referenced from an `onclick`/`oninput`/`onchange`/`onkeydown` attribute must be explicitly assigned to `window` at the bottom of the script (see the `window.fn = fn` block). **If you add a function and wire it to an inline handler, you must add it to that list or the click will silently do nothing** — there's no error, it just fails quietly.

**Data model**:
```js
folder = { id, name, color }
note = { id, folderId, title, date, attendees, body, actions: [{ id, text, assignee, done }] }
```
Every note belongs to exactly one folder; folders are the only categorization mechanism (no tags) — this is a deliberate product choice, not an oversight, so don't reintroduce tagging/auto-categorization without checking with the user.

**AI assistant** (`askAi`): serializes *all* notes into one context blob and sends them to the local `/api/ask` proxy, which injects the `ANTHROPIC_API_KEY` environment variable and calls the Anthropic API.

**Security note**: Firestore rules require `request.auth != null`, and the only sign-in method is Google, so access is tied to the signed-in Google account rather than an open/public database. There is no cross-device conflict resolution yet — if the same note is edited on two devices, the last write silently wins (tracked in `Afterword_Handoff.md` Priority 2).

**Mobile layout**: single-column, driven by a `mobile-nav` bottom bar and `.hidden` class toggles on `.note-list`/`.detail-panel`, distinct from the desktop two/three-pane layout — check `isMobile()` (viewport ≤700px) and the `mobile*` functions before changing responsive behavior.
