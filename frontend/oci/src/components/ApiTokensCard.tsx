import { useEffect, useRef, useState } from "react";

import {
  ApiError,
  type ApiToken,
  type ApiTokenKind,
  createApiToken,
  fetchApiTokens,
  revokeApiToken,
} from "../api";
import { formatDate, formatTimeAgo } from "../dates";
import { Modal } from "./Modal";

// Mirrors the backend's token name rule (#413): stripped, 1 to 100.
const MAX_TOKEN_NAME_LENGTH = 100;
const NAME_RULE = `Name must be 1 to ${MAX_TOKEN_NAME_LENGTH} characters.`;
const NAME_ERROR_ID = "api-token-name-error";

/** What each kind of token is used by (#525). */
const KIND_LABELS: Record<ApiTokenKind, string> = { mcp: "MCP server", api: "API" };
const KIND_CHOICES: { kind: ApiTokenKind; label: string; hint: string }[] = [
  {
    kind: "api",
    label: "Other clients (API)",
    hint: "Scripts and clients that call Tuk Tuk's API directly.",
  },
  {
    kind: "mcp",
    label: "MCP server",
    hint: "Your AI client, through the shared Tuk Tuk MCP server. Works nowhere else.",
  },
];

function lastUsed(token: ApiToken): string {
  return token.last_used_at === null
    ? "Never used"
    : `Last used ${formatTimeAgo(new Date(token.last_used_at))}`;
}

/** A token just created, with the value the server returns only once. */
interface FreshToken {
  id: number;
  value: string;
}

/** The new token's value with Copy, shown in place of its row. Copy
 * confirms on the button; where the clipboard is unavailable or refused it
 * selects the value so it can be copied by hand. */
function FreshTokenValue({ name, value }: { name: string; value: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const valueRef = useRef<HTMLElement>(null);

  function selectValue(): void {
    if (valueRef.current !== null) {
      window.getSelection()?.selectAllChildren(valueRef.current);
    }
  }

  function copy(): void {
    if (navigator.clipboard === undefined) {
      selectValue();
      return;
    }
    navigator.clipboard.writeText(value).then(() => setCopied(true), selectValue);
  }

  return (
    <>
      <div className="api-token-new-head">
        <h3>{name}</h3>
        <span className="api-token-badge">New</span>
      </div>
      <div className="api-token-value">
        <code ref={valueRef}>{value}</code>
        <button type="button" className="btn-secondary" onClick={copy} autoFocus>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="settings-hint">Copy it now. This is the only time the token is shown.</p>
    </>
  );
}

interface NewTokenFormProps {
  onCreated: (token: ApiToken, value: string) => void;
  onCancel: () => void;
}

/** Asks for the token's name, so the User can tell tokens apart, and what
 * it is used by. Escape or Cancel closes it without a request. */
function NewTokenForm({ onCreated, onCancel }: NewTokenFormProps): JSX.Element {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ApiTokenKind>("api");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // After the render that re-enables the field: a disabled input can't take
  // focus.
  useEffect(() => {
    if (error !== null) {
      inputRef.current?.focus();
    }
  }, [error]);

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (pending) {
      return;
    }
    const trimmed = name.trim();
    if (trimmed === "" || trimmed.length > MAX_TOKEN_NAME_LENGTH) {
      setError(NAME_RULE);
      return;
    }
    setPending(true);
    setError(null);
    createApiToken(trimmed, kind)
      .then(({ token, ...listed }) => onCreated(listed, token))
      .catch((err: unknown) => {
        setPending(false);
        setError(
          err instanceof ApiError && err.code === "invalid_token_name"
            ? NAME_RULE
            : "Something went wrong. Try again.",
        );
      });
  }

  return (
    <form
      className="settings-field api-token-form"
      onSubmit={handleSubmit}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !pending) {
          event.preventDefault();
          onCancel();
        }
      }}
      noValidate
    >
      <label htmlFor="api-token-name">Token name</label>
      <div className="profile-field-row">
        <input
          ref={inputRef}
          id="api-token-name"
          name="token-name"
          autoComplete="off"
          autoFocus
          value={name}
          disabled={pending}
          aria-invalid={error !== null || undefined}
          aria-describedby={error !== null ? NAME_ERROR_ID : undefined}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
        />
        <button type="submit" className="btn-secondary" disabled={pending}>
          Create
        </button>
        <button type="button" className="btn-quiet" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
      </div>
      {error !== null && (
        <p role="alert" id={NAME_ERROR_ID}>
          {error}
        </p>
      )}
      <fieldset className="api-token-kind" role="radiogroup" aria-label="Used by">
        <legend>Used by</legend>
        {KIND_CHOICES.map((choice) => (
          <div key={choice.kind} className="api-token-kind-choice">
            <label>
              <input
                type="radio"
                name="token-kind"
                value={choice.kind}
                checked={kind === choice.kind}
                disabled={pending}
                aria-describedby={`api-token-kind-${choice.kind}-hint`}
                onChange={() => setKind(choice.kind)}
              />
              {choice.label}
            </label>
            <p className="settings-hint" id={`api-token-kind-${choice.kind}-hint`}>
              {choice.hint}
            </p>
          </div>
        ))}
      </fieldset>
    </form>
  );
}

