# TMF BizHub

Admin workspace for a snacks business: dashboard, orders, products, inventory, purchases, suppliers, customers, wholesalers, reports and audit logs.

- **Frontend:** React 18 + Vite + React Router, plain CSS, SVG charts (no chart library)
- **Backend:** Node.js + Express, in-memory store with a swappable storage contract
- **Firebase:** web SDK initialised from environment variables (Analytics enabled when supported)

```
frontend/   React app (Vite)
backend/    Express API (src/routes.js, src/resources.js, src/db.js, src/seed.js)
.env.example
```

## Installation

Requires Node.js 18.18 or newer.

```bash
npm install     # installs root, backend and frontend dependencies
npm run dev     # API on :5000 and web app on :5173
```

Open http://localhost:5173.

## Environment variables

All variables live in one root `.env` file, which is git-ignored. Copy `.env.example` to `.env` and fill it in (a pre-filled `.env` with your Firebase web config is already included in this download).

| Variable | Purpose |
| --- | --- |
| `PORT` | API port (default `5000`) |
| `CLIENT_ORIGIN` | Allowed CORS origin(s), comma separated |
| `DB_DRIVER` | `memory` (default) or `firestore` |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | Path to the Admin SDK key, relative to the project root |
| `VITE_API_URL` | API base URL used by the browser (default `/api`, proxied in dev) |
| `VITE_FIREBASE_*` | Firebase web config (API key, auth domain, project ID, bucket, sender ID, app ID, measurement ID) |

Restart the dev server after editing `.env`. Firebase web keys identify your project and are not secrets; protect data with Firestore/Storage security rules.

## Running separately

```bash
npm run dev:backend    # http://localhost:5000  (node --watch)
npm run dev:frontend   # http://localhost:5173  (Vite, proxies /api to the backend)
```

## Production build

```bash
npm run build          # builds frontend/dist
npm start              # Express serves the API and the built app on PORT
```

When `frontend/dist` exists the API server also serves it, so a single Node process hosts everything at `http://localhost:5000`.

## Deployment

1. Set the environment variables from `.env.example` on your host (the `VITE_*` values must be present at **build** time).
2. Run `npm install && npm run build`.
3. Start with `npm start` (works on Render, Railway, Fly.io, a VPS with PM2, etc.).
4. Optional: host `frontend/dist` on a static host (Netlify, Vercel, Firebase Hosting) and set `VITE_API_URL` to your API URL and `CLIENT_ORIGIN` to the site's URL.

## Business logic

- Order creation updates today's sales, monthly sales, the sales-mix donut and the pending badge; cancelling or deleting reverses the sale.
- Inventory records change product stock; stock-out is rejected when it exceeds available stock.
- Marking a purchase **Received** adds stock, writes an inventory movement and locks the purchase.
- Products at or below 25 units are flagged as low stock (dashboard, inventory, notifications).
- Every create, update and delete is written to the audit log.

## API

`GET /api/health`, `/api/summary`, `/api/dashboard`, `/api/reports?days=7|30|90`

CRUD (`GET/POST /api/:resource`, `PUT/DELETE /api/:resource/:id`) for `orders`, `products`, `purchases`, `suppliers`, `customers`, `wholesalers`. `inventory` supports `GET/POST` only and `audit-logs` is read-only.

## Using Firestore (Firebase database)

1. Firebase Console → **Build → Firestore Database → Create database**.
2. **Project settings → Service accounts → Generate new private key**. Save the file as `backend/serviceAccountKey.json` (git-ignored).
3. In `.env` set `DB_DRIVER=firestore` and keep `FIREBASE_SERVICE_ACCOUNT_PATH=./backend/serviceAccountKey.json`.
4. Run `npm run dev`. On first start, an empty database is filled with the seed data automatically. Check **Connection settings** (avatar menu) to confirm the driver.

The Admin SDK bypasses security rules, so keep the key private and never expose it to the browser. Set Firestore rules to deny direct client access (`allow read, write: if false;`) because the app reads and writes only through the API.

## Moving to MongoDB

All data access goes through the contract in `backend/src/db.js` (`list`, `get`, `create`, `update`, `remove`, `getMeta`, `setMeta`). Add a driver that implements these async methods, return it from `createDb()` based on `DB_DRIVER`, and no route or frontend code needs to change. Seed data in `backend/src/seed.js` can be used to import initial records.

With `DB_DRIVER=memory` data resets whenever the API restarts; use `firestore` for persistence.
