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

const signed = (r) => (r.type === 'Stock out' || r.type === 'Used in Demo' ? -Number(r.quantity || 0) : Number(r.quantity || 0));

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
 * Enterprise Stock & Demo Adjustment Modal
 * Gives the user 2 straightforward ways to record demo usage and update current inventory:
 * 1. "Used in Demo / Tasting": Enter exact packets or kg used for customer sampling -> deducts from stock.
 * 2. "Set Exact Current Stock": Enter actual current stock counted in warehouse -> calculates difference & updates balance.
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

  return (
    <Modal title="Record Demo Usage & Update Stock" onClose={onClose} width={580}>
      <div style={{ marginBottom: '16px' }}>
        {/* Product selector */}
        <div className="field" style={{ marginBottom: '14px' }}>
          <label style={{ fontWeight: 600 }}>Select Product <span className="req">*</span></label>
          <select
            value={selectedPid}
            onChange={(e) => {
              setSelectedPid(e.target.value);
              const found = products.find((p) => p.id === e.target.value);
              if (found) setExactCurrentStock(Number(found.stock || 0));
            }}
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (Current: {formatWeight(p.stock)})
              </option>
            ))}
          </select>
        </div>

        {/* Tab selection */}
        <div className="tabs" style={{ marginBottom: '16px' }}>
          <button
            type="button"
            className={`tab ${activeTab === 'demo' ? 'on' : ''}`}
            onClick={() => setActiveTab('demo')}
          >
            🍪 Used in Demo / Tasting
          </button>
          <button
            type="button"
            className={`tab ${activeTab === 'current' ? 'on' : ''}`}
            onClick={() => {
              setActiveTab('current');
              setExactCurrentStock(currentStockKg);
            }}
          >
            ⚖️ Set Exact Current Stock
          </button>
        </div>

        {error && <div className="form-error mb">{error}</div>}

        {/* TAB 1: Used in Demo / Customer Tasting */}
        {activeTab === 'demo' && (
          <form onSubmit={handleSaveDemo}>
            <p className="sub" style={{ fontSize: '13px', margin: '0 0 14px' }}>
              Deduct stock used for customer tasting samples, showroom demos, or promotional testing.
            </p>

            {/* Quick pack size picker */}
            <div className="field" style={{ marginBottom: '14px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600 }}>Pack Size Used</label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
                {['100 gm', '200 gm', '250 gm', '500 gm', '1 kg', 'Custom'].map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={`tab ${demoPackVariant === v ? 'on' : ''}`}
                    onClick={() => setDemoPackVariant(v)}
                    style={{ padding: '4px 10px', fontSize: '12px' }}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {demoPackVariant === 'Custom' ? (
              <div className="field" style={{ marginBottom: '14px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>Demo Weight (in Kg) <span className="req">*</span></label>
                <input
                  type="number"
                  step="0.05"
                  min="0.01"
                  placeholder="e.g. 0.75"
                  value={demoCustomKg}
                  onChange={(e) => setDemoCustomKg(e.target.value)}
                  required
                />
              </div>
            ) : (
              <div className="field" style={{ marginBottom: '14px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>Number of Packs Used</label>
                <div className="qty-stepper" style={{ maxWidth: '160px' }}>
                  <button
                    type="button"
                    className="qty-step-btn"
                    onClick={() => setDemoPacksCount((c) => Math.max(1, c - 1))}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min="1"
                    value={demoPacksCount}
                    onChange={(e) => setDemoPacksCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  />
                  <button
                    type="button"
                    className="qty-step-btn"
                    onClick={() => setDemoPacksCount((c) => c + 1)}
                  >
                    +
                  </button>
                </div>
              </div>
            )}

            {/* Reference note */}
            <div className="field" style={{ marginBottom: '14px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600 }}>Customer / Event Reference Note</label>
              <input
                type="text"
                value={demoNote}
                onChange={(e) => setDemoNote(e.target.value)}
                placeholder="e.g. Customer tasting demo for Ramesh, exhibition samples…"
              />
            </div>

            {/* Live calculation banner */}
            <div
              style={{
                background: '#faf5ff',
                border: '1px solid #e9d5ff',
                borderRadius: '8px',
                padding: '12px 16px',
                marginBottom: '16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '13px',
              }}
            >
              <div>
                <span className="muted" style={{ display: 'block', fontSize: '11px' }}>Current Stock</span>
                <b>{formatWeight(currentStockKg)}</b>
              </div>
              <div style={{ color: '#7e22ce', fontWeight: 700, fontSize: '14px' }}>
                − {formatWeight(demoWeightKg)} (Demo)
              </div>
              <div style={{ textAlign: 'right' }}>
                <span className="muted" style={{ display: 'block', fontSize: '11px' }}>New Warehouse Stock</span>
                <b style={{ color: currentStockKg - demoWeightKg < 0 ? '#dc2626' : '#15803d', fontSize: '15px' }}>
                  {formatWeight(Math.round((currentStockKg - demoWeightKg) * 1000) / 1000)}
                </b>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <Button type="button" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button
                type="submit"
                variant="primary"
                disabled={saving || demoWeightKg <= 0}
                style={{ background: '#7e22ce', borderColor: '#7e22ce', color: '#fff' }}
              >
                {saving ? 'Deducting…' : `Deduct ${formatWeight(demoWeightKg)} Demo Stock`}
              </Button>
            </div>
          </form>
        )}

        {/* TAB 2: Set Exact Current Stock */}
        {activeTab === 'current' && (
          <form onSubmit={handleSaveExactStock}>
            <p className="sub" style={{ fontSize: '13px', margin: '0 0 14px' }}>
              Directly enter the physical stock counted in your warehouse. The difference will be automatically calculated and logged.
            </p>

            <div className="form-grid mb">
              <div className="field">
                <label style={{ fontSize: '12px', fontWeight: 600 }}>Current System Stock</label>
                <div style={{ fontSize: '15px', fontWeight: 700, padding: '8px 0' }}>
                  {formatWeight(currentStockKg)}
                </div>
              </div>

              <div className="field">
                <label style={{ fontSize: '12px', fontWeight: 600 }}>Actual Current Stock Now (in Kg) <span className="req">*</span></label>
                <input
                  type="number"
                  step="0.05"
                  value={exactCurrentStock}
                  onChange={(e) => setExactCurrentStock(e.target.value)}
                  placeholder="Enter counted stock in Kg"
                  required
                />
              </div>
            </div>

            <div className="field" style={{ marginBottom: '14px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600 }}>Reason for Stock Difference</label>
              <select
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
              >
                <option value="Used in Demo / Customer Tasting">🍪 Used in Demo / Customer Tasting</option>
                <option value="Physical Stock Audit Reconciliation">📋 Physical Stock Audit Count</option>
                <option value="Damage / Spillage / Expired">⚠️ Damage / Spillage / Waste</option>
                <option value="Surplus Found / Recount">✓ Surplus Found in Warehouse</option>
                <option value="Other Adjustment">Other Adjustment</option>
              </select>
            </div>

            <div className="field" style={{ marginBottom: '14px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600 }}>Audit Reference Note</label>
              <input
                type="text"
                value={adjustNote}
                onChange={(e) => setAdjustNote(e.target.value)}
                placeholder="e.g. Reconciliation after tasting samples at trade show…"
              />
            </div>

            {/* Calculated difference preview */}
            {(() => {
              const diff = Math.round((Number(exactCurrentStock) - currentStockKg) * 1000) / 1000;
              return (
                <div
                  style={{
                    background: diff < 0 ? '#fef2f2' : diff > 0 ? '#f0fdf4' : '#f8fafc',
                    border: `1px solid ${diff < 0 ? '#fecaca' : diff > 0 ? '#bbf7d0' : '#e2e8f0'}`,
                    borderRadius: '8px',
                    padding: '12px 16px',
                    marginBottom: '16px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '13px',
                  }}
                >
                  <div>
                    <span className="muted" style={{ display: 'block', fontSize: '11px' }}>Adjustment</span>
                    <b style={{ color: diff < 0 ? '#dc2626' : diff > 0 ? '#15803d' : '#64748b' }}>
                      {diff > 0 ? `+${formatWeight(diff)}` : diff < 0 ? `-${formatWeight(Math.abs(diff))}` : '0 kg change'}
                    </b>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span className="muted" style={{ display: 'block', fontSize: '11px' }}>New Warehouse Stock</span>
                    <b style={{ fontSize: '15px' }}>{formatWeight(Number(exactCurrentStock) || 0)}</b>
                  </div>
                </div>
              );
            })()}

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <Button type="button" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button
                type="submit"
                variant="primary"
                disabled={saving || Number(exactCurrentStock) === currentStockKg}
              >
                {saving ? 'Updating…' : `Update Stock to ${formatWeight(Number(exactCurrentStock) || 0)}`}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}

/**
 * Enterprise Inventory & Fulfillment Dashboard
 * Calculates:
 * 1. Physical Stock on Hand remaining after Dispatched, Delivered & Demo deductions.
 * 2. Required stock needed for future deliveries of open orders received (Pending & Processing).
 * 3. Net projected balance & exact restock shortfall needed to fulfill incoming customer orders.
 */
function Overview({ rows, look, threshold, onOpenDemoModal }) {
  const navigate = useNavigate();
  const { data } = useApp();
  const products = look.products || data.products || [];
  const orders = data.orders || [];

  const [tabFilter, setTabFilter] = useState('All'); // 'All' | 'Shortage' | 'Pending' | 'Covered'
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedProduct, setExpandedProduct] = useState(null);

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

      // Dispatched / Delivered fulfilled volume
      let fulfilledKg = 0;
      for (const order of fulfilledOrders) {
        const items = getOrderItems(order);
        for (const item of items) {
          const itemPid = item.productId || item.id;
          const matchesId = itemPid && String(itemPid) === String(p.id);
          const matchesName = item.productName && p.name && item.productName.trim().toLowerCase() === p.name.trim().toLowerCase();
          if (matchesId || matchesName) {
            fulfilledKg += extractItemWeightKg(item);
          }
        }
      }
      fulfilledKg = Math.round(fulfilledKg * 1000) / 1000;

      // Demo usage recorded for this product from movement logs
      const demoUsedKg = Math.round(
        rows
          .filter((r) => r.type === 'Used in Demo' && (r.productId === p.id || r.productName === p.name))
          .reduce((sum, r) => sum + Number(r.quantity || 0), 0) * 1000
      ) / 1000;

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
        fulfilledKg,
        demoUsedKg,
        hasShortage: deficitKg > 0,
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
    const totalDemoUsedKg = Math.round(
      rows.filter((r) => r.type === 'Used in Demo').reduce((s, r) => s + Number(r.quantity || 0), 0) * 1000
    ) / 1000;
    const shortageCount = productStats.filter((p) => p.hasShortage).length;

    return {
      productStats,
      totalStockOnHandKg,
      totalNeededFutureKg,
      totalDeficitKg,
      totalFulfilledKg,
      totalDemoUsedKg,
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
    totalFulfilledKg,
    totalDemoUsedKg,
    futureOrdersCount,
    fulfilledOrdersCount,
    shortageCount,
  } = analytics;

  // Filtered rows for the Future Delivery & Stock Balance Table
  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return productStats.filter((p) => {
      if (tabFilter === 'Shortage' && !p.hasShortage) return false;
      if (tabFilter === 'Pending' && !p.hasPendingOrders) return false;
      if (tabFilter === 'Covered' && (p.hasShortage || (!p.hasPendingOrders && p.stockOnHand <= 0))) return false;
      if (q) {
        const hay = `${p.name} ${p.sku} ${p.category}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [productStats, tabFilter, searchQuery]);

  // Low stock products for replenishment health progress bars
  const lowStockProducts = products.filter((p) => p.active && p.stock <= threshold).sort((a, b) => a.stock - b.stock);

  return (
    <>
      {/* Top 4 KPI Metrics */}
      <div className="kpis">
        <div className="card kpi stack">
          <span className="muted">Stock on Hand (Warehouse)</span>
          <b className="kv" style={{ color: totalStockOnHandKg < 0 ? '#dc2626' : 'var(--text)' }}>
            {formatWeight(totalStockOnHandKg)}
          </b>
          <small className="muted">Remaining from Dispatched, Delivered & Demo</small>
        </div>

        <div className="card kpi stack">
          <span className="muted">Needed for Future Delivery</span>
          <b className="kv" style={{ color: totalNeededFutureKg > 0 ? '#2563eb' : 'var(--text)' }}>
            {formatWeight(totalNeededFutureKg)}
          </b>
          <small className="muted">{futureOrdersCount} received orders awaiting fulfillment</small>
        </div>

        <div className="card kpi stack">
          <span className="muted">Stock Shortfall for Orders</span>
          {totalDeficitKg > 0 ? (
            <>
              <b className="kv neg">
                -{formatWeight(totalDeficitKg)}
              </b>
              <small className="neg" style={{ fontWeight: 600 }}>
                ⚠️ Needs restock for {shortageCount} {shortageCount === 1 ? 'item' : 'items'}
              </small>
            </>
          ) : (
            <>
              <b className="kv pos">
                ✓ Fully Covered
              </b>
              <small className="pos">
                +{formatWeight(Math.max(0, totalStockOnHandKg - totalNeededFutureKg))} surplus available
              </small>
            </>
          )}
        </div>

        <div className="card kpi stack">
          <span className="muted">Dispatched & Demo Deducted</span>
          <b className="kv" style={{ color: '#059669' }}>
            {formatWeight(totalFulfilledKg)}
          </b>
          <small className="muted">
            {fulfilledOrdersCount} orders fulfilled
            {totalDemoUsedKg > 0 && ` · ${formatWeight(totalDemoUsedKg)} demo`}
          </small>
        </div>
      </div>

      {/* Stock Deficit Action Alert (Visible when future delivery orders exceed current warehouse stock) */}
      {totalDeficitKg > 0 && (
        <div
          className="card pad mb"
          style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '12px',
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '24px' }}>⚠️</span>
            <div>
              <b style={{ color: '#991b1b', fontSize: '15px' }}>
                Stock Shortfall Alert: {formatWeight(totalDeficitKg)} needed for future deliveries
              </b>
              <p style={{ margin: '2px 0 0', color: '#b91c1c', fontSize: '13px' }}>
                You have received customer orders requiring more inventory than currently available on hand. Restock to ensure on-time delivery.
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button
              variant="primary"
              icon="plus"
              onClick={() => {
                const firstShort = productStats.find((p) => p.hasShortage);
                if (firstShort) {
                  navigate(`/purchases?productId=${firstShort.id}&quantity=${firstShort.deficitKg}&notes=Restock for Order Deliveries`);
                } else {
                  navigate('/purchases');
                }
              }}
              style={{ background: '#dc2626', borderColor: '#dc2626', color: '#fff' }}
            >
              Restock via Purchase Order
            </Button>
          </div>
        </div>
      )}

      {/* Future Delivery & Inventory Requirements Table Dashboard */}
      <section className="card pad mb" style={{ padding: '24px' }}>
        <div className="card-h flat" style={{ flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
          <div>
            <h2 style={{ fontSize: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>📦</span> Future Delivery & Stock Requirements
            </h2>
            <p className="sub" style={{ margin: '4px 0 0', fontSize: '13px' }}>
              Compares remaining warehouse stock with future delivery demands from received orders. Shows exact stock needed to fulfill deliveries.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <Button
              variant="ghost"
              icon="sliders"
              onClick={() => onOpenDemoModal?.(null)}
              style={{ fontSize: '13px', color: '#7e22ce', borderColor: '#d8b4fe' }}
            >
              Record Demo / Adjust Stock
            </Button>
            <Link className="link" to="/purchases" style={{ fontSize: '14px', fontWeight: 600 }}>
              Plan purchase orders <Icon name="arrow" size={16} />
            </Link>
          </div>
        </div>

        {/* Dashboard Filter Bar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
          <div className="tabs" style={{ margin: 0 }}>
            <button
              type="button"
              className={`tab ${tabFilter === 'All' ? 'on' : ''}`}
              onClick={() => setTabFilter('All')}
            >
              All Products <span>{productStats.length}</span>
            </button>
            <button
              type="button"
              className={`tab ${tabFilter === 'Shortage' ? 'on' : ''}`}
              onClick={() => setTabFilter('Shortage')}
              style={shortageCount > 0 ? { color: tabFilter === 'Shortage' ? '#fff' : '#dc2626' } : undefined}
            >
              ⚠️ Needs Restock <span>{shortageCount}</span>
            </button>
            <button
              type="button"
              className={`tab ${tabFilter === 'Pending' ? 'on' : ''}`}
              onClick={() => setTabFilter('Pending')}
            >
              📦 Future Orders <span>{productStats.filter((p) => p.hasPendingOrders).length}</span>
            </button>
            <button
              type="button"
              className={`tab ${tabFilter === 'Covered' ? 'on' : ''}`}
              onClick={() => setTabFilter('Covered')}
            >
              ✓ Stock Sufficient <span>{productStats.filter((p) => p.isCovered && !p.hasShortage).length}</span>
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <label className="search" style={{ minWidth: '220px', margin: 0 }}>
              <Icon name="search" size={18} />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search products in inventory…"
                style={{ fontSize: '13px' }}
              />
            </label>
            <span className="count-label" style={{ margin: 0 }}>
              {filteredProducts.length} {filteredProducts.length === 1 ? 'item' : 'items'}
            </span>
          </div>
        </div>

        {/* Table View */}
        <div className="tw" style={{ border: '1px solid var(--line)', borderRadius: '10px', overflow: 'hidden' }}>
          <table>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={{ width: '250px' }}>Product</th>
                <th>Stock on Hand (Remaining)</th>
                <th>Needed for Future Delivery</th>
                <th>Projected Net Balance</th>
                <th>Fulfillment Status</th>
                <th>Earliest Due Date</th>
                <th className="end" style={{ width: '220px' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '32px', color: '#64748b' }}>
                    No products match the selected filter.
                  </td>
                </tr>
              ) : (
                filteredProducts.map((p) => {
                  const isExpanded = expandedProduct === p.id;
                  const dStatus = p.earliestDeliveryOrder ? getDeliveryStatus(p.earliestDeliveryOrder) : null;

                  return (
                    <tr
                      key={p.id}
                      style={{
                        background: p.hasShortage ? '#fffdfd' : undefined,
                      }}
                    >
                      {/* 1. Product Name & Category */}
                      <td>
                        <div className="cell">
                          <Tile>{initial(p.name)}</Tile>
                          <div>
                            <b>{p.name}</b>
                            <small className="muted block">
                              {p.sku} · {p.category}
                              {p.demoUsedKg > 0 && <span style={{ color: '#7e22ce', marginLeft: '6px' }}>({formatWeight(p.demoUsedKg)} demo)</span>}
                            </small>
                          </div>
                        </div>
                      </td>

                      {/* 2. Stock on Hand (Remaining from dispatched & delivered & demo) */}
                      <td>
                        <div>
                          <b
                            style={{
                              fontSize: '14px',
                              color: p.stockOnHand < 0 ? '#dc2626' : p.stockOnHand === 0 ? '#d97706' : 'var(--text)',
                            }}
                          >
                            {formatWeight(p.stockOnHand)}
                          </b>
                          <small className="muted block" style={{ fontSize: '11px', marginTop: '2px' }}>
                            Physical in warehouse
                          </small>
                        </div>
                      </td>

                      {/* 3. Needed for Future Delivery */}
                      <td>
                        {p.futureOrderCount > 0 ? (
                          <div>
                            <b style={{ color: '#2563eb', fontSize: '14px' }}>
                              {formatWeight(p.neededForFutureDeliveryKg)}
                            </b>
                            <small
                              className="badge b-blue"
                              style={{
                                display: 'inline-block',
                                fontSize: '11px',
                                padding: '1px 6px',
                                marginLeft: '6px',
                              }}
                            >
                              {p.futureOrderCount} {p.futureOrderCount === 1 ? 'order' : 'orders'}
                            </small>
                          </div>
                        ) : (
                          <span className="muted" style={{ fontSize: '13px' }}>—</span>
                        )}
                      </td>

                      {/* 4. Projected Net Balance */}
                      <td>
                        {p.projectedBalanceKg < 0 ? (
                          <b className="neg" style={{ fontSize: '14px' }}>
                            -{formatWeight(Math.abs(p.projectedBalanceKg))}
                          </b>
                        ) : (
                          <b className="pos" style={{ fontSize: '14px' }}>
                            +{formatWeight(p.projectedBalanceKg)}
                          </b>
                        )}
                        <small className="muted block" style={{ fontSize: '11px', marginTop: '2px' }}>
                          {p.projectedBalanceKg < 0 ? 'Shortfall to restock' : 'Available surplus'}
                        </small>
                      </td>

                      {/* 5. Fulfillment Status */}
                      <td>
                        {p.hasShortage ? (
                          <span
                            className="badge b-red"
                            style={{
                              fontSize: '12px',
                              padding: '4px 8px',
                              fontWeight: 700,
                            }}
                          >
                            ⚠️ Shortage: Need {formatWeight(p.deficitKg)}
                          </span>
                        ) : p.hasPendingOrders ? (
                          <span
                            className="badge b-green"
                            style={{
                              fontSize: '12px',
                              padding: '4px 8px',
                            }}
                          >
                            ✓ Ready to Deliver
                          </span>
                        ) : p.stockOnHand <= 0 ? (
                          <span
                            className="badge b-gray"
                            style={{
                              fontSize: '12px',
                              padding: '4px 8px',
                            }}
                          >
                            0 Stock (No orders)
                          </span>
                        ) : (
                          <span
                            className="badge b-gray"
                            style={{
                              fontSize: '12px',
                              padding: '4px 8px',
                            }}
                          >
                            Sufficient
                          </span>
                        )}
                      </td>

                      {/* 6. Earliest Due Date */}
                      <td>
                        {p.earliestDeliveryDate ? (
                          <div>
                            <b>
                              {new Date(p.earliestDeliveryDate).toLocaleDateString('en-IN', {
                                day: '2-digit',
                                month: 'short',
                              })}
                            </b>
                            {dStatus && (
                              <span
                                className={`badge b-${dStatus.tone}`}
                                style={{
                                  display: 'block',
                                  width: 'fit-content',
                                  fontSize: '11px',
                                  padding: '1px 6px',
                                  marginTop: '2px',
                                }}
                              >
                                {dStatus.label}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="muted" style={{ fontSize: '13px' }}>—</span>
                        )}
                      </td>

                      {/* 7. Action */}
                      <td className="end">
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap' }}>
                          {p.hasShortage && (
                            <Button
                              variant="primary"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/purchases?productId=${p.id}&quantity=${p.deficitKg}&notes=Restock for future delivery of ${p.name}`);
                              }}
                              style={{
                                fontSize: '11px',
                                padding: '3px 8px',
                                background: '#dc2626',
                                borderColor: '#dc2626',
                                color: '#fff',
                              }}
                              title={`Create Purchase Order to buy ${formatWeight(p.deficitKg)} of ${p.name}`}
                            >
                              + Buy {formatWeightShort(p.deficitKg)}
                            </Button>
                          )}

                          <Button
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenDemoModal?.(p.product);
                            }}
                            style={{ fontSize: '11px', padding: '3px 7px', color: '#7e22ce' }}
                            title="Record demo usage or update physical stock"
                          >
                            Demo / Stock
                          </Button>

                          {p.futureOrderCount > 0 && (
                            <Button
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedProduct(isExpanded ? null : p.id);
                              }}
                              style={{ fontSize: '11px', padding: '3px 6px' }}
                            >
                              {isExpanded ? '▲' : `(${p.futureOrderCount}) ▼`}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Low Stock Replenishment Health Section */}
      <section className="card pad mb">
        <div className="card-h flat">
          <div>
            <h2>Replenishment Health</h2>
            <p className="sub">Active snack items at or below low-stock threshold ({threshold} kg)</p>
          </div>
          <Link className="link" to="/purchases">Plan purchase order <Icon name="arrow" size={16} /></Link>
        </div>
        {lowStockProducts.length ? (
          <div className="health">
            {lowStockProducts.slice(0, 6).map((p) => (
              <div key={p.id} className="health-row">
                <Tile>{initial(p.name)}</Tile>
                <div className="grow">
                  <b>{p.name}</b>
                  <small className="muted">{p.category}</small>
                </div>
                <div className="bar">
                  <i style={{ width: `${Math.max(0, Math.min(100, (p.stock / 50) * 100))}%`, background: p.stock < 0 ? '#dc2626' : undefined }} />
                </div>
                <span className={p.stock < 0 ? 'neg' : 'low'}>
                  {p.stock < 0 ? `${formatWeight(p.stock)} (Deficit)` : `${formatWeight(p.stock)} left`}
                </span>
                <Badge>{stockLevel(p.stock, threshold)}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="sub">All active products are above the low-stock threshold.</p>
        )}
      </section>
    </>
  );
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
        subtitle="Detailed stock balances, demo usage tracking, future delivery demands, and transactional movements."
        addLabel="Add movement"
        noun="stock record"
        countNoun="movements"
        immutable
        columns={columns}
        fields={fields}
        lookups={['products', 'orders']}
        searchKeys={['productName', 'sku', 'note']}
        placeholder="Search stock movements…"
        customAction={(ctx) => (
          <div className="btn-group" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Button
              variant="primary"
              icon="sliders"
              onClick={() => setDemoModal({ product: null })}
              style={{ background: '#7e22ce', borderColor: '#7e22ce', color: '#fff' }}
            >
              Record Demo / Update Stock
            </Button>
            <Button
              variant="ghost"
              icon="plus"
              onClick={() => ctx.openCreate()}
            >
              Add Movement
            </Button>
          </div>
        )}
        above={(p) => (
          <Overview
            {...p}
            onOpenDemoModal={(prod) => setDemoModal({ product: prod })}
          />
        )}
        filters={[
          {
            key: 'type',
            label: 'All movements',
            options: ['Stock in', 'Stock out', 'Used in Demo', 'Adjustment'].map((v) => ({ value: v, label: v })),
            test: (r, v) => r.type === v,
          },
        ]}
      />

      {/* Interactive Stock & Demo Adjustment Modal */}
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
