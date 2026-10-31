import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import ResourcePage from './ResourcePage.jsx';
import { Badge, Button, Modal, Tile } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import { useApp } from '../context.jsx';
import { api } from '../api.js';
import { customerNameOf } from '../billShare.js';
import {
  formatWeight,
  formatWeightShort,
  initial,
  stockLevel,
  when,
  getDeliveryStatus,
  extractItemWeightKg,
  getOrderItems,
  isDeductedStatus,
  parseWeightKg,
} from '../utils.js';
import './inventory.css';

const signed = (r) => (r.type === 'Stock out' || r.type === 'Used in Demo' ? -Number(r.quantity || 0) : Number(r.quantity || 0));
const round3 = (n) => Math.round(n * 1000) / 1000;

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
  { name: 'type', label: 'Movement type', type: 'select', options: ['Stock in', 'Stock out', 'Used in Demo', 'Adjustment'] },
  { name: 'quantity', label: 'Quantity (in Kg)', type: 'number', step: '0.05', required: true, hint: 'Weight in Kg. For Stock out and Used in Demo, this will be deducted.' },
  { name: 'note', label: 'Reason / Reference Note', type: 'textarea', placeholder: 'Customer tasting demo, batch code, physical count difference…', required: true },
];

/**
 * Stock & Demo Adjustment Modal
 * 1. "Used in demo": enter packs or kg used for tasting/sampling -> deducts from stock.
 * 2. "Set exact stock": enter the counted warehouse stock -> the difference is calculated and logged.
 */
