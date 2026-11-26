"""GitHub: GitHub Tokens (issue #578, spec #576, ADR 0020).

A User pastes a fine-grained personal access token; it is checked with
GitHub before it is saved, encrypted with the master key, and listed by the
GitHub owner it grants access to. The token itself is write-only: no
response ever carries it.
"""

from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select

from app.crypto import decrypt_credential, encrypt_credential
from app.db import SessionDep
from app.errors import APIError, NotFoundError
from app.github_source import (
    GitHubRepository,
    GitHubSource,
    GitHubTokenIdentity,
    TerminalGitHubSourceError,
    TransientGitHubSourceError,
)
from app.models import GitHubToken, WatchedRepository

router = APIRouter(prefix="/api/v1/github", tags=["github"])

FINE_GRAINED_PREFIX = "github_pat_"
# How long before a GitHub Token expires the User is warned (spec #576).
EXPIRY_WARNING = timedelta(days=7)


def expires_soon(expires_at: datetime | None, now: datetime) -> bool:
    """Whether a GitHub Token expiring at `expires_at` is within the expiry
    warning, or already expired. A token without an expiry never is."""
    return expires_at is not None and expires_at - now <= EXPIRY_WARNING


class GitHubTokenCreate(BaseModel):
    token: str = Field(min_length=1, max_length=1024)


class GitHubTokenRead(BaseModel):
    id: int
    owner_login: str
    owner_kind: str
    expires_at: datetime | None
    expires_soon: bool
    connection_state: str
    created_at: datetime

    @classmethod
    def of(cls, row: GitHubToken, request: Request) -> "GitHubTokenRead":
        return cls(
            id=row.id,
            owner_login=row.owner_login,
            owner_kind=row.owner_kind,
            expires_at=row.expires_at,
            expires_soon=expires_soon(row.expires_at, request.app.state.clock()),
            connection_state=row.connection_state,
            created_at=row.created_at,
        )


def _not_fine_grained_error() -> APIError:
    return APIError(
        422,
        "github_token_not_fine_grained",
        "tuk-tuk accepts only fine-grained personal access tokens (they start with "
        "github_pat_). Create one with read-only access to Metadata, Issues and "
        "Pull requests.",
    )


@router.get("/tokens")
async def list_tokens(request: Request, session: SessionDep) -> list[GitHubTokenRead]:
    rows = await session.scalars(select(GitHubToken).order_by(GitHubToken.id))
    return [GitHubTokenRead.of(row, request) for row in rows]


async def _validate(request: Request, token: str) -> GitHubTokenIdentity:
    """Checks a pasted token with GitHub before anything is saved: only a
    fine-grained token GitHub accepts gets through."""
    # GitHub's own prefix for fine-grained tokens: anything else is refused
    # before it is ever sent to GitHub.
    if not token.startswith(FINE_GRAINED_PREFIX):
        raise _not_fine_grained_error()
    github_source: GitHubSource = request.app.state.github_source
    try:
        identity = await github_source.identify_token(token)
    except TerminalGitHubSourceError:
        raise APIError(
            422,
            "github_token_rejected",
            "GitHub rejected this token: it may be mistyped, expired or revoked.",
        ) from None
    except TransientGitHubSourceError:
        raise APIError(
            502,
            "github_unavailable",
            "GitHub could not be reached to check this token. Nothing was saved; "
            "try again in a moment.",
        ) from None
    if identity.token_type != "fine_grained":
        raise _not_fine_grained_error()
    return identity


def _encrypt(request: Request, token: str) -> str:
    settings = request.app.state.settings
    assert settings.app_master_key is not None  # app.main refuses to start without it
    return encrypt_credential(token, key=settings.app_master_key)


@router.post("/tokens", status_code=201)
async def add_token(
    payload: GitHubTokenCreate, request: Request, session: SessionDep
) -> GitHubTokenRead:
    token = payload.token.strip()
    identity = await _validate(request, token)

    # GitHub logins are case-insensitive; one GitHub Token per owner.
    existing = await session.scalar(
        select(GitHubToken).where(
            func.lower(GitHubToken.owner_login) == identity.owner_login.lower()
        )
    )
    if existing is not None:
        raise APIError(
            409,
            "github_token_owner_exists",
            f"You already have a GitHub Token for {identity.owner_login}. "
            "Reconnect it to use a different one.",
        )

    row = GitHubToken(
        owner_login=identity.owner_login,
        owner_kind=identity.owner_kind,
        encrypted_token=_encrypt(request, token),
        expires_at=identity.expires_at,
        connection_state="connected",
    )
    session.add(row)
    await session.commit()
    return GitHubTokenRead.of(row, request)


@router.patch("/tokens/{token_id}")
async def reconnect_token(
    token_id: int, payload: GitHubTokenCreate, request: Request, session: SessionDep
) -> GitHubTokenRead:
    """Reconnect: replaces the token on an existing GitHub Token in place
    with a replacement for the same owner, so its Watched Repositories
    survive a rotation (issue #584)."""
    row = await session.get(GitHubToken, token_id)
    if row is None:
        raise NotFoundError(f"GitHub Token {token_id} not found")
    token = payload.token.strip()
    identity = await _validate(request, token)
    # A replacement must grant access to the same owner, or the Watched
    # Repositories it keeps would be read through someone else's access.
    if identity.owner_login.lower() != row.owner_login.lower():
        raise APIError(
            422,
            "github_token_owner_mismatch",
            f"This token grants access to {identity.owner_login}, not "
            f"{row.owner_login}. Paste a token for {row.owner_login}, or add it as a "
            "new GitHub Token.",
        )
    row.encrypted_token = _encrypt(request, token)
    row.expires_at = identity.expires_at
    row.connection_state = "connected"
    await session.commit()
    return GitHubTokenRead.of(row, request)


