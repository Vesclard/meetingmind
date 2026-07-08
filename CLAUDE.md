# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Afterword is a single-user personal meeting-notes app: structured notes organized by project folder, with search and an AI assistant over all notes. It is **not** a multi-tenant product — designed and built for one person's own use. The app was originally called "MeetingMind"; in-app branding, filename, `localStorage` key, export filename, and the GitHub repo name have all been rebranded to Afterword.

The app syncs to Firebase Firestore, on a fresh project (`afterword-53cd7`) set up from scratch, gated behind Google Sign-In — not the old, insecure `meetingmind-af171` project. `localStorage` holds small UI prefs (theme, sidebar collapsed state) plus the user's own Anthropic API key for the BYOK AI assistant — never note data. See `Afterword_Handoff.md` Section 6 for full status.

Read `Afterword_Handoff.md` in full before making changes — it's the authoritative, up-to-date handoff doc (tech stack, data model, known issues, priorities). Don't duplicate its contents here; this file only covers what a coding agent needs to act inside the codebase.

## Repo structure

Three static files, plus serverless configuration:
- `index.html` — markup only: sidebar, note list, detail panel, AI panel, folder modal, AI-settings modal, mobile bottom nav, plus `<link>`/`<script src>` tags pulling in the other two files.
- `styles.css` — all CSS, including the `@media (max-width: 700px)` mobile layout.
- `app.js` — entire app logic, loaded as `<script type="module" src="app.js">`. The AI assistant calls `api.anthropic.com` directly from the browser using the user's own API key (BYOK — see below).
- `vercel.json` — Vercel configuration: enables clean URLs.

There is no serverless AI proxy anymore: `/api/ask.js` was deleted in July 2026 (it was an unauthenticated open proxy on the developer's key — see `AUDIT.md` S1). Do not reintroduce one; the `afterword-security` skill §2 has the invariants.

No package.json, no dependencies to install, no test suite.

## Development workflow

There is no local dev server, linter, bundler, or test command — none exist in this repo and none should be introduced casually. Iteration is: edit `index.html`/`styles.css`/`app.js` directly, then open `index.html` in a browser to check behavior. Deployment is via GitHub → Vercel auto-deploy (static files, zero build config). The user's environment historically had no Node/npm/Firebase-CLI available, so avoid proposing CLI-based tooling or build steps unless you've confirmed that constraint no longer holds.

## Architecture

**State**: a single in-memory `state` object (`folders`, `notes`, `activeFolder`, `activeNote`, `isNew`, `searchQuery`, `aiOpen`) plus a parallel `editActions` array used while editing a note's action items. There's no framework-level reactivity — every mutation is followed by an explicit `render()` call that re-renders folders, note list, and topbar via `innerHTML`.

**Persistence is Firestore-backed, gated behind Google Sign-In**: the app shows a full-screen sign-in overlay (`#signinScreen`) until `onAuthStateChanged` reports a signed-in user. Notes live in one Firestore document per user at `users/{uid}` (`{ folders, notes }`). `loadUserData(uid)` reads it on sign-in and seeds `DEFAULT_DATA` if the doc doesn't exist yet (first-ever login); `saveData()` writes the whole document after every mutation (called from `saveNote`/`deleteNote`/`confirmAddFolder`/`importData`), returning a boolean so callers can toast a "⚠ Save failed" message on failure instead of silently swallowing errors. `localStorage` holds UI prefs (`afterword_theme`, `afterword_sidebar_collapsed`) and the BYOK credentials (`afterword_api_key_v1`, `afterword_ai_model`, both cleared on sign-out) — no note data lives there.

**Critical quirk — inline `onclick` + ES module**: because the script is `type="module"`, its functions are scoped to the module and invisible to inline `onclick="..."` HTML handlers. Every function referenced from an `onclick`/`oninput`/`onchange`/`onkeydown` attribute must be explicitly assigned to `window` at the bottom of the script (see the `window.fn = fn` block). **If you add a function and wire it to an inline handler, you must add it to that list or the click will silently do nothing** — there's no error, it just fails quietly.

**Data model**:
```js
folder = { id, name, color }
note = { id, folderId, title, date, attendees, body, actions: [{ id, text, assignee, done }] }
```
Every note belongs to exactly one folder; folders are the only categorization mechanism (no tags) — this is a deliberate product choice, not an oversight, so don't reintroduce tagging/auto-categorization without checking with the user.

**AI assistant** (`askAi`): **BYOK — the user's own Anthropic key, not the developer's.** The key is entered in the AI-settings modal, validated via `count_tokens`, and stored only in this device's `localStorage` (`afterword_api_key_v1`); `signOutUser()` clears it. All Claude calls go through the shared `callClaude()` helper, which POSTs `https://api.anthropic.com/v1/messages` directly from the browser with the `anthropic-dangerous-direct-browser-access: true` header (Anthropic's official BYOK opt-in). Model defaults to `claude-opus-4-8` with a user-facing selector (`afterword_ai_model`). `askAi` serializes *all* notes into the system prompt. New AI features must reuse `callClaude()` — never fork the request builder, never send the key anywhere but `api.anthropic.com`.

**Security note**: Firestore rules scope each user to their own `users/{uid}` document via `request.auth.uid == uid` — not merely `request.auth != null`, which would let any signed-in Google account read/write every user's document (an earlier version of this setup had that bug; it's fixed in the deployed rules). There is no cross-device conflict resolution yet — if the same note is edited on two devices, the last write silently wins (tracked in `Afterword_Handoff.md` Priority 2).

**Mobile layout**: single-column, driven by a `mobile-nav` bottom bar and `.hidden` class toggles on `.note-list`/`.detail-panel`, distinct from the desktop two/three-pane layout — check `isMobile()` (viewport ≤700px) and the `mobile*` functions before changing responsive behavior.
