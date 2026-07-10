# Afterword — Masterplan

**Created:** 2026-07-07, from the findings in `AUDIT.md` (read that first — finding IDs like S1/R2 refer to it).
**Audience:** the next coding agent (Opus 4.8 / Sonnet 5) and the owner.
**Prerequisite reading:** `Afterword_Handoff.md` (authoritative project history), `CLAUDE.md`, and the three skills in `.claude/skills/`.

---

## The end goal (north star)

> **Afterword is the fastest, most private way to turn a finished meeting into a permanent, findable, actionable record — with no bot in the room and no workspace sprawl.**
>
> Concretely, the finished product is a single-user app where the owner can: paste anything (rough notes, a transcript, an email) and get a structured meeting record back in seconds; see every open commitment across all projects at a glance; ask questions over months of meetings and get grounded answers; read any note as a beautifully typeset page; and trust that the data syncs safely across devices, survives conflicts, and can never be read or spent by anyone else.

Every phase below moves toward that sentence. If a proposed change doesn't, it's scope creep.

### Standing constraints (do not violate)

1. **No build step, no framework, no test runner, no npm for the frontend.** Three static files + serverless functions. Serverless functions *may* get a `package.json` if strictly needed (Vercel installs it at deploy) but prefer zero-dependency solutions.
2. **Single-account data model; user-pays AI.** Each user's data is isolated to their own `users/{uid}` scope and there are no shared/collaborative features (that would be a security redesign). The production AI model is **BYOK** — every user, including the owner, supplies their own Anthropic API key (see Phase 0). The app never spends the developer's key on anyone's behalf. Routing traffic against users' *consumer Claude subscriptions* (Pro/Max via OAuth) is prohibited by Anthropic policy — do not implement it.
3. **Folders are the only categorization.** No tags without explicit owner approval.
4. **Sign-out keeps its hard reload.** See handoff §6.
5. **The repo is public.** No emails, UIDs, keys, or personal data in committed files — secrets go in Vercel env vars and the Firebase console.
6. Every `window.fn = fn` rule, `esc()` rule, and verification step in `.claude/skills/working-on-afterword` applies to all work below.

---

## Phase 0 — Emergency: retire the proxy, restore the AI as BYOK (do first)

> **Revised 2026-07-07.** The original Phase 0 hardened `api/ask.js` around the developer's key. The owner has since decided the production model is **user-pays**: each user brings their own Anthropic API key. Anthropic supports this directly — the API accepts browser calls when the request carries the `anthropic-dangerous-direct-browser-access: true` header, added specifically for the BYOK pattern. That means the proxy, the Vercel `ANTHROPIC_API_KEY`, and the entire S1 attack surface can simply be **deleted** rather than defended. (The compliant-alternatives analysis and rejected options are in "AI billing model — decision record" below.)

Fixes: **S1, S2**. Step A is minutes of work and closes the live hole; Step B restores the feature.

### Step A — take the open proxy offline (same day)

> **Status 2026-07-08:** item 1 ✅ done (`api/ask.js` deleted, no references remain). Item 2 ⚠ **pending owner action** — rotate the key at console.anthropic.com and delete `ANTHROPIC_API_KEY` from the Vercel project; the endpoint stays live in production until this change is *pushed and deployed*.

1. Delete `api/ask.js` (or replace its body with a `410 Gone` response) and push. The AI is already broken (S2), so nothing functional is lost.
2. **Rotate the Anthropic API key** in the Anthropic Console and remove `ANTHROPIC_API_KEY` from Vercel. The key sat behind a public unauthenticated endpoint in a public repo — treat it as potentially abused; check the Console usage logs for unexplained spend while there.

### Step B — BYOK: the user's key, stored on the user's device, calling Anthropic directly