function StockAdjustmentModal({ product, products = [], onClose, onSaved }) {
  const [activeTab, setActiveTab] = useState('demo'); // 'demo' | 'current'
  const [selectedPid, setSelectedPid] = useState(product?.id || products[0]?.id || '');

  const currentProd = products.find((p) => p.id === selectedPid) || product || products[0];
  const currentStockKg = Number(currentProd?.stock || 0);

  // Tab 1: Demo / Tasting state
  const [demoPackVariant, setDemoPackVariant] = useState('200 gm');
  const [demoPacksCount, setDemoPacksCount] = useState(1);
  const [demoCustomKg, setDemoCustomKg] = useState('');
  const [demoNote, setDemoNote] = useState('');

  // Tab 2: Exact Current Stock state
  const [exactCurrentStock, setExactCurrentStock] = useState(currentStockKg);
  const [adjustReason, setAdjustReason] = useState('Used in Demo / Customer Tasting');
  const [adjustNote, setAdjustNote] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Derived demo weight
  const demoWeightKg = useMemo(() => {
    if (demoPackVariant === 'Custom') {
      return Math.max(0, Number(demoCustomKg) || 0);
    }
    const unitKg = parseWeightKg(demoPackVariant, '');
    const count = Math.max(1, parseInt(demoPacksCount, 10) || 1);
    return Math.round(unitKg * count * 1000) / 1000;
  }, [demoPackVariant, demoPacksCount, demoCustomKg]);

  // Handle Tab 1: Used in Demo
  const handleSaveDemo = async (e) => {
    e.preventDefault();
    if (!currentProd) return setError('Please select a product');
    if (demoWeightKg <= 0) return setError('Please enter a valid demo quantity greater than 0');

    setError('');
    setSaving(true);
    try {
      const variantDesc = demoPackVariant === 'Custom' ? formatWeight(demoWeightKg) : `${demoPacksCount} × ${demoPackVariant} (${formatWeight(demoWeightKg)})`;
      const note = demoNote.trim()
        ? `Used in Demo: ${demoNote.trim()} (${variantDesc})`
        : `Customer tasting demo (${variantDesc})`;

      await api.create('inventory', {
        productId: currentProd.id,
        type: 'Used in Demo',
        quantity: demoWeightKg,
        note,
      });

      const newBalance = Math.round((currentStockKg - demoWeightKg) * 1000) / 1000;
      onSaved?.(`Recorded ${formatWeight(demoWeightKg)} used in demo for ${currentProd.name}. Current stock updated to ${formatWeight(newBalance)}.`);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to record demo stock');
      setSaving(false);
    }
  };

  // Handle Tab 2: Set Exact Current Stock
  const handleSaveExactStock = async (e) => {
    e.preventDefault();
    if (!currentProd) return setError('Please select a product');
    const targetStock = Number(exactCurrentStock);
    if (!Number.isFinite(targetStock)) return setError('Please enter a valid stock number');

    const diff = Math.round((targetStock - currentStockKg) * 1000) / 1000;
    if (diff === 0) return setError('New stock matches current stock — no adjustment needed');

    setError('');
    setSaving(true);
    try {
      let type = 'Adjustment';
      let qty = diff;
      let note = adjustNote.trim();

      if (adjustReason.includes('Demo')) {
        if (diff < 0) {
          type = 'Used in Demo';
          qty = Math.abs(diff);
          note = note
            ? `Used in Demo: ${note} (Reconciled from ${formatWeight(currentStockKg)} to ${formatWeight(targetStock)})`
            : `Customer demo/tasting (Stock updated from ${formatWeight(currentStockKg)} to ${formatWeight(targetStock)})`;
        } else {
          type = 'Adjustment';
          qty = diff;
          note = note || `Stock adjustment (Reconciled from ${formatWeight(currentStockKg)} to ${formatWeight(targetStock)})`;
        }
      } else {
        type = 'Adjustment';
        qty = diff;
        note = note
          ? `${adjustReason}: ${note} (Reconciled from ${formatWeight(currentStockKg)} to ${formatWeight(targetStock)})`
          : `${adjustReason} (Stock updated from ${formatWeight(currentStockKg)} to ${formatWeight(targetStock)})`;
      }

      await api.create('inventory', {
        productId: currentProd.id,
        type,
        quantity: qty,
        note,
      });

      onSaved?.(`Current stock for ${currentProd.name} updated to ${formatWeight(targetStock)}.`);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to update stock');
      setSaving(false);
    }
  };

  const diffExact = round3((Number(exactCurrentStock) || 0) - currentStockKg);
  const afterDemo = round3(currentStockKg - demoWeightKg);

  return (
    <Modal title="Record demo usage & update stock" onClose={onClose} width={580}>
      <div className="inv inv-modal">
        <div className="field">
          <label htmlFor="inv-pid">Product <span className="req">*</span></label>
          <select
            id="inv-pid"
            value={selectedPid}
            onChange={(e) => {
              setSelectedPid(e.target.value);
              const found = products.find((p) => p.id === e.target.value);
              if (found) setExactCurrentStock(Number(found.stock || 0));
            }}
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name} (Current: {formatWeight(p.stock)})</option>
            ))}
          </select>
        </div>

        <div className="inv-seg" role="tablist">
          <button type="button" role="tab" aria-selected={activeTab === 'demo'} className={activeTab === 'demo' ? 'on' : ''} onClick={() => setActiveTab('demo')}>
            Used in demo
          </button>
          <button
            type="button" role="tab" aria-selected={activeTab === 'current'} className={activeTab === 'current' ? 'on' : ''}
            onClick={() => { setActiveTab('current'); setExactCurrentStock(currentStockKg); }}
          >
            Set exact stock
          </button>
        </div>

        {error && <div className="form-error" role="alert">{error}</div>}

        {activeTab === 'demo' && (
          <form onSubmit={handleSaveDemo}>
            <p className="sub inv-note">Deduct stock used for customer tasting samples, showroom demos or promotional testing.</p>

            <div className="field">
              <label>Pack size used</label>
              <div className="inv-pills">
                {['100 gm', '200 gm', '250 gm', '500 gm', '1 kg', 'Custom'].map((v) => (
                  <button key={v} type="button" className={`inv-pill ${demoPackVariant === v ? 'on' : ''}`} onClick={() => setDemoPackVariant(v)}>{v}</button>
                ))}
              </div>
            </div>

            {demoPackVariant === 'Custom' ? (
              <div className="field">
                <label htmlFor="inv-custom">Demo weight (Kg) <span className="req">*</span></label>
                <input id="inv-custom" type="number" inputMode="decimal" step="0.05" min="0.01" placeholder="e.g. 0.75" value={demoCustomKg} onChange={(e) => setDemoCustomKg(e.target.value)} required />
              </div>
            ) : (
              <div className="field">
                <label>Number of packs used</label>
                <div className="qty-stepper inv-stepper">
                  <button type="button" className="qty-step-btn" aria-label="Fewer packs" onClick={() => setDemoPacksCount((c) => Math.max(1, c - 1))}>−</button>
                  <input className="qty-step-input" type="number" inputMode="numeric" min="1" value={demoPacksCount} onChange={(e) => setDemoPacksCount(Math.max(1, parseInt(e.target.value, 10) || 1))} aria-label="Number of packs" />
                  <button type="button" className="qty-step-btn" aria-label="More packs" onClick={() => setDemoPacksCount((c) => c + 1)}>+</button>
                </div>
              </div>
            )}

            <div className="field">
              <label htmlFor="inv-demo-note">Customer / event note</label>
              <input id="inv-demo-note" type="text" value={demoNote} onChange={(e) => setDemoNote(e.target.value)} placeholder="e.g. Tasting for Ramesh, exhibition samples…" />
            </div>

            <div className="inv-calc demo">
              <div><span>Current stock</span><b>{formatWeight(currentStockKg)}</b></div>
              <div className="mid"><span>Demo use</span><b>− {formatWeight(demoWeightKg)}</b></div>
              <div className="end"><span>New stock</span><b className={afterDemo < 0 ? 'neg' : 'pos'}>{formatWeight(afterDemo)}</b></div>
            </div>

            <div className="modal-f">
              <Button type="button" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button type="submit" variant="demo" disabled={saving || demoWeightKg <= 0}>
                {saving ? 'Deducting…' : `Deduct ${formatWeight(demoWeightKg)}`}
              </Button>
            </div>
          </form>
        )}

        {activeTab === 'current' && (
          <form onSubmit={handleSaveExactStock}>
            <p className="sub inv-note">Enter the stock you counted in the warehouse. The difference is calculated and logged for you.</p>

            <div className="form-grid">
              <div className="field">
                <label>Current system stock</label>
                <div className="inv-readout">{formatWeight(currentStockKg)}</div>
              </div>
              <div className="field">
                <label htmlFor="inv-exact">Actual stock now (Kg) <span className="req">*</span></label>
                <input id="inv-exact" type="number" inputMode="decimal" step="0.05" value={exactCurrentStock} onChange={(e) => setExactCurrentStock(e.target.value)} placeholder="Counted stock in Kg" required />
              </div>
            </div>

            <div className="field">
              <label htmlFor="inv-reason">Reason for difference</label>
              <select id="inv-reason" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)}>
                <option value="Used in Demo / Customer Tasting">Used in demo / customer tasting</option>
                <option value="Physical Stock Audit Reconciliation">Physical stock audit count</option>
                <option value="Damage / Spillage / Expired">Damage / spillage / waste</option>
                <option value="Surplus Found / Recount">Surplus found in warehouse</option>
                <option value="Other Adjustment">Other adjustment</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="inv-adj-note">Audit reference note</label>
              <input id="inv-adj-note" type="text" value={adjustNote} onChange={(e) => setAdjustNote(e.target.value)} placeholder="e.g. Reconciliation after tasting at trade show…" />
            </div>

            <div className={`inv-calc ${diffExact < 0 ? 'down' : diffExact > 0 ? 'up' : ''}`}>
              <div>
                <span>Adjustment</span>
                <b className={diffExact < 0 ? 'neg' : diffExact > 0 ? 'pos' : 'muted'}>
                  {diffExact > 0 ? `+${formatWeight(diffExact)}` : diffExact < 0 ? `−${formatWeight(Math.abs(diffExact))}` : 'No change'}
                </b>
              </div>
              <div className="end"><span>New stock</span><b>{formatWeight(Number(exactCurrentStock) || 0)}</b></div>
            </div>

            <div className="modal-f">
              <Button type="button" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={saving || Number(exactCurrentStock) === currentStockKg}>
                {saving ? 'Updating…' : `Update stock to ${formatWeight(Number(exactCurrentStock) || 0)}`}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}

