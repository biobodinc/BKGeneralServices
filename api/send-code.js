// POST /api/send-code  { booking: {...} }
// Generates a 6-digit code, stores it (hashed) with the pending booking, and
// emails it via the Resend SDK. Runs server-side only.
import crypto from "node:crypto";
import { Resend } from "resend";

const {
  RESEND_API_KEY,
  FROM_EMAIL = "B&K General Services <bookings@biobod.net>",
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

const resend = new Resend(RESEND_API_KEY);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

async function sb(path, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Explicit, readable checks so a missing/blank var is obvious in the response.
  if (!RESEND_API_KEY) return res.status(500).json({ error: "Missing RESEND_API_KEY env var." });
  if (!SUPABASE_URL) return res.status(500).json({ error: "Missing SUPABASE_URL env var." });
  if (!SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: "Missing SUPABASE_SERVICE_ROLE_KEY env var." });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const booking = body.booking || {};
    const email = (booking.email || "").trim().toLowerCase();

    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "A valid email is required." });
    if (!booking.service) return res.status(400).json({ error: "Please choose a service." });
    if (!booking.location) return res.status(400).json({ error: "Please add the service address." });
    if (!booking.service_date) return res.status(400).json({ error: "Please choose a date." });

    // Rate limit: max 3 codes per email per 10 minutes.
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const recent = await sb(
      `email_verifications?email=eq.${encodeURIComponent(email)}&created_at=gte.${encodeURIComponent(since)}&select=id`
    );
    if (Array.isArray(recent) && recent.length >= 3) {
      return res.status(429).json({ error: "Too many codes requested. Please wait a few minutes." });
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const code_hash = sha(`${code}:${email}`);
    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await sb("email_verifications", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ email, code_hash, booking: { ...booking, email }, expires_at }),
    });

    // Send via the Resend SDK (returns { data, error } instead of throwing).
    const { data, error } = await resend.emails.send({
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
      // Surface Resend's real reason so it's visible in the Network response.
      return res.status(502).json({ error: `Email failed: ${error.message || error.name || JSON.stringify(error)}` });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("send-code crash:", e);
    // Surface the real crash reason (e.g. a Supabase 401/403) for debugging.
    return res.status(500).json({ error: `Server error: ${e.message}` });
  }
}
