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
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:8px">
          <h2 style="color:#17211b;margin:0 0 6px">B&amp;K General Services</h2>
          <p style="color:#333">Use this code to confirm your booking:</p>
          <p style="font-size:34px;font-weight:bold;letter-spacing:8px;color:#17211b;margin:14px 0">${code}</p>
          <p style="color:#6f6757;font-size:14px">This code expires in 10 minutes. If you didn't request it, you can ignore this email.</p>
        </div>`,
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
