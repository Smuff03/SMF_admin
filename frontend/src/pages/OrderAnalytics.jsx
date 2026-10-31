import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import { Badge, Button, EmptyState, PageHeader, Tile } from '../components/ui.jsx';
import { customerNameOf } from '../billShare.js';
import {
  downloadCsv,
  extractItemWeightKg,
  formatWeight,
  formatWeightShort,
  getDeliveryStatus,
  getOrderItems,
  initial,
} from '../utils.js';
import './orderAnalytics.css';

/**
 * Orders by product
 *  - Received  = every order that is not Cancelled.
 *  - Delivered = status Delivered.
 *  - Yet to deliver = Pending + Processing + Dispatched (dispatched but not delivered yet).
 * Reached from Orders -> "Product analytics" (route: /orders/analytics).
 */

const STAGES = [
  { key: 'delivered', label: 'Delivered' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'processing', label: 'Processing' },
  { key: 'pending', label: 'Pending' },
];
const YET = ['pending', 'processing', 'dispatched'];
const RANGES = [
  { value: 0, label: 'All time' },
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
];

const round3 = (n) => Math.round(n * 1000) / 1000;
const sum = (obj, keys) => keys.reduce((a, k) => a + obj[k], 0);
const zero = () => ({ pending: 0, processing: 0, dispatched: 0, delivered: 0 });
const bucketOf = (order) => {
  const s = String(order.status || '').toLowerCase().trim();
  if (s === 'cancelled' || s === 'canceled') return null;
  return STAGES.some((x) => x.key === s) ? s : 'pending'; // unknown statuses count as not yet delivered
};
const dueOf = (o) => (o.deliveryDate ? new Date(o.deliveryDate).getTime() : Infinity);
const shortDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

function ProductCell({ r }) {
  return (
    <div className="cell oa-prod">
      <Tile>{initial(r.name)}</Tile>
      <div>
        <b>{r.name}</b>
        <small className="muted">{[r.sku, r.category].filter(Boolean).join(' · ')}</small>
      </div>
    </div>
  );
}

function Progress({ r }) {
  if (!r.orderedKg) return <span className="muted">—</span>;
  return (
    <div className="oa-progress" role="img" aria-label={STAGES.map((s) => `${s.label} ${formatWeightShort(r.kg[s.key])}`).join(', ')}>
      {STAGES.map((s) => r.kg[s.key] > 0 && (
        <i key={s.key} className={`seg-${s.key}`} style={{ flexGrow: r.kg[s.key] }} title={`${s.label}: ${formatWeight(r.kg[s.key])}`} />
      ))}
    </div>
  );
}

function YetCell({ r }) {
  if (!r.yetKg) return <span className="oa-done">All delivered</span>;
  const parts = YET.filter((k) => r.kg[k] > 0);
  return (
    <div>
      <b className="oa-amber">{formatWeight(r.yetKg)}</b>
      <small className="muted block">{r.yetOrders} {r.yetOrders === 1 ? 'order' : 'orders'}</small>
      <div className="oa-split">
        {parts.map((k) => <span key={k}>{formatWeightShort(r.kg[k])} {k}</span>)}
      </div>
    </div>
  );
}

