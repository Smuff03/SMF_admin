import { api } from '../api.js';
import { useApp } from '../context.jsx';
import ResourcePage from './ResourcePage.jsx';
import { Badge, Button, Muted, Tile } from '../components/ui.jsx';
import { CATEGORIES, initial, inr } from '../utils.js';

const price = (v) => (v == null ? <Muted /> : inr(v));

const columns = [
  {
    label: 'Product', render: (r) => (
      <div className="cell"><Tile>{initial(r.name)}</Tile><div><b>{r.name}</b><small className="muted">{r.sku}</small></div></div>
    )
  },
  { label: 'Category', key: 'category' },
  { label: 'MRP', render: (r) => price(r.mrp) },
  { label: 'Retail price', render: (r) => price(r.retailPrice) },
  { label: 'Wholesale', render: (r) => price(r.wholesalePrice) },
  { label: 'Stock', render: (r, c) => <span className={r.stock <= c.threshold ? 'low' : 'strong'}>{r.stock} units</span> },
  { label: 'State', render: (r) => <Badge>{r.active ? 'Active' : 'Inactive'}</Badge> },
];

const fields = () => [
  { name: 'name', label: 'Product name', required: true, full: true },
  { name: 'category', label: 'Category', type: 'select', options: CATEGORIES },
  { name: 'stock', label: 'Opening stock (units)', type: 'number', min: 0, step: '1', default: '0' },
  { name: 'mrp', label: 'MRP (₹)', type: 'number', min: 0, step: '0.01', placeholder: 'Not set' },
  { name: 'retailPrice', label: 'Retail price (₹)', type: 'number', min: 0, step: '0.01', placeholder: 'Not set' },
  { name: 'wholesalePrice', label: 'Wholesale price (₹)', type: 'number', min: 0, step: '0.01', placeholder: 'Not set' },
  { name: 'active', label: 'State', type: 'select', options: [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }], default: 'true' },
];

const expand = (r, c) => (
  <div className="expand-body">
    <div><small className="muted">Margin</small><b>{r.retailPrice != null && r.wholesalePrice != null ? `${inr(r.retailPrice - r.wholesalePrice)} per unit` : 'Set prices to see margin'}</b></div>
    <div><small className="muted">Added</small><b>{new Date(r.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</b></div>
    <div className="expand-actions">
      <Button icon="pencil" onClick={() => c.edit(r)}>Edit</Button>
      <Button onClick={() => c.update(r, { active: !r.active }, r.active ? 'Product deactivated' : 'Product activated')}>{r.active ? 'Mark inactive' : 'Mark active'}</Button>
      <Button variant="danger-ghost" icon="trash" onClick={() => c.remove(r)}>Delete</Button>
    </div>
  </div>
);

const opts = (list) => list.map((l) => ({ value: l, label: l }));

function SyncBar() {
  const { toast } = useApp();
  const run = async () => {
    try { const r = await api.syncProducts(); toast(`${r.synced} products synced to the customer store`); } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div className="banner">
      <p><b>New products reach the customer store automatically.</b> If older products are missing there, push them across once.</p>
      <Button onClick={run}>Sync all to store</Button>
    </div>
  );
}

export default function Products() {
  return (
    <ResourcePage resource="products" eyebrow="CATALOG / PRODUCTS" title="Products" subtitle="Manage your TMF snack catalogue, pricing, and availability."
      above={() => <SyncBar />} addLabel="Add product" noun="product" countNoun="products" columns={columns} fields={fields} expand={expand}
      searchKeys={['name', 'sku', 'category']} placeholder="Search products…"
      banner={(rows) => ({ strong: 'Catalogue seed imported.', text: `${rows.length} products from The Maharashtra Foods catalogue are ready for pricing. MRP, retail, and wholesale prices were not present in the PDF.` })}
      filters={[
        { key: 'category', label: 'All categories', options: opts(CATEGORIES), test: (r, v) => r.category === v },
        {
          key: 'stock', label: 'Any stock level', panel: true, options: opts(['Low stock', 'In stock', 'Out of stock']),
          test: (r, v, { threshold }) => (v === 'Low stock' ? r.stock > 0 && r.stock <= threshold : v === 'Out of stock' ? r.stock === 0 : r.stock > threshold)
        },
        { key: 'state', label: 'Any state', panel: true, options: opts(['Active', 'Inactive']), test: (r, v) => r.active === (v === 'Active') },
      ]} />
  );
}