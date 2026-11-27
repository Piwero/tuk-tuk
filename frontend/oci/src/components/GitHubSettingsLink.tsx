import { pathForSettingsTab } from "../routes";

/** A link to Settings › GitHub that opens it in the app on a plain click
 * (and in a new tab on a modified one, as any link does). */
export function GitHubSettingsLink({
  onOpenSettings,
  children,
}: {
  onOpenSettings: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <a
      href={pathForSettingsTab("github")}
      onClick={(event) => {
        event.preventDefault();
        onOpenSettings();
      }}
    >
      {children}
    </a>
  );
}
