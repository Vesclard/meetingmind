---
name: afterword-brand
description: The Vesatile/Afterword design system — tokens, typography, motion, and composition rules. Load before building or changing any UI in this repo, or writing any CSS/HTML.
---

# Afterword brand system ("editorial print")

Afterword's identity is **editorial print**: a well-set book page, not a SaaS dashboard. Organizing metaphor — *Afterword is a book of your meetings*: notes are pages, projects are chapters, the dashboard is a table of contents, the editor is a paper sheet. Motto: "Less effort than you think." Every new surface should be explainable in those terms.

All tokens already exist at the top of `styles.css`. **Never hardcode colors, fonts, or easings — use the custom properties.** Both themes must work for every change; the dark theme derives from the same tokens.

## Palette (light theme values; dark derivations exist)

| Token | Value | Role |
|---|---|---|
| `--bg` | `#F4F4F2` Off-White | primary background — paper |
| `--surface` | `#FBFBF9` | cards, the sheet, raised paper |
| `--surface-2` | `#ECECE7` | sidebar, alternate panels |
| `--ink` | `#151716` Charcoal | text anchor |
| `--muted` | `#7A8581` Sage | secondary text/tone |
| `--brand` | `#3B5244` Deep Green | primary brand, interactive |
| `--brand-soft` | green @ ~10% | chips, hovers |
| `--accent` / `--danger` | `#8B3A3A` Brick Red | **sparing** accent + danger |
| `--line` | `#DDDDD5` | hairline rules |
| `--frame` | `#3B5244` | the sheet's frame rule |

**Brick red discipline:** red = danger, plus at most one or two earned celebration moments (action completed, note saved). If red starts appearing decoratively, remove it. Folder colors come from the `FOLDER_COLORS` array in `app.js` (muted tones derived from the palette) — extend that array, don't invent new folder colors ad hoc.

## Typography

- Body: `var(--font-body)` — Plus Jakarta Sans. Mono: `var(--font-mono)` — JetBrains Mono.
- **The signature label style** (already a shared CSS rule): small size + `text-transform: uppercase` + `letter-spacing: .16em` + mono + weight 500. Use it for every eyebrow, section divider, meta label, count, and byline. When adding such an element, add its selector to the existing shared rule near the top of `styles.css` rather than restating the properties.
- Long-form reading (note read mode): ~65ch measure, generous leading (≥1.6), restrained heading scale. Metadata (date, attendees) sets as a mono "colophon" line, not a form row.

## Composition motifs

- **The sheet:** notes render on a raised `--surface` panel with the four `.corner` marks and the `--frame` rule. Reuse this treatment for any new "document-like" surface (read mode, print view, transcript-paste review).
- **Hairlines over boxes:** separate with 1px `--line` rules and whitespace, not borders-around-everything or heavy shadows. `--shadow` is the only elevation.
- **Table-of-contents pattern** for list/dashboard views: chapter-style group headers (signature label style), rows with hairline separators, mono counts right-aligned like page numbers.
- **The V-mark** (inline SVG polygon, already in `index.html`) is the identity glyph — use it in empty states, loading states, and icons. The `◆` diamond is the secondary ornament.
- **Every state is designed:** loading = paper-toned skeleton blocks (no spinners); empty = V-mark + mono eyebrow + one short editorial line; errors = same voice, brick red only on the key phrase.

## Motion doctrine

Two easings, two jobs — nothing else animates:
- `--ease-out` (`cubic-bezier(.2,.7,.3,1)`): content entering — short (≤350ms), subtle (small translate/fade). Example: the sheet's `rise`.
- `--ease-pop` (`cubic-bezier(.34,1.56,.64,1)`): **user-earned rewards only** — action checkbox pop, save confirmation, theme toggle spin.

Decorative/ambient animation is off-brand. `prefers-reduced-motion` is already handled globally with a kill-all rule — never bypass it. The `.btn-sheen` hover sweep is the one sanctioned flourish for solid pill buttons.

## Accessibility & platform

- Focus: the global `:focus-visible` token style (accent outline) must survive on any new interactive element.
- Contrast: `--ink` on `--bg`/`--surface` and `--brand` on `--bg` pass AA; check anything using `--muted` for essential text at small sizes.
- Both themes, always: test light + dark for every UI change; theme is `data-theme` on `<html>`, persisted to `localStorage`.
- Mobile (≤700px) is a distinct single-column composition (bottom nav, slide-in sidebar) — new desktop UI needs an explicit answer for mobile, respecting safe-area insets.

## Voice

Copy is calm, editorial, first-person-respectful, and short. Sentence case except the signature uppercase labels. No exclamation marks, no "Oops!", no emoji in UI copy (the existing `◆`/`⚠`/`✓` glyphs are the sanctioned set). Empty states get one line, e.g. "Nothing recorded yet."
