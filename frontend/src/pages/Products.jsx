import ResourcePage from './ResourcePage.jsx';
import { Badge, Button, Muted, Tile } from '../components/ui.jsx';
import { CATEGORIES, initial, inr } from '../utils.js';
import { deleteImages, uploadProductImage } from '../storage.js';

const price = (v) => (v == null ? <Muted /> : inr(v));

const columns = [
  { label: 'Product', render: (r) => (
    <div className="cell">{r.imageUrl ? <img className="tile tile-img" src={r.imageUrl} alt="" loading="lazy" /> : <Tile>{initial(r.name)}</Tile>}<div><b>{r.name}</b><small className="muted">{r.sku}</small></div></div>
  ) },
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
  { name: 'images', label: 'Product images', type: 'images', full: true, hint: 'Up to 6 images. The first one is the cover shown in lists.' },
];

const expand = (r, c) => (
  <div className="expand-body">
    <div><small className="muted">Margin</small><b>{r.retailPrice != null && r.wholesalePrice != null ? `${inr(r.retailPrice - r.wholesalePrice)} per unit` : 'Set prices to see margin'}</b></div>
    <div><small className="muted">Added</small><b>{new Date(r.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</b></div>
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

export default function Products() {
  return (
    <ResourcePage resource="products" eyebrow="CATALOG / PRODUCTS" title="Products" subtitle="Manage your TMF snack catalogue, pricing, and availability."
      addLabel="Add product" noun="product" countNoun="products" columns={columns} fields={fields} expand={expand}
      onBeforeSave={prepareImages} onRemoved={(row) => deleteImages(row.images)}
      searchKeys={['name', 'sku', 'category']} placeholder="Search products…"
      banner={(rows) => ({ strong: 'Catalogue seed imported.', text: `${rows.length} products from The Maharashtra Foods catalogue are ready for pricing. MRP, retail, and wholesale prices were not present in the PDF.` })}
      filters={[
        { key: 'category', label: 'All categories', options: opts(CATEGORIES), test: (r, v) => r.category === v },
        { key: 'stock', label: 'Any stock level', panel: true, options: opts(['Low stock', 'In stock', 'Out of stock']),
          test: (r, v, { threshold }) => (v === 'Low stock' ? r.stock > 0 && r.stock <= threshold : v === 'Out of stock' ? r.stock === 0 : r.stock > threshold) },
        { key: 'state', label: 'Any state', panel: true, options: opts(['Active', 'Inactive']), test: (r, v) => r.active === (v === 'Active') },
      ]} />
  );
}
