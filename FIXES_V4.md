# FIXES_V4 — review fixes

1. **Ambiguous Nova order (`/api/numbers/buy`)** — timeout / network drop / 5xx / 408 now retries once with the SAME `Idempotency-Key`. Only a clear 4xx rejection refunds immediately. If still unclear, the wallet stays debited and a `needs_review` order is saved (and logged as `[NOVA-REVIEW]`). Admin endpoints: `GET /api/admin/numbers/needs-review`, `POST /api/admin/numbers/:id/resolve` with `{action:'refund'}` or `{action:'confirm', phoneNumber, sessionId}`. (No admin UI yet.)
2. **Double refund (`/api/v1/cancel-number`)** — now claims the order with `findOneAndUpdate({status:'sold', code:''})` before refunding; a concurrent call gets 409.
3. **`public/uploads`** — placeholder files removed, real folders + `.gitkeep`, `.gitignore` fixed, and startup replaces a stray file with a folder.
4. **Developer API** — `/api/v1/buy-number` works again (shared purchase code, wallet-safe; accepts `serviceId`+`serverId`+`country`, or legacy `provider`+`country` = cheapest server). `/api/v1/numbers/options` honours `serverId`, resolves the country like the customer flow, and uses `apiProfitPercent` pricing. `apidocs.html` updated.
5. **Smaller** — error text / frontend regex now match; client sends `expectedPrice` and the server returns 409 `price changed` (no charge) if it differs; failed Nova cancels are retried every 5 min (max 5 tries, 24h) after the customer refund; Nova 401/403 are returned to browsers as 502 so users aren't logged out.

Still needs a real Nova key to verify: country slug conversion, SMS poll response shape, pool step.
