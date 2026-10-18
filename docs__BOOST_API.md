# King Social Hub Boost API (v1)

Resell social-media boosting (followers, likes, views, subscribers) from your own
app, using your King Social Hub wallet. Same catalogue, same prices and the same upstream
provider (Really Simple Social) that powers the King Social Hub website.

- **Base URL:** `https://klslogs.com`
- **Money:** all prices are **NGN**, charged to your King Social Hub wallet balance.
- **Auth:** API key pair, sent as headers (generate it in **Settings → Developer API**).

```
X-API-Key:    ksl_live_xxxxxxxxxxxxxxxxxxxxxxxx
X-API-Secret: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Content-Type: application/json
```

> **No webhooks.** The upstream panel does not send callbacks, so King Social Hub does not
> either. Poll `GET /api/v1/boost/order/:id` (King Social Hub refreshes it live from the
> provider on every call). Polling every 2–5 minutes is plenty; orders rarely
> change faster than that.

---

## 1. `GET /api/v1/boost/services`

Full catalogue with **your** NGN price.

Optional query: `?platform=Instagram`, `?search=followers`

```json
{
  "ok": true,
  "count": 812,
  "services": [
    {
      "serviceId": "1435",
      "name": "Instagram Followers [Real] [30 Days Refill]",
      "platform": "Instagram",
      "category": "Instagram Followers",
      "type": "Default",
      "min": 100,
      "max": 100000,
      "refill": true,
      "cancel": false,
      "pricePer1000Ngn": 2450.75,
      "deliveryTime": "Usually starts within 0–6 hours"
    }
  ]
}
```

## 2. `POST /api/v1/boost/quote`

Exact price before you commit. Nothing is charged.

```json
{ "serviceId": "1435", "quantity": 500 }
```

```json
{ "ok": true, "serviceId": "1435", "name": "Instagram Followers", "quantity": 500,
  "priceNgn": 1575.38, "currency": "NGN", "deliveryTime": "Usually starts within 0–6 hours" }
```

## 3. `POST /api/v1/boost/order`

Charges your wallet and places the order. If the provider rejects it, the wallet
is refunded automatically in the same request (`"charged": false`).

```json
{ "serviceId": "1435", "link": "https://instagram.com/yourpage", "quantity": 500 }
```

```json
{ "ok": true, "orderId": "66f0c1a2b3c4d5e6f7a8b9c0", "status": "Pending",
  "quantity": 500, "priceNgn": 1575.38, "balanceNgn": 18424.62 }
```

## 4. `GET /api/v1/boost/order/:orderId`

Live status. While the order is open, King Social Hub pulls fresh numbers from the provider.

```json
{
  "ok": true,
  "order": {
    "id": "66f0c1a2b3c4d5e6f7a8b9c0",
    "service": "Instagram Followers [Real]",
    "link": "https://instagram.com/yourpage",
    "quantity": 500,
    "price": 1575.38,
    "status": "In progress",
    "bucket": "pending",
    "startCount": 1204,
    "remains": 220,
    "createdAt": "2026-08-12T09:14:02.101Z"
  }
}
```

`bucket` is the simple one to switch on: `pending` · `delivered` · `failed`.

## 5. `GET /api/v1/boost/orders?status=pending&limit=50`

Your order history (`status` = `all|pending|delivered|failed`, `limit` 1–200).

## 6. `POST /api/v1/boost/order/:orderId/refill`

Only for **completed** orders on services where `refill: true`.

## 7. `GET /api/v1/boost/balance`

```json
{ "ok": true, "balanceNgn": 18424.62, "currency": "NGN" }
```

---

## Errors

Every failure is JSON: `{ "ok": false, "error": "human readable reason" }`.

| Status | Meaning | What to do |
|--------|---------|------------|
| 400 | Bad input (quantity out of range, bad link) | Fix the field named in `error` |
| 401 | Missing/invalid `X-API-Key` / `X-API-Secret` | Regenerate in Settings → Developer API |
| 402 | Insufficient wallet balance | Top up, then retry |
| 403 | Account restricted | Contact support |
| 404 | Unknown `serviceId` or order | Refresh the catalogue |
| 502 | Provider rejected or is unreachable | Nothing was charged — retry in a minute |
| 503 | Boosting temporarily switched off | Retry later |

