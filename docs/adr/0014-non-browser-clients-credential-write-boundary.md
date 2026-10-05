# Non-browser clients: shared credential and the MCP write boundary

## Status

Accepted. Supersedes one clause of
[0009](0009-assistant-cloud-chat-suggest-only.md) — "there are no write
tools" narrows to "the *in-app Assistant* has no write tools" — in the
same way that record superseded clauses of
[0005 (Assist)](0005-assist-local-suggest-only-ephemeral.md). ADR 0009
itself is left unedited: the history of why the stance changed is the
point. Cross-references [0002](0002-single-user-no-auth.md) and
[0005 (gate)](0005-single-user-authentication-gate.md) for the
single-user premise this record rests on. (The other
[0005](0005-assist-local-suggest-only-ephemeral.md) is the Assist
record, cited as the thing ADR 0009 narrowed — filenames, not bare
numbers, disambiguate the two.)

## Context

tuk-tuk is reachable from two non-browser clients sharing one package
(`cli/oci/`): `tuk`, a command-line client for the daily loop, and
`tuk-mcp`, a local MCP server exposing the owner's data to whichever AI
client they already use. Both talk HTTP only to the existing API; both
cache the same session (see Glossary: Session file).

Three of the decisions below are genuinely counter-intuitive, and each
has a specific failure mode if left unrecorded: a contributor adds a
token system nobody needs; a contributor adds a delete tool to the MCP
server because nothing stopped them; a contributor "unifies" the CLI's
strict name matching with the backend's lenient phrase resolver and
turns a typo into a silent write to the wrong List.

## Decision: non-browser clients share the browser's credential

A client posts the password to the existing login endpoint and caches
the resulting signed session cookie. No API tokens, no bearer scheme, no
middleware change, no schema change. The rolling reissue the middleware
already performs keeps an actively-used session alive, so a working
client re-authenticates roughly never. The password is never written to
disk; the session file is created with owner-only permissions.

This is acceptable precisely because the app is single-user (ADR 0002,
ADR 0005) and because the clients run on the owner's own machine. There
is exactly one legitimate user, so per-client identity buys nothing, and
a stolen session file is reachable only to someone already on the
machine — at which point the threat model has larger problems than a
task list.

Rejected: per-client API tokens with a new table and a `Bearer` branch
in the middleware. It buys per-client revocation and an audit trail,
neither of which has a user yet, at the cost of a migration, new
endpoints, a Settings surface, and its own record. Scoped per-client
tokens are the recorded upgrade path for when a client stops running on
a trusted local machine — not part of this work.

Rejected: sending the password on every request. Argon2id verification
and the deliberate login delay make that slow by construction, and it
would put the password in every shell's environment.

## Decision: ADR 0009's write-tool clause narrows to the in-app Assistant

ADR 0009's load-bearing claim was deliberately absolute: there are no
write tools, structurally rather than instructionally, because a model
that cannot call a write endpoint cannot write. That claim now governs
the surface it was written for — the Assistant view inside the app —
and the MCP server is outside it.

The distinction it rests on: ADR 0009 governs a surface inside the app,
where a model is handed an automatically-assembled payload for a view
the owner opened and never saw the prompt for. The MCP server is driven
turn by turn by the owner's explicit instruction in a client they chose.
Automatic-and-broad egress with model-chosen writes is a different shape
from user-initiated-and-narrow egress with owner-directed writes, and
one rule cannot serve both without banning the second.

The restriction that earns its keep across both is *no
model-initiated destruction*, and it is preserved exactly: everything
the MCP write set admits is undone by hand in seconds (see below), and
deletion is absent from it entirely.

## Decision: the MCP write set is a principle, not a list

Tools are admitted by the principle **idempotent, non-destructive, and
scoped to Tasks and Habits** — not by membership in a fixed roster. A
principle can be applied to the next proposed addition; a list can only
be argued about.

The list needed amending on day one, which is why this is stated as a
principle: the Habit check-in tool arrived before the first eight Task
tools were cold, admitted by the rule rather than by precedent. Judge
the next proposed addition the same way: day-keyed and repeat-harmless
like a check-in qualifies; anything destructive or outside Task-or-Habit
scope does not, whatever the precedent list contains by then.

## Decision: the tool list is the enforcement boundary

The server process holds the full session cookie, so every endpoint is
technically within reach; what constrains the model is that no tool
exists for anything outside the write set. That is structural with
respect to the model — a model cannot call what it cannot see — and
*not* structural with respect to a bug or a compromised binary, against
which it offers nothing.

This is acceptable only because the server runs as a local subprocess
under the owner's own user (stdio transport, no listener, no network
surface). A network transport would reopen both this decision and the
credential decision above, and needs its own record. The code carries a
load-bearing comment saying so, and the roster is pinned by a test that
fails on any silent addition or removal — a boundary that lives only in
prose is a boundary somebody widens by accident.