/* ---------- small shared pieces (used by both the desktop table and the mobile cards) ---------- */

function statusOf(p) {
  if (p.hasShortage) {
    return p.deficitKg > 0
      ? { tone: 'red', label: `Short ${formatWeight(p.deficitKg)}` }
      : { tone: 'amber', label: 'Restock soon' };
  }
  if (p.hasPendingOrders) return { tone: 'green', label: 'Ready to deliver' };
  if (p.stockOnHand <= 0) return { tone: 'gray', label: 'No stock, no orders' };
  return { tone: 'gray', label: 'Sufficient' };
}

const stockTone = (kg) => (kg < 0 ? 'neg' : kg === 0 ? 'warn' : '');

function ProductCell({ p }) {
  return (
    <div className="cell inv-prod">
      <Tile>{initial(p.name)}</Tile>
      <div>
        <b>{p.name}</b>
        <small className="muted">{[p.sku, p.category].filter(Boolean).join(' · ')}</small>
      </div>
    </div>
  );
}

function UsedBreakdown({ p }) {
  const parts = [
    p.dispatchedKg > 0 && { key: 'disp', label: 'dispatched', kg: p.dispatchedKg },
    p.deliveredKg > 0 && { key: 'del', label: 'delivered', kg: p.deliveredKg },
    p.demoUsedKg > 0 && { key: 'demo', label: 'demo', kg: p.demoUsedKg },
  ].filter(Boolean);
  if (!p.totalUsedKg) return <span className="muted">—</span>;
  return (
    <div>
      <b>{formatWeight(p.totalUsedKg)}</b>
      <div className="inv-split">
        {parts.map((x) => <span key={x.key} className={`inv-split-${x.key}`}>{formatWeightShort(x.kg)} {x.label}</span>)}
      </div>
    </div>
  );
}

