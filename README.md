# TMF BizHub

Admin workspace for a snacks business: dashboard, orders, products, inventory, purchases, suppliers, customers, wholesalers, reports and audit logs.

- **Frontend** (`frontend/`): React 18 + Vite + React Router, plain CSS, SVG charts. Reads Firestore **live** with `onSnapshot`.
- **Writes** (`admin-functions/`): one Cloud Function, `adminMutate`. It verifies the admin claim, validates input and applies the business rules in a Firestore transaction (stock, sequential ids, audit log).
- **Security**: Firebase Authentication (email + password) and Firestore rules. Clients can read the admin collections only if they hold the `role: admin` custom claim; **no client can write them**.

```
frontend/          React app (src/context.jsx = live listeners, src/api.js = calls to the function)
admin-functions/   Cloud Functions codebase "admin" (src/logic.js = business rules) + set-admin script
firestore.rules    Your original rules, unchanged, plus an appended admin section
firestore.indexes.json, storage.rules   Your originals, unchanged
firebase.json, .firebaserc, .env.example
```

## Important: shared Firebase project with the live storefront

Your rules show a storefront using `orders` and `products` with a different schema (`userId`, `orderStatus`, `stockQty`, public product reads, no `wholesalePrice` in product docs). To avoid mixing the two, the admin panel stores its own copies in **`adminOrders`** and **`adminProducts`**. Everything else keeps its original name. The mapping lives in one file, `admin-functions/src/collections.js` (copy: `frontend/src/collections.js`; keep them identical). URLs, UI and field names are unchanged.

Consequences to be aware of:

- Storefront orders do **not** appear in the admin Orders page, and admin products/stock are **not** synced to the storefront's `stockQty`. That bridge is a product decision I did not make for you.
- Functions deploy under their own codebase (`admin`), and hosting uses its own target, so deploying this project cannot delete or overwrite the storefront's functions or site.

## Database structure

All timestamps are ISO strings. Ids are also stored in the document as `id`.

| Collection | Key fields | Written by |
| --- | --- | --- |
| `adminOrders` | `id` (TMF-1001…), `customer`, `type` Retail/Wholesale, `amount`, `status` Pending/Processing/Dispatched/Delivered/Cancelled, `note`, `createdAt` | `adminMutate` |
| `adminProducts` | `id`, `sku`, `name`, `category`, `mrp`, `retailPrice`, `wholesalePrice` (nullable), `stock`, `active`, `createdAt` | `adminMutate` |
| `inventory` | `productId`, `productName`, `sku`, `type` Stock in/out/Adjustment, `quantity`, `balance`, `note`, `createdAt` (immutable ledger) | `adminMutate` |
| `purchases` | `id` (PO-3021…), `supplier`, `productId`, `productName`, `quantity`, `unitCost`, `amount`, `status` Ordered/Received/Cancelled, `notes`, `createdAt` | `adminMutate` |
| `suppliers`, `customers`, `wholesalers` | contact fields, `status`, wholesalers also `gstin`, `creditLimit`, `outstanding`; all have `createdAt` | `adminMutate` |
| `audit-logs` | `user` (email of the admin), `action`, `entity`, `detail`, `createdAt` | `adminMutate` |
| `meta/counters` | sequence counters, e.g. `{ orders: 1048, purchases: 3024, "sku-CHI": 5 }` | `adminMutate` |

Schema notes:

- `createdAt` is now stored on every new record (previously suppliers/customers/wholesalers had none; it gives newest-first ordering).
- The old `meta/main` document (a seeded sales series, retail/wholesale mix and "216 historical orders") is **gone**. That data was demo data. The dashboard and reports now compute everything from real orders, so figures start at zero and fill in as you add orders. Cancelled orders are excluded from sales.
- Customer/wholesaler order totals and supplier purchase totals are derived live in the browser (matched by name, as before).
- To continue an existing numbering sequence, create `meta/counters` by hand (e.g. `{ "orders": 1048 }`) before adding records. Otherwise orders start at TMF-1001 and purchases at PO-3021.