## Decision: the CLI deletes; the MCP server has no delete tool

The CLI gets a delete command — `tuk rm`, taking a Task id behind a
confirmation prompt — and the MCP server has no delete tool of any kind
and will not gain one. Without this clause the asymmetry reads as an
inconsistency somebody should tidy up. It is a decision, not an
oversight.

The CLI half is a decision recorded ahead of its implementation, not a
description of shipped behaviour: `tuk rm` is its own piece of work and
the command does not exist yet. What is settled here is that when it
lands it lands on the CLI alone.

The gate is whether a language model is choosing the operation, not
whether the endpoint is dangerous. A human typing a delete command with
an explicit id has demonstrated intent in a way a model emitting a tool
call has not. Deletion is the one operation a confirmation click does
not really protect, because the click that matters is the one made
without reading the card — and a model never reads the card at all.

## Decision: Task descriptions go to the MCP model

ADR 0009 excludes Task `description` bodies and Check Item text from
the Assistant's snapshot by construction: a planner needs to know what
and when, and the substance of a task is where the genuinely private
text lives. The MCP server sends descriptions anyway.

This is recorded as a real narrowing of that privacy stance, justified
by the same asymmetry that justifies write tools at all:
automatic-and-broad versus user-initiated-and-narrow egress. The
in-app snapshot fires on every turn of a view the owner opened; the MCP
read answers a question the owner is pointing at, in a client they
chose, about data they are already discussing. Flagged as the most
contestable decision in this set: it should not be widened further
without reading this paragraph first.

## Decision: the CLI takes flags, not the sigil grammar

`tuk add` takes explicit `--list`, `--tag`, `--due` flags rather than
the Quick-Add sigil grammar (`~list`, `#tag`, `@date`). The grammar has
one implementation, in the frontend, and a cheap second one drifts
silently — two parsers agreeing today is no guarantee they agree after
the next grammar change. Porting the grammar to the backend, where both
consumers could share it, is the right eventual answer and separate
work. The MCP server likewise takes structured arguments and never a
free-text capture string: a model is better at filling declared fields
than at inventing a syntax.

The related strictness is deliberate in the other direction: the CLI
resolves a typed List or Tag name by exact case-insensitive match and
never creates what does not exist — it reuses the backend's lenient
phrase resolver *nowhere*. That resolver's whole-word containment
fallback is correct for a language model guessing a List from prose,
and wrong for an argument a human typed, where a loose match turns a
typo into a silent write to the wrong List.

## Considered options (and why they were rejected)

- **Per-client API tokens now.** Rejected — see the credential decision;
  the recorded upgrade path, not this change.
- **No MCP write tools at all (hold ADR 0009 absolute).** Rejected — it
  preserves the letter at the cost of the use case: acting on a plan
  made in conversation means retyping it by hand, which is the problem
  the server exists to solve. The preserved invariant is no
  model-initiated destruction, not no writes.
- **A fixed write-tool roster instead of a principle.** Rejected — the
  roster needed amending on day one; a list that cannot survive its
  first addition was never the right form for the rule.
- **A delete tool guarded by model-side confirmation.** Rejected — a
  confirmation the model narrates to itself constrains nothing; see the
  asymmetry decision.
- **Withholding descriptions from the MCP model (hold ADR 0009's
  egress stance absolute).** Rejected — a planner that cannot see what
  the owner wrote cannot answer "what did I mean by this"; the egress
  asymmetry above is what makes the narrowing honest rather than
  convenient.
- **Sharing the sigil grammar with the CLI now.** Rejected — a second
  implementation to keep in step, for input a flag set already covers.
- **A composite Agenda endpoint on the backend.** Rejected — the Agenda
  is composed client-side from existing endpoints; promoting it
  server-side is a measured optimisation if round trips ever hurt, not
  an opening move.

## Accepted trade-offs

- The MCP server's privacy posture is weaker than the in-app
  Assistant's by construction: descriptions egress to a model the app
  does not operate, under a provider configuration the app does not
  see. The owner opts into this by registering the server; the trade-off
  is theirs, not a surprise.
- The tool-list boundary trusts the local machine. A compromised owner
  account or a malicious binary beside the server bypasses it entirely
  — but so do they bypass everything else, including the browser's own
  cookie jar.
- The CLI duplicates thin request models rather than importing the
  backend's schemas, so installing it never pulls in the database
  stack. That duplication is the accepted price of the decoupling.

## What would justify revisiting this

A client running anywhere other than the owner's own machine — a
network-transport MCP deployment, a hosted CLI — reopens the credential
decision and the enforcement-boundary decision together, and needs its
own record. A second non-frontend grammar consumer is the moment to
revisit porting the sigil grammar to the backend. Evidence that
client-side Agenda composition measurably hurts is the moment to promote
it server-side.
