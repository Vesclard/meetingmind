# Afterword — Project Audit

**Date:** 2026-07-07
**Auditor:** Claude (Fable 5), full-codebase review
**Scope:** `index.html`, `styles.css`, `app.js`, `api/ask.js`, `vercel.json`, Firebase setup as described in `Afterword_Handoff.md`
**Companion doc:** `MASTERPLAN.md` (roadmap + end goal). Read that after this.

---

## 1. Executive summary

Afterword is in genuinely good shape for a solo, no-build project: ~2,400 lines across four files, a coherent brand system, working Google-Sign-In-gated Firestore sync with correctly scoped per-user security rules, and a server-side proxy that keeps the Anthropic key out of the client. The two hard security lessons from its history (open Firestore rules, client-side API key) have both been fixed properly.

However, the audit found **one production breakage and one exploitable hole**:

1. **The AI assistant is broken right now.** `app.js` requests model `claude-3-5-sonnet-latest`, which Anthropic retired on 2025-10-28. Every `/api/ask` call 404s at Anthropic; the UI swallows it as "No answer found."
2. **`/api/ask` is a public, unauthenticated Anthropic proxy.** It has `Access-Control-Allow-Origin: *`, requires no auth, and passes client-supplied `model`, `max_tokens`, `system`, and `messages` straight through. Anyone who discovers the URL can spend the owner's Anthropic credits freely, from any website, with any model.

Everything else is polish, hardening, and growth. Severity-ranked findings are in §3; the fix plan lives in `MASTERPLAN.md`.

---

## 2. Current state assessment

### What's working well

- **Architecture fits the product.** Vanilla JS + explicit `render()` is the right amount of machinery for a single-user notes app. No framework debt, no build step, deploys are trivially reproducible (git push → Vercel).
- **Security posture is fundamentally sound.** Firestore rules scope to `request.auth.uid == uid` (verified in handoff §6). The Anthropic key lives only in a Vercel env var. `esc()` is applied consistently to user text rendered via `innerHTML`.
- **The sign-out hard-reload** (`location.reload()` in `signOutUser`) is a structurally correct fix for cross-account state leaks — the git history shows this was earned the hard way. Do not "improve" it away.
- **The brand system is real.** `styles.css` opens with a proper token block (Vesatile palette, light + dark derivations, two named easing curves, a signature mono-uppercase label style). This is a design system, not accidental CSS — it's the foundation the UI plan in §5 builds on.
- **Small thoughtful details:** `prefers-reduced-motion` support, `pendingSave` awaited before sign-out, defensive deep-clone of `DEFAULT_DATA`, save-failure toasts instead of silent `console.warn`.

### Code quality observations (non-blocking)

- `app.js` at 677 lines is still comfortably navigable, but it mixes five concerns (Firebase, state, rendering, DOM handlers, utilities) in one file. Fine for now; if it passes ~1,200 lines, split by concern into modules (still no bundler needed — browsers handle multiple ES modules).
- `renderNoteList` re-renders every card on every keystroke of search. Imperceptible at current scale; only worth touching if note count reaches hundreds.
- `actionCounter` starts at 100 and only increments in-session — action IDs can collide across sessions (`a101` created today and `a101` created tomorrow). Harmless today because actions live inside their note, but it will bite any future feature that references actions globally (e.g. an actions dashboard). Use `Date.now()`-based IDs like notes/folders do.
- No favicon / `manifest.json` — the browser tab shows a default icon.

---

## 3. Security findings (severity-ranked)

### S1 — CRITICAL: `/api/ask` is an open Anthropic proxy

> **Status 2026-07-08: fixed in working tree** — `api/ask.js` deleted, replaced by BYOK (Masterplan Phase 0). Remaining until closed: owner rotates the Anthropic key, removes `ANTHROPIC_API_KEY` from Vercel, and the deletion is deployed.

`api/ask.js` sets `Access-Control-Allow-Origin: *`, performs no authentication, and forwards client-controlled `model`, `max_tokens`, `system`, and `messages` verbatim to Anthropic. Consequences:

