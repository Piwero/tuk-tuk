import "./GitHubSettingsPanel.css";

import { useEffect, useState } from "react";

import {
  ApiError,
  createGitHubToken,
  deleteGitHubToken,
  fetchGitHubTokens,
  type GitHubToken,
  reconnectGitHubToken,
} from "../api";
import { formatDate } from "../dates";
import { githubOwnerName, githubTokenName, UNKNOWN_GITHUB_OWNER } from "../githubOwner";
import { GitHubRepositoryPicker } from "./GitHubRepositoryPicker";
import { GitHubTokenExpiryWarning } from "./GitHubTokenBanners";
import { Modal } from "./Modal";

/** Codes whose server message already tells the User what went wrong and
 * what to do next (#578). Anything else gets the generic retry line. */
const EXPLAINED_CODES = new Set([
  "github_token_not_fine_grained",
  "github_token_rejected",
  "github_unavailable",
  "github_token_owner_exists",
  "github_token_owner_mismatch",
  "github_token_owner_unknown",
]);

function describeToken(token: GitHubToken): string {
  const kind =
    token.owner_kind === null
      ? UNKNOWN_GITHUB_OWNER
      : token.owner_kind === "organization"
        ? "Organization"
        : "Your account";
  const expiry =
    token.expires_at === null
      ? "No expiry"
      : `Expires ${formatDate(new Date(token.expires_at), "date")}`;
  return `${kind} · ${expiry}`;
}

/** Pastes a fine-grained token; it is checked with GitHub before it is
 * saved, so a mistyped, classic or rejected token is explained here and
 * never listed. Adds a new GitHub Token, or reconnects one (#584). */