Retry rule of thumb: retry **502/503** with backoff; never blind-retry a 402 or a
400. `POST /order` is *not* idempotent — if you get a network timeout, call
`GET /api/v1/boost/orders?limit=5` before re-sending.

---

## Full example — Node.js

```js
// npm i node-fetch@3   (or use global fetch on Node 18+)
const BASE = 'https://klslogs.com';
const HEADERS = {
  'Content-Type': 'application/json',
  'X-API-Key': process.env.KLS_API_KEY,
  'X-API-SECRET': process.env.KLS_API_SECRET,
};

async function kls(path, options = {}) {
  const res = await fetch(BASE + path, { ...options, headers: HEADERS });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); }
  catch { throw new Error(`King Social Hub returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`); }
  if (!res.ok || body.ok === false) {
    const err = new Error(body.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.retryable = res.status === 502 || res.status === 503;
    throw err;
  }
  return body;
}

async function boost(link, quantity) {
  // 1. find a service
  const { services } = await kls('/api/v1/boost/services?platform=Instagram&search=followers');
  const service = services.find(s => quantity >= s.min && quantity <= s.max);
  if (!service) throw new Error('No Instagram followers service accepts that quantity');

  // 2. price it
  const quote = await kls('/api/v1/boost/quote', {
    method: 'POST',
    body: JSON.stringify({ serviceId: service.serviceId, quantity }),
  });
  console.log(`Price: ₦${quote.priceNgn}`);

  // 3. check the wallet
  const { balanceNgn } = await kls('/api/v1/boost/balance');
  if (balanceNgn < quote.priceNgn) throw new Error('Top up your King Social Hub wallet first');

  // 4. order
  const order = await kls('/api/v1/boost/order', {
    method: 'POST',
    body: JSON.stringify({ serviceId: service.serviceId, link, quantity }),
  });
  console.log('Order placed:', order.orderId);

  // 5. poll until it finishes (no webhooks upstream)
  for (;;) {
    await new Promise(r => setTimeout(r, 120000)); // 2 minutes
    const { order: o } = await kls(`/api/v1/boost/order/${order.orderId}`);
    console.log(o.status, 'remaining:', o.remains);
    if (o.bucket !== 'pending') return o;
  }
}

boost('https://instagram.com/yourpage', 500)
  .then(o => console.log('Finished:', o.status))
  .catch(e => console.error('Boost failed:', e.message, '| retryable:', !!e.retryable));
```

## Full example — PHP

```php
<?php
class KlsBoost
{
    private $base = 'https://klslogs.com';
    private $key, $secret;

    public function __construct(string $key, string $secret)
    { $this->key = $key; $this->secret = $secret; }

    private function call(string $path, string $method = 'GET', array $payload = null)
    {
        $ch = curl_init($this->base . $path);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_TIMEOUT        => 40,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'X-API-Key: ' . $this->key,
                'X-API-Secret: ' . $this->secret,
            ],
        ]);
        if ($payload !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
        $raw    = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $cerr   = curl_error($ch);
        curl_close($ch);

        if ($raw === false)                 throw new Exception("Network error: $cerr");
        $data = json_decode($raw, true);
        if (json_last_error() !== JSON_ERROR_NONE)
            throw new Exception("Non-JSON reply (HTTP $status): " . substr($raw, 0, 200));
        if ($status >= 400 || (isset($data['ok']) && $data['ok'] === false))
            throw new Exception(($data['error'] ?? "HTTP $status") . " [$status]");
        return $data;
    }

    public function services(array $q = []) { return $this->call('/api/v1/boost/services?' . http_build_query($q)); }
    public function quote($id, $qty)        { return $this->call('/api/v1/boost/quote', 'POST', ['serviceId' => $id, 'quantity' => $qty]); }
    public function order($id, $link, $qty) { return $this->call('/api/v1/boost/order', 'POST', ['serviceId' => $id, 'link' => $link, 'quantity' => $qty]); }
    public function status($orderId)        { return $this->call('/api/v1/boost/order/' . $orderId); }
    public function balance()               { return $this->call('/api/v1/boost/balance'); }
}

try {
    $api   = new KlsBoost(getenv('KLS_API_KEY'), getenv('KLS_API_SECRET'));
    $quote = $api->quote('1435', 500);
    echo "Price: NGN {$quote['priceNgn']}\n";
    $order = $api->order('1435', 'https://instagram.com/yourpage', 500);
    echo "Order {$order['orderId']} placed\n";
    $state = $api->status($order['orderId']);
    echo "Status: {$state['order']['status']}\n";
} catch (Exception $e) {
    echo 'Boost failed: ' . $e->getMessage() . "\n";
}
```

