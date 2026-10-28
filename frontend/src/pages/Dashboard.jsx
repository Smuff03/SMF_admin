import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { dashboard } from '../analytics.js';
import { useApp } from '../context.jsx';
import { profitSummary } from '../profit.js';
import Icon from '../components/Icon.jsx';
import DataTable from '../components/DataTable.jsx';
import { AreaChart, Donut } from '../components/Charts.jsx';
import { Badge, Button, EmptyState, PageHeader, Tile } from '../components/ui.jsx';
import { compact, downloadCsv, formatWeight, greeting, initial, inr, when } from '../utils.js';

const delta = (v, label) => <small className={v >= 0 ? 'up' : 'down'}>{v >= 0 ? '↑' : '↓'} {Math.abs(v)}% {label}</small>;

const orderCols = [
  { label: 'Order', render: (r) => <b>#{r.id}</b> },
  { label: 'Customer', render: (r) => (typeof r.customer === 'object' && r.customer ? (r.customer.name || r.customer.email || 'Customer') : (r.customer || '—')) },
  { label: 'Type', render: (r) => <Badge>{r.type}</Badge> },
  { label: 'Amount', render: (r) => <b>{inr(r.amount)}</b> },
  { label: 'Status', render: (r) => <Badge>{r.status}</Badge> },
  { label: 'When', render: (r) => <span className="muted">{when(r.createdAt)}</span> },
];

export default function Dashboard() {
  const { setConnOpen, data, errors } = useApp();
  const [range, setRange] = useState(30);
  const error = errors.orders || errors.products || '';
  const d = useMemo(() => (data.orders && data.products ? dashboard(data.orders, data.products) : null), [data.orders, data.products]);

  // Profit from delivered orders, measured against what the stock cost to purchase (Kg x cost per Kg).
  const profit = useMemo(() => (data.orders && data.products ? profitSummary(data.orders, data.products, 30) : null), [data.orders, data.products]);

  if (error) {
    return <EmptyState title="Dashboard unavailable" text={`${error}. Check the connection settings.`}
      action={<Button onClick={() => setConnOpen(true)}>Review connection settings</Button>} />;
  }
  if (!d) return <div className="loading">Loading dashboard…</div>;

  const { kpis: k, mix } = d;
  const series = d.series.slice(-range);
  const labels = series.map((_, i) => String(new Date(Date.now() - (series.length - 1 - i) * 864e5).getDate()).padStart(2, '0'));
  const total = mix.retail + mix.wholesale;
  const retailPct = total ? Math.round((mix.retail / total) * 100) : 0;
  const exportReport = () => downloadCsv('Crunchzy_dashboard-report.csv', [
    ['Net profit (all delivered orders)', profit.total.profit], ['Profit last 30 days', profit.recent.profit], ['Profit margin % (all delivered)', profit.total.margin],
    ['Purchase cost of delivered goods', profit.total.cost], ['Today\'s sales', k.todaySales], ['Monthly sales', k.monthSales], ['Total orders', k.totalOrders], ['Orders this week', k.weekOrders],
    ['Pending orders', k.pendingOrders], ['Retail sales', mix.retail], ['Wholesale sales', mix.wholesale],
  ].map(([metric, value]) => ({ metric, value })));

  const cards = [
    ['Today\'s sales', inr(k.todaySales), delta(k.todayChange, 'vs yesterday'), 'rupee', 'green'],
    ['Monthly sales', inr(k.monthSales), delta(k.monthChange, 'vs last month'), 'rupee', 'blue'],
    ['Total orders', k.totalOrders, <small className="up">{k.weekOrders} orders this week</small>, 'cart', 'orange'],
    ['Pending orders', k.pendingOrders, <small className="up">Needs attention</small>, 'file', 'red'],
  ];

  const tone = (v) => (v >= 0 ? 'up' : 'down');
  const profitCards = [
    ['Net profit', inr(profit.total.profit), <small className={tone(profit.total.profit)}>{profit.total.orders} delivered {profit.total.orders === 1 ? 'order' : 'orders'}</small>, 'rupee', profit.total.profit >= 0 ? 'green' : 'red'],
    ['Profit · last 30 days', inr(profit.recent.profit), <small className={tone(profit.recent.profit)}>{profit.recent.margin}% margin</small>, 'rupee', 'blue'],
    ['Profit margin', `${profit.total.margin}%`, <small className="muted">On {inr(profit.total.revenue)} delivered sales</small>, 'cart', 'orange'],
    ['Purchase cost', inr(profit.total.cost), <small className="muted">Cost of goods delivered</small>, 'file', 'red'],
  ];
  const renderCards = (list) => list.map(([label, value, note, icon, t]) => (
    <div key={label} className="card kpi">
      <span className={`kicon t-${t}`}><Icon name={icon} size={20} /></span>
      <div><span className="muted">{label}</span><b className="kv">{value}</b>{note}</div>
    </div>
  ));

  return (
    <>
      <PageHeader eyebrow={`OVERVIEW / ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase()}`}
        title={`${greeting()}, Admin`} subtitle="Here’s the health of your snacks business today."
        action={<Button icon="download" onClick={exportReport}>Export report</Button>} />

      <div className="kpis">{renderCards(cards)}</div>

      <div className="kpis">{renderCards(profitCards)}</div>
      {profit.skipped > 0 && (
        <div className="banner">
          <Icon name="box" size={22} />
          <p>
            <b>{profit.skipped} delivered {profit.skipped === 1 ? 'order is' : 'orders are'} not in the profit figures yet.</b>{' '}
            Some items have no purchase cost. Record the purchase in <Link className="link" to="/purchases">Purchases</Link> and they are included automatically.
          </p>
        </div>
      )}

      <div className="grid2 mb">
        <section className="card pad">
          <div className="card-h flat">
            <div><h2>Sales overview</h2><p className="sub">Revenue performance {range === 30 ? 'this month' : `over the last ${range} days`}</p></div>
            <select className="sel" value={range} onChange={(e) => setRange(Number(e.target.value))} aria-label="Date range">
              <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
            </select>
          </div>
          <div className="legend-row"><span><i className="dot-g" /> Total sales</span><b>{compact(series.reduce((a, b) => a + b, 0))}</b></div>
          <AreaChart data={series} labels={labels} />
        </section>

        <section className="card pad">
          <div className="card-h flat">
            <div><h2>Sales mix</h2><p className="sub">By customer type</p></div>
            <Icon name="help" size={22} />
          </div>
          <div className="donut-wrap">
            <Donut parts={total ? [{ label: 'Retail', value: mix.retail, color: '#22c55e' }, { label: 'Wholesale', value: mix.wholesale, color: '#cbd5e1' }] : [{ label: 'No sales yet', value: 1, color: '#e5e7eb' }]}>
              <b>{compact(total)}</b><small className="muted">Total sales</small>
            </Donut>
          </div>
          <div className="mix-row"><span><i className="dot-g" /> Retail sales</span><b>{retailPct}%</b></div>
          <div className="mix-row"><span><i className="dot-s" /> Wholesale sales</span><b>{100 - retailPct}%</b></div>
        </section>
      </div>

      <div className="grid2 mb">
        <section className="card">
          <div className="card-h"><div><h2>Recent orders</h2><p className="sub">Your latest customer activity</p></div><Link className="link" to="/orders">View all <Icon name="arrow" size={16} /></Link></div>
          {d.recentOrders.length ? <DataTable columns={orderCols} rows={d.recentOrders} /> : <p className="sub pad">No orders yet. New orders appear here instantly.</p>}
        </section>
        <section className="card">
          <div className="card-h"><div><h2>Low stock</h2><p className="sub">Products that need replenishing</p></div><Link className="link" to="/inventory">View inventory <Icon name="arrow" size={16} /></Link></div>
          {d.lowStock.length ? d.lowStock.map((p) => (
            <div key={p.id} className="stock-row">
              <Tile>{initial(p.name)}</Tile>
              <div className="grow"><b>{p.name}</b><small className="muted block">{p.category}</small><div className="bar"><i style={{ width: `${Math.min(100, (p.stock / 50) * 100)}%` }} /></div></div>
              <span className="low">{formatWeight(p.stock)} left</span>
            </div>
          )) : <p className="sub pad">Everything is well stocked.</p>}
        </section>
      </div>
    </>
  );
}