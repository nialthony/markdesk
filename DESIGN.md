# DESIGN.md

Direction supplied by the product owner on 2026-09-22, transcribed from their
answers. The owner is the author of this file; the agent only formats it and
keeps the decision log below current.

## Identity

A real trading terminal. A serious institutional-desk console: numbers,
precision, trust. A visitor (especially a Stocklana judge) should see a tool,
not a landing page.

## Personality

Loud and firm. A hard terminal: heavy type, high contrast, felt speed.
Bloomberg vibes. It speaks in specifics, never in marketing.

## Palette

Dark base with exactly ONE accent, more specific to MarkDesk than today's acid
green. Core colors: dark ink neutrals. The accent belongs to the key moments
only. Semantic red stays strictly functional (errors, failures) and is not
decoration.

## Typography

Editorial serif headlines (financial-journal voice) carrying the loud
personality. Sans body for prose. Mono strictly for data: numbers, marks,
addresses, on-chain values. No uppercase wide-tracking mono as a default
identity.

## Mood (dials)

Dial: ENERGY 2 / RHYTHM 2 / MOTION 1

Balanced energy with one focal point per screen, deliberate section variation,
motion limited to hover states and short functional transitions.

## Decision log (R-31: one-line reason per major decision)

- Logo mark: the owner's reference M (docs/assets/logo-reference.png),
  reconstructed as a slab M whose center V reaches almost to the baseline,
  split two-tone with the left half over the right at the crossing. Mapped to
  the system palette: left var(--text), right the amber accent. (R-23/R-31)

- Dark theme default: a trading terminal for a professional desk; dark is the
  product's native environment, not a "tech" costume. (R-21)
- Accent: amber `#ffb454`, the terminal-amber of institutional desks; it
  replaces acid green, orange, and blue as THE accent. (R-29, one accent)
- Semantic red `#ff786d` kept only for error and failure states. (R-25, functional)
- Headline typeface: Fraunces (variable, high-weight editorial serif); loud
  without being the default AI pick. (R-06)
- Body typeface: Inter; an unopinionated UI sans that defers to the serif
  voice and stays legible at small sizes. (R-06)
- Data typeface: the system mono stack (zero payload, tabular alignment for
  marks and addresses). (R-06)
- Identity motif: the angular corner cut (existing clip-path chamfer on the
  logo tile, signal panel, and buttons); it is specific to MarkDesk and
  repeated, so it stays and is carried further instead of being replaced. (R-31)
- Serif display numerals join the motif at data moments (hero signal, step
  numbers) as the editorial voice of the numbers. (R-06)
- Hero background grid removed; it was texture without intent. (R-07)
- Eyebrow pill above the H1 removed; the kicker becomes plain small text. (R-09)
- In-page button arrows removed; the external-link arrow stays only on links
  that leave the site (Source API, Stocklana brief, Inspect source, Explorer
  signatures), where it marks an external destination. (R-08)
- Status color semantics, one written system: amber = verified/success/premium
  (the accent at the key moment), blue = informational/in-progress/discount,
  red = error/failure/critical, grey = not started. The old orange hue is gone.
  (R-29)
- Small uppercase sans labels (7-10px, 0.08-0.14em tracking) are the terminal's
  label voice; they are not the banned default (large monospace headlines with
  extreme tracking). Data values, marks, addresses, and signatures stay mono.
  (R-06)
- The Clock glyph stays on the mark-freshness notice because freshness is a
  time claim; the Shield and Layers glyphs were removed as generic. (R-04)
- The duplicate nav CTA is hidden on small screens instead of shrinking to an
  icon; the hero primary button points to the same anchor. (R-03, R-26)
- Glow removed from status dots; a dot marks a real state and needs no halo.
  (R-13)
- Focus: a global amber focus-visible ring plus focus-within rings on the
  composite input fields. (R-32)
- Motion dial honored with 120ms color transitions only, disabled under
  prefers-reduced-motion. (R-19)