- Anyone with the URL (guessable: it's a public repo + a `/api/ask` convention) can make arbitrary Anthropic calls billed to the owner's key — any model, any prompt, unbounded `max_tokens`.
- The wildcard CORS header means any third-party web page can do this from a visitor's browser.
- The public GitHub repo makes discovery trivial: the endpoint path and request shape are documented in source.

**Fix (Masterplan Phase 0 — revised 2026-07-07):** the owner chose a user-pays (BYOK) production model, so the remediation is now *removal*, not hardening: delete `api/ask.js`, rotate the Anthropic key (it sat behind a public unauthenticated endpoint — treat as potentially abused), remove `ANTHROPIC_API_KEY` from Vercel, and rebuild the AI as direct browser→Anthropic calls using each user's own key. See MASTERPLAN.md Phase 0 for the full plan and the decision record of rejected alternatives.

### S2 — HIGH: AI assistant uses a retired model (production breakage)

> **Status 2026-07-08: fixed in working tree** — `callClaude()` defaults to `claude-opus-4-8` with a user-facing model selector; per-status error messages replace the generic "No answer found." Pending: deploy + a live answer with a real key.

`app.js:451` sends `model: 'claude-3-5-sonnet-latest'` — retired 2025-10-28. Anthropic returns 404; `ask.js` relays the error status; the client renders the generic "No answer found." So the flagship AI feature has been silently dead for months. (The handoff's claim of `claude-sonnet-4-20250514` is also stale — that model was deprecated with a 2026-06-15 retirement.)

**Fix (Phase 0, same change as S1 — revised for BYOK):** the shared `callClaude()` helper defaults to `claude-opus-4-8` (current recommended model, 1M context), with an optional user-facing model selector — under BYOK the user pays, so model choice is legitimately theirs. Surface real errors per status code (401 bad key / 429 rate limit / 5xx upstream) instead of the generic "No answer found."

### S3 — MEDIUM: Sign-in is open to any Google account

The app is single-user by design, but Firebase Auth accepts *any* Google account, and the Firestore rules happily create a fresh `users/{uid}` doc for each. Strangers can't read the owner's data (rules are correct), but they can use the app, consume Firestore quota, and — until S1 is fixed — use the AI proxy legitimately from inside the app.

**Fix (Phase 1 — now mode-dependent):** in *private mode*, enforce the owner's identity in the Firestore rules (`request.auth.token.email == <owner email>` in addition to the uid check), with the email typed only into the Firebase console, never committed. In *production/BYOK mode*, open sign-in becomes intended: BYOK removes the AI-cost exposure, per-uid rules keep data isolated, and the residual Firestore-quota exposure is mitigated with App Check + per-doc size limits before any public announcement. See MASTERPLAN.md Phase 1.1.

### S4 — MEDIUM: Imported JSON is trusted and can inject markup/JS (self-XSS)

`importData` validates only that `folders` and `notes` keys exist. Imported values flow into `innerHTML` templates where two interpolations are **not** covered by `esc()`:

- `f.color` → `style="background:${f.color}"` (`renderFolders`, `renderNoteList`). A crafted color like `red" onmouseover="...` breaks out of the attribute.
- `f.id` / `n.id` → `onclick="selectFolder('${f.id}')"`. An id containing a single quote breaks out of the JS string inside the handler.

This is self-XSS (the user must import a malicious file), and the same-origin damage ceiling is "run JS as the owner" — which, in an app holding the owner's Firestore token, is a real ceiling. Firestore data is similarly trusted on load, so a poisoned document persists the payload.

**Fix (Phase 1):** validate imports structurally — ids/names/colors must be strings, colors must match `/^#[0-9a-fA-F]{6}$/`, ids must match `/^[a-zA-Z0-9_-]+$/`, actions must be an array of the expected shape; regenerate ids that fail. Apply the same sanitation once on `loadUserData`.

> **Status 2026-07-10:** ✅ **fixed** (Phase 1.2). `sanitizeData({folders, notes})` in `app.js` regenerates non-conforming ids, replaces bad colors with a `FOLDER_COLORS` entry, coerces names/titles/bodies to strings, and reshapes actions; applied in both `loadUserData` and `importData`. The two raw `f.color` interpolations now also pass through `esc()` for defense-in-depth.

### S5 — LOW: `esc()` doesn't escape single quotes

Currently safe because all generated attributes use double quotes, but it's a one-refactor-away trap given the inline-handler pattern. Add `.replace(/'/g,'&#39;')`.

> **Status 2026-07-10:** ✅ **fixed** (Phase 1.3). `esc()` now appends `.replace(/'/g,'&#39;')`.

### S6 — LOW: Supply-chain and misc hardening

- Firebase SDK (10.13.0) and Google Fonts load from CDNs without SRI (gstatic ES modules don't support SRI well; acceptable risk, note only).
- No Firebase App Check. For a single-user app behind correct rules + an email-pinned proxy, this is optional; revisit if the app is ever multi-user.
- The repo is **public**: never commit personal emails, UIDs, or any credential. (The Firebase web config in `app.js` is fine — it's an identifier, not a secret.)

---

## 4. Reliability & data-model findings

| # | Finding | Impact |
|---|---|---|
| R1 | **Last-write-wins across devices.** Whole `{folders, notes}` doc rewritten on every save; no `updatedAt`, no transaction. Editing on two devices silently destroys one side's work. (Handoff Priority 2, still open.) | Data loss |
| R2 | **1 MiB Firestore document ceiling.** ✅ *fixed & deployed 2026-07-10 (Phase 2.1)* — dataset split into per-note docs + a `meta` doc; saves are per-note. Whole-doc ceiling and re-upload-everything cost eliminated; verified live. | Hard scaling wall |
| R3 | **AI context = full dump.** `askAi` serializes *all* notes into the system prompt per question. Cost grows with corpus size and will eventually degrade answer quality. Fine now; becomes the binding constraint if the corpus grows or the product ever ships to others. | Cost + quality decay |
| R4 | **No autosave, no dirty-state guard.** Navigating to another note or closing the tab discards unsaved edits without warning. | Silent edit loss |
| R5 | **Delete is one click, no confirm, no undo.** ✅ *fixed 2026-07-10 (Phase 1.4)* — `requestDeleteNote` now opens a styled confirm modal; `confirmDeleteNote` performs the destroy. | Accidental data loss |
| R6 | **No "Reset app" affordance** (handoff P2) and no loading state during the sign-in data fetch beyond static text. | Papercuts |
| R7 | Folders can't be renamed, recolored, or deleted (handoff P3). Deleting a folder needs a decision about orphaned notes. | Feature gap |

The fix for R1+R2 is the same move: migrate from one blob document to `users/{uid}/meta` (folders) + `users/{uid}/notes/{noteId}` subcollection documents, with per-note `updatedAt`. Saves become per-note (small, cheap, conflict-checkable), the 1 MiB ceiling disappears per-note, and a simple `updatedAt` comparison gives conflict *detection* even before conflict *resolution*. Migration path and sequencing are in `MASTERPLAN.md` Phase 2.

---

## 5. Competitive position & feature opportunities

**The field:** meeting-notes tooling clusters into (a) bot-attends-your-meeting recorders (Otter, Fireflies, Fathom), (b) local-capture AI notepads (Granola), and (c) general workspaces with AI bolted on (Notion, Fellow). All of (a) has a social cost — a bot in the room — and all of (c) is heavy.

**Afterword's defensible position:** the *fast, private, structured post-meeting record*. No bot, no recording, no workspace sprawl — a disciplined form plus AI over your own words. "Afterword" is literally the word after the meeting; the product story writes itself. Features should deepen that position, not chase transcription.

Ranked by leverage (full sequencing in the masterplan):

1. **Paste-a-transcript ingestion.** One textarea: paste anything (raw notes, a Teams/Meet transcript, an email thread) → Claude structures it into title/date/attendees/body and drafts the action items → user reviews and saves. This converts Afterword from "a form you fill in" to "a place you throw meeting residue and get a record back." Highest value-per-effort in the entire plan; needs only a second server endpoint reusing the existing proxy pattern, plus structured outputs.
2. **AI action-item extraction** from an existing note body ("Suggest actions") — same machinery, smaller scope; ship it as the first slice of #1.
3. **Open-actions dashboard.** A cross-project "My commitments" view (all open actions, grouped by owner/project, click-through to note). Data already exists; pure client feature; makes the app a daily driver instead of an archive.
4. **Weekly digest / project recap.** "Summarize what happened in Project X" or "my week" — a canned prompt over a *filtered* subset of notes. Also the first step toward fixing R3 (scoped context instead of full dump).
5. **Markdown rendering** in the note body (read mode renders, edit mode stays a plain textarea). Cheap, big perceived-quality jump for long notes. Use a tiny sanitizing renderer written in-repo — no dependency needed for a safe subset (headings, bold, lists, links).
6. **Note templates** (e.g. 1:1, client kickoff, standup) — pre-filled structure honoring the "consistent structure" thesis.
7. **Cross-note linking** (reference a previous meeting from a new one) + per-project chronology view.
8. **PWA** (manifest + service worker): installable, offline-readable. Handoff §12 Phase 1; pairs naturally with the reliability work.
9. **Calendar prefill** (Google Calendar → title/date/attendees). Real value but the first feature requiring OAuth scopes beyond sign-in; defer until the above land.

Anti-features (stay disciplined): no meeting bots/recording, no tags (owner's explicit choice), no multi-tenant SaaS pivot without revisiting every security assumption (see handoff §12 and finding S1's "single trusted caller" assumption).

---

## 6. UI/UX assessment against the brand

**The identity that exists** (from `styles.css` tokens + `index.html`): Vesatile system — Deep Green `#3B5244` on Off-White `#F4F4F2`, Brick Red `#8B3A3A` as a *sparing* accent, Charcoal ink, Sage muted; Plus Jakarta Sans body + JetBrains Mono for the signature small/uppercase/wide-tracked labels; the note editor styled as a paper "sheet" with corner marks; two named easings (`--ease-pop` for rewards, `--ease-out` for content); the V-mark glyph; motto "Less effort than you think."

**Read:** the brand is *editorial print* — a well-set book page, not a SaaS dashboard. The strongest existing moments are the sheet-with-corner-marks and the mono eyebrow labels. The gaps are where the app falls back to generic patterns:

1. **Reading experience is the brand's home turf and it doesn't exist yet.** Notes are only ever shown inside the edit form. A dedicated read mode — rendered markdown, book-like measure (~65ch), generous leading, actions typeset like a checklist proof — is the single highest-impact brand move.
2. **States are unbranded.** Loading is bare text; there are no skeletons; the empty note-list state is minimal. Every wait/empty/error state should speak the system (V-mark glyph, mono eyebrow, one editorial line).
3. **The "afterword/book" metaphor is underused.** The all-notes/dashboard view can read as a *table of contents*: project = chapter, mono page-number-style counts, hairline rules. This is where feature #3 (actions dashboard) should live visually.
4. **Brick red is currently only danger.** The brand calls it a *sparing accent* — earn it in one or two delight moments (the action-complete "pop", the active nav marker), keep it rare.
5. **Motion language is defined but thinly applied.** `--ease-pop` fires on action-complete and theme toggle only. A consistent rule — content enters with `--ease-out`, user-earned rewards pop with `--ease-pop`, nothing else animates — should be applied everywhere (and already respects reduced-motion).
6. **Mobile is functional, not composed.** The bottom nav works; the detail view on mobile should get the same sheet treatment and the back gesture area deserves polish.
7. **A11y basics are present** (focus-visible, reduced motion, aria-labels on icon buttons) — extend to the dynamically rendered lists (roles, `aria-current` on active items) as views get rebuilt.

The full build order, with per-phase acceptance criteria, is `MASTERPLAN.md` Phase 4, and the design rules are codified in the `afterword-brand` skill so any future agent inherits them.

---

## 7. Where to go from here

Read `MASTERPLAN.md`. Phase 0 (fix the broken AI + lock the proxy) is a same-day job and everything else is sequenced behind it. Three skills were added under `.claude/skills/` — `working-on-afterword` (codebase conventions and pitfalls), `afterword-brand` (design system rules), `afterword-security` (invariants that must never regress) — so the next agent starts with the context this audit had to reconstruct.
