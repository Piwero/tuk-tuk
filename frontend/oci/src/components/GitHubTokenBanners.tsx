import "./GitHubTokenBanners.css";

import type { GitHubTokenReadStatus } from "../api";
import { formatDate } from "../dates";
import { pathForSettingsTab } from "../routes";

/** One banner per GitHub Token that failed a GitHub view read (#584, ADR
 * 0007), naming its owner login, while every other token's items still
 * render. A token GitHub rejected offers Reconnect in Settings; one GitHub
 * couldn't be reached through only needs time. */
export function GitHubTokenBanners({
  tokens,
  onOpenSettings,
}: {
  tokens: GitHubTokenReadStatus[];
  onOpenSettings: () => void;
}): React.JSX.Element {
  const failing = tokens.filter((token) => token.status !== "ok");
  return (
    <>
      {failing.length > 0 && (
        <div className="github-banners" role="alert">
          {failing.map((token) =>
            token.status === "needs_reconnect" ? (
              <p key={token.id}>
                {`GitHub no longer accepts the GitHub Token for ${token.owner_login}, so its repositories aren’t shown. `}
                <SettingsLink onOpenSettings={onOpenSettings} />
              </p>
            ) : (
              <p key={token.id}>
                {`GitHub couldn’t be reached for ${token.owner_login}’s repositories. Try again in a moment.`}
              </p>
            ),
          )}
        </div>
      )}
      <GitHubTokenExpiryWarning tokens={tokens} onOpenSettings={onOpenSettings} />
    </>
  );
}

interface ExpiringToken {
  id: number;
  owner_login: string;
  expires_at: string | null;
  expires_soon: boolean;
}

function SettingsLink({ onOpenSettings }: { onOpenSettings: () => void }): React.JSX.Element {
  return (
    <a
      href={pathForSettingsTab("github")}
      onClick={(event) => {
        event.preventDefault();
        onOpenSettings();
      }}
    >
      Reconnect
    </a>
  );
}

/** Warns about each GitHub Token that expires within 7 days, or already
 * has (#584), so the GitHub view never breaks without notice. Outside
 * Settings, `onOpenSettings` adds a link to reconnect it there. */
export function GitHubTokenExpiryWarning({
  tokens,
  onOpenSettings,
}: {
  tokens: ExpiringToken[];
  onOpenSettings?: () => void;
}): React.JSX.Element | null {
  const expiring = tokens.filter((token) => token.expires_soon && token.expires_at !== null);
  if (expiring.length === 0) return null;
  return (
    <div className="github-expiry" role="status" aria-label="GitHub Token expiry">
      {expiring.map((token) => {
        const at = new Date(token.expires_at ?? "");
        const expired = at.getTime() <= Date.now();
        return (
          <p key={token.id}>
            {`The GitHub Token for ${token.owner_login} ${expired ? "expired" : "expires"} on ${formatDate(at, "date")}. `}
            {expired
              ? "Reconnect it with a new token. "
              : "Reconnect it with a new token before then. "}
            {onOpenSettings !== undefined && <SettingsLink onOpenSettings={onOpenSettings} />}
          </p>
        );
      })}
    </div>
  );
}
