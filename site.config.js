// ─────────────────────────────────────────────────────────────────────────────
//  SITE CONFIG — the ONE file you edit when you clone this project.
//
//  Everything here controls how the site *looks and reads*: its name, tagline,
//  colours, contact links and the page titles Google shows. None of it is
//  business logic, so you can change any value safely and redeploy.
//
//  Two ways to change a value:
//    1. Edit the fallback text below (after the `||`), or
//    2. Set the matching variable in your .env / Render environment.
//       The .env value always wins, so you can rebrand without touching code.
//
//  IMPORTANT: BRAND.txPrefix appears on real bank transfers and is used to
//  match incoming payments to users. Pick it once, before you go live, and
//  never change it afterwards.
// ─────────────────────────────────────────────────────────────────────────────

const env = process.env;

const BRAND = {
  // Names shown across the site, emails and browser tab
  name:      env.BRAND_NAME      || 'King Social Hub',                       // short name, e.g. "King Social Hub"
  fullName:  env.BRAND_FULL_NAME || 'King Social Hub', // long name for the homepage title
  tagline:   env.BRAND_TAGLINE   ||
    "Nigeria's marketplace for verified social media accounts and digital tools — secure wallet, instant delivery, real reviews.",

  // Your live domain, no https:// (used for sitemap + link previews)
  domain:    (env.BRAND_DOMAIN || env.SITE_URL || 'klslogs.com').replace(/^https?:\/\//, '').replace(/\/.*$/, ''),

  // Prefix stamped on payment references and bank narrations. SET ONCE.
  txPrefix:  (env.BRAND_TX_PREFIX || 'KSH').toUpperCase(),

  // Contact / community links shown in the header, footer and support page
  whatsapp:  env.ADMIN_WHATSAPP   || '',
  telegram:  env.BRAND_TELEGRAM   || 'klslogs',
  supportEmail: env.SUPPORT_EMAIL || 'support@klslogs.com',

  // Look and feel. These are injected into the pages as CSS variables at
  // /brand.css, so changing them here restyles the whole site.
  theme: {
    accent:      env.BRAND_ACCENT      || '#16a34a', // buttons, links, highlights
    accentDark:  env.BRAND_ACCENT_DARK || '#15803d', // hover state
    accentSoft:  env.BRAND_ACCENT_SOFT || '#a9c8ff', // subtle accents
    headingFont: env.BRAND_HEADING_FONT || "'Sora', sans-serif",
    bodyFont:    env.BRAND_BODY_FONT    || "'Plus Jakarta Sans', system-ui, sans-serif"
  },

  // Currency shown to shoppers
  currency: env.BRAND_CURRENCY || 'NGN',
  currencySymbol: env.BRAND_CURRENCY_SYMBOL || '₦'
};

// Page titles / descriptions Google and WhatsApp previews use.
// {brand} is replaced with BRAND.name automatically.
const PAGE_SEO_TEMPLATE = {
  '/':             { title: '{full} | Social Media Accounts & Digital Tools', description: '{tagline}' },
  '/marketplace':  { title: 'Marketplace — Browse Verified Logs | {brand}', description: 'Shop verified Gmail, Instagram, Facebook, WhatsApp and other account logs — instant delivery after purchase.' },
  '/tools':        { title: 'Tools & Software — {brand}', description: 'Premium tools and software licenses, delivered instantly to your {brand} account.' },
  '/wallet':       { title: 'My Wallet — {brand}', description: 'See your {brand} balance instantly, with a clear breakdown of confirmed and pending deposits.' },
  '/deposit':      { title: 'Deposit Funds — {brand} Wallet', description: 'Fund your {brand} wallet by bank transfer or card in seconds.' },
  '/purchases':    { title: 'My Purchases — {brand}', description: 'View everything you\u2019ve bought on {brand}, with instant access to your delivered items.' },
  '/transactions': { title: 'Transaction History — {brand}', description: 'Track every deposit, purchase, and refund on your {brand} account.' },
  '/support':      { title: 'Support — {brand}', description: 'Get help with deposits, purchases, and refunds — chat with the {brand} Assistant or WhatsApp support.' },
  '/settings':     { title: 'Account Settings — {brand}', description: 'Manage your {brand} account, theme, and API access.' },
  '/login':        { title: 'Login — {brand}', description: 'Log in to your {brand} account.' },
  '/register':     { title: 'Create an Account — {brand}', description: 'Sign up for {brand} to buy verified accounts, tools, and more.' },
  '/terms':        { title: 'Terms & Conditions — {brand}', description: '{brand}\u2019s terms and conditions of use.' },
  '/api-docs':     { title: 'Developer API Documentation — {brand}', description: 'Integrate with the {brand} marketplace API — check balance, browse listings, and buy items via REST endpoints.' },
  '/groups':       { title: 'Community Groups — {brand}', description: 'Chat with the {brand} community.' },
  '/messages':     { title: 'Messages — {brand}', description: 'Your direct messages on {brand}.' },
  '/referrals':    { title: 'Referral Program | {brand}', description: 'Invite friends to {brand} and earn commission on every purchase they make.' },
  '/notifications':{ title: 'Notifications — {brand}', description: 'Your recent deposits, purchases, and account activity on {brand}.' }
};

function fill(s) {
  return String(s)
    .replace(/\{brand\}/g, BRAND.name)
    .replace(/\{full\}/g, BRAND.fullName)
    .replace(/\{tagline\}/g, BRAND.tagline);
}

const PAGE_SEO = Object.fromEntries(
  Object.entries(PAGE_SEO_TEMPLATE).map(([p, m]) => [p, { title: fill(m.title), description: fill(m.description) }])
);

// Stylesheet served at /brand.css so every page picks up the colours above.
function brandCss() {
  const t = BRAND.theme;
  return `:root{--gold:${t.accent};--gold2:${t.accentDark};--gold3:${t.accentSoft};` +
         `--accent:${t.accent};--brand-heading-font:${t.headingFont};--brand-body-font:${t.bodyFont}}\n` +
         `body{font-family:var(--brand-body-font)}\n` +
         `h1,h2,h3,.brand-ksl{font-family:var(--brand-heading-font)}\n`;
}

// Safe subset the browser may read (never put secrets here).
function publicBrand() {
  return {
    name: BRAND.name, fullName: BRAND.fullName, tagline: BRAND.tagline,
    domain: BRAND.domain, whatsapp: BRAND.whatsapp, telegram: BRAND.telegram,
    supportEmail: BRAND.supportEmail, theme: BRAND.theme,
    currency: BRAND.currency, currencySymbol: BRAND.currencySymbol
  };
}

module.exports = { BRAND, PAGE_SEO, brandCss, publicBrand };
