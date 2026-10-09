import assert from 'node:assert/strict';
import { dashboard, reports, dailySeries } from '../src/analytics.js';
const ago = (d, h = 12) => { const x = new Date(); x.setDate(x.getDate() - d); x.setHours(h, 0, 0, 0); return x.toISOString(); };
const o = (id, customer, type, amount, status, d) => ({ id, customer, type, amount, status, createdAt: ago(d) });
const orders = [
  o('1', 'Maya', 'Wholesale', 1000, 'Pending', 0), o('2', 'Rohan', 'Retail', 500, 'Delivered', 0),
  o('3', 'Maya', 'Wholesale', 700, 'Cancelled', 0), o('4', 'Maya', 'Wholesale', 2000, 'Processing', 1),
  o('5', 'Neha', 'Retail', 300, 'Delivered', 40), o('6', 'Old', 'Retail', 99, 'Delivered', 120),
];
const products = [{ id: 'p1', name: 'A', category: 'Chivda', stock: 5, active: true }, { id: 'p2', name: 'B', category: 'Chivda', stock: 100, active: true }, { id: 'p3', name: 'C', category: 'Sweets', stock: 3, active: false }];

const d = dashboard(orders, products);
assert.equal(d.kpis.todaySales, 1500);               // cancelled excluded
assert.equal(d.kpis.monthSales, 3500);               // today + yesterday only (40 days ago is outside 30)
assert.equal(d.kpis.totalOrders, 6);
assert.equal(d.kpis.weekOrders, 4);
assert.equal(d.kpis.pendingOrders, 1);
assert.equal(d.kpis.todayChange, -25);               // 1500 vs 2000
assert.equal(d.mix.retail, 500 + 300 + 99); assert.equal(d.mix.wholesale, 3000);
assert.deepEqual(d.lowStock.map((p) => p.id), ['p1']); // inactive and healthy excluded
assert.equal(d.series.length, 90); assert.equal(d.recentOrders.length, 4);

const r7 = reports(orders, products, 7), r30 = reports(orders, products, 30), r90 = reports(orders, products, 90);
assert.equal(r7.kpis.revenue, 3500); assert.equal(r7.kpis.orders, 3); assert.equal(r7.kpis.avgOrderValue, 1167);
assert.equal(r7.sales.length, 7); assert.equal(r30.sales.length, 5); assert.equal(r90.kpis.revenue, 3800);
assert.equal(r7.kpis.wholesaleShare, Math.round(3000 / 3500 * 100));
assert.equal(r7.topCustomers[0].name, 'Maya'); assert.equal(r7.topCustomers[0].total, 3000);
assert.equal(r7.ordersByStatus.find((s) => s.label === 'Cancelled').value, 1);
assert.deepEqual(r7.stockByCategory.map((c) => [c.label, c.value]), [['Chivda', 105], ['Sweets', 3]]);

const e = dashboard([], []); const er = reports([], [], 30);
assert.equal(e.kpis.todaySales, 0); assert.equal(e.kpis.todayChange, 0); assert.equal(er.kpis.avgOrderValue, 0); assert.equal(er.kpis.wholesaleShare, 0);
assert.equal(dailySeries([{ status: 'Pending', amount: 5, createdAt: 'garbage' }], 7).reduce((a, b) => a + b, 0), 0);
console.log('analytics: all assertions passed');
