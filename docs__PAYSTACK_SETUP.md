# Paystack + Flutterwave gateway switch

Both gateways now run side by side. The admin decides which one(s) customers can use.

## Admin panel
Admin → **Deposit Tutorials / Payment Methods** tab → **Payment Gateways** card.

| Flutterwave | Paystack | What customers see |
|---|---|---|
| ON  | OFF | Flutterwave only (default — same as before) |
| OFF | ON  | Paystack only |
| ON  | ON  | A "Pay with" picker: Flutterwave / Paystack |
| OFF | OFF | Payment Link is greyed out with your message |

Changes apply immediately. A gateway can only be switched ON if its keys exist on the server.
Both gateways can issue Virtual Accounts — switching a gateway OFF stops new accounts for it.
Money already paid is always credited, even if the gateway was switched off a minute later.

## Environment variables
```
PAYSTACK_SECRET_KEY=sk_live_...     # already used for bank-name lookup; now also takes payments
PAYSTACK_ALLOW_USD=false            # set true ONLY if USD is enabled on your Paystack account
SITE_URL=https://your-domain.com    # already required (used for the return/callback URL)
```
Flutterwave variables are unchanged.

## Paystack dashboard
Settings → API Keys & Webhooks → set the **Webhook URL** to:

`https://YOUR-DOMAIN/api/webhooks/paystack`

(No separate hash — Paystack signs webhooks with your secret key, which the server verifies.)
The callback URL is sent per transaction, so you don't need to set one.

## Notes
* Nigerian customers pay in NGN. Foreign customers are billed in USD, so Paystack is only offered to them when `PAYSTACK_ALLOW_USD=true`.
* Every Paystack payment is double-checked against Paystack's API before the wallet is credited; amount, currency and reference must all match.
* Pending Paystack payments are re-checked every 30 seconds, so a missed webhook still self-heals.
* Admin → deposit desk "retry" and the reversal tool work for Paystack deposits too.

## Paystack virtual accounts (bank transfer)
Each Nigerian customer can get a permanent Paystack account number. Transfers to it credit the wallet automatically
(same service fee tiers as the Flutterwave virtual account).

* Needs the **Dedicated Virtual Accounts** feature enabled on your Paystack business (Nigeria; ask Paystack support if the dashboard doesn't show it).
* Optional env var: `PAYSTACK_DVA_BANK=wema-bank` (default). Use `test-bank` while testing, or `titan-paystack`.
* Uses the same webhook URL as above. Events handled: `charge.success`, `dedicatedaccount.assign.success`.
* On the Bank Transfer screen customers see a **Flutterwave / Paystack** picker when both are ON; with one ON it is used automatically.
* Safety nets: every credit is confirmed with Paystack's API, can only happen once per transfer, a background check runs every 2 minutes, and the customer's open Bank Transfer screen re-checks every 30 seconds.
