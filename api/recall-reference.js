// ============================================================
//  recall-reference.js  —  POST /api/recall-reference  { email }
//  Emails a customer the reference number(s) for bookings on their email.
//  Always responds the same way (doesn't reveal whether an email has bookings).
//
//  ✅ Uses the same env vars as the others — nothing new to set:
//    • DATABASE_URL  👈 (already set in Vercel)
//    • RESEND_API_KEY 👈 (already set in Vercel)
// ============================================================
import { neon } from "@neondatabase/serverless";
import { Resend } from "resend";

const {
  DATABASE_URL,
  RESEND_API_KEY,
  FROM_EMAIL = "B&K General Services <bookings@biobod.net>",
} = process.env;

const sql = neon(DATABASE_URL);
const resend = new Resend(RESEND_API_KEY);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STATUS_LABEL = {
  reviewing: "Reviewing", quoted: "Quoted", paid: "Paid",
  scheduled: "Scheduled", completed: "Completed", cancelled: "Cancelled",
  pending: "Reviewing",
};

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!DATABASE_URL) return res.status(500).json({ error: "Missing DATABASE_URL env var." });
  if (!RESEND_API_KEY) return res.status(500).json({ error: "Missing RESEND_API_KEY env var." });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const email = (body.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Enter a valid email address." });

    const rows = await sql`
      select order_code, service, service_date, status, created_at
      from bookings
      where lower(email) = ${email}
      order by created_at desc
      limit 20`;

    // Only send if there's something to send — but respond identically either way.
    if (rows.length > 0) {
      const items = rows.map((r) => {
        const when = r.service_date
          ? new Date(r.service_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
          : "Flexible date";
        const label = STATUS_LABEL[r.status] || "Reviewing";
        return `
          <tr>
            <td style="padding:12px 14px;border-bottom:1px solid #eee4d0;font-family:'Courier New',Courier,monospace;font-size:16px;font-weight:bold;color:#17211b;">#${r.order_code}</td>
            <td style="padding:12px 14px;border-bottom:1px solid #eee4d0;font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#5c564b;">${r.service} &middot; ${when} &middot; ${label}</td>
          </tr>`;
      }).join("");

      await resend.emails.send({
        from: FROM_EMAIL,
        to: [email],
        subject: "Your B&K booking reference number(s)",
        html: `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f2e9;margin:0;padding:0;">
  <tr>
    <td align="center" style="padding:34px 16px;">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:520px;max-width:520px;">
        <tr>
          <td align="center" style="padding-bottom:20px;">
            <img src="https://bk-general-services.vercel.app/logo.png" width="80" height="80" alt="B&amp;K General Services" style="display:block;width:80px;height:80px;border:0;outline:none;text-decoration:none;border-radius:50%;" />
          </td>
        </tr>
        <tr>
          <td style="background-color:#ffffff;border:1px solid #e4dccb;border-radius:16px;padding:30px 28px;font-family:Helvetica,Arial,sans-serif;">
            <h1 style="margin:0 0 8px;font-size:21px;color:#17211b;font-weight:bold;">Your booking reference number(s)</h1>
            <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#5c564b;">Use any of these on the tracking page to check your booking status and pay.</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee4d0;border-radius:10px;border-collapse:separate;overflow:hidden;">
              ${items}
            </table>
            <div style="text-align:center;margin-top:24px;">
              <a href="https://bk-general-services.vercel.app/status.html" style="display:inline-block;background-color:#17211b;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:13px 26px;border-radius:999px;">Track a booking</a>
            </div>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:22px 8px 0;font-family:Helvetica,Arial,sans-serif;">
            <p style="margin:0 0 4px;font-size:13px;font-weight:bold;color:#17211b;">B&amp;K General Services</p>
            <p style="margin:0;font-size:12px;line-height:1.5;color:#9a917f;">Saratoga Springs, UT &middot; (714) 594-9526</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`,
      });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("recall-reference crash:", e);
    return res.status(500).json({ error: `Server error: ${e.message}` });
  }
}
