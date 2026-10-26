import { useState, useEffect, useMemo } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import ResourcePage from './ResourcePage.jsx';
import { Badge, Button, Muted, Tile } from '../components/ui.jsx';
import { CATEGORIES, formatWeight, initial, inr, parseWeightKg } from '../utils.js';
import { deleteImages, uploadProductImage } from '../storage.js';

const price = (v) => (v == null ? <Muted /> : inr(v));

const PRESET_SIZES = ['200 gm', '500 gm', '1 kg', '250 gm', '2 kg', '5 kg'];
const STARTING_PRESETS = ['200 gm', '500 gm', '1 kg'];

function sortPacks(list = []) {
  return [...list].sort((a, b) => parseWeightKg(a) - parseWeightKg(b));
}

function ProductPackagingPricing({ values, setField }) {
  const [customQty, setCustomQty] = useState('');

  // Active starting pack size
  const starting = values.startingQuantity || (values.packSize ? values.packSize.split(',')[0].trim() : '200 gm');

  // Active available pack sizes
  const available = useMemo(() => {
    if (Array.isArray(values.availableQuantities) && values.availableQuantities.length > 0) {
      return sortPacks(values.availableQuantities);
    }
    if (values.packSize) {
      const parsed = values.packSize.split(',').map((s) => s.trim()).filter(Boolean);
      if (parsed.length > 0) return sortPacks(parsed);
    }
    return ['200 gm', '500 gm', '1 kg'];
  }, [values.availableQuantities, values.packSize]);

  // Variant pricing list: [{ weight, mrp, retailPrice, wholesalePrice }]
  const variants = useMemo(() => {
    const rawList = Array.isArray(values.variantPricing) ? values.variantPricing : [];
    const map = new Map(rawList.map((v) => [v.weight, v]));
    return available.map((w) => {
      const existing = map.get(w);
      if (existing) return existing;
      const topMrp = Number(values.mrp) || 0;
      const topRetail = Number(values.retailPrice) || 0;
      const topWholesale = Number(values.wholesalePrice) || 0;
      const wKg = parseWeightKg(w);
      const startKg = parseWeightKg(starting) || 1;
      const factor = wKg / startKg;
      return {
        weight: w,
        mrp: topMrp ? Math.round(topMrp * factor) : '',
        retailPrice: topRetail ? Math.round(topRetail * factor) : '',
        wholesalePrice: topWholesale ? Math.round(topWholesale * factor) : '',
      };
    });
  }, [available, values.variantPricing, values.mrp, values.retailPrice, values.wholesalePrice, starting]);

  // Initial sync on mount
  useEffect(() => {
    if (!values.startingQuantity) setField('startingQuantity', starting);
    if (!values.availableQuantities || !values.availableQuantities.length) setField('availableQuantities', available);
    if (!values.packSize) setField('packSize', available.join(', '));
    if (!values.variantPricing || !values.variantPricing.length) setField('variantPricing', variants);
  }, []);

  const syncVariants = (nextAvail, currentVariants, curStart) => {
    const map = new Map(currentVariants.map((v) => [v.weight, v]));
    const nextVp = nextAvail.map((w) => map.get(w) || { weight: w, mrp: '', retailPrice: '', wholesalePrice: '' });
    setField('variantPricing', nextVp);
    const startVp = nextVp.find((v) => v.weight === curStart) || nextVp[0];
    if (startVp) {
      if (startVp.mrp) setField('mrp', startVp.mrp);
      if (startVp.retailPrice) setField('retailPrice', startVp.retailPrice);
      if (startVp.wholesalePrice) setField('wholesalePrice', startVp.wholesalePrice);
    }
  };

  const updateStarting = (newStart) => {
    setField('startingQuantity', newStart);
    let nextAvail = [...available];
    const startKg = parseWeightKg(newStart);
    if (newStart === '500 gm' || newStart === '1 kg') {
      nextAvail = nextAvail.filter((q) => parseWeightKg(q) >= startKg);
    }
    if (!nextAvail.includes(newStart)) {
      nextAvail.push(newStart);
    }
    nextAvail = sortPacks(nextAvail);
    setField('availableQuantities', nextAvail);
    setField('packSize', nextAvail.join(', '));
    syncVariants(nextAvail, variants, newStart);
  };

  const toggleQuantity = (q) => {
    let nextAvail;
    if (available.includes(q)) {
      if (available.length <= 1) return;
      nextAvail = available.filter((it) => it !== q);
    } else {
      nextAvail = sortPacks([...available, q]);
    }
    let nextStart = starting;
    if (!nextAvail.includes(nextStart)) {
      nextStart = nextAvail[0];
      setField('startingQuantity', nextStart);
    }
    setField('availableQuantities', nextAvail);
    setField('packSize', nextAvail.join(', '));
    syncVariants(nextAvail, variants, nextStart);
  };

  const addCustomQuantity = () => {
    const q = customQty.trim();
    if (!q || available.includes(q)) return;
    const nextAvail = sortPacks([...available, q]);
    setCustomQty('');
    setField('availableQuantities', nextAvail);
    setField('packSize', nextAvail.join(', '));
    syncVariants(nextAvail, variants, starting);
  };

  const handlePriceChange = (weight, field, val) => {
    const nextVp = variants.map((v) => (v.weight === weight ? { ...v, [field]: val === '' ? '' : Number(val) } : v));
    setField('variantPricing', nextVp);
    if (weight === starting) {
      setField(field, val === '' ? '' : Number(val));
    }
  };

  const autofillProportional = (fromWeight) => {
    const base = variants.find((v) => v.weight === fromWeight);
    if (!base) return;
    const baseKg = parseWeightKg(fromWeight);
    if (!baseKg) return;
    const nextVp = variants.map((v) => {
      const vKg = parseWeightKg(v.weight);
      const ratio = vKg / baseKg;
      return {
        ...v,
        mrp: base.mrp ? Math.round(Number(base.mrp) * ratio) : v.mrp,
        retailPrice: base.retailPrice ? Math.round(Number(base.retailPrice) * ratio) : v.retailPrice,
        wholesalePrice: base.wholesalePrice ? Math.round(Number(base.wholesalePrice) * ratio) : v.wholesalePrice,
      };
    });
    setField('variantPricing', nextVp);
    const startVp = nextVp.find((v) => v.weight === starting) || nextVp[0];
    if (startVp) {
      if (startVp.mrp) setField('mrp', startVp.mrp);
      if (startVp.retailPrice) setField('retailPrice', startVp.retailPrice);
      if (startVp.wholesalePrice) setField('wholesalePrice', startVp.wholesalePrice);
    }
  };

  return (
    <div className="qty-config-box">
      {/* 1. Starting Quantity Selection */}
      <div>
        <div className="qty-section-head">
          <b>1. Starting Pack Size (Minimum pack customer can buy)</b>
          <small className="muted">Some products start from 500 gm</small>
        </div>
        <div className="qty-pills">
          {STARTING_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              className={`qty-pill ${starting === p ? 'active' : ''}`}
              onClick={() => updateStarting(p)}
            >
              {starting === p && <span>★</span>}
              Starts from {p}
            </button>
          ))}
        </div>
      </div>

      {/* 2. Available Pack Sizes Selection */}
      <div>
        <div className="qty-section-head">
          <b>2. Available Quantities for this Product</b>
          <small className="muted">Select which pack sizes are in stock</small>
        </div>
        <div className="qty-chips-grid">
          {PRESET_SIZES.map((size) => {
            const isChecked = available.includes(size);
            const isStart = starting === size;
            const isBelowStart = parseWeightKg(size) < parseWeightKg(starting);
            return (
              <label
                key={size}
                className={`qty-chip-btn ${isChecked ? 'checked' : ''} ${isStart ? 'is-starting' : ''}`}
                style={{ opacity: isBelowStart && !isChecked ? 0.6 : 1 }}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleQuantity(size)}
                />
                <span>{size}</span>
                {isStart && <span className="qty-badge-start">Starting Pack</span>}
              </label>
            );
          })}
        </div>
        <div className="qty-custom-row">
          <input
            type="text"
            placeholder="Add custom pack (e.g. 100 gm)"
            value={customQty}
            onChange={(e) => setCustomQty(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomQuantity(); } }}
          />
          <Button type="button" onClick={addCustomQuantity}>+ Add pack size</Button>
        </div>
      </div>

      {/* 3. DMart-style Pricing Matrix Table */}
      <div>
        <div className="qty-section-head">
          <b>3. MRP & Price According to Quantity (DMart Style)</b>
          <div style={{ display: 'flex', gap: '8px' }}>
            {available.length > 1 && (
              <Button
                type="button"
                onClick={() => autofillProportional(available.includes('1 kg') ? '1 kg' : starting)}
                style={{ fontSize: '11px', padding: '4px 8px', height: 'auto' }}
                title="Auto-calculate prices proportionally based on largest or starting pack"
              >
                ⚡ Auto-fill proportionally
              </Button>
            )}
          </div>
        </div>

        <div className="dmart-pricing-wrap">
          <table className="dmart-pricing-table">
            <thead>
              <tr>
                <th style={{ width: '130px' }}>Pack Size</th>
                <th>MRP (₹)</th>
                <th>Retail Price (₹)</th>
                <th>Wholesale (₹)</th>
                <th style={{ width: '150px' }}>DMart Discount</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((v) => {
                const isStart = v.weight === starting;
                const mrp = Number(v.mrp || 0);
                const retail = Number(v.retailPrice || 0);
                const savings = mrp > retail ? mrp - retail : 0;
                const savingsPct = mrp > 0 && savings > 0 ? Math.round((savings / mrp) * 100) : 0;
                return (
                  <tr key={v.weight} style={isStart ? { background: '#fcfdfd' } : undefined}>
                    <td>
                      <b>{v.weight}</b>
                      {isStart && <span className="qty-badge-start" style={{ display: 'block', width: 'fit-content', marginTop: '2px' }}>Starting</span>}
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="e.g. 100"
                        value={v.mrp}
                        onChange={(e) => handlePriceChange(v.weight, 'mrp', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="e.g. 85"
                        value={v.retailPrice}
                        onChange={(e) => handlePriceChange(v.weight, 'retailPrice', e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="e.g. 70"
                        value={v.wholesalePrice}
                        onChange={(e) => handlePriceChange(v.weight, 'wholesalePrice', e.target.value)}
                      />
                    </td>
                    <td>
                      {savings > 0 ? (
                        <span className="dmart-savings-badge">
                          Save ₹{savings} ({savingsPct}% OFF)
                        </span>
                      ) : mrp > 0 && retail >= mrp ? (
                        <span className="badge b-gray">No discount</span>
                      ) : (
                        <span className="muted" style={{ fontSize: '11px' }}>Enter prices</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="dmart-info-note">
          <span>ℹ️ Cost price is removed from this form and automatically recorded from vendor purchase orders on the <b>Purchases</b> page.</span>
        </div>
      </div>

      {/* 4. Live Summary */}
      <div className="qty-summary-banner">
        <span>
          Selected: <b>{available.join(', ')}</b> (Starts from <b>{starting}</b>)
        </span>
        {variants.some((v) => v.retailPrice) && (
          <span>
            Starting Price: <b>{inr(variants.find((v) => v.weight === starting)?.retailPrice || variants[0]?.retailPrice || 0)}</b>
          </span>
        )}
      </div>
    </div>
  );
}

const columns = [
  {
    label: 'Product', render: (r) => (
      <div className="cell">
        {r.imageUrl ? <img className="tile tile-img" src={r.imageUrl} alt="" loading="lazy" /> : <Tile>{initial(r.name)}</Tile>}
        <div>
          <b>{r.name}</b>
          <small className="muted">{r.sku}{r.startingQuantity ? ` · Starts ${r.startingQuantity}` : r.packSize ? ` · ${r.packSize}` : ''}</small>
        </div>
      </div>
    )
  },
  { label: 'Category', key: 'category' },
  {
    label: 'Pack Sizes & Pricing (DMart)',
    render: (r) => {
      const vps = Array.isArray(r.variantPricing) && r.variantPricing.length > 0
        ? r.variantPricing
        : (r.availableQuantities || (r.packSize ? r.packSize.split(',').map((s) => s.trim()) : ['1 kg'])).map((w) => ({
            weight: w,
            mrp: r.mrp,
            retailPrice: r.retailPrice,
          }));
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          {vps.slice(0, 3).map((v) => {
            const mrp = Number(v.mrp || 0);
            const retail = Number(v.retailPrice || 0);
            const savings = mrp > retail ? mrp - retail : 0;
            return (
              <div key={v.weight} style={{ fontSize: '12px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                <span className={`qty-tag ${v.weight === r.startingQuantity ? 'start-tag' : ''}`}>{v.weight}</span>
                {retail > 0 ? (
                  <span>
                    <b>{inr(retail)}</b>
                    {savings > 0 && <span className="muted" style={{ textDecoration: 'line-through', fontSize: '11px', marginLeft: '4px' }}>{inr(mrp)}</span>}
                  </span>
                ) : (
                  <span className="muted">—</span>
                )}
              </div>
            );
          })}
          {vps.length > 3 && <small className="muted">+{vps.length - 3} more sizes</small>}
        </div>
      );
    }
  },
  {
    label: 'Starting Price',
    render: (r) => (r.retailPrice != null ? <b>{price(r.retailPrice)}</b> : <Muted />)
  },
  {
    label: 'Purchase Cost',
    render: (r) => r.costPrice != null ? (
      <div>
        <b>{price(r.costPrice)}</b>
        <small className="muted" style={{ display: 'block', fontSize: '10px' }}>from purchases</small>
      </div>
    ) : (
      <span className="muted" style={{ fontSize: '11px' }}>From purchases</span>
    )
  },
  {
    label: 'Stock (Kg)',
    render: (r, c) => (
      <div>
        <span className={r.stock <= 0 ? 'neg' : r.stock <= c.threshold ? 'low' : 'strong'}>
          <b>{formatWeight(r.stock)}</b>
        </span>
        {r.stock < 0 && (
          <small className="neg block" style={{ fontSize: '10px', fontWeight: '600' }}>
            Needs Purchase
          </small>
        )}
      </div>
    ),
  },
  { label: 'State', render: (r) => <Badge>{r.active ? 'Active' : 'Inactive'}</Badge> },
];

const fields = () => [
  { name: 'name', label: 'Product name', required: true, full: true, placeholder: 'e.g. Bhajani Chakli, Poha Chivda' },
  { name: 'description', label: 'Description', type: 'textarea', full: true, placeholder: 'Taste, ingredients, shelf life…', hint: 'Shown to customers on the store.' },
  { name: 'category', label: 'Category', type: 'select', options: CATEGORIES },
  { name: 'active', label: 'State', type: 'select', options: [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }], default: 'true' },
  { name: 'startingQuantity', type: 'hidden', default: '200 gm' },
  { name: 'availableQuantities', type: 'array', default: ['200 gm', '500 gm', '1 kg'] },
  { name: 'variantPricing', type: 'array', default: [] },
  { name: 'packSize', type: 'hidden', default: '200 gm, 500 gm, 1 kg' },
  { name: 'mrp', type: 'hidden' },
  { name: 'retailPrice', type: 'hidden' },
  { name: 'wholesalePrice', type: 'hidden' },
  {
    name: 'packagingPricing',
    label: 'Packaging, Quantities & Pricing',
    full: true,
    render: ({ values, setField }) => (
      <ProductPackagingPricing values={values} setField={setField} />
    )
  },
  { name: 'images', label: 'Product images', type: 'images', full: true, hint: 'Up to 6 images. The first one is the cover shown in lists.' },
];

const margin = (r) => {
  if (r.retailPrice > 0 && r.costPrice != null) return `${inr(r.retailPrice - r.costPrice)} per unit (${Math.round(((r.retailPrice - r.costPrice) / r.retailPrice) * 100)}% over purchase cost)`;
  if (r.retailPrice != null && r.wholesalePrice != null) return `${inr(r.retailPrice - r.wholesalePrice)} per unit (retail − wholesale)`;
  return 'Record purchase to see margin';
};

const expand = (r, c) => (
  <div className="expand-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '20px', width: '100%' }}>
    <div>
      <div style={{ marginBottom: '10px' }}><small className="muted">Gross Margin</small><b>{margin(r)}</b></div>
      <div style={{ marginBottom: '10px' }}><small className="muted">Purchase Cost</small><b>{r.costPrice != null ? `${inr(r.costPrice)} / Kg (From Purchases)` : 'No purchase recorded yet'}</b></div>
      <div style={{ marginBottom: '10px' }}><small className="muted">Starting Pack</small><b>{r.startingQuantity || '200 gm'}</b></div>
      <div><small className="muted">Added</small><b>{new Date(r.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</b></div>
    </div>

    <div>
      <small className="muted">Pack Sizes & DMart Pricing</small>
      <div style={{ marginTop: '6px', background: '#fff', border: '1px solid var(--line)', borderRadius: '8px', padding: '10px 14px' }}>
        {(Array.isArray(r.variantPricing) && r.variantPricing.length > 0 ? r.variantPricing : (r.availableQuantities || ['1 kg']).map((w) => ({ weight: w, mrp: r.mrp, retailPrice: r.retailPrice }))).map((v) => {
          const mrp = Number(v.mrp || 0);
          const retail = Number(v.retailPrice || 0);
          const savings = mrp > retail ? mrp - retail : 0;
          const savingsPct = mrp > 0 && savings > 0 ? Math.round((savings / mrp) * 100) : 0;
          return (
            <div key={v.weight} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: '13px' }}>
              <span style={{ fontWeight: 600 }}>{v.weight} {v.weight === r.startingQuantity ? '★' : ''}</span>
              <div>
                <b>{retail ? inr(retail) : '—'}</b>
                {savings > 0 && <small className="pos" style={{ marginLeft: '6px', fontWeight: 600 }}>({savingsPct}% OFF)</small>}
              </div>
            </div>
          );
        })}
      </div>
    </div>

    {r.description && <div className="expand-desc" style={{ gridColumn: '1 / -1' }}><small className="muted">Description</small><p>{r.description}</p></div>}

    {r.images?.length > 0 && (
      <div style={{ gridColumn: '1 / -1' }}><small className="muted">Images</small>
        <div className="gallery">{r.images.map((i) => <a key={i.path} href={i.url} target="_blank" rel="noreferrer"><img src={i.url} alt="" loading="lazy" /></a>)}</div>
      </div>
    )}

    <div className="expand-actions" style={{ gridColumn: '1 / -1' }}>
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

  const availableQuantities = Array.isArray(values.availableQuantities) && values.availableQuantities.length > 0
    ? values.availableQuantities
    : ['200 gm', '500 gm', '1 kg'];
  const startingQuantity = values.startingQuantity || availableQuantities[0] || '200 gm';
  const packSize = values.packSize || availableQuantities.join(', ');
  const variantPricing = Array.isArray(values.variantPricing) ? values.variantPricing : [];
  const startVp = variantPricing.find((v) => v.weight === startingQuantity) || variantPricing[0];
  const mrp = values.mrp ? Number(values.mrp) : (startVp?.mrp ? Number(startVp.mrp) : null);
  const retailPrice = values.retailPrice ? Number(values.retailPrice) : (startVp?.retailPrice ? Number(startVp.retailPrice) : null);
  const wholesalePrice = values.wholesalePrice ? Number(values.wholesalePrice) : (startVp?.wholesalePrice ? Number(startVp.wholesalePrice) : null);

  const { costPrice, packagingPricing, ...rest } = values;
  return {
    values: {
      ...rest,
      startingQuantity,
      availableQuantities,
      variantPricing,
      packSize,
      mrp,
      retailPrice,
      wholesalePrice,
      images,
    },
    rollback: () => deleteImages(uploaded),
    commit: () => deleteImages(removed)
  };
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
    <ResourcePage resource="products" eyebrow="CATALOG / PRODUCTS" title="Products" subtitle="Manage your TMF snack catalogue, packaging variants, DMart pricing, and availability."
      above={() => <SyncBar />} addLabel="Add product" noun="product" countNoun="products" columns={columns} fields={fields} expand={expand}
      onBeforeSave={prepareImages} onRemoved={(row) => deleteImages(row.images)}
      searchKeys={['name', 'sku', 'category']} placeholder="Search products…"
      banner={(rows) => ({ strong: 'Catalogue seed imported.', text: `${rows.length} products from The Maharashtra Foods catalogue are ready for pricing. MRP, retail, and wholesale prices were not present in the PDF.` })}
      filters={[
        { key: 'category', label: 'All categories', options: opts(CATEGORIES), test: (r, v) => r.category === v },
        {
          key: 'stock', label: 'Any stock level', panel: true, options: opts(['Deficit', 'Out of stock', 'Low stock', 'In stock']),
          test: (r, v, { threshold }) => (v === 'Deficit' ? r.stock < 0 : v === 'Out of stock' ? r.stock <= 0 : v === 'Low stock' ? r.stock > 0 && r.stock <= threshold : r.stock > threshold)
        },
        { key: 'state', label: 'Any state', panel: true, options: opts(['Active', 'Inactive']), test: (r, v) => r.active === (v === 'Active') },
      ]} />
  );
}