function NeededCell({ p }) {
  if (!p.futureOrderCount) return <span className="muted">—</span>;
  return (
    <div>
      <b className="inv-blue">{formatWeight(p.neededForFutureDeliveryKg)}</b>
      <small className="muted block">{p.futureOrderCount} {p.futureOrderCount === 1 ? 'order' : 'orders'}</small>
    </div>
  );
}

function BalanceCell({ p }) {
  const neg = p.projectedBalanceKg < 0;
  return (
    <div>
      <b className={neg ? 'neg' : 'pos'}>{neg ? '−' : '+'}{formatWeight(Math.abs(p.projectedBalanceKg))}</b>
      <small className="muted block">{neg ? 'Shortfall to restock' : 'Available surplus'}</small>
    </div>
  );
}

function DueCell({ p }) {
  if (!p.earliestDeliveryDate) return <span className="muted">—</span>;
  const d = p.earliestDeliveryOrder ? getDeliveryStatus(p.earliestDeliveryOrder) : null;
  return (
    <div>
      <b>{new Date(p.earliestDeliveryDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</b>
      {d && <span className={`badge b-${d.tone} inv-mini`}>{d.label}</span>}
    </div>
  );
}

function RowActions({ p, expanded, onToggle, onBuy, onAdjust }) {
  return (
    <div className="inv-actions">
      {p.deficitKg > 0 && (
        <Button variant="danger" onClick={onBuy} title={`Create a purchase order for ${formatWeight(p.deficitKg)} of ${p.name}`}>
          Buy {formatWeightShort(p.deficitKg)}
        </Button>
      )}
      <Button variant="ghost" onClick={onAdjust} title="Record demo usage or update physical stock">Demo / stock</Button>
      {p.futureOrderCount > 0 && (
        <Button variant="ghost" onClick={onToggle} aria-expanded={expanded}>
          Orders ({p.futureOrderCount})
          <span className={`chev ${expanded ? 'on' : ''}`}><Icon name="chevron" size={16} /></span>
        </Button>
      )}
    </div>
  );
}

function FutureOrders({ p }) {
  return (
    <div className="inv-orders">
      <div className="inv-orders-h">Open orders needing {p.name}</div>
      {p.futureOrdersList.map((o) => {
        const due = o.deliveryDate ? new Date(o.deliveryDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : 'No date';
        const packs = o.lines.map((l) => `${l.qty} × ${l.variant}`).join(', ');
        return (
          <div key={o.orderId} className="inv-order">
            <div className="inv-order-who">
              <b>{o.customer}</b>
              <small className="muted">#{String(o.orderId).slice(-6)}{o.source ? ` · ${o.source}` : ''}</small>
            </div>
            <div className="inv-order-packs muted">{packs}</div>
            <b className="inv-blue">{formatWeight(o.weightKg)}</b>
            <span className="inv-order-meta"><Badge>{o.status}</Badge><span className="muted">Due {due}</span></span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Inventory & fulfillment dashboard
 * 1. Physical stock on hand after Dispatched, Delivered & Demo deductions.
 * 2. Stock needed for open orders (Pending & Processing).
 * 3. Projected balance and the exact restock shortfall.
 */
function Overview({ rows, look, threshold, onOpenDemoModal }) {
  const navigate = useNavigate();
  const { data } = useApp();
  const products = look.products || data.products || [];
  const orders = data.orders || [];

  const [searchQuery, setSearchQuery] = useState('');
  const [expandedProduct, setExpandedProduct] = useState(null);
  const [tabFilter, setTabFilter] = useState('All');

  // Compute live fulfillment & stock analytics
  const analytics = useMemo(() => {
    const fulfilledOrders = orders.filter((o) => isDeductedStatus(o.status));
    const futureOrders = orders.filter((o) => {
      const s = String(o.status || '').toLowerCase().trim();
      return s === 'pending' || s === 'processing';
    });

    const productStats = products.map((p) => {
      const stockOnHand = Number(p.stock || 0);

      // Find future order demand for this product
      const matchingFutureOrders = [];
      let neededForFutureDeliveryKg = 0;
      const futureOrderIds = new Set();
      let earliestDeliveryDate = null;
      let earliestDeliveryOrder = null;

      for (const order of futureOrders) {
        const items = getOrderItems(order);
        let orderHasProduct = false;
        let orderProductWeight = 0;
        let lineItemDetails = [];

        for (const item of items) {
          const itemPid = item.productId || item.id;
          const matchesId = itemPid && String(itemPid) === String(p.id);
          const matchesName = item.productName && p.name && item.productName.trim().toLowerCase() === p.name.trim().toLowerCase();

          if (matchesId || matchesName) {
            orderHasProduct = true;
            const weight = extractItemWeightKg(item);
            neededForFutureDeliveryKg += weight;
            orderProductWeight += weight;
            lineItemDetails.push({
              variant: item.weightVariant || item.packSize || item.weight || (item.weightInKg ? `${item.weightInKg} kg` : 'Standard'),
              qty: item.quantity || item.qty || 1,
              weightKg: weight,
            });
          }
        }

        if (orderHasProduct) {
          futureOrderIds.add(order.id);
          matchingFutureOrders.push({
            orderId: order.id,
            source: order.source,
            customer: customerNameOf(order),
            phone: order.phone || '',
            deliveryDate: order.deliveryDate,
            status: order.status,
            weightKg: Math.round(orderProductWeight * 1000) / 1000,
            lines: lineItemDetails,
          });

          if (order.deliveryDate) {
            if (!earliestDeliveryDate || new Date(order.deliveryDate) < new Date(earliestDeliveryDate)) {
              earliestDeliveryDate = order.deliveryDate;
              earliestDeliveryOrder = order;
            }
          }
        }
      }

      neededForFutureDeliveryKg = Math.round(neededForFutureDeliveryKg * 1000) / 1000;
      const projectedBalanceKg = Math.round((stockOnHand - neededForFutureDeliveryKg) * 1000) / 1000;
      const deficitKg = projectedBalanceKg < 0 ? Math.abs(projectedBalanceKg) : 0;

      // Dispatched / Delivered fulfilled volume — split by status
      let dispatchedKg = 0;
      let deliveredKg = 0;
      for (const order of fulfilledOrders) {
        const items = getOrderItems(order);
        const statusLower = String(order.status || '').toLowerCase().trim();
        for (const item of items) {
          const itemPid = item.productId || item.id;
          const matchesId = itemPid && String(itemPid) === String(p.id);
          const matchesName = item.productName && p.name && item.productName.trim().toLowerCase() === p.name.trim().toLowerCase();
          if (matchesId || matchesName) {
            const wt = extractItemWeightKg(item);
            if (statusLower === 'dispatched') dispatchedKg += wt;
            else if (statusLower === 'delivered') deliveredKg += wt;
          }
        }
      }
      dispatchedKg = Math.round(dispatchedKg * 1000) / 1000;
      deliveredKg = Math.round(deliveredKg * 1000) / 1000;
      const fulfilledKg = Math.round((dispatchedKg + deliveredKg) * 1000) / 1000;

      // Demo usage recorded for this product from movement logs
      const demoUsedKg = Math.round(
        rows
          .filter((r) => r.type === 'Used in Demo' && (r.productId === p.id || r.productName === p.name))
          .reduce((sum, r) => sum + Number(r.quantity || 0), 0) * 1000
      ) / 1000;

      // Total Used = Dispatched + Delivered + Demo (only these 3 statuses count as used)
      const totalUsedKg = Math.round((dispatchedKg + deliveredKg + demoUsedKg) * 1000) / 1000;

      // Shortfall from used (dispatched+delivered) exceeding current stock
      const shortfallFromUsedKg = Math.max(0, totalUsedKg - stockOnHand);
      const hasShortage = deficitKg > 0 || shortfallFromUsedKg > 0;
      return {
        product: p,
        id: p.id,
        name: p.name,
        category: p.category,
        sku: p.sku,
        active: p.active !== false,
        stockOnHand,
        neededForFutureDeliveryKg,
        futureOrderCount: futureOrderIds.size,
        futureOrdersList: matchingFutureOrders,
        earliestDeliveryDate,
        earliestDeliveryOrder,
        projectedBalanceKg,
        deficitKg,
        dispatchedKg,
        deliveredKg,
        fulfilledKg,
        demoUsedKg,
        totalUsedKg,
        shortfallFromUsedKg,
        hasShortage,
        hasPendingOrders: neededForFutureDeliveryKg > 0,
        isCovered: projectedBalanceKg >= 0 && (neededForFutureDeliveryKg > 0 || stockOnHand > 0),
      };
    });

    // Priority sort: shortages first (highest deficit first), then pending demand, then alphabetical
    productStats.sort((a, b) => {
      if (a.hasShortage && !b.hasShortage) return -1;
      if (!a.hasShortage && b.hasShortage) return 1;
      if (b.deficitKg !== a.deficitKg) return b.deficitKg - a.deficitKg;
      if (b.neededForFutureDeliveryKg !== a.neededForFutureDeliveryKg) return b.neededForFutureDeliveryKg - a.neededForFutureDeliveryKg;
      return a.name.localeCompare(b.name);
    });

    const activeProducts = productStats.filter((p) => p.active);
    const totalStockOnHandKg = Math.round(activeProducts.reduce((s, p) => s + p.stockOnHand, 0) * 1000) / 1000;
    const totalNeededFutureKg = Math.round(productStats.reduce((s, p) => s + p.neededForFutureDeliveryKg, 0) * 1000) / 1000;
    const totalDeficitKg = Math.round(productStats.reduce((s, p) => s + p.deficitKg, 0) * 1000) / 1000;
    const totalFulfilledKg = Math.round(productStats.reduce((s, p) => s + p.fulfilledKg, 0) * 1000) / 1000;
    const totalDispatchedKg = Math.round(productStats.reduce((s, p) => s + p.dispatchedKg, 0) * 1000) / 1000;
    const totalDeliveredKg = Math.round(productStats.reduce((s, p) => s + p.deliveredKg, 0) * 1000) / 1000;
    const totalDemoUsedKg = Math.round(
      rows.filter((r) => r.type === 'Used in Demo').reduce((s, r) => s + Number(r.quantity || 0), 0) * 1000
    ) / 1000;
    // Total Used Products = Dispatched + Delivered + Demo ONLY (no other status counts as used)
    const totalUsedProductsKg = Math.round((totalDispatchedKg + totalDeliveredKg + totalDemoUsedKg) * 1000) / 1000;
    const shortageCount = productStats.filter((p) => p.hasShortage).length;

    return {
      productStats,
      totalStockOnHandKg,
      totalNeededFutureKg,
      totalDeficitKg,
      totalFulfilledKg,
      totalDispatchedKg,
      totalDeliveredKg,
      totalDemoUsedKg,
      totalUsedProductsKg,
      futureOrdersCount: futureOrders.length,
      fulfilledOrdersCount: fulfilledOrders.length,
      shortageCount,
    };
  }, [products, orders, rows]);

  const {
    productStats,
    totalStockOnHandKg,
    totalNeededFutureKg,
    totalDeficitKg,
    totalDispatchedKg,
    totalDeliveredKg,
    totalDemoUsedKg,
    totalUsedProductsKg,
    futureOrdersCount,
    shortageCount,
  } = analytics;

  const pendingCount = useMemo(() => productStats.filter((p) => p.hasPendingOrders).length, [productStats]);
  const coveredCount = useMemo(() => productStats.filter((p) => p.isCovered && !p.hasShortage).length, [productStats]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return productStats.filter((p) => {
      if (tabFilter === 'Shortage' && !p.hasShortage) return false;
      if (tabFilter === 'Pending' && !p.hasPendingOrders) return false;
      if (tabFilter === 'Covered' && (p.hasShortage || (!p.hasPendingOrders && p.stockOnHand <= 0))) return false;
      if (q && !`${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [productStats, tabFilter, searchQuery]);

  const lowStockProducts = products.filter((p) => p.active && p.stock <= threshold).sort((a, b) => a.stock - b.stock);

  const buy = (p) => navigate(`/purchases?productId=${p.id}&quantity=${p.deficitKg}&notes=${encodeURIComponent(`Restock for future delivery of ${p.name}`)}`);
  const toggle = (id) => setExpandedProduct((cur) => (cur === id ? null : id));

  const chips = [
    ['All', 'All products', productStats.length, ''],
    ['Shortage', 'Needs restock', shortageCount, shortageCount > 0 ? 'alert' : ''],
    ['Pending', 'Future orders', pendingCount, ''],
    ['Covered', 'Stock sufficient', coveredCount, ''],
  ];

  return (
    <div className="inv">
      {/* KPI strip */}
      <div className="kpis inv-kpis">
        <div className="card kpi stack">
          <span className="muted">Stock on hand</span>
          <b className={`kv ${totalStockOnHandKg < 0 ? 'neg' : ''}`}>{formatWeight(totalStockOnHandKg)}</b>
          <small className="muted">After dispatched, delivered &amp; demo</small>
        </div>

        <div className="card kpi stack">
          <span className="muted">Needed for delivery</span>
          <b className={`kv ${totalNeededFutureKg > 0 ? 'inv-blue' : ''}`}>{formatWeight(totalNeededFutureKg)}</b>
          <small className="muted">{futureOrdersCount} open {futureOrdersCount === 1 ? 'order' : 'orders'}</small>
        </div>

        <div className="card kpi stack">
          <span className="muted">Stock shortfall</span>
          {totalDeficitKg > 0 ? (
            <>
              <b className="kv neg">−{formatWeight(totalDeficitKg)}</b>
              <small className="neg">Restock {shortageCount} {shortageCount === 1 ? 'item' : 'items'}</small>
            </>
          ) : (
            <>
              <b className="kv pos">Covered</b>
              <small className="pos">+{formatWeight(Math.max(0, totalStockOnHandKg - totalNeededFutureKg))} surplus</small>
            </>
          )}
        </div>

        <div className="card kpi stack">
          <span className="muted">Total used</span>
          <b className="kv">{formatWeight(totalUsedProductsKg)}</b>
          <small className="muted">
            {formatWeightShort(totalDispatchedKg)} dispatched · {formatWeightShort(totalDeliveredKg)} delivered · {formatWeightShort(totalDemoUsedKg)} demo
          </small>
        </div>
      </div>

      {/* Shortfall alert */}
      {totalDeficitKg > 0 && (
        <div className="inv-alert" role="alert">
          <div className="inv-alert-text">
            <b>{formatWeight(totalDeficitKg)} short for open orders</b>
            <p>Customer orders need more stock than you have on hand. Restock to deliver on time.</p>
          </div>
          <Button
            variant="danger"
            icon="plus"
            onClick={() => {
              const first = productStats.find((p) => p.deficitKg > 0);
              if (first) buy(first); else navigate('/purchases');
            }}
          >
            Restock via purchase order
          </Button>
        </div>
      )}

      {/* Future delivery & stock requirements */}
      <section className="card inv-panel">
        <div className="inv-panel-h">
          <div>
            <h2>Future delivery &amp; stock requirements</h2>
            <p className="sub">Remaining warehouse stock compared with what open orders still need.</p>
          </div>
          <div className="inv-panel-actions">
            <Button variant="demo" icon="sliders" onClick={() => onOpenDemoModal?.(null)}>Record demo / adjust stock</Button>
            <Link className="link" to="/purchases">Plan purchase orders <Icon name="arrow" size={16} /></Link>
          </div>
        </div>

        <div className="inv-filterbar">
          <div className="inv-chips" role="tablist" aria-label="Filter products">
            {chips.map(([key, label, count, tone]) => (
              <button key={key} type="button" role="tab" aria-selected={tabFilter === key} className={`inv-chip ${tabFilter === key ? 'on' : ''} ${tone}`} onClick={() => setTabFilter(key)}>
                {label} <span>{count}</span>
              </button>
            ))}
          </div>
          <div className="inv-find">
            <label className="search">
              <Icon name="search" size={18} />
              <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search products…" aria-label="Search products in inventory" />
            </label>
            <span className="count-label">{filteredProducts.length} {filteredProducts.length === 1 ? 'item' : 'items'}</span>
          </div>
        </div>

        {filteredProducts.length === 0 && (
          <div className="inv-none">No products match this filter.</div>
        )}

        {/* Desktop / wide tablet: table */}
        {filteredProducts.length > 0 && (
          <div className="inv-table-card">
            <div className="inv-table-scroll">
              <table className="inv-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>On hand</th>
                    <th>Used</th>
                    <th>Needed</th>
                    <th>Net balance</th>
                    <th>Status</th>
                    <th>Due</th>
                    <th className="end">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((p) => {
                    const st = statusOf(p);
                    const open = expandedProduct === p.id;
                    return (
                      <FragmentRow key={p.id}>
                        <tr className={p.hasShortage ? 'is-short' : ''}>
                          <td><ProductCell p={p} /></td>
                          <td>
                            <b className={stockTone(p.stockOnHand)}>{formatWeight(p.stockOnHand)}</b>
                            <small className="muted block">In warehouse</small>
                          </td>
                          <td><UsedBreakdown p={p} /></td>
                          <td><NeededCell p={p} /></td>
                          <td><BalanceCell p={p} /></td>
                          <td><Badge tone={st.tone}>{st.label}</Badge></td>
                          <td><DueCell p={p} /></td>
                          <td className="end">
                            <RowActions p={p} expanded={open} onToggle={() => toggle(p.id)} onBuy={() => buy(p)} onAdjust={() => onOpenDemoModal?.(p.product)} />
                          </td>
                        </tr>
                        {open && (
                          <tr className="inv-expand">
                            <td colSpan={8}><FutureOrders p={p} /></td>
                          </tr>
                        )}
                      </FragmentRow>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Phones / small tablets: cards */}
        {filteredProducts.length > 0 && (
          <div className="inv-cards">
            {filteredProducts.map((p) => {
              const st = statusOf(p);
              const open = expandedProduct === p.id;
              return (
                <article key={p.id} className={`inv-card ${p.hasShortage ? 'is-short' : ''}`}>
                  <ProductCell p={p} />

                  <div className="inv-card-status">
                    <Badge tone={st.tone}>{st.label}</Badge>
                    {p.earliestDeliveryDate && <DueCell p={p} />}
                  </div>

                  <div className="inv-metrics">
                    <div className="inv-metric">
                      <span>On hand</span>
                      <b className={stockTone(p.stockOnHand)}>{formatWeight(p.stockOnHand)}</b>
                    </div>
                    <div className="inv-metric">
                      <span>Used</span>
                      <UsedBreakdown p={p} />
                    </div>
                    <div className="inv-metric">
                      <span>Needed</span>
                      <NeededCell p={p} />
                    </div>
                    <div className="inv-metric">
                      <span>Net balance</span>
                      <BalanceCell p={p} />
                    </div>
                  </div>

                  <RowActions p={p} expanded={open} onToggle={() => toggle(p.id)} onBuy={() => buy(p)} onAdjust={() => onOpenDemoModal?.(p.product)} />
                  {open && <FutureOrders p={p} />}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Replenishment health */}
      <section className="card inv-panel">
        <div className="inv-panel-h">
          <div>
            <h2>Replenishment health</h2>
            <p className="sub">Active products at or below the low-stock level of {threshold} kg.</p>
          </div>
          <Link className="link" to="/purchases">Plan purchase order <Icon name="arrow" size={16} /></Link>
        </div>
        {lowStockProducts.length ? (
          <div className="inv-health">
            {lowStockProducts.slice(0, 6).map((p) => (
              <div key={p.id} className="inv-health-row">
                <div className="cell inv-health-who">
                  <Tile>{initial(p.name)}</Tile>
                  <div><b>{p.name}</b><small className="muted">{p.category}</small></div>
                </div>
                <div className="bar"><i style={{ width: `${Math.max(0, Math.min(100, (p.stock / Math.max(threshold, 1)) * 100))}%`, background: p.stock < 0 ? '#dc2626' : undefined }} /></div>
                <span className={p.stock < 0 ? 'neg inv-health-qty' : 'low inv-health-qty'}>
                  {p.stock < 0 ? `${formatWeight(p.stock)} deficit` : `${formatWeight(p.stock)} left`}
                </span>
                <Badge>{stockLevel(p.stock, threshold)}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="sub">All active products are above the low-stock level.</p>
        )}
      </section>

      <div className="inv-log-h">
        <h2>Stock movements</h2>
        <p className="sub">Every stock in, stock out, demo and adjustment, newest first.</p>
      </div>
    </div>
  );
}

// Lets a table row and its expanded detail row share one key.
function FragmentRow({ children }) {
  return <>{children}</>;
}

export default function Inventory() {
  const { data, toast } = useApp();
  const products = data.products || [];
  const [demoModal, setDemoModal] = useState(null); // null | { product: null | object }

  return (
    <>
      <ResourcePage
        resource="inventory"
        eyebrow="WORKSPACE / INVENTORY"
        title="Inventory"
        subtitle="Stock balances, demo usage, future delivery demand and every stock movement."
        addLabel="Add movement"
        noun="stock record"
        countNoun="movements"
        columns={columns}
        fields={fields}
        lookups={['products', 'orders']}
        searchKeys={['productName', 'sku', 'note']}
        placeholder="Search stock movements…"
        customAction={(ctx) => (
          <div className="btn-group">
            <Button variant="demo" icon="sliders" onClick={() => setDemoModal({ product: null })}>Record demo / update stock</Button>
            <Button variant="primary" icon="plus" onClick={() => ctx.createWith({})}>Add movement</Button>
          </div>
        )}
        above={(p) => <Overview {...p} onOpenDemoModal={(prod) => setDemoModal({ product: prod })} />}
        filters={[
          {
            key: 'type',
            label: 'All movements',
            options: ['Stock in', 'Stock out', 'Used in Demo', 'Adjustment'].map((v) => ({ value: v, label: v })),
            test: (r, v) => r.type === v,
          },
        ]}
      />

      {demoModal && (
        <StockAdjustmentModal
          product={demoModal.product}
          products={products}
          onClose={() => setDemoModal(null)}
          onSaved={(msg) => toast(msg)}
        />
      )}
    </>
  );
}