function TokenForm({
  id,
  label,
  submitLabel,
  submit,
  onSaved,
  onCancel,
}: {
  id: string;
  label: string;
  submitLabel: string;
  submit: (token: string) => Promise<GitHubToken>;
  onSaved: (token: GitHubToken) => void;
  onCancel?: () => void;
}): React.JSX.Element {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorId = `${id}-error`;

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (pending || value.trim() === "") {
      return;
    }
    setPending(true);
    setError(null);
    submit(value.trim())
      .then((token) => {
        setValue("");
        onSaved(token);
      })
      .catch((err: unknown) => {
        setError(
          err instanceof ApiError && EXPLAINED_CODES.has(err.code)
            ? err.message
            : "Something went wrong. Try again.",
        );
      })
      .finally(() => setPending(false));
  }

  return (
    <form className="settings-field" onSubmit={handleSubmit} noValidate>
      <label htmlFor={id}>{label}</label>
      <div className="profile-field-row">
        <input
          id={id}
          name="github-token"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="github_pat_…"
          value={value}
          disabled={pending}
          aria-invalid={error !== null || undefined}
          aria-describedby={error !== null ? errorId : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
        />
        <button type="submit" className="btn-secondary" disabled={pending || value.trim() === ""}>
          {pending ? "Checking…" : submitLabel}
        </button>
        {onCancel !== undefined && (
          <button type="button" className="btn-quiet" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      {error !== null && (
        <p role="alert" id={errorId}>
          {error}
        </p>
      )}
    </form>
  );
}

/** Settings › GitHub (#578, ADR 0020): the User's GitHub Tokens, one per
 * GitHub owner (themselves or an organisation). tuk-tuk only ever reads
 * GitHub with them. */
export function GitHubSettingsPanel(): React.JSX.Element {
  const [tokens, setTokens] = useState<GitHubToken[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [confirming, setConfirming] = useState<GitHubToken | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState<number | null>(null);

  useEffect(() => {
    let current = true;
    fetchGitHubTokens().then(
      (fetched) => {
        if (current) setTokens(fetched);
      },
      () => {
        if (current) setLoadFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, []);

  function replace(token: GitHubToken): void {
    setTokens((previous) =>
      (previous ?? []).map((other) => (other.id === token.id ? token : other)),
    );
    setReconnecting(null);
  }

  function forget(token: GitHubToken): void {
    setTokens((previous) => (previous ?? []).filter((other) => other.id !== token.id));
  }

  /** A 404 means it is already gone (removed in another tab). */
  function remove(token: GitHubToken): void {
    setRemoveError(null);
    deleteGitHubToken(token.id)
      .then(() => forget(token))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) {
          forget(token);
          return;
        }
        setRemoveError(`Couldn’t remove ${githubTokenName(token.owner_login)}. Try again.`);
      });
  }

  return (
    <>
      <section aria-label="GitHub Tokens" id="settings-github" className="settings-section">
        <div className="settings-section-head">
          <h2>GitHub Tokens</h2>
        </div>
        <p className="settings-lead">
          Paste a fine-grained personal access token with read-only access to Metadata, Issues and
          Pull requests. Add one token for your own repositories and one per organisation. Tuk Tuk
          never writes to GitHub.
        </p>
        <GitHubTokenExpiryWarning tokens={tokens ?? []} />
        <TokenForm
          id="github-token-value"
          label="GitHub Token"
          submitLabel="Add token"
          submit={createGitHubToken}
          onSaved={(token) => setTokens((previous) => [...(previous ?? []), token])}
        />
        {loadFailed && <p role="alert">Couldn’t load your GitHub Tokens.</p>}
        {tokens !== null && tokens.length === 0 && (
          <p className="settings-hint">No GitHub Tokens yet.</p>
        )}
        {tokens !== null && tokens.length > 0 && (
          <ul className="api-tokens" aria-label="GitHub Tokens">
            {tokens.map((token) => (
              <li key={token.id} className="api-token">
                <div>
                  <h3>{githubOwnerName(token.owner_login)}</h3>
                  <p className="settings-hint">{describeToken(token)}</p>
                  {token.owner_login === null && (
                    <p className="settings-hint">
                      GitHub can’t tell whose repositories this token is for until it can read one.
                      An organisation may need to allow or approve fine-grained tokens: check the
                      organisation’s settings on GitHub.
                    </p>
                  )}
                  {token.connection_state === "needs_reconnect" && (
                    <p role="alert">
                      GitHub no longer accepts this token. Reconnect it with a replacement for{" "}
                      {token.owner_login ?? "the same owner"}.
                    </p>
                  )}
                  {reconnecting === token.id && (
                    <TokenForm
                      id={`github-token-reconnect-${token.id}`}
                      label={`Replacement token for ${githubOwnerName(token.owner_login)}`}
                      submitLabel="Reconnect"
                      submit={(value) => reconnectGitHubToken(token.id, value)}
                      onSaved={replace}
                      onCancel={() => setReconnecting(null)}
                    />
                  )}
                </div>
                <div className="github-token-actions">
                  {reconnecting !== token.id && (
                    <button
                      type="button"
                      className="btn-secondary"
                      aria-label={`Reconnect GitHub Token for ${githubOwnerName(token.owner_login)}`}
                      onClick={() => setReconnecting(token.id)}
                    >
                      Reconnect
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-secondary"
                    aria-label={`Remove GitHub Token for ${githubOwnerName(token.owner_login)}`}
                    onClick={() => setConfirming(token)}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {removeError !== null && <p role="alert">{removeError}</p>}
        {confirming !== null && (
          <Modal
            title={`Remove ${githubTokenName(confirming.owner_login)}?`}
            onClose={() => setConfirming(null)}
          >
            <p className="api-token-confirm-lead">
              Its Watched Repositories are deleted and dropped from every Repository View. Tuk Tuk
              stops reading {confirming.owner_login ?? "its owner"}’s repositories. You can add a
              token again later.
            </p>
            <div className="api-token-confirm-actions">
              <button
                type="button"
                className="btn-secondary"
                autoFocus
                onClick={() => setConfirming(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary api-token-confirm-danger"
                onClick={() => {
                  setConfirming(null);
                  remove(confirming);
                }}
              >
                Remove token
              </button>
            </div>
          </Modal>
        )}
      </section>
      <GitHubRepositoryPicker tokens={tokens ?? []} />
    </>
  );
}
