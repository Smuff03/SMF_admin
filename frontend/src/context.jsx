import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from './firebase.js';
import { COLLECTIONS } from './collections.js';
import { LOW_STOCK } from './utils.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

const NAMES = ['orders', 'storefrontOrders', 'products', 'inventory', 'purchases', 'suppliers', 'customers', 'wholesalers', 'audit-logs'];
// Bounded lists keep read costs predictable; everything else is loaded in full.
const QUERY = { inventory: [orderBy('createdAt', 'desc'), limit(500)], 'audit-logs': [orderBy('createdAt', 'desc'), limit(200)] };

const readError = (e) => (e.code === 'permission-denied'
  ? 'Firestore denied access. Make sure your account has the admin role and the latest firestore.rules are deployed'
  : e.message || 'Could not load data');
const time = (r) => new Date(r.createdAt || 0).getTime();
const newest = (rows) => [...rows].sort((a, b) => time(b) - time(a));
const sumBy = (rows, fn) => rows.reduce((a, r) => a + fn(r), 0);

const GENERIC_NAMES = new Set(['direct customer', 'portal customer', 'customer']);

/**
 * Saved customers plus every retail buyer who only exists on an order. Those extra rows are marked `derived`
 * (read-only in the UI) so names are always picked up from orders, even if nobody added the customer by hand.
 */
function customersWithOrderBuyers(saved, raw, orders) {
  if (!saved) return saved;
  const known = new Set([...(raw.customers || []), ...(raw.wholesalers || [])].map((r) => String(r.name || '').toLowerCase().trim()));
  const found = new Map();
  for (const o of orders || []) {
    if (o.status === 'Cancelled' || o.type === 'Wholesale') continue;
    const name = typeof o.customer === 'string' ? o.customer.trim() : '';
    const key = name.toLowerCase();
    if (!name || GENERIC_NAMES.has(key) || known.has(key)) continue;
    const row = found.get(key) || { id: `from-orders:${key}`, name, phone: '', email: '', city: '', createdAt: o.createdAt, derived: true, orders: 0, totalSpent: 0 };
    row.orders += 1;
    row.totalSpent += o.amount;
    row.phone = row.phone || o.phone || '';
    row.email = row.email || o.email || '';
    if (time(o) > time(row)) row.createdAt = o.createdAt;
    found.set(key, row);
  }
  return newest([...saved, ...found.values()]);
}

