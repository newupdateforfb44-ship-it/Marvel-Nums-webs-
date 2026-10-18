# King Social Hub — NovaSolution migration update

## Implemented in this archive
- Removed OTP Suite references/integration from the active backend, customer number flow, admin provider UI, and environment template.
- Replaced Server 1 catalog loading with NovaSolution server/country/service data. Server 2 remains GrizzlySMS.
- Added live NovaSolution balance and catalog checks to Admin → Numbers.
- Connected Server 1 purchase requests to the local wallet with an atomic balance deduction, purchase transaction, referral commission, local order record, and refund credits for provider failures/incomplete orders or cancellations/expiry.
- Added Nova session polling, completion notification after an SMS arrives, and provider cancellation handling.
- Kept the Nova API key server-side in Render environment variables.
- Excluded the uploaded `.env` and secrets from the archive.

## Verification performed
- `node --check server.js` passes.
- ZIP archive integrity and frontend inline-script syntax are checked during packaging.
- A live NovaSolution purchase, SMS arrival, provider cancellation, and balance reconciliation were not tested because this environment does not have a valid provider key/balance.

## Important remaining provider-documentation blocker
The NovaSolution API documentation provided for this work has no distinct pool-list endpoint and the documented order body only accepts `service_id`. It does not define `pool_id` or say that `server_id` is the pool selector. The implemented picker selects a Nova server, then country, then service; a separate selectable pool step must wait for NovaSolution to document the pool endpoint/field. Do not claim that exact four-step selection is fully complete until Nova confirms the correct API.

## Deploy to Render
Use Node, build command `npm install`, start command `npm start`. Set `MONGODB_URI`, `JWT_SECRET`, `ADMIN_PASSCODE`, `ADMIN_SECRET_PATH`, `SITE_URL`, and `NOVA_API_KEY` in Render Environment. See `NOVASOLUTION_RENDER_SETUP.md`.

## Security
Rotate every credential that was present in the originally uploaded `.env` file before deploying, including database, JWT/admin, payment, email, Cloudinary, and provider secrets.

## NovaSolution social products update (2026-10-15)
- Boost 2 now has a server-side NovaSolution SMM catalogue and order path using `GET /catalog/smm` and `POST /orders` with `type: "smm"`, `item_id`, `quantity`, and `payload.link`.
- Added Admin → Boosting → Boost 2 pricing controls for per-service markup or specific selling price, plus enable/disable.
- Marketplace 2 now loads products from `GET /catalog/logs`, checks `/balance`, and submits `POST /orders` with `type: "logs"` and `product_id`.
- Both NovaSolution features use `NOVA_API_KEY` and `NOVA_BASE_URL` server-side. No Really Simple Social or RakibSocials API is used by Boost 2 or Marketplace 2. Boost 1 remains on its existing provider as requested.
- Live provider orders were not tested because no valid NovaSolution API key was supplied in this editing environment. Nova's supplied logs docs do not specify how purchased product credentials are returned from POST /orders, so Marketplace 2 delivery payload behavior requires a sandbox/live test against the actual account.
