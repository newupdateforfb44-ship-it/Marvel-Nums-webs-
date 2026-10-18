# 👑 King Social Hub — Setup Guide

This document explains what King Social Hub is, how it's put together, and exactly how to set it up and run it — written for someone with no coding background.

---

## 📁 File Structure

```
ksl-website/
├── server.js          ← Backend (Node.js/Express/MongoDB) — all the logic and API routes live here
├── package.json        ← List of code libraries the project depends on
├── .env                 ← Your secret keys (NEVER share this or push it publicly)
├── .gitignore           ← Tells Git to ignore .env, node_modules, uploads
└── public/
    ├── index.html       ← Main website (marketplace, deposit, chat, etc.)
    ├── style.css        ← All visual styling
    ├── script.js        ← Frontend logic (what runs in the visitor's browser)
    ├── admin.html        ← Admin panel (only reachable via a secret URL)
    ├── game.html          ← Standalone Arcade page
    ├── giveaway.html      ← Standalone Giveaways page
    └── uploads/, files/   ← Local fallback storage (Cloudinary is used instead when configured)
```

---

## 🧩 How The Pieces Fit Together

- **server.js** is the brain — it talks to MongoDB (your database), Flutterwave (payments), Cloudinary (image/file storage), and Google (sign-in).
- **public/** is everything a visitor's browser downloads and runs — the actual pages, buttons, and forms.
- **MongoDB** stores everything permanent: users, listings, transactions, chat messages, giveaways.
- **Render** (or wherever you host this) runs `server.js` continuously, 24/7, so the site is always reachable.
- **GitHub** holds your code. When you push a change to GitHub, Render notices and automatically redeploys your site with the new code — this is called "auto-deploy."

**Important mental model:** editing a file on your phone/computer does nothing to your live site by itself. The file has to reach GitHub, and then Render has to redeploy it. Both steps must actually complete before any change is visible to real visitors.

---

## 🔑 Environment Variables (`.env`) — What Each One Is For

Your `.env` file holds every secret key the server needs. **Never share this file's contents in a chat, screenshot, or public repo.**

| Variable | What it's for |
|---|---|
| `MONGODB_URI` | Connection string to your MongoDB database — this is where ALL your data lives (users, listings, chat, everything) |
| `JWT_SECRET` | Used to sign login sessions — keep this secret and never change it once live (it would log everyone out) |
| `ADMIN_PASSCODE` | The password for your admin panel |
| `ADMIN_SECRET_PATH` | The hidden URL segment for your admin panel (e.g. `yoursite.com/this-value`) |
| `ADMIN_WHATSAPP` | Your WhatsApp number for the "Contact Owner" buttons across the site |
| `SITE_URL` | Your site's real public URL — used for Google Sign-In redirects and other links |
| `CLOUDINARY_*` | Cloudinary account keys — used so uploaded images/files survive server restarts |
| `CLOUDINARY_UNSIGNED_PRESET` | Optional — an unsigned upload preset name from your Cloudinary dashboard. When set, large tutorial videos upload directly from the admin's browser straight to Cloudinary instead of relaying through this server first, which is much faster. Without it, uploads still work, just slower (old relay method). See "Speeding Up Large Video Uploads" below. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | For "Continue with Google" sign-in |
| `SITE_URL` | Optional — your live domain (e.g. `https://klslogs.com`), used to generate correct `og:url` and canonical link tags for search engines / link previews. Without it, those tags are just omitted; everything else still works. |
| `FLW_V3_SECRET_KEY` | Flutterwave v3 secret key — used for payment-link deposits, transaction verification, and webhook processing |
| `FLW_CLIENT_ID` / `FLW_CLIENT_SECRET` | Flutterwave v4 (OAuth) credentials — used only for creating static Virtual Accounts |
| `FLW_ENV` | Set to `live` for real payments, or leave unset/anything else for sandbox testing |
| `FLW_PLATFORM_BVN` | Your BVN — used by Flutterwave to create static virtual accounts for users. Already set to `22852818383`. |
| `FLW_BANK_TRANSFER_BANK_CODE` | Optional — which bank Flutterwave issues virtual accounts under. Defaults to Wema Bank (`035`) if not set. |
| `FLW_WEBHOOK_HASH` | A secret string YOU create (any random text). Add it to Flutterwave Dashboard → Settings → Webhooks as the "Secret Hash". King Social Hub uses it to verify that webhook calls are genuinely from Flutterwave. Webhook URL to set: `https://YOUR-SITE.com/api/webhooks/flutterwave` |

---

## ⚡ Speeding Up Large Video Uploads (Deposit Tutorials)

By default, uploading a big tutorial video (e.g. 25MB+) goes browser → your Render server → Cloudinary, a double hop that's only as fast as your server's own upload bandwidth. To skip that middle hop and upload straight from the browser to Cloudinary:

1. Log into your Cloudinary dashboard → **Settings → Upload**
2. Scroll to **Upload presets** → click **Add upload preset**
3. Set **Signing Mode** to **Unsigned**, give it a name (e.g. `ksl_unsigned`), save
4. Add `CLOUDINARY_UNSIGNED_PRESET=ksl_unsigned` to your `.env` (or Render environment variables)
5. Redeploy

Once set, tutorial video uploads in the admin panel will automatically go directly to Cloudinary and show real upload progress. If this isn't set up, uploads still work — they just go through the old (slower) route automatically as a fallback.

---

## 💳 Flutterwave Deposits (V4 API) — Full Setup Guide

King Social Hub uses **Flutterwave's V4 API** for wallet deposits via bank transfer. Manual receipt upload has been fully removed. Here's exactly how it works and how to set it up.

### How it works (in plain terms)

1. A user goes to the Deposit page and types an amount, e.g. ₦5,000.
2. Your server asks Flutterwave for a **one-time bank account number** tied to that exact amount.
3. The user transfers ₦5,000 from their own bank app to that account number — it's a real bank account, so this works exactly like any normal transfer.
4. The moment the bank transfer completes, Flutterwave instantly notifies your server (this is called a **webhook**).
5. Your server double-checks the payment is real and correct, then credits the user's King Social Hub wallet automatically. No admin action needed, ever.
6. That specific account number then expires (~1 hour) and can't be reused — a fresh one is generated for each deposit attempt.

This account type requires **no BVN** from your users, since it's a temporary ("dynamic") account rather than a permanent one.

**Important: V4 uses OAuth2, not a static Secret Key.** Instead of one fixed key you paste everywhere, your server exchanges a Client ID + Client Secret for a short-lived access token (valid ~10 minutes), and automatically refreshes it — this all happens in the background, you don't need to do anything extra for it.

### Step-by-step setup

**1. Get your Flutterwave V4 credentials**
- Log in to your Flutterwave dashboard: https://dashboard.flutterwave.com
- Go to **Settings → API Keys** (or "Developers")
- Copy your **Client ID**, **Client Secret**, and **Encryption Key** (the Encryption Key isn't used by this build, but keep it saved somewhere safe regardless)
- Use **sandbox/test credentials first** to make sure everything works before going live — Flutterwave's V4 sandbox is a separate environment from live, with its own Client ID/Secret.

**2. Set your Secret Hash (webhook password)**
- In the Flutterwave dashboard, go to **Settings → Webhooks**
- Make sure you're on the **V3 webhook** form (not V4 webhooks) — this build's webhook signature check uses the same `verif-hash` mechanism as V3, which is still how V4 webhook events are secured
- Find the field called **"Secret Hash"** and type in any random string of your own choosing — **maximum 36 characters**. This is NOT given to you by Flutterwave — you invent it yourself.
- Save it there, and remember it exactly — you'll enter the identical value on your own server in the next step.

**3. Set your Webhook URL**
On that same Webhooks page, set the URL to:
```
https://YOUR-DOMAIN-HERE/api/webhooks/flutterwave
```
Replace `YOUR-DOMAIN-HERE` with your actual site domain (e.g. `klslogs.com`).

**4. Add the credentials to your `.env` file**
On GitHub (or wherever you edit your `.env`), fill in:
```
FLW_CLIENT_ID=your-actual-client-id-here
FLW_CLIENT_SECRET=your-actual-client-secret-here
FLW_SECRET_HASH=the-exact-same-random-string-you-set-in-step-2
FLW_ENV=test
```
Leave `FLW_ENV=test` while testing with sandbox credentials. Once you've fully tested and switched to your **live** Client ID/Secret, change this to `FLW_ENV=live`.

**5. Redeploy**
Push these changes to GitHub, wait for Render to redeploy (check the Events/Deploys tab shows "Live"), then test a small real deposit yourself to confirm everything works end-to-end.

### What happens if Flutterwave has an issue

If Flutterwave is briefly down or a request fails, your server:
- **Never pretends the payment happened** — the user sees a clear error and is told nothing was charged
- **Logs the failure** in a "System Errors" table, visible in your admin panel under the **Deposits** tab, so you can see exactly when and why something failed
- Also includes a **manual "Check Now" button** on the user's deposit screen — this asks Flutterwave directly "did this payment actually complete?" as a backup in case the automatic webhook notification is ever delayed or lost in transit
- A background check runs every 15 minutes and flags any deposit stuck "pending" for more than 90 minutes as a System Error, so nothing silently falls through the cracks even in a worst-case scenario where both the webhook and manual check somehow miss a payment

### Testing before going live

Use your sandbox Client ID/Secret first (with `FLW_ENV=test`), complete a fake deposit using Flutterwave's test bank details, confirm your wallet balance updates correctly, then switch to live credentials (`FLW_ENV=live`) only once you've seen the whole flow work.

---

## 🚀 Deploying Changes (GitHub → Render)

Whenever you get updated files (from me, or by editing them yourself):

1. **On GitHub** (mobile app or website): open each changed file, replace its content with the new version, and **Commit changes**. For files where only a small part changed, edit in place — for brand new files, use "Add file → Upload."
2. **Check Render**: go to your Render dashboard → your service → **Events** (or **Deploys**) tab. A new deploy should start automatically within about a minute of your GitHub commit.
3. **Wait for "Live"**: don't test anything until the deploy shows a green "Live" status — "Building" means it's not ready yet, and "Failed" means something broke (check "deploy logs" for the exact error).
4. **Verify**: open your actual site in a **new private/incognito browser tab** (not an old tab you already had open) to make sure you're seeing the real current version, not a cached old one.

---

---

## 🌍 FULL SETUP FROM ZERO — Clone → Render → Truehost Domain → Cloudflare DNS

This is the complete, copy-paste-able guide for anyone who buys, clones or inherits this project.
Follow it top to bottom. Every common error and its fix is listed at the end of this section.

### 0. What you will need (accounts)

| Account | Why | Cost |
|---|---|---|
| GitHub | Stores the code, triggers deploys | Free |
| Render.com | Runs `server.js` 24/7 | Free tier works, **Starter $7/mo recommended** (free tier sleeps) |
| MongoDB Atlas | The database | Free M0 tier is fine to start |
| Cloudinary | Image/file/video storage | Free tier |
| Flutterwave and/or Paystack | Collecting deposits | Pay per transaction |
| Truehost | Buying the domain name | ~$1–$12/yr depending on TLD |
| Cloudflare | DNS + free SSL + CDN + DDoS protection | Free |
| Resend | Sending every email (only provider) | Free tier: 100/day |

---

### 1. Get the code into your own GitHub

```bash
git clone <this-repo-url> kls
cd kls
npm install
```

Then create your own empty repo on GitHub and push:

```bash
git remote remove origin
git remote add origin https://github.com/<your-username>/<your-repo>.git
git branch -M main
git push -u origin main
```

> **Never commit `.env`.** Confirm `.gitignore` contains `.env`, `node_modules`, `public/uploads`.

---

### 2. Create the database (MongoDB Atlas)

1. Go to mongodb.com/atlas → create a free **M0 cluster** (pick a region close to your users, e.g. Frankfurt or Ireland for Nigeria).
2. **Database Access** → Add New Database User → username + a strong password (avoid `@ : / ?` characters, they break the URI).
3. **Network Access** → Add IP Address → **Allow access from anywhere `0.0.0.0/0`**. Render's IPs are dynamic, so this is required.
4. **Connect → Drivers → Node.js** and copy the string. It looks like:
   `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/kls?retryWrites=true&w=majority`
   Replace `USER`/`PASSWORD`, and add the database name (`/kls`) before the `?`.
5. Keep this — it is your `MONGODB_URI`.

---

### 3. Run it locally first (recommended before deploying)

Create a file named `.env` in the project root:

```env
PORT=8080
MONGODB_URI=mongodb+srv://...
JWT_SECRET=<paste a long random string>
SITE_URL=http://localhost:8080
ADMIN_SECRET_PATH=my-secret-admin-path
ADMIN_PASSCODE=<your admin passcode>

# Storage (optional locally, required in production)
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
CLOUDINARY_UNSIGNED_PRESET=

# Payments
FLW_CLIENT_ID=
FLW_CLIENT_SECRET=
FLW_ENV=live
FLW_WEBHOOK_HASH=
FLW_V3_SECRET_KEY=
PAYSTACK_SECRET_KEY=

# Google sign-in (optional)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# SMS/OTP number providers (optional)
GRIZZLY_API_KEY=
GRIZZLY_BASE_URL=

# Email / alerts (optional)
RESEND_DAILY_LIMIT=100
RESEND_RESET_RESERVE=10
MAX_ACCOUNTS_PER_PERSON=5
RESEND_API_KEY=
ALERT_EMAIL_FROM=
ADMIN_ALERT_EMAIL=
ADMIN_WHATSAPP=
```

Generate a strong `JWT_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Then:

```bash
npm run dev      # http://localhost:8080
```

Admin panel is at `http://localhost:8080/<ADMIN_SECRET_PATH>`.

---

### 4. Deploy on Render

1. render.com → **New +** → **Web Service** → **Build and deploy from a Git repository** → connect GitHub → pick your repo.
2. Settings:
   - **Name:** `kls` (this gives you `https://kls.onrender.com`)
   - **Region:** Frankfurt (closest to Nigeria) or Oregon
   - **Branch:** `main`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Starter ($7) — the Free plan sleeps after 15 minutes and kills webhooks/pollers.
3. **Environment → Add Environment Variable**: paste every key from your `.env` (one by one, or use *Add from .env*).
   Set `SITE_URL=https://your-domain.com` (or the onrender URL until the domain is live).
   Do **not** set `PORT` on Render — Render injects it automatically.
4. **Advanced → Health Check Path:** `/` — keeps Render from marking the app unhealthy.
5. Click **Create Web Service** and watch the log until you see the server listening line.
6. Auto-deploy is on by default: every `git push` to `main` redeploys.

**Persistent files:** Render's disk is ephemeral — anything written into `public/uploads` disappears on redeploy. That is why Cloudinary must be configured in production. (If you insist on local storage, add a Render **Disk** mounted at `/opt/render/project/src/public/uploads`.)

---

### 5. Buy the domain on Truehost

1. truehost.cloud (or truehost.com.ng) → search your domain → add to cart → checkout → pay.
2. Open **Client Area → Domains → My Domains → (your domain) → Manage**.
3. You are going to point the domain at **Cloudflare**, not at Truehost DNS, so ignore Truehost's DNS zone editor for now.

---

### 6. Put the domain on Cloudflare

1. cloudflare.com → Sign up → **Add a site** → type your domain → choose the **Free** plan.
2. Cloudflare scans existing records and shows you **two nameservers**, e.g.
   `amy.ns.cloudflare.com` and `rick.ns.cloudflare.com`.
3. Back in **Truehost → My Domains → your domain → Nameservers** → choose **Use custom nameservers** and replace both entries with the Cloudflare ones → Save.
4. Wait for propagation (usually 15 min – 2 hrs, up to 24 hrs). Cloudflare emails you when the site is Active.

---

### 7. Connect Cloudflare DNS → Render

**In Render:** open your service → **Settings → Custom Domains → Add Custom Domain** → add **both**:
- `yourdomain.com`
- `www.yourdomain.com`

Render then shows the exact target values. Typically:
- for `www` → a **CNAME** to `kls.onrender.com`
- for the root (`@`) → either an **A record** to Render's IP (`216.24.57.1`) or a CNAME (Cloudflare supports CNAME flattening at the root).

**In Cloudflare → DNS → Records**, add exactly what Render showed:

| Type | Name | Content | Proxy |
|---|---|---|---|
| CNAME | `www` | `kls.onrender.com` | 🟠 Proxied |
| CNAME (or A) | `@` | `kls.onrender.com` (or the IP Render shows) | 🟠 Proxied |

**Cloudflare → SSL/TLS → Overview → set encryption mode to `Full (strict)`.**
This is the single most common mistake — `Flexible` causes an infinite redirect loop (`ERR_TOO_MANY_REDIRECTS`).

Then **SSL/TLS → Edge Certificates** → turn on **Always Use HTTPS** and **Automatic HTTPS Rewrites**.

Back in Render, wait until each custom domain shows **Verified / Certificate Issued** (a few minutes).

Finally set `SITE_URL=https://yourdomain.com` in Render env vars and redeploy, then update:
- Google OAuth redirect URI → `https://yourdomain.com/auth/google/callback`
- Flutterwave / Paystack webhook URLs → `https://yourdomain.com/api/...` (see the payments section above)

---

### 8. Post-launch checklist

- [ ] Home page loads over `https://` with a padlock
- [ ] Register + login + Google sign-in all work
- [ ] Deposit with a small real amount (₦100 / $1) and confirm the wallet credits
- [ ] Webhook shows a `200` in the Flutterwave/Paystack dashboard
- [ ] Admin panel reachable at `https://yourdomain.com/<ADMIN_SECRET_PATH>`
- [ ] Upload an image in admin (confirms Cloudinary)
- [ ] Buy a number on Server 1 and Server 2
- [ ] `https://yourdomain.com/api/public/live-stats` returns JSON

---

## 🩺 TROUBLESHOOTING — every issue we have actually hit, and the fix

**Render build fails: `npm ERR! code ENOENT ... package.json`**
The repo root must contain `package.json`. If you uploaded the project inside a folder, set Render's **Root Directory** to that folder.

**Render deploys but crashes: `MongooseServerSelectionError` / `connect ETIMEDOUT`**
Atlas Network Access is not open. Add `0.0.0.0/0`. Also check the password in the URI is URL-encoded (`@` → `%40`).

**`MongoParseError: Invalid scheme`** — the URI must start with `mongodb+srv://`. Quotes accidentally pasted into the env value cause this too.

**Site works then dies after 15 minutes** — you're on Render Free (it sleeps). Upgrade to Starter, or accept cold starts.

**`ERR_TOO_MANY_REDIRECTS` after adding Cloudflare** — SSL/TLS mode is `Flexible`. Set it to **Full (strict)**.

**`DNS_PROBE_FINISHED_NXDOMAIN` / domain not resolving** — nameservers at Truehost were not switched, or propagation is still running. Check with `nslookup -type=NS yourdomain.com`.

**Render says `Certificate pending` forever** — the DNS record doesn't match what Render asked for, or Cloudflare proxy is masking it. Temporarily set the record to **DNS only (grey cloud)**, let Render issue the certificate, then re-enable the orange cloud.

**`www` works but the root domain doesn't (or vice-versa)** — both must be added in Render **and** both must exist as DNS records in Cloudflare.

**Deposits not crediting** — the webhook URL still points to the old `onrender.com` address, or `FLW_WEBHOOK_HASH` doesn't match the "Secret hash" field in the Flutterwave dashboard. Check Render logs for the incoming webhook.

**Payments show the wrong currency** — currency is chosen by detected country: Nigeria pays in ₦, everyone else pays in $. Clear the site data / re-select your country on the deposit page if it looks wrong.

**Uploaded images vanish after a deploy** — Cloudinary env vars are missing, so files fell back to local disk which Render wipes. Fill in all four `CLOUDINARY_*` values.

**Google sign-in: `redirect_uri_mismatch`** — add the exact `https://yourdomain.com/auth/google/callback` URI in Google Cloud Console → Credentials → OAuth client.

**Admin page 404** — you're using the wrong `ADMIN_SECRET_PATH`. It is intentionally not linked anywhere.

**Cloudflare shows the old version of the site after a deploy** — Cloudflare → Caching → **Purge Everything**, and enable *Development Mode* while working.

**502 / 503 from Render** — the app crashed on boot. Open **Logs**; 9 times out of 10 it's one missing env variable.

**Emails not sending** — `RESEND_API_KEY` missing/expired, today's 90-email campaign allowance is used up (resets at UTC midnight), or the `ALERT_EMAIL_FROM` address is not verified with the provider.

---

## 📦 Handing the project over / selling it

Give the buyer:
1. The GitHub repository (transfer ownership or invite them).
2. This `Readme.md`.
3. A list of the environment variable **names** (never the values — they should create their own keys).
4. Their own accounts for: MongoDB Atlas, Cloudinary, Flutterwave/Paystack, Google Cloud, Render, Cloudflare, Truehost.

Then have them: rotate `JWT_SECRET`, change `ADMIN_PASSCODE` and `ADMIN_SECRET_PATH`, create fresh payment keys, and update the WhatsApp/support links in `public/index.html` and the admin **Site Links** settings.

---

## 🎮 Games (Arcade)

Games live at `yoursite.com/games` as their own standalone page (separate from the main app). Three games: Void Interceptor (space shooter), Turbo Run (lane racer), Base Defense (tower defense). Each has Easy/Hard/Hardest difficulty and a discrete Level system (a "LEVEL UP!" banner pops up every 300 points). Every player gets a permanent Game ID for score-battles against friends.

## 🎁 Giveaways

Admin posts a giveaway (title, description, credentials, optional image, optional scheduled start time) from the admin panel's **Giveaways** tab. It appears at `yoursite.com/giveaways` for all logged-in users. First person to tap "Claim & Win" gets the credentials revealed instantly and is recorded as the winner — this is race-condition-safe (two people can't both win the same giveaway even if they click at the exact same moment).

## 📖 Login Tutorials

Each listing (single-account or folder/multi-account) can have an optional tutorial — Multiple Images (buyer clicks through them), a Video, or a Link — set from the admin panel's Add/Edit Log form. If none is set, buyers see a clearly disabled "Tutorial Unavailable" button rather than nothing at all.

## 💬 Support Assistant & Auto-Split Multiple Logs — no API key needed

Both of these features run entirely on built-in logic — no external AI service, no API key, no billing:

- **Support Assistant** (Support page): matches a user's question against a small set of common topics (deposits, balance, purchases, delivery, refunds, referrals, the API, Buy Numbers, badges, login) and replies with a canned, accurate answer. If nothing matches, it points the user to WhatsApp support instead of guessing.
- **Auto-Split Multiple Logs** (admin panel, Add/Edit Log form): splits a big pasted block of multiple account logs into separate sub-accounts using pattern detection — blank-line gaps between accounts, numbered entries ("1.", "2)", "Account 1:"), or a repeating field label. For best results, separate each account with a blank line when pasting. If it only detects one entry, it'll say so — paste with clearer separators and try again, or add sub-accounts manually.

## 🏆 Weekly Top-Buyer Reward

Admin panel → **Weekly Reward** tab. Shows a Monday–Sunday leaderboard of who bought the most logs that week. Admin manually clicks "Award ₦50" for the top buyer — this is deliberately manual (not automatic) so you can review the numbers first, and each calendar week can only be paid out once.

## 📦 Sub-Account Auto-Cleanup

For folder listings (multiple sub-accounts, e.g. several TextPlus logins under one product), once a sub-account is sold, it's automatically removed from that listing entirely, and the remaining sub-accounts renumber themselves sequentially (so buyers never see gaps like "Account 1, 2, 4, 5" after Account 3 sells — it becomes "Account 1, 2, 3, 4"). The parent folder listing itself always stays visible, even after every sub-account has sold out.

## 📱 Mobile Navigation Drawer — the standard every page must follow

Every standalone page (`marketplace.html`, `chat.html`, `transactions.html`, `support.html`, `settings.html`, `purchases.html`, `referrals.html`, `apidocs.html`, and `index.html` itself) shares the same JS (`script.js`) and CSS (`style.css`), so the mobile hamburger menu **must** use these exact element IDs/classes on every page, or the hamburger silently does nothing (this was a real bug, fixed — 8 pages had stale IDs from an older drawer design):

```html
<div class="drawer-backdrop" id="drawerBackdrop" onclick="closeMobile()"></div>
<div class="mobile-menu" id="mobileMenu">
  <div class="drawer-header">...</div>
  <a href="/">🏠 Home</a>
  ...
  <div id="mobileAuth">...guest-only links...</div>
  <div id="mobileUser" style="display:none">...logged-in-only links...</div>
</div>
```

The hamburger button itself must keep `id="hamburger"` and `onclick="toggleMobile()"` — `toggleMobile()`/`closeMobile()` in `script.js` look for `#mobileMenu`, `#drawerBackdrop`, `#mobileAuth`, and `#mobileUser` by those exact IDs. If you ever copy this drawer into a new page, copy it from `index.html` (the reference implementation), not from memory — a slightly-off ID here is invisible in the code review but completely breaks mobile navigation on that page.

## 📱 Buy Numbers (SMS/OTP Virtual Numbers)

This is a manually-stocked system, not a live automatic API integration with an SMS provider — admin buys real numbers from their own provider account separately, then pastes them into King Social Hub. In **Admin → Buy Numbers**:
1. Set a ₦ price per provider+country combo (the price sheet).
2. Paste the actual rented phone numbers (one per line) as stock — they use the price sheet automatically unless you set an override price.

Buyers browse available stock at `/buy-number`, rent a number (price deducted immediately, atomically claimed so two buyers can't grab the same one), and poll for the code, which admin has to paste in manually as it arrives from the provider. If no code arrives before the rental window expires, the buyer is refunded automatically.

## ⭐ Reviews — buyer reviews + a separate seller "official" review

Two independent review sources exist per listing (and per sub-account, for folder listings):
- **Buyer reviews** (`reviews[]`) — written by real buyers after a purchase, shown to buyers as normal, always sorted by date.
- **Seller "official" review** (`adminReview`) — a single review admin can attach directly from the Add/Edit Log form, shown separately and **before** purchase (so it can work as proof/preview), supporting text, picture, video, or link. Set `reviewType` to `'none'` to remove it.

Both support the same four content types (text/image/video/link) and both respect the per-category "Show Reviews" toggle in the admin panel.

## 📶 Data / Cable TV / Electricity & Utility Bills

Users can buy MTN/Airtel/Glo/9mobile data, DSTV/GOTV/Startimes cable subscriptions, and prepaid/postpaid electricity — paid straight from their King Social Hub wallet — under the **Data/Bill** nav link.

**How the pricing works:** this reuses the same `FLW_V3_SECRET_KEY` already set up for Payment Link deposits — no new env var needed. When a user buys a plan, King Social Hub charges the plan's list price to King Social Hub's own Flutterwave balance, and deducts your own selling price from the user's King Social Hub wallet. In **Admin → Data/Bill Pricing**, pick a category and provider to pull that provider's live plans from Flutterwave; each row shows Flutterwave's own price next to a "Your Price" field — leave "Your Price" blank to charge the customer exactly Flutterwave's price with zero markup, or set your own price there to add a margin. **Admin → Bill Purchases** shows every purchase with its status.

**Before this works live**, two things need to be true on Flutterwave's side (not something this code can do for you):
1. Your Flutterwave account needs **Bill Payments** enabled — contact Flutterwave support if `/api/bills/*` calls come back empty or erroring.
2. Your Flutterwave **source balance** (the wallet bills get debited from) needs to be funded — this is separate from the money your customers deposit into King Social Hub.

Any purchase that fails on Flutterwave's side is automatically refunded back to the user's King Social Hub wallet, and gets logged to **Admin → Deposits → Payment System Errors** for you to review.

---

## 🔒 Security Notes

- Never paste your `.env` contents, Secret Key, Secret Hash, or database connection string into a chat, screenshot, or public place.
- The admin panel is only reachable via the secret URL in `ADMIN_SECRET_PATH` — don't share this URL publicly, and don't put it in any public file (like `robots.txt`), since that would defeat the purpose of it being secret.
- Regular API keys (`X-API-Key`/`X-API-Secret` for the public `/api/v1/` endpoints) are intentionally separate from admin access (`X-Admin-Passcode`) — an API key alone can never reach admin-only routes.

---

## 🆘 If Something Breaks

1. Check Render's **Events/Deploys** tab first — does it show "Live" (good) or "Failed" (something's broken in the code)?
2. If "Failed," tap **"deploy logs"** to see the exact error message — this almost always tells you exactly which file and line broke.
3. Check your MongoDB connection is still valid (hasn't expired, isn't over its free-tier limit).
4. For payment issues specifically, check the admin panel's **Deposits → Payment System Errors** table first — most payment problems leave a clear trail there.
