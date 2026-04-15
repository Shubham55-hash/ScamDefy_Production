"""
guardian_service.py — Safety Circle alert mailer
Sends privacy-preserving emails to trusted guardians when a high-risk
scam is detected. Uses Python stdlib smtplib — no extra dependencies.
"""
import os
import smtplib
import logging
import time
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)

# In-memory rate limit: { guardian_email: last_sent_unix_timestamp }
_rate_limit: Dict[str, float] = {}
COOLDOWN_SECONDS = 1800  # 30 minutes


def _can_notify(email: str) -> bool:
    last = _rate_limit.get(email, 0)
    return (time.time() - last) > COOLDOWN_SECONDS


def _mark_notified(email: str) -> None:
    _rate_limit[email] = time.time()


def _build_html(
    guardian_name: str,
    user_name: str,
    alert_type: str,
    scam_type: str,
    risk_score: int,
    is_escalation: bool,
) -> str:
    risk_color = "#ef4444" if risk_score >= 75 else "#f97316"
    risk_label = "CRITICAL" if risk_score >= 80 else "HIGH"
    escalation_banner = ""
    if is_escalation:
        escalation_banner = """
        <div style="background:#7f1d1d;border:1px solid #ef4444;border-radius:8px;padding:12px 16px;margin-bottom:16px;">
          <p style="margin:0;color:#fca5a5;font-family:monospace;font-size:13px;font-weight:bold;">
            ⚠ ESCALATION — USER PROCEEDED THROUGH WARNING
          </p>
        </div>"""

    return f"""
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0a0f1e;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:520px;margin:32px auto;background:#0f172a;border:1px solid #1e3a5f;border-radius:16px;overflow:hidden;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#0f172a,#1e293b);padding:28px 32px;border-bottom:1px solid #1e3a5f;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
        <div style="width:36px;height:36px;background:#00f2ff22;border:2px solid #00f2ff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;">🛡</div>
        <span style="color:#00f2ff;font-family:monospace;font-size:14px;font-weight:bold;letter-spacing:2px;">SCAMDEFY</span>
      </div>
      <h1 style="margin:0;color:#f8fafc;font-size:20px;font-weight:700;">Safety Alert</h1>
      <p style="margin:4px 0 0;color:#94a3b8;font-size:13px;">Trusted Guardian Notification</p>
    </div>

    <!-- Body -->
    <div style="padding:28px 32px;">
      {escalation_banner}

      <p style="color:#cbd5e1;font-size:15px;line-height:1.6;margin:0 0 20px;">
        Hello <strong style="color:#f8fafc;">{guardian_name}</strong>,
      </p>
      <p style="color:#cbd5e1;font-size:15px;line-height:1.6;margin:0 0 24px;">
        ScamDefy has detected a potential scam attempt for <strong style="color:#f8fafc;">{user_name}</strong>.
        Please check in with them at your earliest convenience.
      </p>

      <!-- Alert card -->
      <div style="background:#1e293b;border:1px solid {risk_color}44;border-radius:12px;padding:20px;margin-bottom:24px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <span style="color:#94a3b8;font-family:monospace;font-size:11px;letter-spacing:1px;">THREAT CLASSIFICATION</span>
          <span style="background:{risk_color}22;color:{risk_color};font-family:monospace;font-size:11px;font-weight:bold;padding:3px 10px;border-radius:20px;border:1px solid {risk_color}55;">
            {risk_label}
          </span>
        </div>
        <p style="margin:0 0 8px;color:#f8fafc;font-size:16px;font-weight:600;">{scam_type}</p>
        <p style="margin:0;color:#94a3b8;font-size:13px;">Alert type: {alert_type}</p>
      </div>

      <!-- Privacy note -->
      <div style="background:#0f2d1a;border:1px solid #166534;border-radius:8px;padding:14px 16px;margin-bottom:24px;">
        <p style="margin:0;color:#86efac;font-size:12px;line-height:1.6;">
          🔒 <strong>Privacy Protected:</strong> No personal messages, URLs, or sensitive data have been shared in this alert.
          ScamDefy only notifies you of the risk level and category.
        </p>
      </div>

      <p style="color:#64748b;font-size:13px;margin:0 0 4px;">
        This alert was sent because <strong style="color:#94a3b8;">{user_name}</strong> has added you as a trusted guardian in ScamDefy.
      </p>
      <p style="color:#64748b;font-size:12px;margin:0;">
        They can manage guardian settings anytime from their ScamDefy app.
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#060d1a;padding:16px 32px;border-top:1px solid #1e3a5f;">
      <p style="margin:0;color:#334155;font-size:11px;font-family:monospace;">
        SCAMDEFY SENTINEL · AI-POWERED SCAM PROTECTION · DO NOT REPLY TO THIS EMAIL
      </p>
    </div>
  </div>
</body>
</html>"""


