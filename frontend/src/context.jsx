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
          }).catch(() => {});
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
    const adminOrders = raw.orders || [];
    const portalOrders = (raw.storefrontOrders || []).map((po) => ({
      ...po,
      source: 'Customer Portal',
      customer: po.customer || po.userName || po.userId || 'Portal Customer',
      type: po.type || (po.isWholesale ? 'Wholesale' : 'Retail'),
      amount: Number(po.amount || po.totalAmount || 0),
      status: po.status || po.orderStatus || 'Pending',
      items: Array.isArray(po.items) ? po.items : Array.isArray(po.cart) ? po.cart : [],
      createdAt: po.createdAt || new Date().toISOString(),
    }));
    const combinedOrders = newest([
      ...adminOrders,
      ...portalOrders.filter((po) => !adminOrders.some((ao) => ao.portalOrderId === po.id || ao.id === po.id))
    ]);
    const orders = raw.orders !== undefined || raw.storefrontOrders !== undefined ? combinedOrders : null;
    const purchases = raw.purchases ? newest(raw.purchases) : null;
    const withOrders = (rows) => rows && newest(rows).map((r) => {
      const mine = (orders || []).filter((o) => o.status !== 'Cancelled' && String(o.customer || '').toLowerCase() === String(r.name || '').toLowerCase());
      return { ...r, orders: mine.length, totalSpent: sumBy(mine, (o) => o.amount) };
    });
    return {
      orders,
      products: raw.products ? newest(raw.products) : null,
      inventory: raw.inventory ?? null,
      purchases,
      suppliers: raw.suppliers && newest(raw.suppliers).map((r) => {
        const mine = (purchases || []).filter((p) => p.supplier === r.name && p.status !== 'Cancelled');
        return { ...r, purchases: mine.length, totalPurchased: sumBy(mine, (p) => p.amount) };
      }),
      customers: withOrders(raw.customers),
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
