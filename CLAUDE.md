# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Afterword is a single-user personal meeting-notes app: structured notes organized by project folder, with search and an AI assistant over all notes. It is **not** a multi-tenant product — designed and built for one person's own use. The app was originally called "MeetingMind"; in-app branding, filename, `localStorage` key, export filename, and the GitHub repo name have all been rebranded to Afterword. Only the Firebase project ID (`meetingmind-af171`) still references the old name — it's permanent and stays as an internal-only identifier (see `Afterword_Handoff.md` §10).

Read `Afterword_Handoff.md` in full before making changes — it's the authoritative, up-to-date handoff doc (tech stack, data model, known issues, priorities). Don't duplicate its contents here; this file only covers what a coding agent needs to act inside the codebase.

## Repo structure

The entire app is one file: `afterword.html`.

- No build step, no package.json, no dependencies to install, no test suite.
- `<style>` block: all CSS, including the `@media (max-width: 700px)` mobile layout.
- HTML body: sidebar, note list, detail panel, AI panel, folder modal, mobile bottom nav.
- `<script type="module">`: entire app logic — Firebase SDK imported via `gstatic.com` CDN URLs, all state management, rendering is manual DOM/innerHTML (no framework).

## Development workflow

There is no local dev server, linter, bundler, or test command — none exist in this repo and none should be introduced casually. Iteration is: edit `afterword.html` directly, then open it in a browser to check behavior. Deployment is via GitHub → Vercel auto-deploy (static file, zero build config). The user's environment historically had no Node/npm/Firebase-CLI available, so avoid proposing CLI-based tooling or build steps unless you've confirmed that constraint no longer holds.

## Architecture

**State**: a single in-memory `state` object (`folders`, `notes`, `activeFolder`, `activeNote`, `isNew`, `searchQuery`, `aiOpen`) plus a parallel `editActions` array used while editing a note's action items. There's no framework-level reactivity — every mutation is followed by an explicit `render()` call that re-renders folders, note list, and topbar via `innerHTML`.

**Persistence has three layers, in this priority order on boot**:
1. `localStorage` (key `afterword_v1`; one-time migration reads and clears the old `meetingmind_v1` key if present) — read synchronously first for instant load.
2. Firestore (`folders` and `notes` collections, one doc per item, doc ID = item `id`) — fetched async on boot and used to overwrite local state/cache if present.
3. `DEFAULT_DATA` — hardcoded seed data used only if both of the above are empty (and in that case, immediately written to Firestore).

Every save/delete writes to `localStorage` synchronously, then to Firestore async (fire-and-forget, errors only `console.warn`, no user-facing failure state).

**Critical quirk — inline `onclick` + ES module**: because the script is `type="module"`, its functions are scoped to the module and invisible to inline `onclick="..."` HTML handlers. Every function referenced from an `onclick`/`oninput`/`onchange`/`onkeydown` attribute must be explicitly assigned to `window` at the bottom of the script (see the `window.fn = fn` block). **If you add a function and wire it to an inline handler, you must add it to that list or the click will silently do nothing** — there's no error, it just fails quietly.

**Data model**:
```js
folder = { id, name, color }
note = { id, folderId, title, date, attendees, body, actions: [{ id, text, assignee, done }] }
```
Every note belongs to exactly one folder; folders are the only categorization mechanism (no tags) — this is a deliberate product choice, not an oversight, so don't reintroduce tagging/auto-categorization without checking with the user.

**AI assistant** (`askAi`): serializes *all* notes into one context blob and sends it as the `system` prompt to `https://api.anthropic.com/v1/messages` directly from the browser, with no API key in the request. This currently only works in contexts (like Claude.ai artifacts) that inject the key for you — in a real deployed static site this call has no way to authenticate. Fixing this properly requires moving the call server-side (e.g. a Vercel serverless function) rather than adding a client-side key, since a hardcoded key would be exposed in page source.

**Security note**: Firestore rules are currently open to any client with a time-based cutoff (see handoff doc §6) and there is no authentication. Treat this as the top-priority known gap — don't assume the database is access-controlled.

**Mobile layout**: single-column, driven by a `mobile-nav` bottom bar and `.hidden` class toggles on `.note-list`/`.detail-panel`, distinct from the desktop two/three-pane layout — check `isMobile()` (viewport ≤700px) and the `mobile*` functions before changing responsive behavior.
