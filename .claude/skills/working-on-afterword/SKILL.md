---
name: working-on-afterword
description: Conventions, pitfalls, and verification steps for making any code change in the Afterword repo (index.html / styles.css / app.js / api/*). Load before editing code here.
---

# Working on Afterword

Afterword is three static files + one Vercel serverless function. No build step, no framework, no linter, no test suite, no frontend npm — and none should be introduced. Read `Afterword_Handoff.md` before structural changes; `AUDIT.md`/`MASTERPLAN.md` define current priorities.

## The five rules that prevent silent breakage

1. **`window.fn = fn` or the click does nothing.** `app.js` is a `type="module"` script, so functions referenced from inline `onclick`/`oninput`/`onchange`/`onkeydown` attributes in `index.html` (or in `innerHTML` templates) are invisible unless assigned to `window` in the block at the bottom of `app.js`. There is no error — the handler just silently no-ops. Every new inline-handler function goes in that list.

2. **`esc()` everything interpolated into `innerHTML`.** All rendering is template literals assigned to `innerHTML`. Any user- or data-derived value must pass through `esc()` — including values that "look safe" like ids and colors (imported JSON can contain anything; see AUDIT S4). Attribute values must be double-quoted in templates.

3. **Mutate state → `saveData()` → `render()`.** There is no reactivity. The pattern everywhere: change `state`, `await saveData()` (returns boolean — toast "⚠ ... failed" on false, never swallow), then `render()`. While a note is being edited, action items live in the parallel `editActions` array, not in `state`, until Save.

4. **Never remove the sign-out hard reload.** `signOutUser()` awaits `pendingSave`, signs out, then `location.reload()`. This structurally prevents cross-account state leaks that manual resets repeatedly failed to fix (handoff §6). Similarly keep `resetLocalState()` on auth changes.

5. **The repo is public.** Never commit emails, UIDs, tokens, or keys. After the BYOK migration (Masterplan Phase 0) there are no server-side AI secrets at all — users' Anthropic keys live only in their own browser's `localStorage`, and the owner's email pin lives only in the Firebase rules console. The Firebase web config in `app.js` is a client identifier, not a secret — it's fine.

## Architecture map

- `index.html` — markup only. Sidebar, note list, detail panel (form inside a "sheet"), AI panel, folder modal, mobile bottom nav.
- `styles.css` — everything, including brand tokens at the top (see the `afterword-brand` skill) and the `@media (max-width: 700px)` mobile layout.
- `app.js` — all logic: Firebase init/auth, `state` object (`folders, notes, activeFolder, activeNote, isNew, searchQuery, aiOpen`), render functions (`render` → `renderFolders`/`renderNoteList`/`renderTopbar`), CRUD, import/export, AI panel, mobile helpers, theme.
- `api/ask.js` — legacy Anthropic proxy, **being deleted in Masterplan Phase 0** (it was an unauthenticated open proxy on the dev's key — AUDIT S1). Production AI is BYOK: the browser calls `api.anthropic.com` directly with the user's own key via the shared `callClaude()` helper (`anthropic-dangerous-direct-browser-access: true` header). Never reintroduce a dev-key proxy; see the `afterword-security` skill §2.
- Data model: `folder = {id, name, color}`; `note = {id, folderId, title, date, attendees, body, actions:[{id,text,assignee,done}]}`. Every note has exactly one folder; folders are the only categorization (deliberate — no tags).
- Persistence: Firestore, project `afterword-53cd7`, gated behind Google Sign-In. `localStorage` holds UI prefs only (`afterword_theme`, `afterword_sidebar_collapsed`).
- Mobile: single-column via `.hidden` toggles + `mobile-nav`; check `isMobile()` (≤700px) and the `mobile*` functions before touching responsive behavior.

## How to verify a change (there is no test suite)

1. **Serve locally — `file://` will NOT work** (module scripts are blocked by CORS): `python3 -m http.server 8000` in the repo root, open `http://localhost:8000`. `localhost` is an authorized domain in Firebase by default, so Google sign-in works locally.
2. Exercise the actual flow you changed in the browser (create/edit/save/delete/search/import/export as relevant), in **both themes** and at **mobile width** (≤700px) if the UI changed.
3. Check the console for errors — silent inline-handler failures show up as *nothing happening*, so click every new control.
4. `/api/ask` changes can't run locally without `vercel dev` (needs npm — historically unavailable on the owner's machine; fine in an agent environment if installed). Otherwise: deploy to a Vercel preview via a branch push and test there, and unit-check the handler logic by reading carefully — keep it small enough to reason about.
5. Deployment is git push → GitHub → Vercel auto-deploy. Commit only when asked; keep one masterplan item per commit.

## Known sharp edges

- `actionCounter` IDs (`a101`, …) can collide across sessions — use `Date.now()`-based IDs for anything new that needs global uniqueness.
- `importData` merges by id (new ids appended, existing ids overwritten) — imported data must be sanitized (Masterplan Phase 1.2).
- Search re-renders the full note list per keystroke — fine at current scale; don't optimize prematurely.
- `formatDate` expects `YYYY-MM-DD`; note dates come from `<input type="date">`.
- The owner's environment historically had no Node/npm/CLI tooling — confirm before proposing any CLI-based workflow to them (agent-side tooling in this environment is fine).