function Detail({ r }) {
  return (
    <div className="oa-detail">
      <div className="oa-detail-h">Packs ordered</div>
      <div className="oa-packs">
        {r.variants.map((v) => (
          <span key={v.label} className="oa-pack">
            <b>{v.label}</b> × {v.qty}
            <small className="muted"> {formatWeightShort(v.kg)}</small>
          </span>
        ))}
      </div>

      <div className="oa-detail-h">{r.pendingList.length ? `Yet to deliver (${r.pendingList.length} ${r.pendingList.length === 1 ? 'order' : 'orders'})` : 'Delivery'}</div>
      {r.pendingList.length === 0 && <p className="sub oa-empty">Everything ordered for this product has been delivered.</p>}
      {r.pendingList.map((l) => {
        const d = getDeliveryStatus(l.order);
        return (
          <div key={l.order.id} className="oa-order">
            <div className="oa-order-who">
              <b>{customerNameOf(l.order)}</b>
              <small className="muted">#{String(l.order.id).slice(-6)}</small>
            </div>
            <div className="oa-order-packs muted">{l.packs.join(', ')}</div>
            <b>{formatWeight(l.kg)}</b>
            <span className="oa-order-meta">
              <Badge>{l.order.status}</Badge>
              {l.order.deliveryDate
                ? <span className="muted">Due {shortDate(l.order.deliveryDate)}</span>
                : <span className="muted">No due date</span>}
              {l.order.deliveryDate && d && <span className={`badge b-${d.tone} oa-mini`}>{d.label}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ExpandButton({ r, open, onToggle }) {
  return (
    <Button variant="ghost" onClick={onToggle} aria-expanded={open}>
      {open ? 'Hide details' : 'Details'}
      <span className={`chev ${open ? 'on' : ''}`}><Icon name="chevron" size={16} /></span>
    </Button>
  );
}

export default function OrderAnalytics() {
  const navigate = useNavigate();
  const { data, errors, setConnOpen } = useApp();
  const orders = data.orders;
  const products = data.products || [];

  const [range, setRange] = useState(0);
  const [view, setView] = useState('All');
  const [sort, setSort] = useState('ordered');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);

  const agg = useMemo(() => {
    const byId = new Map(products.map((p) => [String(p.id), p]));
    const byName = new Map(products.filter((p) => p.name).map((p) => [p.name.trim().toLowerCase(), p]));
    const since = range ? Date.now() - range * 864e5 : 0;
    const map = new Map();
    const seenOrders = new Set();
    let received = 0;
    let yetOrders = 0;
    let cancelled = 0;

    for (const o of orders || []) {
      if (since && new Date(o.createdAt).getTime() < since) continue;
      const bucket = bucketOf(o);
      if (!bucket) { cancelled++; continue; }
      if (!seenOrders.has(o.id)) {
        seenOrders.add(o.id);
        received++;
        if (bucket !== 'delivered') yetOrders++;
      }

      for (const it of getOrderItems(o)) {
        const pid = it.productId || it.id;
        const nm = String(it.productName || it.name || '').trim();
        const p = (pid && byId.get(String(pid))) || (nm && byName.get(nm.toLowerCase())) || null;
        const name = p?.name || nm || 'Unknown item';
        const key = p ? `p:${p.id}` : `n:${name.toLowerCase()}`;

        let r = map.get(key);
        if (!r) {
          r = { key, name, sku: p?.sku || '', category: p?.category || '', kg: zero(), orders: zero(), packs: 0, variants: new Map(), lines: new Map() };
          map.set(key, r);
        }
        const kg = extractItemWeightKg(it);
        const qty = Number(it.quantity ?? it.qty ?? 1) || 1;
        const variant = String(it.weightVariant || it.packSize || it.weight || (it.weightInKg ? `${it.weightInKg} kg` : 'Standard'));

        r.kg[bucket] += kg;
        r.packs += qty;
        const v = r.variants.get(variant) || { label: variant, qty: 0, kg: 0 };
        v.qty += qty; v.kg += kg;
        r.variants.set(variant, v);

        let line = r.lines.get(o.id);
        if (!line) {
          line = { order: o, bucket, kg: 0, packs: [] };
          r.lines.set(o.id, line);
          r.orders[bucket]++;
        }
        line.kg += kg;
        line.packs.push(`${qty} × ${variant}`);
      }
    }

    const rows = [...map.values()].map((r) => {
      const kg = Object.fromEntries(Object.entries(r.kg).map(([k, v]) => [k, round3(v)]));
      const orderedKg = round3(sum(kg, Object.keys(kg)));
      return {
        ...r,
        kg,
        orderedKg,
        deliveredKg: kg.delivered,
        yetKg: round3(sum(kg, YET)),
        orderCount: sum(r.orders, Object.keys(r.orders)),
        yetOrders: sum(r.orders, YET),
        variants: [...r.variants.values()].sort((a, b) => b.kg - a.kg).map((v) => ({ ...v, kg: round3(v.kg) })),
        pendingList: [...r.lines.values()]
          .filter((l) => l.bucket !== 'delivered')
          .map((l) => ({ ...l, kg: round3(l.kg) }))
          .sort((a, b) => dueOf(a.order) - dueOf(b.order)),
      };
    });

    const totals = {
      received,
      yetOrders,
      cancelled,
      orderedKg: round3(rows.reduce((a, r) => a + r.orderedKg, 0)),
      deliveredKg: round3(rows.reduce((a, r) => a + r.deliveredKg, 0)),
      yetKg: round3(rows.reduce((a, r) => a + r.yetKg, 0)),
    };
    const unordered = products.filter((p) => p.active !== false && !map.has(`p:${p.id}`)).length;
    return { rows, totals, unordered };
  }, [orders, products, range]);

  const counts = useMemo(() => ({
    All: agg.rows.length,
    Yet: agg.rows.filter((r) => r.yetKg > 0).length,
    Done: agg.rows.filter((r) => r.yetKg === 0 && r.deliveredKg > 0).length,
  }), [agg.rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = agg.rows.filter((r) => {
      if (view === 'Yet' && !(r.yetKg > 0)) return false;
      if (view === 'Done' && !(r.yetKg === 0 && r.deliveredKg > 0)) return false;
      return !needle || `${r.name} ${r.sku} ${r.category}`.toLowerCase().includes(needle);
    });
    const by = {
      ordered: (a, b) => b.orderedKg - a.orderedKg,
      yet: (a, b) => b.yetKg - a.yetKg || b.orderedKg - a.orderedKg,
      orders: (a, b) => b.orderCount - a.orderCount,
      name: (a, b) => a.name.localeCompare(b.name),
    };
    return [...list].sort(by[sort]);
  }, [agg.rows, view, q, sort]);

  const toggle = (key) => setOpen((cur) => (cur === key ? null : key));

  const exportCsv = () => {
    downloadCsv('crunchzy-orders-by-product.csv', shown.map((r) => ({
      Product: r.name,
      SKU: r.sku,
      Category: r.category,
      'Orders received': r.orderCount,
      'Ordered (Kg)': r.orderedKg,
      'Packs ordered': r.packs,
      'Delivered (Kg)': r.deliveredKg,
      'Yet to deliver (Kg)': r.yetKg,
      'Orders yet to deliver': r.yetOrders,
      'Pending (Kg)': r.kg.pending,
      'Processing (Kg)': r.kg.processing,
      'Dispatched (Kg)': r.kg.dispatched,
    })));
  };

  const header = (
    <PageHeader
      eyebrow="ORDERS / PRODUCT ANALYTICS"
      title="Orders by product"
      subtitle="What customers have ordered, what is delivered and what is still to go out."
      action={
        <div className="btn-group">
          <Button onClick={() => navigate('/orders')}>Back to orders</Button>
          <Button icon="download" onClick={exportCsv} disabled={!shown.length}>Export CSV</Button>
        </div>
      }
    />
  );

  if (errors.orders) {
    return (
      <>
        {header}
        <EmptyState title="Orders unavailable" text={`${errors.orders}. Check the connection settings.`} action={<Button onClick={() => setConnOpen(true)}>Review connection settings</Button>} />
      </>
    );
  }
  if (orders === null || orders === undefined) return <>{header}<div className="loading">Loading orders…</div></>;

  const t = agg.totals;
  const chips = [['All', 'All products', counts.All], ['Yet', 'Yet to deliver', counts.Yet], ['Done', 'Fully delivered', counts.Done]];

  return (
    <div className="oa">
      {header}

      <div className="kpis oa-kpis">
        <div className="card kpi stack">
          <span className="muted">Orders received</span>
          <b className="kv">{t.received}</b>
          <small className="muted">{t.cancelled ? `${t.cancelled} cancelled not counted` : 'Excluding cancelled'}</small>
        </div>
        <div className="card kpi stack">
          <span className="muted">Total ordered</span>
          <b className="kv">{formatWeight(t.orderedKg)}</b>
          <small className="muted">Across {agg.rows.length} {agg.rows.length === 1 ? 'product' : 'products'}</small>
        </div>
        <div className="card kpi stack">
          <span className="muted">Delivered</span>
          <b className="kv pos">{formatWeight(t.deliveredKg)}</b>
          <small className="muted">{t.received - t.yetOrders} {t.received - t.yetOrders === 1 ? 'order' : 'orders'} complete</small>
        </div>
        <div className="card kpi stack">
          <span className="muted">Yet to deliver</span>
          <b className="kv oa-amber">{formatWeight(t.yetKg)}</b>
          <small className="muted">{t.yetOrders} {t.yetOrders === 1 ? 'order' : 'orders'} pending, processing or dispatched</small>
        </div>
      </div>

      <section className="card oa-panel">
        <div className="oa-filterbar">
          <div className="oa-chips" role="tablist" aria-label="Filter products">
            {chips.map(([key, label, count]) => (
              <button key={key} type="button" role="tab" aria-selected={view === key} className={`oa-chip ${view === key ? 'on' : ''}`} onClick={() => setView(key)}>
                {label} <span>{count}</span>
              </button>
            ))}
          </div>
          <div className="oa-controls">
            <label className="search">
              <Icon name="search" size={18} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products…" aria-label="Search products" />
            </label>
            <select className="sel" value={range} onChange={(e) => { setRange(Number(e.target.value)); setOpen(null); }} aria-label="Order date range">
              {RANGES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
            <select className="sel" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort products">
              <option value="ordered">Most ordered</option>
              <option value="yet">Most to deliver</option>
              <option value="orders">Most orders</option>
              <option value="name">Name A–Z</option>
            </select>
          </div>
        </div>

        <div className="oa-legend" aria-hidden="true">
          {STAGES.map((s) => <span key={s.key}><i className={`seg-${s.key}`} />{s.label}</span>)}
        </div>

        {shown.length === 0 ? (
          <div className="oa-none">{agg.rows.length ? 'No products match this filter.' : 'No orders in this period.'}</div>
        ) : (
          <>
            {/* Wide screens: table */}
            <div className="oa-table-card">
              <div className="oa-table-scroll">
                <table className="oa-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Orders</th>
                      <th>Ordered</th>
                      <th>Delivered</th>
                      <th>Yet to deliver</th>
                      <th className="oa-bar-col">Progress</th>
                      <th className="end"><span className="sr-only">Details</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <RowGroup key={r.key}>
                        <tr>
                          <td><ProductCell r={r} /></td>
                          <td><b>{r.orderCount}</b></td>
                          <td>
                            <b>{formatWeight(r.orderedKg)}</b>
                            <small className="muted block">{r.packs} {r.packs === 1 ? 'pack' : 'packs'}</small>
                          </td>
                          <td><b className={r.deliveredKg ? 'pos' : 'muted'}>{formatWeight(r.deliveredKg)}</b></td>
                          <td><YetCell r={r} /></td>
                          <td className="oa-bar-col"><Progress r={r} /></td>
                          <td className="end"><ExpandButton r={r} open={open === r.key} onToggle={() => toggle(r.key)} /></td>
                        </tr>
                        {open === r.key && <tr className="oa-expand"><td colSpan={7}><Detail r={r} /></td></tr>}
                      </RowGroup>
                    ))}
                  </tbody>
                  {shown.length === agg.rows.length && (
                    <tfoot>
                      <tr>
                        <td><b>Total</b></td>
                        <td><b>{t.received}</b></td>
                        <td><b>{formatWeight(t.orderedKg)}</b></td>
                        <td><b>{formatWeight(t.deliveredKg)}</b></td>
                        <td><b className="oa-amber">{formatWeight(t.yetKg)}</b></td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            {/* Phones / small tablets: cards */}
            <div className="oa-cards">
              {shown.map((r) => (
                <article key={r.key} className="oa-card">
                  <ProductCell r={r} />
                  <Progress r={r} />
                  <div className="oa-metrics">
                    <div className="oa-metric"><span>Orders</span><b>{r.orderCount}</b></div>
                    <div className="oa-metric">
                      <span>Ordered</span>
                      <b>{formatWeight(r.orderedKg)}</b>
                      <small className="muted block">{r.packs} {r.packs === 1 ? 'pack' : 'packs'}</small>
                    </div>
                    <div className="oa-metric"><span>Delivered</span><b className={r.deliveredKg ? 'pos' : 'muted'}>{formatWeight(r.deliveredKg)}</b></div>
                    <div className="oa-metric"><span>Yet to deliver</span><YetCell r={r} /></div>
                  </div>
                  <ExpandButton r={r} open={open === r.key} onToggle={() => toggle(r.key)} />
                  {open === r.key && <Detail r={r} />}
                </article>
              ))}
            </div>
          </>
        )}

        {agg.unordered > 0 && (
          <p className="sub oa-foot">{agg.unordered} active {agg.unordered === 1 ? 'product has' : 'products have'} no orders in this period.</p>
        )}
      </section>
    </div>
  );
}

// Lets a table row and its detail row share one key.
function RowGroup({ children }) {
  return <>{children}</>;
}
