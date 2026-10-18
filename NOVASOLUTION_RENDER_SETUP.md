# NovaSolution + Render setup

## Migration status
The OTP Suite integration has been removed from the customer number flow, admin provider UI, and active backend integration. Server 1 now uses NovaSolution; Server 2 remains GrizzlySMS. The customer Server 1 flow loads NovaSolution servers and countries, filters services by the selected server, shows the configured naira price, creates a wallet-backed order, polls for SMS, and supports cancellation/refunds.

**Pool-selection limitation:** the NovaSolution documentation supplied for this migration documents `GET /catalog/numbers` returning `servers`, `countries`, and `services`, and `POST /orders` accepting only `service_id`. It does not document a separate pool catalog, `pool_id`, or a pool parameter on order creation. Therefore a distinct selectable pool step cannot be implemented or honestly verified from those docs alone. Ask NovaSolution for the pool endpoint/field (or confirmation that `server_id` is the pool), then wire that documented field before claiming the exact Server → Country → Service → Pool → Purchase sequence is complete.

## Render environment
Create a Node Web Service, build command `npm install`, start command `npm start`. Set `MONGODB_URI`, `JWT_SECRET`, `ADMIN_PASSCODE`, `ADMIN_SECRET_PATH`, `SITE_URL`, `NOVA_API_KEY`, and (optionally) `NOVA_BASE_URL` in Render Dashboard → Environment. `NOVA_BASE_URL` defaults to `https://www.novasolution.ng/api/v1`. The same NovaSolution credentials are shared by Number Server 1, Boost 2 (SMM catalogue), and Marketplace 2 (digital logs catalogue); configure the key once. Do not commit `.env` or provider keys.

## NovaSolution catalogue split
- **Boost 2** reads `GET /catalog/smm` and submits SMM orders.
- **Marketplace 2** reads `GET /catalog/logs` and submits digital-log orders.
- **Number Server 1** uses the documented NovaSolution number endpoints.
These are separate catalogues: SMM services belong in Boost 2, while digital-log products belong in Marketplace 2. Only items returned by the relevant endpoint and permitted for the API account can be displayed.

## Admin controls
Admin → Numbers provides the Server 1 enabled toggle, the editable naira profit ladder, NovaSolution balance check, and live catalog check. The API key remains a server-side Render secret and is never shown to customers or stored in the browser.

## Safety and verification notes
- Purchases validate the chosen server/service against a fresh Nova catalog.
- Wallet debit is atomic and happens before the provider order; provider failures and incomplete orders trigger a wallet credit and transaction record.
- Nova sessions are stored on the user's number order so status polling and cancellation can be tied to that order.
- Automatic expiry refunds remain part of the shared number-order lifecycle.
- The repository can be syntax-checked locally, but a real provider purchase/SMS/cancel test cannot be claimed without a valid NovaSolution API key and provider-side test balance.

## Credential safety
The uploaded archive's `.env` file was excluded from the updated ZIP. Rotate credentials that were present in that file, especially MongoDB, JWT/admin secrets, payment credentials, email, Cloudinary, and provider API keys. Add replacement secrets only in Render Environment.