export function AppProvider({ children }) {
  const [raw, setRaw] = useState({});
  const [errors, setErrors] = useState({});
  const [online, setOnline] = useState(navigator.onLine);
  const [connOpen, setConnOpen] = useState(false);
  const [toasts, setToasts] = useState([]);

  // One live listener per collection for the whole session: every page, badge and chart updates in real time.
  useEffect(() => {
    const unsubs = NAMES.map((name) => {
      const colPath = COLLECTIONS[name] || name;
      return onSnapshot(
        query(collection(db, colPath), ...(QUERY[name] || [])),
        (snap) => {
          setRaw((r) => ({ ...r, [name]: snap.docs.map((d) => ({ ...d.data(), id: d.id })) }));
          setErrors((e) => { if (!e[name]) return e; const { [name]: _gone, ...rest } = e; return rest; });
        },
        (err) => {
          console.warn(`Listener failed for ${name}:`, err.message);
          setErrors((e) => ({ ...e, [name]: readError(err) }));
          setRaw((r) => ({ ...r, [name]: r[name] ?? [] }));
          // Fallback to local API endpoint if running
          fetch(`/api/${name}`).then((res) => res.ok && res.json()).then((rows) => {
            if (Array.isArray(rows)) {
              setRaw((r) => ({ ...r, [name]: rows }));
              setErrors((e) => { const { [name]: _gone, ...rest } = e; return rest; });
            }
          }).catch(() => { });
        }
      );
    });
    const up = () => setOnline(true), down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { unsubs.forEach((u) => u()); window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);

  // Rows per collection (null while the first snapshot is pending), with per-customer / per-supplier totals derived live.
  const data = useMemo(() => {
    const normalizeOrder = (o, isPortal = false) => {
      const custObj = typeof o.customer === 'object' && o.customer !== null ? o.customer : {};
      const userObj = typeof o.user === 'object' && o.user !== null ? o.user : {};
      const shipObj = typeof o.shippingAddress === 'object' && o.shippingAddress !== null ? o.shippingAddress : {};

      const customer = (typeof o.customer === 'string' && o.customer.trim())
        || custObj.name || custObj.fullName
        || o.customerName
        || o.userName
        || userObj.name || userObj.fullName
        || shipObj.fullName || shipObj.name
        || o.customerInfo?.name || o.customerInfo?.fullName
        || o.buyerName || o.buyer?.name
        || o.billingAddress?.fullName || o.billingAddress?.name
        || o.deliveryAddress?.fullName || o.deliveryAddress?.name
        || o.fullName || o.displayName || o.name
        || custObj.email || userObj.email || o.email
        || (isPortal ? 'Portal Customer' : 'Direct Customer');

      const phone = (typeof o.phone === 'string' ? o.phone : '') || custObj.phone || userObj.phone || shipObj.phone || o.userPhone || '';
      const email = (typeof o.email === 'string' ? o.email : '') || custObj.email || userObj.email || o.userEmail || '';
      const address = o.address || (typeof o.shippingAddress === 'string' ? o.shippingAddress : (shipObj.addressLine1 || shipObj.city) ? `${shipObj.addressLine1 || ''} ${shipObj.city || ''} ${shipObj.pincode || ''}`.trim() : '');

      return {
        ...o,
        customer,
        phone,
        email,
        address,
        source: o.source || (isPortal ? 'Customer Portal' : 'Admin Direct'),
        type: o.type || (o.isWholesale ? 'Wholesale' : 'Retail'),
        amount: Number(o.amount || o.totalAmount || o.total || 0),
        status: o.status || o.orderStatus || 'Pending',
        items: Array.isArray(o.items) ? o.items : Array.isArray(o.cart) ? o.cart : [],
        createdAt: o.createdAt || new Date().toISOString(),
      };
    };

    const adminOrders = (raw.orders || []).map((o) => normalizeOrder(o, false));
    const portalOrders = (raw.storefrontOrders || []).map((po) => normalizeOrder(po, true));
    const combinedOrders = newest([
      ...adminOrders,
      ...portalOrders.filter((po) => !adminOrders.some((ao) => ao.portalOrderId === po.id || ao.id === po.id))
    ]);
    const orders = raw.orders !== undefined || raw.storefrontOrders !== undefined ? combinedOrders : null;
    const purchases = raw.purchases ? newest(raw.purchases) : null;
    const withOrders = (rows) => rows && newest(rows).map((r) => {
      const rName = String(r.name || '').toLowerCase().trim();
      const mine = (orders || []).filter((o) => {
        if (o.status === 'Cancelled') return false;
        const oCust = typeof o.customer === 'string' ? o.customer.toLowerCase().trim() : '';
        return oCust === rName;
      });
      return { ...r, orders: mine.length, totalSpent: sumBy(mine, (o) => o.amount) };
    });
    return {
      orders,
      products: raw.products ? newest(raw.products).map((p) => {
        const productPurchases = (raw.purchases || []).filter((po) => po.productId === p.id && po.status !== 'Cancelled');
        const latestPo = productPurchases.sort((a, b) => time(b) - time(a))[0];
        const costPrice = latestPo?.unitCost !== undefined ? latestPo.unitCost : (p.costPrice ?? null);
        return {
          ...p,
          costPrice,
          latestPurchase: latestPo ? { id: latestPo.id, supplier: latestPo.supplier, unitCost: latestPo.unitCost, createdAt: latestPo.createdAt } : null
        };
      }) : null,
      inventory: raw.inventory ?? null,
      purchases,
      suppliers: raw.suppliers && newest(raw.suppliers).map((r) => {
        const mine = (purchases || []).filter((p) => p.supplier === r.name && p.status !== 'Cancelled');
        return { ...r, purchases: mine.length, totalPurchased: sumBy(mine, (p) => p.amount) };
      }),
      customers: customersWithOrderBuyers(withOrders(raw.customers), raw, orders),
      wholesalers: withOrders(raw.wholesalers),
      'audit-logs': raw['audit-logs'] ?? null,
    };
  }, [raw]);

  const summary = useMemo(() => ({
    pendingOrders: (data.orders || []).filter((o) => o.status === 'Pending').length,
    lowStock: (data.products || []).filter((p) => p.active && p.stock <= LOW_STOCK).length,
    lowStockThreshold: LOW_STOCK,
  }), [data.orders, data.products]);

  const toast = useCallback((message, type = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  return (
    <Ctx.Provider value={{ data, errors, summary, online, toast, connOpen, setConnOpen }}>
      {children}
      <div className="toasts" role="status">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.type}`}>{t.message}</div>)}
      </div>
    </Ctx.Provider>
  );
}