## Full example — cURL

```bash
curl -s https://klslogs.com/api/v1/boost/services \
  -H "X-API-Key: $KLS_API_KEY" -H "X-API-Secret: $KLS_API_SECRET"

curl -s -X POST https://klslogs.com/api/v1/boost/order \
  -H "X-API-Key: $KLS_API_KEY" -H "X-API-Secret: $KLS_API_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"serviceId":"1435","link":"https://instagram.com/yourpage","quantity":500}'
```

---

## How King Social Hub talks to Really Simple Social (internal reference)

One endpoint, form-encoded `POST`, JSON back — `lib/boost.js → providerCall()`:

| Action | Params | Returns |
|--------|--------|---------|
| `services` | — | catalogue with `rate` per 1000 |
| `add` | `service`, `link`, `quantity` | `{ "order": 23501 }` |
| `status` | `order` *or* `orders=1,2,3` | `charge`, `start_count`, `status`, `remains`, `currency` |
| `refill` | `order` | `{ "refill": "1" }` |
| `refill_status` | `refill` | `{ "status": "Completed" }` |
| `cancel` | `orders=1,2` | `[{ "order":1, "cancel": {...} }]` |
| `balance` | — | `{ "balance": "100.84", "currency": "USD" }` |

Errors come back as `{"error":"Incorrect service id"}` with HTTP 200, which is why
`providerCall()` inspects the body rather than the status code. It retries once on
timeouts and 5xx, converts HTML/empty replies into readable messages, and maps
known provider strings to plain English before they reach a customer.

---

## Cancelling a running order (pro-rata refund)

Really Simple Social stops an order where it is and only returns the value of
the units it never delivered. King Social Hub mirrors that behaviour exactly.

| Endpoint | Who | What it does |
|---|---|---|
| `POST /api/boost/orders/:id/cancel-quote` | logged-in customer | Preview: `delivered`, `remaining`, `refund`, `charged` |
| `POST /api/boost/orders/:id/cancel` | logged-in customer | Cancels at the provider (`action=cancel`) then refunds `price × remaining / quantity` |
| `POST /api/v1/boost/order/:id/cancel` | API key | Same, for developers |

Rules
* Only orders in the **pending** bucket can be cancelled.
* Live progress is pulled from the provider first, so the split is accurate.
* If the provider refuses the cancellation, nothing is refunded and the error is returned.
* Nothing delivered yet → full refund. Fully delivered → no refund.

## Boost admin troubleshooting

| Endpoint | What it returns |
|---|---|
| `GET /api/admin/boost/troubleshoot` | Config/provider/catalogue checks, failed sync runs, services the provider no longer offers, recent provider errors |
| `POST /api/admin/boost/rebuild` | Re-imports the full catalogue, re-enables services and deletes withdrawn ones |
| `POST /api/admin/boost/sync-progress` | Starts a sync and returns `{ jobId }` |
| `GET /api/admin/boost/sync-progress/:jobId` | Step-by-step log, `providerCount`, `storedCount`, `done`, `ok`, `error` |
