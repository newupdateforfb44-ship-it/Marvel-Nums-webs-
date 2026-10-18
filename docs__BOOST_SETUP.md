# Boosting (SMM) — setup guide

Everything below is done **once**. After that, boosting runs by itself.

## 1. Get your API key

1. Log in at https://reallysimplesocial.com
2. Open **Account → API** (the page also documents every action).
3. Copy the **API key**. It looks like a long random string.
4. Fund your panel balance — orders fail if the panel wallet is empty.

## 2. Add the key to your `.env` file

Your `.env` file lives in the **root folder of the project**, next to
`server.js`. If it does not exist, create a new plain-text file named exactly
`.env` (nothing before the dot, no `.txt` at the end).

Each line is `NAME=value` — no spaces around `=`, no quotes needed:

```env
# ── Social boosting ────────────────────────────────────────────────
BOOST_API_KEY=paste_your_really_simple_social_key_here
BOOST_ENABLED=true
BOOST_API_URL=https://reallysimplesocial.com/api/v2

# Instant status updates (see step 4). Invent any long random word.
BOOST_WEBHOOK_SECRET=choose_a_long_random_secret_here

# How often the server checks order status (optional, these are the defaults)
BOOST_FAST_SWEEP_SECONDS=60     # recent orders, checked every minute
BOOST_FAST_WINDOW_HOURS=6       # "recent" means placed in the last 6 hours
BOOST_SWEEP_MINUTES=5           # full sweep of every open order
BOOST_POLL_SECONDS=15           # how fast the customer's page refreshes

# Fallback dollar rate if the live FX feed is down (optional)
BOOST_FALLBACK_USD_RATE=1600
```

**Then restart the server.** `.env` is only read at start-up.

> Never commit `.env` to GitHub and never paste the key in chat or WhatsApp.
> If a key leaks, regenerate it in the provider panel and update `.env`.

## 3. Turn it on and load the services

- With `BOOST_API_KEY` set and `BOOST_ENABLED=true`, boosting switches itself
  on at start-up and pulls the service catalogue automatically the first time
  someone opens **/boost**.
- To do it manually: **Admin panel → Boosting (SMM)** → tick *Boosting is live*
  → **Save settings** → **Sync service catalogue**.
- In the **Services** table you can hide any service, write your own short
  description, and set the delivery time customers see (e.g. `0–6 hours`).

If the boost page says *"still loading from our provider"*, the catalogue has
not synced yet — press **Sync service catalogue** and check the status line for
the last error.

## 4. Instant updates (webhook)

In the provider panel, set the status-callback / webhook URL to:

```
https://klslogs.com/api/boost/webhook?secret=YOUR_BOOST_WEBHOOK_SECRET
```

(the same value you put in `BOOST_WEBHOOK_SECRET`). The secret may also be sent
as an `X-Boost-Secret` header.

The webhook only tells King Social Hub *which* order changed — the real status is always
re-read from the provider API, so a fake call can never mark an order delivered
or trigger a refund.

If your provider plan has no webhooks, nothing breaks: the fast sweep
(`BOOST_FAST_SWEEP_SECONDS`, default every 60s) plus the customer page poll
(`BOOST_POLL_SECONDS`, default 15s) keep statuses close to real time. Lower
those numbers for faster updates, raise them to reduce provider API calls.

## 5. Pricing / profit

Profit is a flat naira markup per order, by quantity, editable in
**Admin → Boosting (SMM)**:

| Quantity      | Profit added |
|---------------|--------------|
| up to 499     | ₦350         |
| 500 – 999     | ₦500         |
| 1,000 – 4,999 | ₦700         |
| 5,000 – 10,000| ₦1,200       |
| above         | ₦2,000       |

Customer price = provider cost (rate × quantity ÷ 1000 × dollar rate) + profit,
rounded up to the nearest ₦10, and it updates live as the quantity changes.

## 6. Turning boosting off

Untick *Boosting is live* in the admin panel. The page then shows your
"boosting is off" message. Everything else on the site is unaffected.
