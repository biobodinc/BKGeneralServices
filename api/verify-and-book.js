// ============================================================
//  verify-and-book.js  —  POST /api/verify-and-book  { email, code }
//  Verifies the 6-digit code, then creates the booking.
//
//  ✅ CHANGED FOR NEON. WHAT YOU NEED TO DO:
//    • Set DATABASE_URL in Vercel (same Neon connection string).  👈
//    (No Supabase vars needed.)
// ============================================================
import crypto from "node:crypto";
import { neon } from "@neondatabase/serverless";

const { DATABASE_URL } = process.env;                // 👈 set in Vercel
const sql = neon(DATABASE_URL);
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!DATABASE_URL) return res.status(500).json({ error: "Missing DATABASE_URL env var." });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const email = (body.email || "").trim().toLowerCase();
    const code = (body.code || "").trim();
    if (!email || !/^\d{6}$/.test(code)) return res.status(400).json({ error: "Enter the 6-digit code." });

    const rows = await sql`
      select * from email_verifications
      where email = ${email} and used = false and expires_at > now()
      order by created_at desc limit 1`;
    const v = rows[0];
    if (!v) return res.status(400).json({ error: "Your code expired. Please request a new one." });
    if (v.attempts >= 5) return res.status(429).json({ error: "Too many attempts. Request a new code." });

    if (sha(`${code}:${email}`) !== v.code_hash) {
      await sql`update email_verifications set attempts = attempts + 1 where id = ${v.id}`;
      return res.status(400).json({ error: "Incorrect code. Try again." });
    }

    // jsonb comes back from Neon already parsed into a JS object.
    const b = v.booking;
    const inserted = await sql`
      insert into bookings (name, email, phone, service, service_date, location, notes, payment, status)
      values (
        ${b.name || null}, ${b.email}, ${b.phone || null}, ${b.service}, ${b.service_date || null},
        ${b.location || null}, ${b.notes || null}, ${b.payment || "inperson"}, 'reviewing'
      )
      returning order_code, payment`;
    const order = inserted[0];

    await sql`update email_verifications set used = true where id = ${v.id}`;

    return res.status(200).json({ ok: true, order_code: order.order_code, payment: order.payment });
  } catch (e) {
    console.error("verify-and-book crash:", e);
    return res.status(500).json({ error: `Server error: ${e.message}` });
  }
}
