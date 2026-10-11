import { api } from '../api.js';
import { useApp } from '../context.jsx';
import ResourcePage from './ResourcePage.jsx';
import { Badge, Button, Muted, Tile } from '../components/ui.jsx';
import { CATEGORIES, initial, inr } from '../utils.js';
import { deleteImages, uploadProductImage } from '../storage.js';

const price = (v) => (v == null ? <Muted /> : inr(v));

const columns = [
  {
    label: 'Product', render: (r) => (
      <div className="cell">{r.imageUrl ? <img className="tile tile-img" src={r.imageUrl} alt="" loading="lazy" /> : <Tile>{initial(r.name)}</Tile>}<div><b>{r.name}</b><small className="muted">{r.sku}{r.packSize ? ` · ${r.packSize}` : ''}</small></div></div>
    )
  },
  { label: 'Category', key: 'category' },
  { label: 'MRP', render: (r) => price(r.mrp) },
  { label: 'Retail price', render: (r) => price(r.retailPrice) },
  { label: 'Wholesale', render: (r) => price(r.wholesalePrice) },
  { label: 'Cost', render: (r) => price(r.costPrice) },
  { label: 'Stock', render: (r, c) => <span className={r.stock <= c.threshold ? 'low' : 'strong'}>{r.stock} units</span> },
  { label: 'State', render: (r) => <Badge>{r.active ? 'Active' : 'Inactive'}</Badge> },
];

const fields = () => [
  { name: 'name', label: 'Product name', required: true, full: true },
  { name: 'description', label: 'Description', type: 'textarea', full: true, placeholder: 'What it is, taste, ingredients, shelf life…', hint: 'Shown to customers on the store.' },
  { name: 'category', label: 'Category', type: 'select', options: CATEGORIES },
  { name: 'packSize', label: 'Quantity / pack size', placeholder: 'e.g. 250 g, 500 g, 1 kg', hint: 'Net quantity in one pack. Shown to customers on the store.' },
  { name: 'stock', label: 'Opening stock (units)', type: 'number', min: 0, step: '1', default: '0' },
  { name: 'mrp', label: 'MRP (₹)', type: 'number', min: 0, step: '0.01', placeholder: 'Not set' },
  { name: 'retailPrice', label: 'Retail price (₹)', type: 'number', min: 0, step: '0.01', placeholder: 'Not set' },
  { name: 'wholesalePrice', label: 'Wholesale price (₹)', type: 'number', min: 0, step: '0.01', placeholder: 'Not set' },
  {
    name: 'costPrice', label: 'Cost price (₹)', type: 'number', min: 0, step: '0.01', placeholder: 'Not set',
    hint: 'What one unit costs you. Used to work out profit; updated automatically (average) when you receive a purchase.'
  },
  { name: 'active', label: 'State', type: 'select', options: [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }], default: 'true' },
  { name: 'images', label: 'Product images', type: 'images', full: true, hint: 'Up to 6 images. The first one is the cover shown in lists.' },
];

const margin = (r) => {
  if (r.retailPrice > 0 && r.costPrice != null) return `${inr(r.retailPrice - r.costPrice)} per unit (${Math.round(((r.retailPrice - r.costPrice) / r.retailPrice) * 100)}% over cost)`;
  if (r.retailPrice != null && r.wholesalePrice != null) return `${inr(r.retailPrice - r.wholesalePrice)} per unit (retail − wholesale)`;
  return 'Set cost and retail prices to see margin';
};

const expand = (r, c) => (
  <div className="expand-body">
    <div><small className="muted">Margin</small><b>{margin(r)}</b></div>
    {r.packSize && <div><small className="muted">Quantity</small><b>{r.packSize}</b></div>}
    <div><small className="muted">Added</small><b>{new Date(r.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</b></div>
    {r.description && <div className="expand-desc"><small className="muted">Description</small><p>{r.description}</p></div>}
    {r.images?.length > 0 && (
      <div><small className="muted">Images</small>
        <div className="gallery">{r.images.map((i) => <a key={i.path} href={i.url} target="_blank" rel="noreferrer"><img src={i.url} alt="" loading="lazy" /></a>)}</div>
      </div>
    )}
    <div className="expand-actions">
      <Button icon="pencil" onClick={() => c.edit(r)}>Edit</Button>
      <Button onClick={() => c.update(r, { active: !r.active }, r.active ? 'Product deactivated' : 'Product activated')}>{r.active ? 'Mark inactive' : 'Mark active'}</Button>
      <Button variant="danger-ghost" icon="trash" onClick={() => c.remove(r)}>Delete</Button>
    </div>
  </div>
);

/** Upload newly picked files first; if the save then fails, delete them again. Images removed in an edit are deleted after a successful save. */
async function prepareImages(values, row) {
  const uploaded = [];
  const results = await Promise.allSettled((values.images || []).map(async (it) => {
    if (!it.file) return { url: it.url, path: it.path };
    const img = await uploadProductImage(it.file);
    uploaded.push(img);
    return img;
  }));
  const failed = results.find((r) => r.status === 'rejected');
  if (failed) { await deleteImages(uploaded); throw failed.reason; }
  const images = results.map((r) => r.value);
  const keep = new Set(images.map((i) => i.path));
  const removed = (row?.images || []).filter((i) => !keep.has(i.path));
  return { values: { ...values, images }, rollback: () => deleteImages(uploaded), commit: () => deleteImages(removed) };
}

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
      onBeforeSave={prepareImages} onRemoved={(row) => deleteImages(row.images)}
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