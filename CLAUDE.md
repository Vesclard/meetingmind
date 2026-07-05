# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Afterword is a single-user personal meeting-notes app: structured notes organized by project folder, with search and an AI assistant over all notes. It is **not** a multi-tenant product — designed and built for one person's own use. The app was originally called "MeetingMind"; in-app branding, filename, `localStorage` key, export filename, and the GitHub repo name have all been rebranded to Afterword.

The app previously synced to Firebase Firestore; that integration has been removed and the app is now **`localStorage`-only** (Firebase is planned to come back later as a from-scratch setup — see `Afterword_Handoff.md` for status). Don't reintroduce a Firestore/`firebaseConfig` dependency unless asked.

Read `Afterword_Handoff.md` in full before making changes — it's the authoritative, up-to-date handoff doc (tech stack, data model, known issues, priorities). Don't duplicate its contents here; this file only covers what a coding agent needs to act inside the codebase.

## Repo structure

Three static files, no build step:
- `afterword.html` — markup only: sidebar, note list, detail panel, AI panel, folder modal, mobile bottom nav, plus `<link>`/`<script src>` tags pulling in the other two files.
- `styles.css` — all CSS, including the `@media (max-width: 700px)` mobile layout.
- `app.js` — entire app logic, loaded as `<script type="module" src="app.js">`. State management, rendering (manual DOM/innerHTML, no framework).
- `index.html` — redirect stub to `afterword.html` (meta refresh + JS `location.replace`), since there's no build step to make `afterword.html` the served root.

No package.json, no dependencies to install, no test suite.

## Development workflow

There is no local dev server, linter, bundler, or test command — none exist in this repo and none should be introduced casually. Iteration is: edit `afterword.html`/`styles.css`/`app.js` directly, then open `afterword.html` in a browser to check behavior. Deployment is via GitHub → Vercel auto-deploy (static files, zero build config). The user's environment historically had no Node/npm/Firebase-CLI available, so avoid proposing CLI-based tooling or build steps unless you've confirmed that constraint no longer holds.

## Architecture

**State**: a single in-memory `state` object (`folders`, `notes`, `activeFolder`, `activeNote`, `isNew`, `searchQuery`, `aiOpen`) plus a parallel `editActions` array used while editing a note's action items. There's no framework-level reactivity — every mutation is followed by an explicit `render()` call that re-renders folders, note list, and topbar via `innerHTML`.

**Persistence is `localStorage`-only**: key `afterword_v1`, with a one-time migration that reads and clears the old `meetingmind_v1` key if present. If `localStorage` is empty, `DEFAULT_DATA` (hardcoded seed notes/folders) is used instead. Every save/delete/import writes to `localStorage` synchronously via `saveToLocalStorage()` — there is no remote sync of any kind right now. (Firebase Firestore sync used to exist here; it was intentionally removed and a fresh Firebase setup is planned later — see `Afterword_Handoff.md`.)

**Critical quirk — inline `onclick` + ES module**: because the script is `type="module"`, its functions are scoped to the module and invisible to inline `onclick="..."` HTML handlers. Every function referenced from an `onclick`/`oninput`/`onchange`/`onkeydown` attribute must be explicitly assigned to `window` at the bottom of the script (see the `window.fn = fn` block). **If you add a function and wire it to an inline handler, you must add it to that list or the click will silently do nothing** — there's no error, it just fails quietly.

**Data model**:
```js
folder = { id, name, color }
note = { id, folderId, title, date, attendees, body, actions: [{ id, text, assignee, done }] }
```
Every note belongs to exactly one folder; folders are the only categorization mechanism (no tags) — this is a deliberate product choice, not an oversight, so don't reintroduce tagging/auto-categorization without checking with the user.

**AI assistant** (`askAi`): serializes *all* notes into one context blob and sends it as the `system` prompt to `https://api.anthropic.com/v1/messages` directly from the browser, with no API key in the request. This currently only works in contexts (like Claude.ai artifacts) that inject the key for you — in a real deployed static site this call has no way to authenticate. Fixing this properly requires moving the call server-side (e.g. a Vercel serverless function) rather than adding a client-side key, since a hardcoded key would be exposed in page source.

**Security note**: with no Firestore, all data lives only in the browser's `localStorage` on whatever device the user is on — there's currently no cross-device sync at all. This is the tradeoff for pulling Firebase out; expect it to come back once Firebase is set up fresh (see `Afterword_Handoff.md`).

**Mobile layout**: single-column, driven by a `mobile-nav` bottom bar and `.hidden` class toggles on `.note-list`/`.detail-panel`, distinct from the desktop two/three-pane layout — check `isMobile()` (viewport ≤700px) and the `mobile*` functions before changing responsive behavior.
