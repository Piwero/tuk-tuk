// The account rules the backend enforces (auth router, ADR 0018), mirrored
// so forms can state and check them before a request goes out; the
// server's rejection stays the backstop.

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