> **Status 2026-07-08:** ✅ implemented as specified below (AI-settings modal, `localStorage` key + model pref, `callClaude()` helper, per-status error UX, no-key panel state, sign-out clearing). Verified: `app.js` parses as an ES module, all inline handlers have `window` exports, `count_tokens` returns 401 on a bad key as the error mapping assumes, app serves locally. **Not yet verified (needs owner):** live sign-in flow and a real answer with a real key after deploy — run the "Verify" checklist below.

**Settings surface** (new modal or sidebar-footer section, styled per the brand skill):
- API key input with paste-and-save. After save, never render the key back into the DOM — show `sk-ant-…` + last 4 characters, with "Replace" and "Remove" actions.
- Store in `localStorage` under `afterword_api_key_v1`, **on the user's device only**. It never touches Vercel, Firestore, or any server the developer controls — this is the whole point: no key custody, no liability, no server cost.
- Validate on save with a cheap call to `POST /v1/messages/count_tokens` (no generation, negligible cost); show an inline "key looks valid ✓ / key rejected" result.
- Copy under the field: a one-liner explaining the key stays on this device, a link to `console.anthropic.com` to create one, and a recommendation to create the key in a **dedicated workspace with a monthly spend limit** so Afterword can never cost more than the user allows.
- Optional model selector, default `claude-opus-4-8`, with `claude-sonnet-5` and `claude-haiku-4-5` as cost-conscious choices (persist in `localStorage`). Since the user pays, model choice is legitimately theirs — server-side pinning is obsolete.

