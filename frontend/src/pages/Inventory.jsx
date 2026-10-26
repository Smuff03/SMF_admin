import { Link } from 'react-router-dom';
import ResourcePage from './ResourcePage.jsx';
import { Badge, Tile } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import { formatWeight, initial, stockLevel, when } from '../utils.js';

const signed = (r) => (r.type === 'Stock out' ? -Number(r.quantity || 0) : Number(r.quantity || 0));

const columns = [
  { label: 'Product', render: (r) => <div className="cell"><Tile>{initial(r.productName)}</Tile><div><b>{r.productName}</b><small className="muted">{r.sku}</small></div></div> },
  { label: 'Type', render: (r) => <Badge>{r.type}</Badge> },
  { label: 'Change (Kg)', render: (r) => <b className={signed(r) < 0 ? 'neg' : 'pos'}>{signed(r) > 0 ? '+' : ''}{formatWeight(Math.abs(signed(r)))}</b> },
  { label: 'Closing Balance', render: (r) => <b>{formatWeight(r.balance)}</b> },
  { label: 'Reference / Note', render: (r) => r.note || <span className="muted">Standard movement</span> },
  { label: 'When', render: (r) => <span className="muted">{when(r.createdAt)}</span> },
];

const fields = ({ products = [] }) => [
  { name: 'productId', label: 'Product', type: 'select', full: true, options: products.map((p) => ({ value: p.id, label: `${p.name} (Current: ${formatWeight(p.stock)})` })) },
  { name: 'type', label: 'Movement type', type: 'select', options: ['Stock in', 'Stock out', 'Adjustment'] },
  { name: 'quantity', label: 'Quantity (in Kg)', type: 'number', step: '0.05', required: true, hint: 'Weight in Kg. Use a negative number to reduce stock in an adjustment.' },
  { name: 'note', label: 'Reason / Reference Note', type: 'textarea', placeholder: 'Batch code, spillage, physical audit count difference…', required: true },
];

function Overview({ rows, look, threshold }) {
  const products = look.products || [];
  const week = rows.filter((r) => Date.now() - new Date(r.createdAt) < 7 * 864e5).length;
  const low = products.filter((p) => p.active && p.stock <= threshold).sort((a, b) => a.stock - b.stock);
  const deficits = products.filter((p) => Number(p.stock || 0) < 0);
  const outOfStock = products.filter((p) => Number(p.stock || 0) <= 0);
  const totalStockKg = products.reduce((a, p) => a + Number(p.stock || 0), 0);
  const cards = [
    ['Total Stock on Hand', formatWeight(totalStockKg), `${products.length} products active`],
    ['Low stock alerts', low.length, `At or below ${threshold} kg`],
    ['Stock deficit / 0 Stock', outOfStock.length, deficits.length > 0 ? `${deficits.length} product(s) in deficit` : 'Needs immediate restock'],
    ['Movements this week', week, 'Orders, purchases & adjustments'],
  ];
  return (
    <>
      <div className="kpis">
        {cards.map(([label, value, hint]) => <div key={label} className="card kpi stack"><span className="muted">{label}</span><b className="kv">{value}</b><small className="muted">{hint}</small></div>)}
      </div>
      <section className="card pad mb">
        <div className="card-h flat">
          <div><h2>Replenishment health</h2><p className="sub">Snack items that need restocking from purchases</p></div>
          <Link className="link" to="/purchases">Plan purchase order <Icon name="arrow" size={16} /></Link>
        </div>
        {low.length ? (
          <div className="health">
            {low.slice(0, 6).map((p) => (
              <div key={p.id} className="health-row">
                <Tile>{initial(p.name)}</Tile>
                <div className="grow"><b>{p.name}</b><small className="muted">{p.category}</small></div>
                <div className="bar"><i style={{ width: `${Math.max(0, Math.min(100, (p.stock / 50) * 100))}%`, background: p.stock < 0 ? '#dc2626' : undefined }} /></div>
                <span className={p.stock < 0 ? 'neg' : 'low'}>{p.stock < 0 ? `${formatWeight(p.stock)} (Deficit)` : `${formatWeight(p.stock)} left`}</span>
                <Badge>{stockLevel(p.stock, threshold)}</Badge>
              </div>
            ))}
          </div>
        ) : <p className="sub">All active products are above the low-stock threshold.</p>}
      </section>
    </>
  );
}

export default function Inventory() {
  return (
    <ResourcePage resource="inventory" eyebrow="WORKSPACE / INVENTORY" title="Inventory" subtitle="Transactional stock movements and replenishment health."
      addLabel="Add record" noun="stock record" countNoun="movements" immutable columns={columns} fields={fields} lookups={['products']}
      searchKeys={['productName', 'sku', 'note']} placeholder="Search movements…" above={(p) => <Overview {...p} />}
      filters={[{ key: 'type', label: 'All movements', options: ['Stock in', 'Stock out', 'Adjustment'].map((v) => ({ value: v, label: v })), test: (r, v) => r.type === v }]} />
  );
}
