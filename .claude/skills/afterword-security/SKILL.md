---
name: afterword-security
description: Security invariants for Afterword that must never regress — Firestore rules, the /api/ask proxy contract, XSS discipline, and public-repo hygiene. Load before touching api/, auth, Firestore access, rendering code, or import/export.
---

# Afterword security invariants

This app has already shipped two real vulnerabilities in its history (world-writable Firestore rules; client-side Anthropic key) and the 2026-07 audit found a third (`/api/ask` open proxy — AUDIT.md S1). Each invariant below exists because its violation was real. Check changes against this list before committing.

## 1. Firestore rules: per-user AND owner-pinned

Deployed rules must scope to `request.auth.uid == uid` — never merely `request.auth != null` (that was the original bug: any Google account could read/write every document). After Masterplan Phase 1, they must *additionally* pin the owner's email via `request.auth.token.email`. The owner's email is typed into the Firebase console only — never committed (see §5). Any change to the data model (e.g. the Phase-2 per-note subcollection) needs matching rules for the new paths *before* the client code ships, and the same uid + email conditions on every path.

## 2. AI is BYOK — the developer's key never serves users, and user keys never leave the device

Since Masterplan Phase 0 (revised 2026-07-07), the AI billing model is **bring-your-own-key**: every user (including the owner) stores their own Anthropic API key in `localStorage` and the browser calls `api.anthropic.com` directly with the `anthropic-dangerous-direct-browser-access: true` header. Invariants:

- **No server-side Anthropic proxy exists, and none may be reintroduced** backed by a developer key. The old `api/ask.js` was an unauthenticated open proxy on the dev's key (AUDIT S1) — that key was rotated and removed from Vercel. If a server AI route ever becomes necessary, it must be authenticated (Firebase ID token, verified server-side) with model/params pinned server-side and no CORS headers — but the default answer is: don't build one.
- **User keys are device-local only.** Never send the user's key to Vercel, never store it in Firestore, never log it, never render it back into the DOM after entry (show a masked `sk-ant-…last4`). It lives in `localStorage` (`afterword_api_key_v1`) and in request headers to `api.anthropic.com` — nowhere else.
- **Clear the key on sign-out** (before the hard reload) so it can't survive into another person's session on a shared machine.
- **Do not route traffic against users' Claude Pro/Max subscriptions** (consumer-OAuth tokens). Anthropic's terms prohibit third-party apps using subscription limits; BYOK Console API keys are the compliant path.
- New AI features (action extraction, transcript ingestion, digests) go through the shared `callClaude()` helper — don't fork per-feature request builders that might mishandle the key.

## 3. XSS discipline in a 100%-`innerHTML` app

All rendering is string templates into `innerHTML`, so this discipline is the entire client-side defense — and under BYOK the prize for XSS is no longer defacement, it's **theft of the user's stored Anthropic key**. Sanitation is therefore a blocking prerequisite for any multi-user distribution:

- Every interpolated value passes through `esc()` — including ids, colors, and anything from Firestore or an imported file, not just obvious "user text." Attribute values are always double-quoted.
- Data entering the app from outside the current session (Firestore load, JSON import) goes through `sanitizeData()` (Phase 1.2): id/color/name/shape validation with safe fallbacks. Import files are attacker-controlled input; Firestore content is only as trustworthy as the last thing that wrote it.
- If markdown rendering ships (Masterplan Phase 3.5), the renderer must be sanitizing by construction: whitelist of output tags, no raw HTML passthrough, `href` restricted to `https?:`/`mailto:`, `rel="noopener noreferrer"` + `target="_blank"` on links.

## 4. Auth/session state hygiene

- `signOutUser()` keeps its `location.reload()` — the structural guarantee that no in-memory state crosses accounts (handoff §6 documents the failed alternatives).
- `resetLocalState()` runs on every auth transition (sign-in *and* sign-out) before loading the new user's data.
- Never cache note data in `localStorage` — it outlives the Firebase session and leaks across accounts on a shared machine. `localStorage` holds theme/sidebar prefs plus exactly one credential: the user's own Anthropic key (`afterword_api_key_v1`), which `signOutUser()` must clear.

## 5. Public-repo hygiene

The GitHub repo is public. Never commit: the owner's email address, UIDs, ID tokens, any Anthropic key, service-account JSON, or Firestore exports containing note content. Any remaining secrets live in the Firebase console (rules email pin, private mode only) — after the BYOK migration there should be **no** `ANTHROPIC_API_KEY` in Vercel at all; its presence is a regression. The Firebase *web config* in `app.js` (apiKey/projectId/appId) is a public client identifier protected by the rules — it is fine and should stay.

## 6. Deployment modes and what gates going public

Two modes exist (Masterplan Phase 1.1): **private** (Firestore rules pin the owner's email) and **production/BYOK** (open sign-in, per-uid isolation, each user on their own key). BYOK removed the AI-cost reason strangers were dangerous, but going public is still gated on: the XSS/sanitation work in §3 (key-theft stakes), Firebase App Check + per-doc size limits against Firestore quota abuse, and the Phase 2 conflict/reliability work. Shared or collaborative features remain a full security redesign — treat "multi-user *collaboration*" as a security project, not a feature.
