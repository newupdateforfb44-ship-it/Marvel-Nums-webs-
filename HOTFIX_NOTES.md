# King Social Hub Hotfix — Deployment Issues Resolved

## Issues Fixed

### 1. ✅ Rate-Limit Trust Proxy Error (Render Deployment)
**Error**: `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` — rate-limiter couldn't identify users correctly

**Fix**: Added `trustProxy: true` to the `express-rate-limit` configuration. This tells express-rate-limit to trust the `X-Forwarded-For` header from reverse proxies (Render, Heroku, etc.), allowing it to correctly identify users and enforce rate limits.

**File**: `server.js` (around line 65)

---

### 2. ✅ Category Manager Not Working
**Issue**: "Add Category" button in admin panel wasn't creating categories

**Root Cause**: 
- Category dropdown list (`lCat`/`eCat`) was trying to load from `/api/admin/categories` which requires admin passcode
- The dropdown was being loaded before admin logged in, causing silent failures
- Error feedback wasn't visible to the user

**Fix**:
- `loadCategoriesIntoSelects()` now uses public `/api/categories` endpoint (no auth required) for the dropdown
- Added better error handling and user-friendly messages
- `addCategory()` now shows feedback: "Creating...", then "✅ Category added!" or error with reason
- `loadCategories()` shows clear error messages if admin isn't logged in

**Files**: `public/admin.html`

---

### 3. ✅ Reviews Now Support Images/Links/Text
**Issue**: Reviews were text-only; buyers wanted to share pictures, links, or text reviews

**Solution**: Updated review schema to support three types of review content:
- `text` — plain text comment (e.g. "Great account, still working!")
- `image` — image URL (e.g. screenshot proving the account works)
- `link` — clickable link (e.g. proof video on YouTube)

**Changes**:
- Review schema: `{ rating, reviewType, content }` instead of just `{ rating, comment }`
- Works for both simple logs AND sub-account reviews
- Backend accepts any review type; frontend can display accordingly

**Files**: `server.js` (review schemas and POST route)

---

## Deployment Instructions (Updated)

1. **Replace files**:
   - `server.js` (rate-limit + review fixes)
   - `public/admin.html` (category manager + review type support)

2. **No database migration needed** — MongoDB is flexible; old reviews with `comment` field still work

3. **Restart server** and test:
   - Try adding a category from admin panel
   - Create a simple log (should work)
   - Create a folder log with sub-accounts (should work)
   - Buy something and leave a review (text, image, or link)

---

## Testing Checklist

- [ ] Rate limiter working (no `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`)
- [ ] Admin can create a category (shows "Creating..." then "✅ Category added!")
- [ ] Category appears in "Add New Log" form
- [ ] Category manager loads categories table (toggle Show Reviews for each)
- [ ] Create simple log with new category
- [ ] Create folder log with sub-accounts
- [ ] Purchase a log/sub-account
- [ ] Leave a review with text, image URL, or link
- [ ] Review displays correctly (if category has reviews enabled)

---

## Notes for Future Work

- Reviews now support rich content (image/link/text) but UI isn't built yet — the backend accepts it, frontend can render it
- Consider building a review display component to show images/links nicely in the buyer-facing UI
- Rate limiter is set to 120 requests/min — adjust if needed for your traffic


---

## Boost (SMM) fixes — 12 Aug 2026

**1. Only Instagram / Threads / Twitter services showed up**
`syncCatalogue()` did one `findOne` + `save` round-trip per service inside the
HTTP request. Really Simple Social returns ~747 services, so the request died
part-way through and the catalogue kept only the first ~159 rows — exactly the
Instagram, Threads and Twitter block. It now builds one `bulkWrite` per 200
services, guards every row individually, and never aborts the run.
Verified against the live panel: **747 services stored, 667 live, 11 platforms**
(Instagram, Threads, Twitter, TikTok, YouTube, Facebook, Telegram, Snapchat,
Reddit, LinkedIn, Spotify).
`ensureCatalogue()` now also self-heals a truncated or stale catalogue instead
of only refilling an empty one.

**2. Prices were ~1600× too high**
The panel bills in **NGN** (`action=balance` → `{"currency":"NGN"}`), but the
code multiplied the panel rate by the USD→NGN rate. Pricing now uses a
`providerCurrency` setting (default NGN, auto-detected on every catalogue sync)
and only applies FX when the panel is genuinely not in naira.

**3. /boost page rebuilt**
Single-column order form: Search → Category → Service → Description → Link →
Quantity (with `Min: … Max: …`) → Average time → Charge → Submit.

**4. Admin → Boost**
Tab renamed to "Boost". On/off switch, panel currency, and the profit table are
all editable, with add/remove rows and a "Reset to defaults" button.
Default profit tiers:

| Quantity        | Profit  |
|-----------------|---------|
| 1 – 500         | ₦350    |
| 501 – 1,000     | ₦450    |
| 1,001 – 5,000   | ₦700    |
| 5,001 – 10,000  | ₦1,200  |
| 10,001 – 20,000 | ₦2,000  |
| above 20,000    | ₦2,000  |
