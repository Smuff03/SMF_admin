/**
 * Profit = what the customer paid  -  what the goods cost you to buy.
 *
 * Cost of an order line = weight sold (Kg) x purchase cost per Kg.
 * Purchase cost per Kg comes from, in this order:
 *   1. item.costPerKg  - frozen onto the order line the moment it is marked Delivered
 *                        (so later price changes with your suppliers don't rewrite old profit)
 *   2. product.costPrice - the latest unit cost saved by your Purchases
 *
 * Orders where any line has no purchase cost yet are left out of the profit totals and counted
 * separately, so profit is never overstated (e.g. an order delivered before you bought the stock).
 */
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (v) => Math.round(v * 100) / 100;

export const orderItems = (o) => {
    if (Array.isArray(o?.items) && o.items.length) return o.items;
    if (Array.isArray(o?.cart) && o.cart.length) return o.cart;
    return [];
};

export const itemWeightKg = (it) =>
    num(it.totalWeightKg) || (num(it.weightInKg) || 1) * (num(it.quantity ?? it.qty) || 1);

/** { revenue, cost, profit, known } for one order. `known` is false if any line has no cost. */
export function orderProfit(order, productsById) {
    const revenue = num(order.amount);
    const items = orderItems(order);
    if (!items.length) return { revenue, cost: 0, profit: 0, known: false };
    let cost = 0;
    let known = true;
    for (const it of items) {
        const product = productsById.get(it.productId || it.id);
        const perKg = num(it.costPerKg) > 0 ? num(it.costPerKg) : num(product?.costPrice);
        if (!(perKg > 0)) known = false;
        cost += itemWeightKg(it) * perKg;
    }
    return { revenue, cost: money(cost), profit: money(revenue - cost), known };
}

const blank = () => ({ revenue: 0, cost: 0, profit: 0, orders: 0, margin: 0 });
const finish = (t) => ({ ...t, revenue: money(t.revenue), cost: money(t.cost), profit: money(t.profit), margin: t.revenue ? Math.round((t.profit / t.revenue) * 1000) / 10 : 0 });

/**
 * Profit over all Delivered orders (`total`) and those delivered in the last `days` days (`recent`).
 * `skipped` = delivered orders that could not be costed yet.
 */
export function profitSummary(orders = [], products = [], days = 30) {
    const byId = new Map(products.map((p) => [p.id, p]));
    const since = Date.now() - days * 864e5;
    const total = blank();
    const recent = blank();
    let skipped = 0;
    let delivered = 0;

    for (const o of orders) {
        if ((o.status || o.orderStatus) !== 'Delivered') continue;
        delivered++;
        const r = orderProfit(o, byId);
        if (!r.known) { skipped++; continue; }
        const when = new Date(o.deliveredAt || o.createdAt).getTime();
        for (const [bucket, on] of [[total, true], [recent, when >= since]]) {
            if (!on) continue;
            bucket.revenue += r.revenue; bucket.cost += r.cost; bucket.profit += r.profit; bucket.orders++;
        }
    }
    return { total: finish(total), recent: finish(recent), skipped, delivered, days };
}