// Transactional email via Resend's HTTPS API (no SDK needed).
// Env: RESEND_API_KEY, EMAIL_FROM (e.g. "Wheelsdown <no-reply@mail.yourdomain.com>").
// Without a key, emails are printed to the server log in development and skipped in production.
export async function sendEmail(to: string, subject: string, text: string, html?: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "Wheelsdown <onboarding@resend.dev>";
  if (!key) {
    if (process.env.NODE_ENV !== "production") console.log(`[email:dev] to=${to} subject=${subject}\n${text}`);
    else console.warn("[email] RESEND_API_KEY not set; email not sent");
    return false;
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, text, html: html || text.replace(/\n/g, "<br>") }),
  });
  if (!r.ok) console.error("[email] send failed", r.status, await r.text().catch(() => ""));
  return r.ok;
}

export function resetEmail(name: string, link: string) {
  const text = `Hi ${name},

Someone (hopefully you) asked to reset your Wheelsdown password. This link works for 1 hour:

${link}

If you didn't ask for this, you can ignore this email; your password won't change.

Wheels down,
The Wheelsdown crew`;
  const html = `<p>Hi ${escapeHtml(name)},</p><p>Someone (hopefully you) asked to reset your Wheelsdown password. This link works for 1 hour:</p>
<p><a href="${link}" style="display:inline-block;background:#F5B700;color:#111;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:600">Reset my password</a></p>
<p style="color:#666;font-size:13px">If you didn't ask for this, ignore this email; your password won't change.</p><p>Wheels down,<br>The Wheelsdown crew</p>`;
  return { text, html };
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
