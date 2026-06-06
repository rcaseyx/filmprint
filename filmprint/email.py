"""Transactional email via Resend. Requires RESEND_API_KEY env var."""

import logging
import os

import requests

logger = logging.getLogger(__name__)

_RESEND_URL = "https://api.resend.com/emails"
_FROM = "filmprint <dev@myfilmprint.com>"


def _send(to: str, subject: str, html: str) -> bool:
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        logger.warning("[email] RESEND_API_KEY not set — skipping send to %s", to)
        return False
    try:
        resp = requests.post(
            _RESEND_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            json={"from": _FROM, "to": [to], "subject": subject, "html": html},
            timeout=10,
        )
        if resp.status_code not in (200, 201):
            logger.error("[email] Resend error %s: %s", resp.status_code, resp.text)
            return False
        return True
    except Exception as exc:
        logger.error("[email] Failed to send to %s: %s", to, exc)
        return False


def send_approval_email(to: str, name: str, signup_url: str) -> bool:
    subject = "You're in — welcome to the filmprint beta"
    html = f"""
    <p>Hi {name},</p>
    <p>Your request to join the filmprint beta has been approved.</p>
    <p><a href="{signup_url}">Create your account</a></p>
    <p>You have <strong>7 days</strong> to sign up — after that your spot will expire
    and you'll need to request access again.</p>
    <p>— filmprint</p>
    """
    return _send(to, subject, html)


def send_google_account_email(to: str) -> bool:
    subject = "filmprint password reset"
    html = """
    <p>Hi,</p>
    <p>We received a password reset request for this email address, but your filmprint account uses Google Sign-In — there's no password to reset.</p>
    <p>To get back in, use the <strong>Continue with Google</strong> button on the login page.</p>
    <p>— filmprint</p>
    """
    return _send(to, subject, html)


def send_password_reset_email(to: str, reset_url: str) -> bool:
    subject = "Reset your filmprint password"
    html = f"""
    <p>Hi,</p>
    <p>We received a request to reset your filmprint password.</p>
    <p><a href="{reset_url}">Reset your password</a></p>
    <p>This link expires in <strong>1 hour</strong>. If you didn't request a reset, you can ignore this email.</p>
    <p>— filmprint</p>
    """
    return _send(to, subject, html)


def send_denial_email(to: str, name: str) -> bool:
    subject = "filmprint beta request"
    html = f"""
    <p>Hi {name},</p>
    <p>Thanks for your interest in filmprint. We're not accepting new beta testers
    right now, but keep an eye out — we'll be opening up again soon.</p>
    <p>— filmprint</p>
    """
    return _send(to, subject, html)
