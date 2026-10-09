/**
 * Logical resource name (used by the UI and the callable) -> Firestore collection path.
 *
 * `orders` and `products` are already used by the live storefront with a different schema and
 * public-read / Cloud-Functions-only rules, so the admin panel keeps its own copies under
 * `adminOrders` / `adminProducts`. Everything else keeps its original name.
 * Keep this file identical to frontend/src/collections.js.
 */
export const COLLECTIONS = {
  orders: 'adminOrders',
  products: 'adminProducts',
  inventory: 'inventory',
  purchases: 'purchases',
  suppliers: 'suppliers',
  customers: 'customers',
  wholesalers: 'wholesalers',
  'audit-logs': 'audit-logs',
  meta: 'meta',
};
