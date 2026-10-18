# King Social Hub Fixes v3 — Airtime / Data / Utilities

## The real bug (this is why plans never showed up)
`lib/clubkonnect.js` was parsing ClubKonnect's data-bundle response with
`data.plans || data.PRODUCT || data.data`, but ClubKonnect actually nests it:

```json
{ "MOBILE_NETWORK": { "MTN": [ { "ID":"01", "PRODUCT": [ {...}, {...} ] } ], "Glo": [...] } }
```

Since that shape was never checked, `/api/data/plans` always returned an
empty list for **every** network — MTN included — no matter what the user
picked. Fixed with `extractRawPlanRows()` / `normalizePlanRow()`, which walk
the real `MOBILE_NETWORK.<name>[0].PRODUCT` structure (network codes 01–04 are
mapped to ClubKonnect's name keys — `9mobile` comes back as `"m_9mobile"`
since JSON keys can't start with a digit). One shared helper
(`getPricedDataPlans`) now backs the plan dropdown, the purchase route's
server-side price re-check, and the developer API, so there's a single
source of truth.

## Also fixed
- **`/api/data` purchase** now re-fetches the live plan list and rejects a
  stale/tampered `planId` instead of trusting whatever price the browser sent.
- **Verification endpoints** (cable/electricity/betting) now parse the
  provider's response properly — a response with no `customer_name` is
  treated as a failed verification with a friendly message, not silently
  shown as "Verified: [object Object]".
- **Server + client-side validation** added on all 5 purchase forms: Nigerian
  phone format, meter/smartcard digit checks, and per-service amount ranges,
  each with a specific error message instead of a generic failure.
- Removed a stray empty file (`utils/3444`) left over in the zip.
- Sidebar is now `position: sticky` on desktop so it stays in view on long
  pages; mobile drawer behavior is unchanged (it already worked well).

## Not done — screenshot missing
No screenshot of clubkonnect.com came through with your upload (only the
`.zip` attached). I didn't rebuild the utilities page layout against it —
the existing `/services` page already mirrors ClubKonnect's structure
(sidebar with Wallet/Airtime/Data/Cable/Electricity/Betting, quick actions,
breadcrumb, 2-step quote→confirm flow). If you still want the layout matched
more closely to a specific screenshot, resend the image in a new message and
I'll adjust it directly.

## Everything else already worked
Admin profit logic (tiers, ON/OFF switches, dashboard, CSV export),
purchase flow (atomic wallet deduction, auto-refund on failure, pending →
callback settlement), and the utility-page navigation/routing were already
correctly wired — no changes needed there.
