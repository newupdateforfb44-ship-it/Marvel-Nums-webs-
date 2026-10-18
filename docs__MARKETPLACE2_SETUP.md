# Marketplace 2 — NovaSolution digital logs

## Environment configuration
Marketplace 2 now uses the NovaSolution API documented for this project. Add these variables to `.env` for local development or your host's Environment settings (for example Render → Environment):

```env
NOVA_BASE_URL=https://www.novasolution.ng/api/v1
NOVA_API_KEY=your_novasolution_api_key
```

The same `NOVA_API_KEY` and `NOVA_BASE_URL` are shared with Number Server 1 and Boost 2. You only need to configure the key once. Do not put the key in frontend JavaScript, and do not commit a real `.env` file. Restart/redeploy the service after changing environment variables.

## What appears in Marketplace 2?
Marketplace 2 loads the digital-log products exposed by NovaSolution's `GET /catalog/logs` endpoint. Products and stock returned by that endpoint should populate the marketplace. NovaSolution's SMM catalogue (`GET /catalog/smm`) is used by **Boost 2**, not Marketplace 2. If you mean every NovaSolution digital-log product, they will appear only if NovaSolution returns them in its logs catalogue and the API account has permission to access them.

## Admin and customers
- Use Admin → Catalogue / Logs 2 to configure marketplace availability and customer-facing prices where those controls are available.
- Customers use `/marketplace2`; purchases are submitted to NovaSolution using the documented `type: "logs"` order format.
- The supplied documentation does not specify the exact format used to return delivered log credentials. Verify that response format with NovaSolution before assuming automatic credential delivery is fully confirmed.

## Verification
A successful API key setup should allow the server to fetch the NovaSolution logs catalogue. If products do not appear, check server logs, the key's permissions, and the response from `/catalog/logs`. A real catalogue/order test requires a valid API key; do not treat code or ZIP checks as a live provider test.
