// POST /api/verify-and-book  { email, code }
// Verifies the 6-digit code, then creates the booking using the service-role key
// (so the public anon key never needs insert access). Runs server-side only.
import crypto from "node:crypto";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
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
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Server not configured (missing env vars)." });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const email = (body.email || "").trim().toLowerCase();
    const code = (body.code || "").trim();
    if (!email || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: "Enter the 6-digit code." });
    }

    const nowIso = new Date().toISOString();
    const rows = await sb(
      `email_verifications?email=eq.${encodeURIComponent(email)}&used=eq.false&expires_at=gt.${encodeURIComponent(
        nowIso
      )}&order=created_at.desc&limit=1&select=*`
    );
    const v = Array.isArray(rows) && rows[0];
    if (!v) return res.status(400).json({ error: "Your code expired. Please request a new one." });
    if (v.attempts >= 5) return res.status(429).json({ error: "Too many attempts. Request a new code." });

    if (sha(`${code}:${email}`) !== v.code_hash) {
      await sb(`email_verifications?id=eq.${v.id}`, {
        method: "PATCH",
        body: JSON.stringify({ attempts: v.attempts + 1 }),
      });
      return res.status(400).json({ error: "Incorrect code. Try again." });
    }

    // Code good → create the booking.
    const inserted = await sb("bookings", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ ...v.booking, status: "reviewing" }),
    });
    const order = Array.isArray(inserted) ? inserted[0] : inserted;

    await sb(`email_verifications?id=eq.${v.id}`, {
      method: "PATCH",
      body: JSON.stringify({ used: true }),
    });

    return res.status(200).json({
      ok: true,
      order_code: order?.order_code || null,
      payment: v.booking.payment || "inperson",
    });
  } catch (e) {
    return res.status(500).json({ error: "Something went wrong saving your booking. Please try again." });
  }
}
