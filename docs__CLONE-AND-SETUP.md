# Cloning this site and making it yours

Written for someone with no coding background. Follow it top to bottom.

## 1. Where the "look" lives now

You do **not** need to read `server.js` to rebrand the site.

| What you want to change | Where |
|---|---|
| Site name, tagline, colours, fonts, currency, Telegram/WhatsApp links | `site.config.js` (or the `BRAND_*` lines in `.env`) |
| Page titles/descriptions Google shows | `site.config.js` → `PAGE_SEO_TEMPLATE` |
| Logos, images, page layout | files inside `public/` |
| Prices, listings, tools, announcements | the admin panel — no code |
| Payment/database keys | `.env` only |

`server.js` now reads all of that from `site.config.js`. Anything set in `.env`
overrides the file, so you can rebrand on Render without editing code at all.

Colours are served to every page as `/brand.css`, which each HTML page links
last — so `BRAND_ACCENT` really does repaint buttons, links and highlights.

## 2. Setup in 8 steps

1. **Fork/clone the repo** to your own GitHub account.
2. `cp .env.example .env` and fill it in (every variable is explained inside,
   including exactly which dashboard to copy it from).
3. **MongoDB Atlas** → free M0 cluster → *Connect → Drivers* → copy the URI into
   `MONGODB_URI`. Under *Network Access*, allow `0.0.0.0/0`.
4. **JWT_SECRET** → run
   `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
   and paste the output. Never change it later.
5. **Render.com** → New → Web Service → pick your repo →
   Build command `npm install`, Start command `node server.js`.
   Paste every line of your `.env` into Render's *Environment* tab.
6. **Flutterwave** → Settings → API Keys for the payment keys; Settings →
   Webhooks: URL `https://yourdomain.com/api/webhooks/flutterwave`, Secret Hash =
   the same random text you put in `FLW_SECRET_HASH`.
7. **Cloudinary / Resend / Google** — only if you want uploads, emails and
   Google sign-in. Each one's location is written next to it in `.env.example`.
8. Edit `site.config.js` (name, colours, tagline), commit, wait for Render to
   show **Live**, then open the site in a private tab.

## 3. Rules that save you pain

- `BRAND_TX_PREFIX` shows up on real bank transfers and is used to match
  payments to users. Choose it before launch and never change it.
- Test with Flutterwave **test** keys and `FLW_ENV=test` first.
- Your admin panel is at `https://yourdomain.com/<ADMIN_SECRET_PATH>` — keep
  that value long and unguessable.
- Never paste your `.env` contents into a chat, screenshot or public repo.