/** Settings › My account's API tokens card (#476): tokens for clients such
 * as the MCP server acting as the signed-in User. A new token's value lives
 * only in this component's state: never stored, gone when the page is left
 * or another token is created. */
export function ApiTokensCard(): JSX.Element {
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState<FreshToken | null>(null);
  const newTokenButton = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState<ApiToken | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    fetchApiTokens().then(
      (page) => {
        if (current) setTokens(page.items);
      },
      () => {
        if (current) setLoadFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [loadAttempt]);

  function retryLoad(): void {
    setLoadFailed(false);
    setLoadAttempt((attempt) => attempt + 1);
  }

  function handleCreated(token: ApiToken, value: string): void {
    setTokens((previous) => [token, ...(previous ?? [])]);
    setFresh({ id: token.id, value });
    setCreating(false);
  }

  function handleCancel(): void {
    setCreating(false);
    newTokenButton.current?.focus();
  }

  function remove(token: ApiToken): void {
    setTokens((previous) => (previous ?? []).filter((other) => other.id !== token.id));
    newTokenButton.current?.focus();
  }

  /** A 404 means the token no longer works anyway (revoked elsewhere), so it
   * leaves the list just the same. */
  function revoke(token: ApiToken): void {
    setRevokeError(null);
    revokeApiToken(token.id)
      .then(() => remove(token))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) {
          remove(token);
          return;
        }
        setRevokeError(`Couldn’t revoke ${token.name}. Try again.`);
      });
  }

  return (
    <section aria-label="API tokens" id="settings-api-tokens" className="settings-section">
      <div className="settings-section-head">
        <h2>API tokens</h2>
        <button
          ref={newTokenButton}
          type="button"
          className="btn-secondary"
          onClick={() => setCreating(true)}
        >
          New token
        </button>
      </div>
      <p className="settings-lead">For the MCP server and other clients acting as you.</p>
      {creating && <NewTokenForm onCreated={handleCreated} onCancel={handleCancel} />}
      {loadFailed && (
        <div className="api-token-load-error">
          <p role="alert">Couldn’t load your tokens.</p>
          <button type="button" className="btn-secondary" onClick={retryLoad}>
            Retry
          </button>
        </div>
      )}
      {tokens !== null && tokens.length === 0 && (
        <p className="settings-hint">
          No tokens yet. Create one to connect the MCP server or another client to your account.
        </p>
      )}
      {tokens !== null && tokens.length > 0 && (
        <ul className="api-tokens">
          {tokens.map((token) =>
            fresh?.id === token.id ? (
              <li key={token.id} className="api-token api-token-new">
                <FreshTokenValue name={token.name} value={fresh.value} />
              </li>
            ) : (
              <li key={token.id} className="api-token">
                <div>
                  <h3>{token.name}</h3>
                  <p className="settings-hint">
                    {KIND_LABELS[token.kind]} · <code>{token.prefix}</code> · Created{" "}
                    {formatDate(new Date(token.created_at), "date")} · {lastUsed(token)}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  aria-label={`Revoke ${token.name}`}
                  onClick={() => setConfirming(token)}
                >
                  Revoke
                </button>
              </li>
            ),
          )}
        </ul>
      )}
      {revokeError !== null && (
        <p role="alert" className="api-token-error">
          {revokeError}
        </p>
      )}
      {confirming !== null && (
        <Modal title={`Revoke ${confirming.name}?`} onClose={() => setConfirming(null)}>
          <p className="api-token-confirm-lead">
            Clients using this token stop working at once. This can’t be undone.
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
                revoke(confirming);
              }}
            >
              Revoke token
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
