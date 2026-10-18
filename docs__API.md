# King Social Hub Global Payments & Localization API

Base URL: `https://<your-domain>` · All authenticated endpoints require the normal
session cookie / bearer token used by the rest of the app. All money is stored in the
ledger as **NGN**; every other currency is a presentation or settlement layer.

---

## 1. Countries & localization

### `GET /api/intl/countries`
Returns the full worldwide registry (250 countries).

```json
{ "countries": [ { "code":"NG","name":"Nigeria","dial":"+234","flag":"🇳🇬","currency":"NGN","methods":["banktransfer","paymentlink"] } ] }
```

### `GET /api/intl/context`
Country inferred from the caller's IP/locale, plus the deposit methods and currency for it.

### `GET /api/intl/languages`
Supported UI languages: `en, fr, es, pt, ar, sw, hi, zh, ru, de` (Arabic renders RTL).

### `PATCH /api/intl/preferences` — *auth*
```json
{ "country": "GB", "language": "fr", "displayCurrency": "GBP" }
```

---

## 2. Currency conversion

### `GET /api/fx/rates?base=NGN`
Live rates, cached 30 minutes, quoted with a 1.5% spread.

### `GET /api/fx/convert?amount=20000&from=NGN&to=USD`
```json
{ "amount": 20000, "from":"NGN", "to":"USD", "converted": 12.84, "rate": 0.000642, "asOf":"2026-08-11T09:00:00Z" }
```

---

## 4. Errors

| Code | Meaning |
|------|---------|
| 400 | Validation error (amount below minimum, unsupported asset/network) |
| 401 | Not signed in, or invalid webhook signature |
| 403 | Country not served |
| 409 | Deposit already processed (safe to ignore — idempotent) |
| 503 | Provider or FX source temporarily unavailable |
