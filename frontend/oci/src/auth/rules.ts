// The account rules the backend enforces (auth router, ADR 0018), mirrored
// so forms can state and check them before a request goes out; the
// server's rejection stays the backstop. Every form that takes a username or
// an email (setup, completing a profile, an Admin's new user, My account's
// profile) checks and words them through here, so they all say the same.

import { ApiError } from "../api";

/** Mirrors the backend's MIN_PASSWORD_LENGTH (issue #338). */
export const MIN_PASSWORD_LENGTH = 12;

export const MAX_USERNAME_LENGTH = 64;

/** Deliberately loose, like the backend's: something@something. */
export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+$/;

/** Whether a new password and its confirmation pass both rules a forced
 * step's checklist shows. "Both entries match" is unmet while the
 * confirmation is empty. */
export function newPasswordReady(newPassword: string, confirmation: string): boolean {
  return newPassword.length >= MIN_PASSWORD_LENGTH && confirmation === newPassword;
}

/** The two fields that name an account, each unique across the instance. */
export type IdentityField = "username" | "email";

export const USERNAME_RULE = `Enter a username of 1 to ${MAX_USERNAME_LENGTH} characters.`;
export const EMAIL_RULE = "Enter a valid email address.";

/** Why the backend would refuse this username or email, already trimmed;
 * null if it would take it. */
export function identityProblem(field: IdentityField, value: string): string | null {
  if (field === "username") {
    return value === "" || value.length > MAX_USERNAME_LENGTH ? USERNAME_RULE : null;
  }
  return EMAIL_PATTERN.test(value) ? null : EMAIL_RULE;
}

/** The backend's refusal of a username or email (its per-field codes), on
 * the field it names and in the same words as the check before sending;
 * null for any other failure, which the form words itself. */
export function identityRejection(err: unknown): { field: IdentityField; message: string } | null {
  if (!(err instanceof ApiError)) {
    return null;
  }
  switch (err.code) {
    case "invalid_username":
      return { field: "username", message: USERNAME_RULE };
    case "username_taken":
      return { field: "username", message: "That username is already taken." };
    case "invalid_email":
      return { field: "email", message: EMAIL_RULE };
    case "email_taken":
      return { field: "email", message: "That email is already in use." };
  }
  return null;
}
