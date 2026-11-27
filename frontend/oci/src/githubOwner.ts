/** How the UI names a GitHub Token's owner. GitHub names a fine-grained
 * token's owner nowhere, so tuk-tuk learns it from the repositories the
 * token reads, and a token that reads none yet has no owner (ADR 0020). */

export const UNKNOWN_GITHUB_OWNER = "Owner not known yet";

/** The owner's login, or a placeholder while GitHub can't tell it. */
export function githubOwnerName(ownerLogin: string | null): string {
  return ownerLogin ?? UNKNOWN_GITHUB_OWNER;
}

/** "the GitHub Token for <login>", for running text. */
export function githubTokenName(ownerLogin: string | null): string {
  return ownerLogin === null
    ? "the GitHub Token whose owner isn’t known yet"
    : `the GitHub Token for ${ownerLogin}`;
}
