import { useMemo, useState } from 'react';
import { reports } from '../analytics.js';
import { useApp } from '../context.jsx';
import DataTable from '../components/DataTable.jsx';
import { BarChart, HBars } from '../components/Charts.jsx';
import { Badge, Button, EmptyState, PageHeader } from '../components/ui.jsx';
import { compact, downloadCsv, inr } from '../utils.js';

const topCols = [
  { label: 'Customer', render: (r) => <b>{r.name}</b> },
  { label: 'Type', render: (r) => <Badge>{r.type}</Badge> },
  { label: 'Orders', key: 'orders' },
  { label: 'Revenue', render: (r) => <b>{inr(r.total)}</b> },
];

export default function Reports() {
  const { setConnOpen, toast, data, errors } = useApp();
  const [days, setDays] = useState(30);
  const error = errors.orders || errors.products || '';
  const r = useMemo(() => (data.orders && data.products ? reports(data.orders, data.products, days) : null), [data.orders, data.products, days]);

  const exportData = (kind) => {
    const rows = data[kind];
    if (!rows) return toast('Still loading, try again in a moment', 'err');
    if (!rows.length) return toast(`No ${kind} to export yet`, 'err');
    downloadCsv(`crunchzy-${kind}.csv`, rows.map(({ id, ...rest }) => ({ id, ...rest })));
  };

  if (error) return <EmptyState title="Reports unavailable" text={`${error}. Check the connection settings.`} action={<Button onClick={() => setConnOpen(true)}>Review connection settings</Button>} />;
  if (!r) return <div className="loading">Loading reports…</div>;

  const k = r.kpis;
  const cards = [['Revenue', compact(k.revenue), `Last ${r.days} days`], ['Orders', k.orders, 'Placed in this period'], ['Average order', inr(k.avgOrderValue), 'Per order value'], ['Wholesale share', `${k.wholesaleShare}%`, 'Of revenue in this period']];

  return (
    <>
      <PageHeader eyebrow="INSIGHTS / REPORTS" title="Reports" subtitle="Sales, order and stock performance at a glance."
        action={<select className="sel" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Date range"><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select>} />

      <div className="kpis">
        {cards.map(([label, value, hint]) => <div key={label} className="card kpi stack"><span className="muted">{label}</span><b className="kv">{value}</b><small className="muted">{hint}</small></div>)}
      </div>

      <div className="grid2 mb">
        <section className="card pad"><div className="card-h flat"><div><h2>Sales trend</h2><p className="sub">{r.days === 7 ? 'Daily' : 'Weekly'} revenue</p></div></div><BarChart data={r.sales} /></section>
        <section className="card pad"><div className="card-h flat"><div><h2>Orders by status</h2><p className="sub">All orders</p></div></div><HBars data={r.ordersByStatus} /></section>
      </div>

      <div className="grid2 mb">
        <section className="card"><div className="card-h"><div><h2>Top customers</h2><p className="sub">Ranked by revenue in this period</p></div></div>
          {r.topCustomers.length ? <DataTable columns={topCols} rows={r.topCustomers.map((c) => ({ ...c, id: c.name }))} /> : <p className="sub pad">No orders in this period.</p>}
        </section>
        <section className="card pad"><div className="card-h flat"><div><h2>Stock by category</h2><p className="sub">Weight on hand</p></div></div><HBars data={r.stockByCategory} suffix=" kg" /></section>
      </div>

      <section className="card pad mb">
        <div className="card-h flat"><div><h2>Export data</h2><p className="sub">Download records as CSV for spreadsheets or accounting.</p></div></div>
        <div className="export-row">
          {['orders', 'products', 'inventory', 'purchases', 'customers', 'wholesalers'].map((x) => <Button key={x} icon="download" onClick={() => exportData(x)}>{x[0].toUpperCase() + x.slice(1)}</Button>)}
        </div>
      </section>
    </>
  );
}
