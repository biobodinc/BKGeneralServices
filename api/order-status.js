// ============================================================
//  order-status.js  —  POST /api/order-status  { email, code }
//  Looks up ONE booking by email + reference number.
//
//  ✅ CHANGED FOR NEON. WHAT YOU NEED TO DO:
//    • Set DATABASE_URL in Vercel (same Neon connection string).  👈
// ============================================================
import { neon } from "@neondatabase/serverless";

const { DATABASE_URL } = process.env;                // 👈 set in Vercel
const sql = neon(DATABASE_URL);

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!DATABASE_URL) return res.status(500).json({ error: "Missing DATABASE_URL env var." });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const email = (body.email || "").trim().toLowerCase();
    const code = (body.code || "").trim().replace(/^#/, "").toLowerCase();
    if (!email || !code) return res.status(400).json({ error: "Enter your email and reference number." });

    const rows = await sql`
      select order_code, service, service_date, status, price_cents, payment_url, created_at, name
      from bookings
      where order_code = ${code} and lower(email) = ${email}
      limit 1`;
    const order = rows[0];
    if (!order) return res.status(404).json({ error: "We couldn't find a booking with that email and reference." });

    return res.status(200).json({ order });
  } catch (e) {
    console.error("order-status crash:", e);
    return res.status(500).json({ error: `Server error: ${e.message}` });
  }
}
