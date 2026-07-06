---
name: PRD (Epic)
about: A product requirements doc for a feature area — the parent of a set of vertical-slice issues
title: "PRD: "
labels: ["ready-to-work"]
assignees: []
---

<!--
A PRD captures WHAT and WHY for a whole feature area, plus the decisions already
made. It gets split into vertical-slice issues (see the "Vertical slice" template)
that reference it as their Parent.

House rules:
- Use the glossary vocabulary from CONTEXT.md; respect ADRs in docs/adr/.
- No specific file paths or code snippets — they go stale fast. (Exception: a
  prototype snippet that encodes a decision more precisely than prose — schema,
  state machine, type shape. Trim to the decision-rich parts.)
-->

## Problem Statement

<!-- The problem the user is facing, from the user's perspective. -->

## Solution

<!-- The solution, from the user's perspective. Link the glossary terms and ADRs that govern it. -->

## User Stories

<!--
A LONG numbered list covering all aspects of the feature, each in the format:
1. As a <actor>, I want <a feature>, so that <benefit>
-->

1. As a ..., I want ..., so that ...

## Implementation Decisions

<!--
Decisions already made: modules to build/modify and their interfaces, architecture,
schema changes, API contracts, specific interactions, technical clarifications.
-->

-

## Testing Decisions

<!--
What makes a good test here (external behavior only, never implementation details),
which seams/modules will be tested, and prior art — similar tests in the codebase.
-->

-

## Out of Scope

<!-- Explicit no-s. These are as valuable as the yes-s. -->

-

## Further Notes

<!-- Constraints, reference hardware, design-system pointers, latency budgets, etc. -->
