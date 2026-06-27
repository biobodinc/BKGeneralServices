// POST /api/order-status  { email, code }
// Looks up ONE booking by email + reference number (order_code), server-side.
// Returns only the customer-facing fields. Requires both email and the reference
// to match, so order codes alone can't reveal anyone's data.
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

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
    const code = (body.code || "").trim().replace(/^#/, "").toLowerCase();

    if (!email || !code) {
      return res.status(400).json({ error: "Enter your email and reference number." });
    }

    const rows = await sb(
      `bookings?order_code=eq.${encodeURIComponent(code)}&email=ilike.${encodeURIComponent(
        email
      )}&select=order_code,service,service_date,status,price_cents,payment_url,created_at,name&limit=1`
    );
    const order = Array.isArray(rows) && rows[0];

    if (!order) {
      return res.status(404).json({ error: "We couldn't find a booking with that email and reference." });
    }

    return res.status(200).json({ order });
  } catch (e) {
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
}
