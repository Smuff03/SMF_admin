// Dashboard and report figures are derived from real orders/products, so they update live
// and never drift from the underlying records.
import { LOW_STOCK } from './utils.js';

const DAY = 864e5;
const sum = (a) => a.reduce((x, y) => x + y, 0);
const pct = (a, b) => (b ? Math.round(((a - b) / b) * 1000) / 10 : 0);
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const byNewest = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);
const counted = (o) => o.status !== 'Cancelled';

/** Whole days between the order and today (0 = today); NaN for a bad date. */
const daysAgo = (o) => Math.round((midnight(new Date()) - midnight(new Date(o.createdAt))) / DAY);

/** Revenue per calendar day for the last `n` days (last item = today), cancelled orders excluded. */
export function dailySeries(orders, n) {
  const out = Array(n).fill(0);
  for (const o of orders) {
    const ago = daysAgo(o);
    if (counted(o) && ago >= 0 && ago < n) out[n - 1 - ago] += o.amount;
  }
  return out;
}

export function dashboard(orders, products) {
  const series = dailySeries(orders, 90);
  const n = series.length;
  const monthSales = sum(series.slice(-30));
  const mix = { retail: 0, wholesale: 0 };
  orders.filter(counted).forEach((o) => { mix[o.type === 'Retail' ? 'retail' : 'wholesale'] += o.amount; });
  return {
    kpis: {
      todaySales: series[n - 1], todayChange: pct(series[n - 1], series[n - 2]),
      monthSales, monthChange: pct(monthSales, sum(series.slice(-60, -30))),
      totalOrders: orders.length,
      weekOrders: orders.filter((o) => { const a = daysAgo(o); return a >= 0 && a < 7; }).length,
      pendingOrders: orders.filter((o) => o.status === 'Pending').length,
    },
    series,
    mix,
    recentOrders: [...orders].sort(byNewest).slice(0, 4),
    lowStock: products.filter((p) => p.active && p.stock <= LOW_STOCK).sort((a, b) => a.stock - b.stock).slice(0, 4),
  };
}

export function reports(orders, products, days) {
  const window = dailySeries(orders, days);
  const live = orders.filter((o) => { const a = daysAgo(o); return counted(o) && a >= 0 && a < days; });
  const size = days === 7 ? 1 : 7;
  const sales = [];
  for (let i = 0; i < window.length; i += size) {
    const d = new Date(Date.now() - (window.length - 1 - i) * DAY);
    sales.push({ label: size === 1 ? d.toLocaleDateString('en-IN', { weekday: 'short' }) : `Wk ${sales.length + 1}`, value: sum(window.slice(i, i + size)) });
  }
  const spend = {};
  live.forEach((o) => { const c = (spend[o.customer] ||= { name: o.customer, type: o.type, orders: 0, total: 0 }); c.orders++; c.total += o.amount; });
  const cats = {};
  products.forEach((p) => { const c = (cats[p.category] ||= { label: p.category, value: 0, items: 0 }); c.value += p.stock; c.items++; });
  const revenue = sum(live.map((o) => o.amount));
  const wholesale = sum(live.filter((o) => o.type === 'Wholesale').map((o) => o.amount));
  return {
    days,
    kpis: {
      revenue, orders: live.length, avgOrderValue: live.length ? Math.round(revenue / live.length) : 0,
      wholesaleShare: revenue ? Math.round((wholesale / revenue) * 100) : 0,
    },
    sales,
    ordersByStatus: ['Pending', 'Processing', 'Dispatched', 'Delivered', 'Cancelled'].map((label) => ({ label, value: orders.filter((o) => o.status === label).length })),
    topCustomers: Object.values(spend).sort((a, b) => b.total - a.total).slice(0, 5),
    stockByCategory: Object.values(cats),
  };
}
