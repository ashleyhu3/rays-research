# Transcript Coverage Gate

Purpose: stop the model from silently dropping management claims, hedges, or Q&A
exchanges while condensing a long transcript. This is a working ledger you build and
check off — it is never itself part of the delivered report.

## Why this exists

Long transcripts get compressed. The failure mode isn't "wrong facts" — it's
**quiet omission**: a hedge ("selectively", "not yet at scale") gets rounded off, a
mechanism explanation gets replaced with just the conclusion, or a Q&A exchange gets
skipped because it seemed to repeat an earlier point. None of that shows up as an
error until someone checks the source. The ledger forces every unit of the transcript
through an explicit covered/pending state before the report is considered done.

## Setting up the ledger

Before drafting, split the transcript into units:

1. **Prepared remarks, per speaker**: break each speaker's remarks into topical
   segments. Assign each an ID: `PR-{Speaker}-{Sequence}`, e.g. `PR-CEO-1`,
   `PR-CEO-2`, `PR-CFO-1`.
2. **Q&A, per exchange**: one ID per analyst question + management answer, in
   transcript order: `QA-{N}`.

For each unit, note in the ledger (scratch file, not delivered):
- ID
- One-line gist of the unit
- Status: `pending` → `drafted` → `verified`

## What counts as a high-signal unit worth preserving in full

Tag units (don't need new IDs, just a flag) that carry any of:

- **Anchor** — a concrete number, ratio, dollar figure, or named metric.
- **Chain** — an explicit causal or mechanism explanation ("X ramped because Y, which
  flowed through to Z").
- **Boundary** — a hedge, qualifier, or scope limiter: "strategically", "selectively",
  "only when", "not yet", "early innings", a named time horizon ("starting FY27").
- **Edge case** — an explicit comparison to a competitor, a named customer/partner
  concentration, or an admission of a risk/uncertainty.

Anchor/Chain/Boundary/Edge-case (ACBE) units are the ones most likely to get flattened
into a vaguer sentence during drafting. When drafting a section, check: did the ACBE
tags in the source units survive into the output, or did they get rounded off into a
generic positive/negative statement?

## Coverage pass (before finalizing)

1. Walk every `PR-*` ID: is it represented under the correct speaker/theme in chapter
   五 (Management Commentary)? If a claim only survives in chapter 七 (buy-side
   signals) as your own inference, that's wrong — chapter 五 must contain the
   management framing verbatim (translated), and chapter 七 the interpretation.
2. Walk every `QA-*` ID: is it represented in chapter 六? Every question needs an
   entry — "management declined to answer directly" or "not addressed" is a valid
   entry, silent omission is not.
3. Spot-check ACBE-tagged units specifically: did the hedge/mechanism/comparison
   survive, or did it get compressed into a plain positive claim?
4. If a sub-question inside a multi-part analyst question went unanswered, say so
   explicitly rather than implying it was folded into the answer given.

## What this is not

- Not a place for buy-side interpretation — that belongs only in chapter 七.
- Not a transcript reproduction — compression is fine and expected, as long as the
  ACBE content of each unit survives the compression.
- Not delivered to the user — it's a working artifact; delete or leave in scratch
  once the coverage pass is done.