class AccessibleRepositoryRead(BaseModel):
    github_repo_id: int
    full_name: str
    private: bool
    github_token_id: int
    watched_repository_id: int | None


class PickerTokenRead(BaseModel):
    """How one GitHub Token fared in the picker. A token that validated
    but reads no repositories usually belongs to an organisation that has
    not yet allowed or approved fine-grained tokens."""

    id: int
    owner_login: str
    # "ok"; "unavailable" when GitHub had a transient problem (the token
    # stays connected); "needs_reconnect" when GitHub rejected the token.
    status: Literal["ok", "unavailable", "needs_reconnect"]
    repository_count: int


class RepositoryPickerRead(BaseModel):
    repositories: list[AccessibleRepositoryRead]
    tokens: list[PickerTokenRead]


class WatchedRepositoryCreate(BaseModel):
    github_token_id: int
    github_repo_id: int


class WatchedRepositoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    github_token_id: int
    github_repo_id: int
    full_name: str
    private: bool
    created_at: datetime


async def _readable_repositories(request: Request, token: GitHubToken) -> list[GitHubRepository]:
    github_source: GitHubSource = request.app.state.github_source
    plaintext = decrypt_credential(
        token.encrypted_token, key=request.app.state.settings.app_master_key
    )
    return await github_source.list_accessible_repositories(plaintext)


@router.get("/repositories")
async def list_accessible_repositories(
    request: Request, session: SessionDep
) -> RepositoryPickerRead:
    """The Watched Repositories picker: every repository the User's GitHub
    Tokens can read, each marked with its Watched Repository if any."""
    watched = {row.github_repo_id: row for row in await session.scalars(select(WatchedRepository))}
    # Keyed by GitHub's repository id: a repository readable through two
    # tokens is offered once, through the first token that reads it.
    repositories: dict[int, AccessibleRepositoryRead] = {}
    tokens: list[PickerTokenRead] = []
    for token in (await session.scalars(select(GitHubToken).order_by(GitHubToken.id))).all():
        status: Literal["ok", "unavailable", "needs_reconnect"] = "ok"
        readable: list[GitHubRepository] = []
        # One token's failure never hides another token's repositories.
        try:
            readable = await _readable_repositories(request, token)
        except TransientGitHubSourceError:
            status = "unavailable"
        except TerminalGitHubSourceError:
            status = "needs_reconnect"
            token.connection_state = "needs_reconnect"
            await session.commit()
        tokens.append(
            PickerTokenRead(
                id=token.id,
                owner_login=token.owner_login,
                status=status,
                repository_count=len(readable),
            )
        )
        for repo in readable:
            existing = watched.get(repo.github_id)
            repositories.setdefault(
                repo.github_id,
                AccessibleRepositoryRead(
                    github_repo_id=repo.github_id,
                    full_name=repo.full_name,
                    private=repo.private,
                    github_token_id=existing.github_token_id if existing else token.id,
                    watched_repository_id=existing.id if existing else None,
                ),
            )
    return RepositoryPickerRead(repositories=list(repositories.values()), tokens=tokens)


@router.get("/watched-repositories")
async def list_watched_repositories(session: SessionDep) -> list[WatchedRepositoryRead]:
    rows = await session.scalars(
        select(WatchedRepository).order_by(func.lower(WatchedRepository.full_name))
    )
    return [WatchedRepositoryRead.model_validate(row) for row in rows]


@router.post("/watched-repositories", status_code=201)
async def watch_repository(
    payload: WatchedRepositoryCreate, request: Request, session: SessionDep
) -> WatchedRepositoryRead:
    token = await session.get(GitHubToken, payload.github_token_id)
    if token is None:
        raise NotFoundError(f"GitHub Token {payload.github_token_id} not found")
    already = await session.scalar(
        select(WatchedRepository).where(WatchedRepository.github_repo_id == payload.github_repo_id)
    )
    if already is not None:
        raise APIError(
            409,
            "github_repository_already_watched",
            f"You already watch {already.full_name}.",
        )
    try:
        readable = await _readable_repositories(request, token)
    except TerminalGitHubSourceError:
        token.connection_state = "needs_reconnect"
        await session.commit()
        raise APIError(
            422,
            "github_token_rejected",
            f"GitHub rejected the GitHub Token for {token.owner_login}: it may be "
            "expired or revoked. Reconnect it in Settings.",
        ) from None
    except TransientGitHubSourceError:
        raise APIError(
            502,
            "github_unavailable",
            "GitHub could not be reached. Nothing was saved; try again in a moment.",
        ) from None
    repo = next((r for r in readable if r.github_id == payload.github_repo_id), None)
    if repo is None:
        raise APIError(
            422,
            "github_repository_not_readable",
            f"The GitHub Token for {token.owner_login} cannot read that repository.",
        )
    row = WatchedRepository(
        github_token_id=token.id,
        github_repo_id=repo.github_id,
        full_name=repo.full_name,
        private=repo.private,
    )
    session.add(row)
    await session.commit()
    return WatchedRepositoryRead.model_validate(row)


@router.delete("/watched-repositories/{watched_id}", status_code=204)
async def unwatch_repository(watched_id: int, session: SessionDep) -> None:
    row = await session.get(WatchedRepository, watched_id)
    if row is None:
        raise NotFoundError(f"Watched Repository {watched_id} not found")
    await session.delete(row)
    await session.commit()


@router.delete("/tokens/{token_id}", status_code=204)
async def remove_token(token_id: int, session: SessionDep) -> None:
    row = await session.get(GitHubToken, token_id)
    if row is None:
        raise NotFoundError(f"GitHub Token {token_id} not found")
    await session.delete(row)
    await session.commit()
