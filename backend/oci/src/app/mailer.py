"""Outgoing email (issue #586): the one boundary invitations are emailed
through, injected through the application factory like the Google and
GitHub sources so tests never send real mail.

`SmtpMailer` uses only the standard library. Submission is all it can
report: a message the server accepted may still never reach an inbox, so
callers say "sent", never "delivered". Errors carry a short, safe summary
that names no credential, recipient or message content, since an Admin
sees it and it may be logged.
"""

import asyncio
import smtplib
import ssl
from email.message import EmailMessage
from typing import Literal, Protocol

from app.config import Settings


class MailDeliveryError(Exception):
    """The message was not handed to the mail server. `str()` is safe to
    show an Admin."""


class Mailer(Protocol):
    async def send(self, message: EmailMessage) -> None:
        """Submits `message` (its From is filled in here) or raises
        MailDeliveryError."""
        ...


class SmtpMailer:
    def __init__(
        self,
        *,
        host: str,
        port: int,
        security: Literal["starttls", "ssl", "none"],
        sender: str,
        username: str | None,
        password: str | None,
        timeout: float,
    ) -> None:
        self._host = host
        self._port = port
        self._security = security
        self._sender = sender
        self._username = username
        self._password = password
        self._timeout = timeout

    async def send(self, message: EmailMessage) -> None:
        if "From" not in message:
            message["From"] = self._sender
        await asyncio.to_thread(self._send, message)

    def _send(self, message: EmailMessage) -> None:
        context = ssl.create_default_context()
        try:
            if self._security == "ssl":
                client: smtplib.SMTP = smtplib.SMTP_SSL(
                    self._host, self._port, timeout=self._timeout, context=context
                )
            else:
                client = smtplib.SMTP(self._host, self._port, timeout=self._timeout)
            with client:
                if self._security == "starttls":
                    client.starttls(context=context)
                if self._username:
                    client.login(self._username, self._password or "")
                client.send_message(message)
        except smtplib.SMTPAuthenticationError:
            raise MailDeliveryError("The mail server rejected the sign-in") from None
        except smtplib.SMTPRecipientsRefused:
            raise MailDeliveryError("The mail server refused the recipient") from None
        except smtplib.SMTPResponseException as exc:
            raise MailDeliveryError(f"The mail server answered {exc.smtp_code}") from None
        except (smtplib.SMTPException, ssl.SSLError):
            raise MailDeliveryError("The mail server could not take the message") from None
        except OSError:
            raise MailDeliveryError("Could not connect to the mail server") from None


def build_mailer(settings: Settings) -> Mailer | None:
    """The deployment's mailer, or None when SMTP is not configured.
    Refuses a half or insecure configuration at startup rather than at the
    first invitation."""
    if not settings.smtp_host:
        return None
    if not settings.smtp_from:
        raise RuntimeError("SMTP_HOST is set but SMTP_FROM is not: set the sender address.")
    if settings.smtp_security == "none" and settings.app_env != "development":
        raise RuntimeError(
            "SMTP_SECURITY=none sends mail credentials in the clear and is refused outside "
            "APP_ENV=development. Use starttls or ssl."
        )
    return SmtpMailer(
        host=settings.smtp_host,
        port=settings.smtp_port,
        security=settings.smtp_security,
        sender=settings.smtp_from,
        username=settings.smtp_username,
        password=settings.smtp_password,
        timeout=settings.smtp_timeout_seconds,
    )
