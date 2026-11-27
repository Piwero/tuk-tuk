# Google sign-in and invitations

⏱ 30 min, one time. Lets an Admin invite people by email. They accept by
signing in with Google, without a password or any Google Cloud setup of
their own, and can then connect Google Calendar in one step. Password
sign-in keeps working for everyone who has one.

You need three things: a Google Cloud OAuth client the whole instance
shares, an SMTP server to email invitations (optional), and the app served
from a fixed address. See [ADR 0021](../adr/0021-invite-only-google-sign-in.md)
for what this does and does not do.

## 1. The shared Google OAuth client

1. In [Google Cloud Console](https://console.cloud.google.com/), create (or
   reuse) a project and enable the **Google Calendar API**.
2. **OAuth consent screen** (type: External):
   - Scopes: `openid`, `email`, and
     `https://www.googleapis.com/auth/calendar.readonly`. Signing in asks for
     the first two only; Calendar access is a separate, optional step.
   - **Publishing status: In production.** On "Testing", only listed test
     users can sign in, and Google expires Calendar refresh tokens after 7
     days, which reads in Tuk Tuk as "needs reconnect" every week.
     Publishing makes a sensitive scope (Calendar) show Google's
     "unverified app" warning until Google verifies the app; people can
     continue with **Advanced → Go to (your project)**. Tuk Tuk never
     submits the app for verification itself.
   - Even in production, Google can revoke a refresh token (password change,
     inactivity, the person removing access). That only ever affects
     Calendar: sign-in is unaffected, and the person reconnects from
     Settings.
3. **Credentials → Create OAuth client ID → Web application.** Under
   **Authorized redirect URIs**, add each of these for every address the app
   is served from (each address must also be in `CORS_ORIGINS`):

   ```text
   https://tuk-tuk.example.com/api/v1/auth/google/callback
   https://tuk-tuk.example.com/api/v1/auth/google/link/callback
   https://tuk-tuk.example.com/api/v1/google/callback
   ```

   The first signs people in and accepts invitations, the second links
   Google to an existing account, the third connects Google Calendar.

4. Set the client on the backend (`.env`, or the `tuk-tuk-sso` Secret on
   Kubernetes; see `backend/chart/README.md`):

   ```bash
   GOOGLE_OAUTH_CLIENT_ID=1234-abc.apps.googleusercontent.com
   GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-...
   ```

These are not the old `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, which only
ever seeded the first User's own client on upgrade. Nobody sees or edits the
shared client in the app. Calendar connections made before, with a User's
own client, keep working with that client and its encrypted tokens; nobody
has to reconnect.

## 2. Invitation email (optional)

Without SMTP, invitations are still created: each shows **Not emailed:
Email delivery is not configured**, and the Admin copies its link and sends
it another way.

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURITY=starttls   # or ssl, usually on port 465
SMTP_USERNAME=tuk-tuk@example.com
SMTP_PASSWORD=...
SMTP_FROM=tuk-tuk@example.com
# Where links point; defaults to the first CORS_ORIGINS entry.
APP_PUBLIC_URL=https://tuk-tuk.example.com
```

The backend refuses to start with `SMTP_HOST` but no `SMTP_FROM`, or with
`SMTP_SECURITY=none` outside `APP_ENV=development`, so credentials never
travel in the clear. Use a sender your mail server is allowed to send as
(SPF/DKIM for its domain), or invitations will land in spam or bounce.

**Emailed** in the app means the mail server accepted the message, not that
it reached an inbox. Neither secrets nor invitation links are logged.

## 3. Verify before inviting anyone

1. Restart the backend. The sign-in screen now shows **Continue with
   Google**, and **Settings → Users → Invitations** offers **Invite**.
2. Invite an address you control. Check that the invitation reads
   **Emailed**, then that the email arrived (and not in spam). If it reads
   **Not emailed**, the reason says what failed; fix it and **Retry
   sending**.
3. Open the link in a private window and continue with the Google account
   for that address. Choose a username, then connect or skip Calendar.
4. Try the same link with a different Google account: it is refused, and no
   account is created.

## Everyday rules

- An invitation admits a regular User only. Make them an Admin separately
  in Settings → Users.
- Links expire after seven days. **Resend** issues a fresh link and makes
  older ones stop working; **Cancel** closes the invitation.
- Someone who already has an account links Google from **Settings → My
  account → Sign in with Google**, after confirming their password. The
  Google account's verified email must match the account's email; if it
  doesn't, an Admin changes the account's email first (**Change email**).
- Lost Google account: after verifying the person out of band, an Admin
  uses **Remove Google sign-in** and **Reset password** on their row. They
  sign in with the temporary password, choose a new one, and link their new
  Google account. Their account and data are unchanged.
- **Disable user** ends every session, password or Google, and revokes all
  their API and MCP tokens. Enabling them again restores neither: they sign
  in afresh and create new tokens. Their data and Calendar connections stay;
  Calendar resumes if Google still accepts the stored credentials.
