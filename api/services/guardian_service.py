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
COOLDOWN_SECONDS = 1800      # 30 minute cooldown between alerts per guardian


def _can_notify(email: str, bypass: bool = False) -> bool:
    if bypass:
        return True
    last = _rate_limit.get(email, 0)
    return (time.time() - last) > COOLDOWN_SECONDS


def _mark_notified(email: str) -> None:
    _rate_limit[email] = time.time()


def _get_friendly_terms(scam_type: str, alert_type: str) -> tuple[str, str]:
    """Maps technical terms to human-friendly ones for guardians."""
    # Friendly names for technical sources
    friendly_scam = scam_type
    if "Gsb" in scam_type:
        friendly_scam = "Malicious Software Link"
    elif "Urlhaus" in scam_type:
        friendly_scam = "Known Fraudulent Site"

    # Friendly descriptions
    description = "This activity has been flagged as high-risk by our AI security filters."
    if alert_type == "URL_SCAN":
        description = "This link is known to be used for identity theft or installing harmful software. We strongly recommend the user does not enter any data there."
    elif alert_type == "VOICE_SCAN":
        description = "Our neural analysis detected synthetic or manipulative patterns in this call, often used in voice-cloning scams."
    elif alert_type == "QR_SCAN":
        description = "The scanned QR code leads to a suspicious destination often used to bypass traditional web security."

    return friendly_scam, description


def _build_html(
    guardian_name: str,
    user_name: str,
    alert_type: str,
    scam_type: str,
    risk_score: int,
    is_escalation: bool,
) -> str:
    friendly_scam, description = _get_friendly_terms(scam_type, alert_type)
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
  <div style="max-width:520px;margin:32px auto;background:#0f172a;border:1px solid #1e3a5f;border-radius:16px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,0.5);">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#0f172a,#1e293b);padding:32px;border-bottom:1px solid #1e3a5f;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <td style="vertical-align: middle; width: 40px;">
             <table border="0" cellpadding="0" cellspacing="0" width="36" height="36" style="background:rgba(0,242,255,0.1); border:1px solid #00f2ff; border-radius:8px;">
                <tr>
                  <td align="center" valign="middle" style="font-size:20px; line-height:36px; display:block;">
                    🛡
                  </td>
                </tr>
             </table>
          </td>
          <td style="padding-left:12px;">
            <span style="color:#00f2ff;font-family:monospace;font-size:14px;font-weight:bold;letter-spacing:2px;">SCAMDEFY</span>
          </td>
        </tr>
      </table>
      <h1 style="margin:20px 0 0;color:#f8fafc;font-size:24px;font-weight:800;letter-spacing:-0.5px;">Safety Alert</h1>
      <p style="margin:4px 0 0;color:#94a3b8;font-size:13px;">Trusted Guardian Notification</p>
    </div>

    <!-- Body -->
    <div style="padding:32px;">
      {escalation_banner}

      <p style="color:#cbd5e1;font-size:15px;line-height:1.6;margin:0 0 20px;">
        Hello <strong style="color:#f8fafc;">{guardian_name}</strong>,
      </p>
      <p style="color:#cbd5e1;font-size:15px;line-height:1.6;margin:0 0 24px;">
        ScamDefy neural monitoring has detected a potential scam attempt involving <strong style="color:#f8fafc;">{user_name}</strong>.
        Please check in with them at your earliest convenience.
      </p>

      <!-- Alert Card -->
      <div style="background:#1e293b;border:1px solid {risk_color}44;border-radius:12px;padding:24px;margin-bottom:24px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <span style="color:#94a3b8;font-family:monospace;font-size:11px;letter-spacing:1px;font-weight:bold;">THREAT ANALYSIS</span>
          <span style="background:{risk_color}22;color:{risk_color};font-family:monospace;font-size:11px;font-weight:bold;padding:4px 12px;border-radius:20px;border:1px solid {risk_color}55;">
            {risk_label} RISK
          </span>
        </div>
        <p style="margin:0 0 8px;color:#f8fafc;font-size:18px;font-weight:700;">{friendly_scam}</p>
        <p style="margin:0;color:#94a3b8;font-size:14px;line-height:1.5;">{description}</p>
      </div>

      <!-- Privacy Note -->
      <div style="background:rgba(22,101,52,0.1);border:1px solid rgba(22,101,52,0.3);border-radius:8px;padding:16px;margin-bottom:24px;">
        <p style="margin:0;color:#86efac;font-size:12px;line-height:1.6;">
          🔒 <strong>Privacy Protected:</strong> Your privacy is our priority. This alert does not include specific messages, URLs, or any sensitive private data.
        </p>
      </div>

      <p style="color:#64748b;font-size:13px;margin:0 0 4px;">
        This alert was sent because <strong style="color:#94a3b8;">{user_name}</strong> added you as a trusted guardian.
      </p>
      <p style="color:#64748b;font-size:12px;margin:0;">
        They can manage these notifications anytime from their ScamDefy security dashboard.
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#060d1a;padding:20px 32px;border-top:1px solid #1e3a5f;text-align:center;">
      <p style="margin:0;color:#475569;font-size:11px;font-family:monospace;letter-spacing:1px;">
        AI-POWERED THREAT PROTECTION · SENTINEL V1.0
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
    bypass_cooldown: bool = False,
) -> dict:
    """
    Sends a guardian alert email.
    Returns { "sent": bool, "reason": str }
    """
    # Rate-limit check (Bypass for manual tests OR critical escalations)
    if not _can_notify(guardian_email, (bypass_cooldown or is_escalation)):
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
    msg["From"] = smtp_from
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
