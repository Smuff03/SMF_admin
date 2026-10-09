import { Link } from 'react-router-dom';
import ResourcePage from './ResourcePage.jsx';
import { Badge, Tile } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import { initial, stockLevel, when } from '../utils.js';

const signed = (r) => (r.type === 'Stock out' ? -r.quantity : r.quantity);

const columns = [
  { label: 'Product', render: (r) => <div className="cell"><Tile>{initial(r.productName)}</Tile><div><b>{r.productName}</b><small className="muted">{r.sku}</small></div></div> },
  { label: 'Type', render: (r) => <Badge>{r.type}</Badge> },
  { label: 'Quantity', render: (r) => <b className={signed(r) < 0 ? 'neg' : 'pos'}>{signed(r) > 0 ? '+' : ''}{signed(r)}</b> },
  { label: 'Balance', render: (r) => `${r.balance} units` },
  { label: 'Note', render: (r) => r.note || <span className="muted">No note</span> },
  { label: 'When', render: (r) => <span className="muted">{when(r.createdAt)}</span> },
];

const fields = ({ products = [] }) => [
  { name: 'productId', label: 'Product', type: 'select', full: true, options: products.map((p) => ({ value: p.id, label: `${p.name} (${p.stock} in stock)` })) },
  { name: 'type', label: 'Movement type', type: 'select', options: ['Stock in', 'Stock out', 'Adjustment'] },
  { name: 'quantity', label: 'Quantity', type: 'number', step: '1', required: true, hint: 'Use a negative number to reduce stock in an adjustment.' },
  { name: 'note', label: 'Note', type: 'textarea', placeholder: 'Batch, reason, or reference' },
];

function Overview({ rows, look, threshold }) {
  const products = look.products || [];
  const week = rows.filter((r) => Date.now() - new Date(r.createdAt) < 7 * 864e5).length;
  const low = products.filter((p) => p.active && p.stock <= threshold).sort((a, b) => a.stock - b.stock);
  const cards = [
    ['Units on hand', products.reduce((a, p) => a + p.stock, 0).toLocaleString('en-IN'), `${products.length} products`],
    ['Low stock', low.length, `At or below ${threshold} units`],
    ['Out of stock', products.filter((p) => p.stock === 0).length, 'Needs immediate restock'],
    ['Movements this week', week, 'Stock in, out and adjustments'],
  ];
  return (
    <>
      <div className="kpis">
        {cards.map(([label, value, hint]) => <div key={label} className="card kpi stack"><span className="muted">{label}</span><b className="kv">{value}</b><small className="muted">{hint}</small></div>)}
      </div>
      <section className="card pad mb">
        <div className="card-h flat">
          <div><h2>Replenishment health</h2><p className="sub">Products that need restocking soon</p></div>
          <Link className="link" to="/purchases">Plan a purchase <Icon name="arrow" size={16} /></Link>
        </div>
        {low.length ? (
          <div className="health">
            {low.slice(0, 6).map((p) => (
              <div key={p.id} className="health-row">
                <Tile>{initial(p.name)}</Tile>
                <div className="grow"><b>{p.name}</b><small className="muted">{p.category}</small></div>
                <div className="bar"><i style={{ width: `${Math.min(100, (p.stock / 50) * 100)}%` }} /></div>
                <span className="low">{p.stock} left</span>
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