Business rules (in `admin-functions/src/logic.js`): stock-out beyond available stock is rejected; receiving a purchase adds stock once, writes an inventory movement and locks the purchase; every create/update/delete is audited with the signed-in admin's email; low stock is ≤ 25 units.

## Admin authentication

1. Firebase console → **Authentication → Sign-in method** → enable **Email/Password**.
2. **Authentication → Users → Add user** (the panel has no public sign-up).
3. Grant the admin role (a custom claim, which only the Admin SDK can set):

   ```bash
   gcloud auth application-default login           # once, with an account that can manage this project
   cd admin-functions
   npm run set-admin -- you@example.com            # add  -- --remove  to revoke
   ```

   The script keeps any other claims the user has (the storefront's `wholesaler`) and only sets `role`. The user must sign out and in again (the panel's "Check again" button also works).
4. Enforcement is server-side in two places: `firestore.rules` (`isAdmin()` from the token claim) and the Cloud Function (`request.auth.token.role === 'admin'`). The UI's "no admin access" screen is only a convenience. Claim removal takes effect when the user's ID token refreshes (up to about an hour).

No service-account key is needed or stored anywhere. Never commit one.

## Local setup

Requires Node 20+ and the Firebase CLI (`npm i -g firebase-tools`, then `firebase login`).

```bash
cp .env.example .env      # fill in the VITE_FIREBASE_* values (your Firebase web config)
npm install               # installs frontend + admin-functions
npm run dev               # http://localhost:5173, against the REAL Firebase project
```

Against the real project you must first deploy the rules and function (below), because the app reads Firestore directly and writes through the function.

**Emulators (safe testing, no real data)**: set `VITE_USE_EMULATORS=true` in `.env`, run `npm run emulators`, open the Emulator UI at http://localhost:4000, add a user under Authentication, then:

```bash
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GCLOUD_PROJECT=smfoods-8eb21 npm --prefix admin-functions run set-admin -- you@example.com
npm run dev
```

Tests: `npm test` (business-logic and callable tests, and dashboard/report calculations; no emulator needed).

## Deployment

The Functions need the **Blaze** (pay-as-you-go) plan. At admin-panel volumes cost is normally negligible.

```bash
firebase use smfoods-8eb21

# 1. Rules + indexes. This REPLACES the live rules with firestore.rules; compare it with the Rules tab
#    in the console first (it should match your original plus the appended admin block).
npm run deploy:rules

# 2. Function (touches only the "admin" codebase)
npm run deploy:functions

# 3. Admin site. Use a SEPARATE Hosting site so the storefront is not overwritten:
firebase hosting:sites:create tmf-admin            # pick any free site id
firebase target:apply hosting admin tmf-admin
npm run deploy:web
```

If you change the function region, update `setGlobalOptions` in `admin-functions/src/index.js` and `VITE_FUNCTIONS_REGION`. The `VITE_*` values are baked in at build time. Add the admin site's domain to **Authentication → Settings → Authorized domains** if it is not already listed.

## Verification status

Verified here: business logic (13 tests incl. the callable with a fake Firestore: auth gate, collection mapping, stock rules, error mapping), dashboard/report math (including empty data), frontend production build, and that the original rules text is unchanged apart from the appended block.

**Not verified** (the sandbox could not run Firebase emulators or a browser): the rules against a real Firestore, real sign-in/claims, live `onSnapshot` updates, the deployed function, and the UI in a browser. Please run the checklist below once on the emulators or a staging project.

1. Signed out → sign-in page. Wrong password → error. Signed in without claim → "No admin access".
2. With the claim: add a product, record Stock in/out, create/edit/delete an order, receive a purchase. Each should appear instantly, and in a second browser tab without refresh.
3. Stock-out above available stock is rejected; received purchase is locked; audit log shows your email.
4. In the console/Rules playground: a non-admin, and an admin, **cannot write** `adminOrders` etc. directly; a non-admin cannot read them; storefront reads/writes behave as before.

## Known limits

- Dashboard/reports read all orders (and customers/purchases) into the browser. Fine for thousands of orders; for much larger volumes move aggregates into the function.
- Inventory and audit-log views show the latest 500 and 200 entries.
- Deleting a product or a received purchase does not reverse stock (same as the original behavior).
