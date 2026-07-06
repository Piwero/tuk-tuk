---
name: Vertical slice
about: One independently-grabbable tracer bullet cut from a PRD — end-to-end through every layer
title: "feat(scope): "
labels: ["ready-to-work"]
assignees: []
---

<!--
A vertical slice cuts through ALL integration layers end-to-end (schema, API, UI,
tests) — never a horizontal slice of one layer. A completed slice is demoable or
verifiable on its own.

House rules:
- Use the glossary vocabulary from CONTEXT.md; respect ADRs in docs/adr/.
- No specific file paths or code snippets — they go stale fast.
- Publish blockers first so "Blocked by" can reference real issue numbers.
-->

## Parent

<!-- Reference to the parent PRD issue, e.g. #41. Omit this section if there is none. -->

#

## What to build

<!--
Concise description of this slice's END-TO-END BEHAVIOR, not layer-by-layer
implementation. Say what is demoable when it's done, and name the scope guard —
what nearby work is deliberately left to other slices.
-->

## Acceptance criteria

<!--
Checkboxes stating observable outcomes, including the tests on each seam
(backend HTTP seam, frontend mocked-fetch pattern) — not implementation steps.
-->

- [ ]
- [ ]
- [ ]

## Blocked by

<!-- Blocking issue references, or exactly: None - can start immediately -->

- None - can start immediately
