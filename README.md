# B&K General Services — Customer Site (with email verification)

Static booking page (`index.html`) plus two **Vercel serverless functions** in
`api/` that send a 6-digit code via Resend and create the booking only after the
code is verified. This blocks bots, because bookings can no longer be inserted
straight from the browser.

## ⚠️ Important — this is no longer "just index.html"

This version depends on the `api/` folder **and** environment variables. If you
deploy `index.html` by itself, the booking form will break at the "Next" step.
**Commit the whole folder (`index.html` + `api/`) and set the env vars below.**

## What you need first

1. **A Resend account** → https://resend.com (free tier is fine). Create an
   **API key**.
2. **A verified sending domain in Resend.** To email codes to real customers you
   must add Resend's DNS records for a domain you own. *Until a domain is
   verified, Resend will only deliver to your own account email* — fine for
   testing, not for customers.

I can't create the Resend account or get the key for you — grab the API key from
your Resend dashboard.

## Set environment variables in Vercel

Vercel project → **Settings → Environment Variables** → add these (all
environments):

| Name | Value |
|------|-------|
| `RESEND_API_KEY` | your Resend API key (`re_...`) |
| `FROM_EMAIL` | `B&K General Services <bookings@yourdomain.com>` (an address on your verified domain) |
| `SUPABASE_URL` | `https://dcstdsibvywmythzkltn.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | your Supabase secret key (`sb_secret_...`) |

These run **server-side only** in the functions — they are never sent to the
browser, so the service-role key is safe here. (Don't prefix them or use them in
client code.)

> For a quick test before verifying a domain, you can leave out `FROM_EMAIL`
> (it defaults to Resend's `onboarding@resend.dev`) and book using your own
> Resend account email as the customer email.

## Deploy

1. Put `index.html` and the `api/` folder in your `BKGeneralServices` repo.
2. Commit & push → Vercel builds and creates the functions automatically.
3. Submit a test booking. You should receive a 6-digit code by email, then the
   booking appears in your admin dashboard as **Reviewing**.

## Final step — lock the database (do this AFTER a test booking works)

Once verification is confirmed working, run this in the Supabase **SQL Editor**
to stop the public key from inserting directly (so every booking must go through
email verification):

```sql
drop policy if exists "Public can submit bookings" on public.bookings;
```

After this, the anon/publishable key can't read OR write `bookings` at all —
only your verified-booking function (service role) can. That's the fully
locked-down state.

## Customer order-status page (`status.html`)

Customers track a booking at **`/status.html`** by entering their **email + the
reference number** from their confirmation. It shows a status timeline and, once
you've quoted the job, the price plus a **Pay now** button that opens the Square
link you attached in the admin dashboard.

There are now **three** functions in `api/` — `send-code`, `verify-and-book`, and
`order-status`. They all use the same `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
env vars, so no new variables are needed for the status page.

## How the flow works

```
Book:   Fill form → Next → /api/send-code (emails a 6-digit code)
                  → enter code → /api/verify-and-book (creates booking, status "reviewing")

You:    Admin dashboard → set price + paste a Square link → status "quoted"

Pay:    Customer → /status.html (email + reference) → sees quote → Pay now → Square
```

Online payment happens on the status page **after** you've quoted, since there's
no price to charge at booking time. Codes expire after 10 minutes, allow 5
attempts, and are rate-limited to 3 per email per 10 minutes.
