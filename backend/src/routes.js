import { Router } from 'express';
import { createDb } from './db.js';
import { LOW_STOCK, bad, clean, resources } from './resources.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const sum = (a) => a.reduce((x, y) => x + y, 0);
const pct = (a, b) => (b ? Math.round(((a - b) / b) * 1000) / 10 : 0);
const byNewest = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);
const DAY = 864e5;

export function createApi() {
  const db = createDb();
  const api = Router();
  const log = (action, entity, detail) => db.create('audit-logs', { user: 'Admin', action, entity, detail, createdAt: new Date().toISOString() });

  api.get('/health', (_q, res) => res.json({ status: 'ok', driver: db.driver, time: new Date().toISOString() }));

  api.get('/summary', wrap(async (_q, res) => {
    const [orders, products] = await Promise.all([db.list('orders'), db.list('products')]);
    res.json({
      pendingOrders: orders.filter((o) => o.status === 'Pending').length,
      lowStock: products.filter((p) => p.active && p.stock <= LOW_STOCK).length,
      lowStockThreshold: LOW_STOCK,
    });
  }));

  api.get('/dashboard', wrap(async (_q, res) => {
    const [orders, products, meta] = await Promise.all([db.list('orders'), db.list('products'), db.getMeta()]);
    const s = meta.series, n = s.length;
    const monthSales = sum(s.slice(-30));
    res.json({
      kpis: {
        todaySales: s[n - 1], todayChange: pct(s[n - 1], s[n - 2]),
        monthSales, monthChange: pct(monthSales, sum(s.slice(-60, -30))),
        totalOrders: meta.historicalOrders + orders.length,
        weekOrders: orders.filter((o) => Date.now() - new Date(o.createdAt) < 7 * DAY).length,
        pendingOrders: orders.filter((o) => o.status === 'Pending').length,
      },
      series: s,
      mix: meta.mix,
      recentOrders: orders.sort(byNewest).slice(0, 4),
      lowStock: products.filter((p) => p.active && p.stock <= LOW_STOCK).slice(0, 4),
      lowStockThreshold: LOW_STOCK,
    });
  }));

  api.get('/reports', wrap(async (req, res) => {
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    const [orders, products, meta] = await Promise.all([db.list('orders'), db.list('products'), db.getMeta()]);
    const window = meta.series.slice(-days);
    const live = orders.filter((o) => o.status !== 'Cancelled' && Date.now() - new Date(o.createdAt) < days * DAY);
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
    const total = meta.mix.retail + meta.mix.wholesale;
    res.json({
      days,
      kpis: {
        revenue: sum(window), orders: live.length, avgOrderValue: live.length ? Math.round(sum(live.map((o) => o.amount)) / live.length) : 0,
        wholesaleShare: total ? Math.round((meta.mix.wholesale / total) * 100) : 0,
      },
      sales,
      ordersByStatus: ['Pending', 'Processing', 'Dispatched', 'Delivered', 'Cancelled'].map((label) => ({ label, value: orders.filter((o) => o.status === label).length })),
      topCustomers: Object.values(spend).sort((a, b) => b.total - a.total).slice(0, 5),
      stockByCategory: Object.values(cats),
    });
  }));

  for (const [name, def] of Object.entries(resources)) {
    const r = Router();
    r.get('/', wrap(async (_q, res) => {
      let rows = await db.list(name);
      if (def.enrich) rows = await def.enrich(db, rows);
      res.json(rows.sort((a, b) => (a.createdAt && b.createdAt ? byNewest(a, b) : 0)));
    }));

    if (!def.readOnly) {
      r.post('/', wrap(async (req, res) => {
        let doc = clean(def.schema, req.body, false);
        doc = (await def.prepare?.(db, doc)) ?? doc;
        const row = await db.create(name, doc);
        await def.afterCreate?.(db, row);
        await log('Created', def.entity, def.label(row));
        res.status(201).json(row);
      }));
    }

    if (!def.readOnly && !def.immutable) {
      r.put('/:id', wrap(async (req, res) => {
        const existing = await db.get(name, req.params.id);
        if (!existing) throw bad('Record not found', 404);
        let patch = clean(def.schema, req.body, true);
        patch = (await def.beforeUpdate?.(db, existing, patch)) ?? patch;
        const row = await db.update(name, existing.id, patch);
        await def.afterUpdate?.(db, existing, row);
        await log('Updated', def.entity, def.label(row));
        res.json(row);
      }));

      r.delete('/:id', wrap(async (req, res) => {
        const existing = await db.get(name, req.params.id);
        if (!existing) throw bad('Record not found', 404);
        await db.remove(name, existing.id);
        await def.afterDelete?.(db, existing);
        await log('Deleted', def.entity, def.label(existing));
        res.status(204).end();
      }));
    }
    api.use(`/${name}`, r);
  }
  return api;
}