def _build_plain(
    guardian_name: str,
    user_name: str,
    alert_type: str,
    scam_type: str,
    risk_score: int,
    is_escalation: bool,
) -> str:
    escalation = "\n⚠ ESCALATION: The user proceeded through a scam warning.\n" if is_escalation else ""
    risk_label = "CRITICAL" if risk_score >= 80 else "HIGH"
    return f"""ScamDefy Safety Alert
======================
{escalation}
Hello {guardian_name},

A potential scam attempt has been detected for {user_name}.
Please check in with them at your earliest convenience.

Threat Classification: {risk_label}
Category: {scam_type}
Alert Type: {alert_type}

PRIVACY NOTE: No personal messages, URLs, or sensitive data are included in this alert.

This alert was sent because {user_name} has added you as a trusted guardian in ScamDefy.
They can manage guardian settings from their ScamDefy app at any time.

— ScamDefy Sentinel"""


async def send_alert(
    guardian_name: str,
    guardian_email: str,
    user_name: str,
    alert_type: str,
    scam_type: str,
    risk_score: int,
    is_escalation: bool = False,
) -> dict:
    """
    Sends a guardian alert email.
    Returns { "sent": bool, "reason": str }
    """
    # Rate-limit check
    if not _can_notify(guardian_email):
        remaining = int(COOLDOWN_SECONDS - (time.time() - _rate_limit.get(guardian_email, 0)))
        logger.info(f"[SafetyCircle] Rate limited for {guardian_email}, cooldown {remaining}s remaining")
        return {"sent": False, "reason": f"rate_limited:{remaining}s"}

    smtp_host = os.getenv("SMTP_HOST", "")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_password = os.getenv("SMTP_PASSWORD", "")
    smtp_from = os.getenv("SMTP_FROM", smtp_user)

    if not all([smtp_host, smtp_user, smtp_password]):
        logger.warning("[SafetyCircle] SMTP credentials not configured — alert not sent.")
        return {"sent": False, "reason": "smtp_not_configured"}

    subject_prefix = "⚠ ESCALATION — " if is_escalation else ""
    subject = f"{subject_prefix}ScamDefy Safety Alert for {user_name}"

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"ScamDefy Sentinel <{smtp_from}>"
    msg["To"] = f"{guardian_name} <{guardian_email}>"

    plain = _build_plain(guardian_name, user_name, alert_type, scam_type, risk_score, is_escalation)
    html = _build_html(guardian_name, user_name, alert_type, scam_type, risk_score, is_escalation)

    msg.attach(MIMEText(plain, "plain"))
    msg.attach(MIMEText(html, "html"))

    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
            server.ehlo()
            server.starttls()
            server.login(smtp_user, smtp_password)
            server.sendmail(smtp_from, [guardian_email], msg.as_string())

        _mark_notified(guardian_email)
        logger.info(f"[SafetyCircle] Alert sent to guardian {guardian_email} for user '{user_name}'")
        return {"sent": True, "reason": "ok"}

    except smtplib.SMTPAuthenticationError:
        logger.error("[SafetyCircle] SMTP authentication failed — check SMTP_USER/SMTP_PASSWORD")
        return {"sent": False, "reason": "smtp_auth_error"}
    except Exception as exc:
        logger.error(f"[SafetyCircle] Failed to send alert: {exc}")
        return {"sent": False, "reason": str(exc)}
