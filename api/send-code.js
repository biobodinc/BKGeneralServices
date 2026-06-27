// ============================================================
//  send-code.js  —  POST /api/send-code  { booking: {...} }
//  Generates a 6-digit code, stores it with the pending booking, emails it.
//
//  ✅ CHANGED FOR NEON (was Supabase). WHAT YOU NEED TO DO:
//    1. In Vercel → Settings → Environment Variables, set:
//         DATABASE_URL    👈 your Neon connection string (Neon → Connect)
//         RESEND_API_KEY  👈 your Resend key (re_...)
//       You can DELETE the old SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
//    2. Run schema.sql once in Neon's SQL Editor (creates the tables).
// ============================================================
import crypto from "node:crypto";
import { neon } from "@neondatabase/serverless";   // 👈 NEW dependency (in package.json)
import { Resend } from "resend";

const {
  DATABASE_URL,                                      // 👈 set in Vercel
  RESEND_API_KEY,                                    // 👈 set in Vercel
  FROM_EMAIL = "B&K General Services <bookings@biobod.net>", // 👈 change if your address differs
} = process.env;

const sql = neon(DATABASE_URL);                      // Neon client (replaces the old Supabase REST helper)
const resend = new Resend(RESEND_API_KEY);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!DATABASE_URL) return res.status(500).json({ error: "Missing DATABASE_URL env var." });
  if (!RESEND_API_KEY) return res.status(500).json({ error: "Missing RESEND_API_KEY env var." });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const booking = body.booking || {};
    const email = (booking.email || "").trim().toLowerCase();

    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "A valid email is required." });
    if (!booking.service) return res.status(400).json({ error: "Please choose a service." });
    if (!booking.location) return res.status(400).json({ error: "Please add the service address." });
    if (!booking.service_date) return res.status(400).json({ error: "Please choose a date." });

    // Rate limit: max 3 codes per email per 10 minutes.
    const recent = await sql`
      select id from email_verifications
      where email = ${email} and created_at > now() - interval '10 minutes'`;
    if (recent.length >= 3) {
      return res.status(429).json({ error: "Too many codes requested. Please wait a few minutes." });
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const code_hash = sha(`${code}:${email}`);

    // jsonb column — stringify the booking and cast it.
    await sql`
      insert into email_verifications (email, code_hash, booking, expires_at)
      values (
        ${email},
        ${code_hash},
        ${JSON.stringify({ ...booking, email })}::jsonb,
        now() + interval '10 minutes'
      )`;

    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: [email],
      subject: `Your B&K verification code: ${code}`,
      html: `
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your B&amp;K verification code is ${code} — expires in 10 minutes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f2e9;margin:0;padding:0;">
  <tr>
    <td align="center" style="padding:34px 16px;">
      <table role="presentation" width="468" cellpadding="0" cellspacing="0" style="width:468px;max-width:468px;">
        <tr>
          <td align="center" style="padding-bottom:20px;">
            <img src="https://bk-general-services.vercel.app/logo.png" width="88" height="88" alt="B&amp;K General Services" style="display:block;width:88px;height:88px;border:0;outline:none;text-decoration:none;border-radius:50%;" />
          </td>
        </tr>
        <tr>
          <td style="background-color:#ffffff;border:1px solid #e4dccb;border-radius:16px;padding:34px 32px;font-family:Helvetica,Arial,sans-serif;">
            <h1 style="margin:0 0 8px;font-size:22px;line-height:1.25;color:#17211b;font-weight:bold;">Confirm your booking</h1>
            <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#5c564b;">Enter this code on the booking page to verify your email and finish up.</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center" style="background-color:#fbf7ee;border:1px solid #f0e4c8;border-radius:12px;padding:24px 12px;">
                  <span style="font-size:38px;font-weight:bold;letter-spacing:12px;color:#17211b;font-family:'Courier New',Courier,monospace;padding-left:12px;">${code}</span>
                </td>
              </tr>
            </table>
            <div style="height:3px;width:48px;background-color:#f4a300;border-radius:2px;margin:26px 0 18px;font-size:0;line-height:0;">&nbsp;</div>
            <p style="margin:0;font-size:14px;line-height:1.5;color:#6f6757;">This code expires in <strong style="color:#17211b;">10 minutes</strong>. Didn't request it? You can safely ignore this email.</p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:22px 8px 0;font-family:Helvetica,Arial,sans-serif;">
            <p style="margin:0 0 4px;font-size:13px;font-weight:bold;color:#17211b;">B&amp;K General Services</p>
            <p style="margin:0;font-size:12px;line-height:1.5;color:#9a917f;">Lawn care &middot; Cleaning &middot; Repairs &middot; Moving help &mdash; Saratoga Springs, UT</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`,
    });

    if (error) {
      console.error("Resend error:", error);
      return res.status(502).json({ error: `Email failed: ${error.message || error.name || JSON.stringify(error)}` });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("send-code crash:", e);
    return res.status(500).json({ error: `Server error: ${e.message}` });
  }
}