**`app.js` — replace `askAi()`'s fetch with a shared `callClaude(payload)` helper:**
- POST `https://api.anthropic.com/v1/messages` with headers `x-api-key: <stored key>`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`, `content-type: application/json`.
- Body: selected model (default `claude-opus-4-8`), `max_tokens: 2000`, the existing system+notes-context+question shape.
- Error UX by status: 401 → "Your API key was rejected — update it in Settings"; 429 → "You've hit your Anthropic rate limit — wait a moment"; 529/5xx → "Anthropic is busy — try again"; network → offline message. Reserve "No answer found" for genuinely empty answers.
- No key stored → the AI panel renders a branded empty state ("Add your Anthropic API key to ask your notes") linking to Settings, instead of the input row.

**Sign-out behavior:** clear `afterword_api_key_v1` (and the model pref) in `signOutUser()` *before* the reload — a stored key must not survive into another person's session on a shared machine.

**Verify:** no key → branded prompt; bad key → inline rejection on save; valid key → real answer about seeded notes; DevTools network tab shows the call going to `api.anthropic.com` with the user's key and the pinned version header; sign out → key gone from `localStorage`; `api/ask` URL → 404/410.

### Hard prerequisite created by BYOK

Storing a spendable credential in `localStorage` raises the stakes of any XSS from "deface the app" to "steal the user's Anthropic key." **Phase 1 items 2–3 (import/load sanitation + `esc()` hardening) are now blocking prerequisites before advertising Afterword to anyone beyond the owner**, and the future markdown renderer (Phase 3.5) must be sanitizing by construction. The `afterword-security` skill §2–3 codifies this.

### AI billing model — decision record (why BYOK)

| Option | Verdict |
|---|---|
| **BYOK, direct browser calls** (chosen) | User pays their own usage; developer holds no keys, runs no AI server, carries no cost or custody risk; officially supported via the CORS opt-in header. Friction: users need an Anthropic Console account with billing — acceptable for a power-user tool, and mitigated by good onboarding copy. |
| "Sign in with Claude" against the user's Pro/Max subscription | **Prohibited.** Anthropic's terms explicitly forbid third-party apps routing traffic against consumer subscription limits. Do not implement, even if community workarounds exist. |
| BYOK passed through the dev's proxy | The developer's infrastructure handles every user's key (custody + logging liability) for zero benefit over direct calls. Rejected. |
| Dev's key + metering/charging users | Turns a free personal tool into a billing business: payments, quotas, abuse handling, ToS. Out of scope; revisit only for a deliberate commercial pivot. |
| Aggregator gateways (OpenRouter etc.) | Adds a third party between users and Anthropic for no gain here. Rejected. |

## Phase 1 — Security hardening (small, independent changes)

Fixes: **S3, S4, S5**.

> **Status 2026-07-10:** items 2, 3, 4 ✅ done (`sanitizeData` on load+import, `esc()` single-quote hardening + color interpolations, delete-confirm modal). Item 1 ✅ **done — owner chose production/BYOK mode (open sign-in) and published the rules to the console, 2026-07-10.** Rules are version-controlled in `firestore.rules` (recursive `users/{uid}/{document=**}`, uid-scoped, no email pin) and cover the Phase 2.1 subcollection paths. No friendly permission-denied message needed — open sign-in is intended. Remaining gates before a *public announcement* (not before use): Firebase App Check + per-note field-size caps in the rules (see `firestore.rules` header), and the Phase 2 conflict/reliability work.

1. **Firestore rules — pick per deployment mode.** The uid scoping (`request.auth.uid == uid`) is non-negotiable in both modes.
   - *Private mode (today, single user):* additionally pin the owner in the rules (Firebase console, not the repo):
     ```
     match /users/{uid} {
       allow read, write: if request.auth != null
         && request.auth.uid == uid
         && request.auth.token.email == "<owner email — typed in console only>";
     }
     ```
     Verify with a second Google account: sign-in succeeds but data load fails → show a friendly "this app is private" message on permission-denied instead of the generic connection toast.
   - *Production/BYOK mode (open to other users):* drop the email pin — open sign-in becomes intended behavior, and BYOK (Phase 0) already removed the AI-cost exposure that made strangers dangerous (S3). Residual exposure is Firestore quota consumption by strangers' notes; accept it initially, and add **Firebase App Check** + per-note size limits in the rules (`request.resource.size` guard) before any public announcement.
2. **Sanitize imported and loaded data.** One `sanitizeData({folders, notes})` function applied in both `importData` and `loadUserData`: ids `/^[a-zA-Z0-9_-]+$/` (regenerate on failure), colors `/^#[0-9a-fA-F]{6}$/` (fallback to a `FOLDER_COLORS` entry), names/titles/bodies coerced to strings, actions coerced to the `{id,text,assignee,done}` shape.
3. **Harden `esc()`**: add single-quote escaping. Audit every template literal in render functions for un-`esc()`ed interpolation (the color/id gaps are closed by #2, but keep the discipline).
4. **Add a confirm step to `deleteNote`** (styled like the folder modal, not `window.confirm`) — bundled here because it's a one-click destructive action (R5).

## Phase 2 — Reliability & the data-model migration

Fixes: **R1, R2, R4, R6**. This is the largest structural change; do it as one focused effort with export-backup first.

> **Status 2026-07-10:** item 1 ✅ **done, deployed, and verified live.** BYOK rules published to the console; the per-note code is on `main`/Vercel; owner confirmed the blob→per-note migration and CRUD round-trip cleanly in production. Item 2 ✅ **done & verified live (2026-07-10)** — transactional `updatedAt` conflict *detection* in `saveNoteDoc` (`noteVersions` map + `tsEqual`), a sync-conflict modal with Keep-mine (`forceSaveNoteDoc`) / Use-theirs (`reloadConflictNote`); owner confirmed with the two-browser test. Item 3 ✅ **done & verified live (2026-07-10)** — one shared write path (`persistCurrentNote`) drives both the Save button and a ~2s debounced autosave; `markDirty`/`editSeq`/`savedSeq` track dirty state (robust to edits made during an in-flight save), `commitPendingEdits` flushes on note/folder switch and sign-out, a `beforeunload` guard warns while dirty, and `setStatus` shows real states (Unsaved… / Saving… / Saved ✓ / ⚠ Offline). New notes autosave only once they have a title + project. Item 4 ✅ **done & verified live (2026-07-10)** — a "Reset app" button in the sidebar footer opens a danger confirm modal; `resetAppData` deletes all note docs (batched), reseeds `DEFAULT_DATA` via `writeAllPerNote`, and reloads (legacy blob backup left untouched). Item 5 ✅ **implemented in code** — an `isLoading` flag makes `renderFolders`/`renderNoteList` emit paper-toned skeleton blocks (with a gentle reduced-motion-safe pulse) during the post-sign-in `loadUserData` fetch, replacing the blank flash. ⚠ not yet verified live. **With item 5, all of Phase 2 is code-complete.**

1. **Migrate to per-note documents.**
   - New shape: `users/{uid}/meta` (doc: `{ folders }`) and `users/{uid}/notes/{noteId}` (one doc per note, plus `updatedAt` (server timestamp) and `schemaVersion`).
   - Migration in `loadUserData`: if the legacy blob doc exists and the subcollection is empty, split it into per-note docs, write `meta`, keep the blob as `users/{uid}` with a `migratedAt` marker (don't delete for one release).
   - `saveNote`/`deleteNote` become single-doc writes/deletes; `confirmAddFolder` (and future folder ops) write `meta` only.
   - Loading uses one `getDocs` on the subcollection. (Live `onSnapshot` sync is optional later; don't add it in this phase.)
2. **Conflict guard (detection, not resolution).** Before overwriting a note, compare the loaded `updatedAt` with the server's current one (read-before-write or a transaction). On mismatch: keep the user's version in the editor, warn "This note changed on another device," and offer overwrite / reload. Last-write-wins stops being *silent*.
3. **Autosave + dirty guard.** Debounced (~2s idle) autosave of the open note; `beforeunload` guard while dirty; keep the explicit Save button as an immediate-flush affordance. The save-status indicator becomes real ("Saving… / Saved ✓ / ⚠ Offline").
4. **Reset app** button (settings area in the sidebar footer): confirm-modal → delete all note docs + meta → reseed defaults.
5. **Loading state** during the post-sign-in fetch: branded skeleton per the brand skill, replacing the blank flash.

**Verify:** two browsers signed in as the owner; edit the same note in both; second save triggers the conflict warning. Export → Reset → Import round-trips losslessly.

## Phase 3 — Competitive features (the "why Afterword" phase)

Sequenced by leverage; each item is shippable alone. All AI items run **client-side through the shared BYOK `callClaude()` helper from Phase 0** — no new server endpoints. Use structured outputs (`output_config.format` with a JSON schema) for anything that must parse (action extraction, transcript ingestion); they work identically from the browser.

1. **AI action extraction ("Suggest actions").** Button in the actions section → sends the note body → Claude returns `{actions: [{text, assignee}]}` via structured output → rendered as accept/dismiss chips that append to `editActions`. Small, self-contained proof of the ingestion machinery.
2. **Paste-a-transcript ingestion.** "New from paste" entry point: one big textarea → Claude returns `{title, date, attendees, body, actions[]}` → opens as a pre-filled unsaved note for review. This is the flagship feature; design its entry point prominently (sidebar button + empty-state CTA).
3. **Open-actions dashboard ("Commitments").** New view (sidebar item above projects): all open actions across notes, grouped by project, owner filter, checkbox completes in place (writes through to the owning note), click-through to the note. Pure client work; visually the brand's "table of contents" concept.
4. **Scoped AI + digests.** Add a project scope selector to the AI panel (current folder vs all notes) — fixes the full-dump cost curve (R3) and improves grounding. Add one canned prompt: "Recap this project" / "My week."
5. **Markdown rendering + read mode.** Render a safe subset (headings, bold/italic, lists, links, inline code) with a small in-repo sanitizing renderer — no dependency. Read mode is the default when opening a note; Edit toggles the current form. (This is jointly a Phase-4 brand deliverable — see below.)
6. **Templates.** 2–3 built-in note templates on the new-note flow (1:1, client meeting, team sync).
7. **Folder management** (rename / recolor / delete-with-reassign) — closes R7.
8. **PWA**: `manifest.json`, icons, minimal service worker (cache-first for the three static files, network for Firestore/API). Installable on phone; offline shows cached shell + a friendly offline note.

Defer until explicitly requested: calendar integration (new OAuth surface), cross-note linking, voice input, any multi-user capability.

## Phase 4 — UI/UX build: "the editorial record" (brand identity plan)

The brand is Vesatile editorial print (see `.claude/skills/afterword-brand` for tokens and rules). The organizing metaphor: **Afterword is a book of your meetings** — notes are pages, projects are chapters, the dashboard is the table of contents. Build order:

1. **Read mode as a typeset page** (with Phase 3.5): ~65ch measure, larger leading, rendered markdown, attendees/date set as a mono colophon line, actions as a checklist proof, the existing sheet + corner marks retained. This is the single highest-impact brand deliverable.
2. **Branded states everywhere:** skeleton loaders (paper-toned blocks, no spinners), empty states with the V-mark + mono eyebrow + one editorial line ("Nothing recorded yet."), error states in the same voice. Every state a user can see should look designed.
3. **Table-of-contents dashboard** (with Phase 3.3): chapter-style project groupings, hairline rules, mono counts right-aligned like page numbers.
4. **Motion doctrine applied app-wide:** content enters with `--ease-out` (short, subtle), user-earned rewards (action complete, note saved) pop with `--ease-pop` + a rare brick-red flash; nothing else moves. Reduced-motion already handled globally — keep it.
5. **Brick red discipline:** danger + at most two celebration moments. If red appears anywhere else, remove it.
6. **Mobile composition pass:** sheet treatment on the mobile detail view, comfortable tap targets on the bottom nav, safe-area insets, back affordance polish.
7. **A11y pass on rendered lists:** list roles, `aria-current` on active folder/note, keyboard navigation for the note list, visible focus everywhere (token already exists).
8. **Micro-identity:** favicon + app icons from the V-mark (needed by the PWA anyway), print stylesheet for read mode (a meeting record you can print is very on-brand).

**Acceptance bar for the phase:** open any screen in either theme and it reads as *one designed object* — no default-browser moments, no unbranded states, red is rare, motion is intentional.

---

## Sequencing summary

| Phase | Theme | Size | Blocking? |
|---|---|---|---|
| 0 | Retire proxy + rotate key (Step A), BYOK AI (Step B) | Step A: minutes. Step B: ~a day | **Yes — Step A before anything else** |
| 1 | Security hardening | Hours | Before Phase 2; items 2–3 block any multi-user distribution (BYOK key-theft stakes) |
| 2 | Reliability + per-note data model | Days | Before Phase 3 items that write data |
| 3 | Competitive features | Incremental, each shippable | — |
| 4 | Brand UI/UX build | Incremental, interleave with 3 | — |

Phases 3 and 4 are deliberately interleaved (read mode, dashboard, and states are joint feature/brand deliverables). Within them, ship in the numbered order unless the owner reprioritizes.

## Working agreements for the next agent

- **Verify in a real browser** per `working-on-afterword` (serve locally with `python3 -m http.server`; file:// won't load ES modules). Never claim a UI change works without exercising it.
- **Update the docs as you go:** `Afterword_Handoff.md` is the living status doc — keep its Firebase/AI/status sections true after each phase. Tick items off in this file. Update `AUDIT.md` finding statuses (e.g. "S1 — fixed <date>, commit <sha>").
- **One phase item per commit** where practical; commit messages state the phase item (e.g. "Phase 0: authenticate /api/ask and pin model server-side").
- **Ask the owner before:** anything touching sign-in UX, deleting the legacy blob doc post-migration, adding any dependency, or anything on the anti-features list.
