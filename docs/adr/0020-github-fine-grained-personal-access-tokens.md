# GitHub access through fine-grained personal access tokens

## Status

Accepted. Spec: issue #576; first ticket #578. Conforms to
[0006](0006-google-calendar-read-only-live-fetch.md),
[0007](0007-google-calendar-failure-isolation-and-freshness.md),
[0008](0008-ui-managed-settings.md) and
[0018](0018-multi-user-row-level-isolation.md).

## Context

The GitHub view lists a User's open Pull Requests and open GitHub Issues
across the repositories they and their organisations own. tuk-tuk only ever
reads GitHub. It never comments, labels, merges or closes anything.

Google Calendar set the precedent for reaching a third party: each User
registers their own OAuth client and goes through a consent flow. For
GitHub, that precedent does not fit:

- A GitHub **OAuth app** has no read-only scope for private repositories.
  The `repo` scope that unlocks them also grants write access to code,
  issues and pull requests. A read-only feature would hold write access to
  everything the User can reach.
- A **GitHub App** offers fine-grained, read-only permissions, but each User
  of a self-hosted instance would have to register an app, generate and
  store a private key, install it on each organisation and expose a callback
  URL. That is far more setup than the feature is worth.

GitHub's **fine-grained personal access tokens** give exactly the
permissions the view needs. They are read-only *Metadata*, *Issues* and
*Pull requests* on a chosen set of repositories. There is no callback URL,
no app registration and no consent flow.

## Decision: a User pastes fine-grained tokens, one per GitHub owner

A User adds **GitHub Tokens** in Settings → GitHub. tuk-tuk accepts only
fine-grained tokens. Anything that does not look like one (`github_pat_`
prefix) is refused before it is sent anywhere. A token GitHub reports as
classic is refused too. Each pasted token is checked with GitHub before it
is saved. tuk-tuk learns which owner the token grants access to (the User
or one organisation, when GitHub can tell; see below) and when it expires.
A token GitHub rejects (401) is not saved. A transient failure while
checking is reported as retryable, and nothing is saved.

A fine-grained token is limited to one resource owner, so a User holds one
GitHub Token per owner. They can have one for their own repositories and
one per organisation. A second token for an owner already covered is
refused. Replacing a token for the same owner (reconnect) keeps what was
built on it.

## Decision: a token's owner is learned from what it reads, or left unknown

GitHub names a fine-grained token's resource owner nowhere. `GET /user`
names the User who created the token, not its owner, and no response
header carries it. Every fine-grained token can also read all public
repositories on GitHub. So the adapter infers the owner from
`GET /user/repos`: the one owner of the private repositories the token
reads (only the owner's private repositories are readable through it),
or, when it reads no private one, the one owner of every repository it
reads. When the token reads no repository, or public repositories of
several owners, the owner is **unknown**. It is never guessed, and in
particular never taken to be the token's User.

This matters for an organisation that has not yet allowed or approved
fine-grained tokens. Its token is valid but reads nothing until then.
Naming it after the User would collide with their own token (refused as
a second token for that owner) and would later refuse the approved token
on Reconnect as an owner mismatch. Instead:

- A token with an unknown owner is saved without one. Settings lists it
  as "Owner not known yet" and says an organisation may need to allow or
  approve fine-grained tokens. One-per-owner does not apply to it.
- Each time the Watched Repositories picker reads such a token and it
  now reads repositories, tuk-tuk asks GitHub again and records the owner,
  unless another GitHub Token already covers that owner. Then it stays
  unknown, and the User removes one of the two.
- Reconnecting a token with an unknown owner takes the replacement's
  owner, refused only if another GitHub Token already covers it.
  Reconnecting a token with a known owner refuses a replacement whose
  owner is unknown (`github_token_owner_unknown`): it cannot be shown to
  be for the same owner. The User tries again once the organisation has
  approved the new token.

All GitHub traffic goes through one injected `GitHubSource` Protocol
(`app.github_source`). The real adapter is `app.github_adapter`. Tests
substitute a fake, the same way they do for the calendar source.

## Decision: it follows the existing integration ADRs

- **ADR 0006 (live read, no mirror).** Pull Requests and GitHub Issues are
  read live from GitHub and never persisted. Only an in-process cache holds
  them: 60 seconds, plus up to 10 minutes of last-good data served as stale
  during a transient failure. That cache stays in memory, consistent with
  the single-replica constraint.
- **ADR 0007 (per-credential failure isolation).** Every GitHub failure is
  either transient (rate limit, including GitHub's 403 rate-limit answers,
  429, 5xx, network) or terminal (401: revoked, expired or invalid). A
  terminal failure flips only that GitHub Token to `needs_reconnect`, and a
  later successful read flips it back. A transient one never touches
  `connection_state`. One failing token shows a
  banner for that token while the others' repositories still render.
- **ADR 0008 (UI-managed settings).** The instance needs no GitHub
  configuration at all: no environment variables, no app registration.
- **ADR 0018 (per-User credentials).** Each User brings their own GitHub
  Tokens. Every GitHub table carries its owner id, and the tokens are
  encrypted at rest with `APP_MASTER_KEY`. No API response ever returns a
  token.

## Considered options

- **A User-registered GitHub OAuth app.** Rejected. `repo` is the only
  scope that reaches private repositories, and it implies write access.
- **A User-registered GitHub App.** Rejected. It gives the right
  permissions but costs each User an app registration, a private key, an
  installation per organisation and a public callback URL.
- **Classic personal access tokens.** Rejected. They have the same
  all-or-nothing `repo` scope as an OAuth app.

## Accepted trade-offs

- One token per owner. A User with three organisations pastes four tokens.
- Rotation. Fine-grained tokens expire, so tuk-tuk shows each token's expiry
  and warns before it lapses. The User pastes a replacement for the same
  owner.
- An organisation may need to allow fine-grained tokens, or approve each
  one, before its repositories become readable. Until then its token's
  owner is unknown, and a rotated token for it cannot be reconnected.
- github.com only. GitHub Enterprise Server hosts are out of scope.

## What would justify revisiting this

- GitHub adds a read-only OAuth scope for private repositories.
- tuk-tuk needs to write to GitHub, or to receive webhooks. Either needs a
  GitHub App.
- Enough Users manage so many organisations that one token per owner
  becomes the main source of friction.
