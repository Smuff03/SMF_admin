import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../context.jsx';
import { Badge, Button, PageHeader, Tile } from '../components/ui.jsx';
import Icon from '../components/Icon.jsx';
import {
  CATEGORIES,
  formatWeight,
  formatWeightShort,
  initial,
  inr,
  extractItemWeightKg,
  getOrderItems,
  downloadCsv,
} from '../utils.js';

/**
 * Product Analytics Page
 * Shows per-product breakdown of:
 *  - Sold (Dispatched + Delivered orders)
 *  - Ordered (Pending + Processing orders)
 *  - Used for Demo (inventory movements of type 'Used in Demo')
 *  - Purchased (purchase orders with status 'Received')
 *
 * Only Dispatched, Delivered, and Demo are considered as "used".
 * Pending and Processing are "open / committed" orders, not used.
 */
export default function ProductAnalytics() {
  const navigate = useNavigate();
  const { data } = useApp();
  const products = data.products || [];
  const orders = data.orders || [];
  const purchases = data.purchases || [];
  const inventory = data.inventory || [];

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [sortBy, setSortBy] = useState('totalSold'); // totalSold | totalOrdered | totalDemo | totalPurchased | name
  const [sortDir, setSortDir] = useState('desc'); // desc | asc

  const analytics = useMemo(() => {
    const stats = products.map((p) => {
      let dispatchedKg = 0;
      let deliveredKg = 0;
      let dispatchedCount = 0;
      let deliveredCount = 0;
      let pendingKg = 0;
      let processingKg = 0;
      let pendingCount = 0;
      let processingCount = 0;
      let dispatchedRevenue = 0;
      let deliveredRevenue = 0;
      let pendingRevenue = 0;
      let processingRevenue = 0;

      for (const order of orders) {
        const status = String(order.status || '').toLowerCase().trim();
        const items = getOrderItems(order);

        for (const item of items) {
          const itemPid = item.productId || item.id;
          const matchesId = itemPid && String(itemPid) === String(p.id);
          const matchesName =
            item.productName &&
            p.name &&
            item.productName.trim().toLowerCase() === p.name.trim().toLowerCase();

          if (matchesId || matchesName) {
            const wt = extractItemWeightKg(item);
            const price = Number(item.price || item.totalPrice || 0);

            if (status === 'dispatched') {
              dispatchedKg += wt;
              dispatchedCount++;
              dispatchedRevenue += price;
            } else if (status === 'delivered') {
              deliveredKg += wt;
              deliveredCount++;
              deliveredRevenue += price;
            } else if (status === 'pending') {
              pendingKg += wt;
              pendingCount++;
              pendingRevenue += price;
            } else if (status === 'processing') {
              processingKg += wt;
              processingCount++;
              processingRevenue += price;
            }
          }
        }
      }

      // Demo usage from inventory movements
      let demoUsedKg = 0;
      let demoCount = 0;
      for (const inv of inventory) {
        if (
          inv.type === 'Used in Demo' &&
          (inv.productId === p.id || inv.productName === p.name)
        ) {
          demoUsedKg += Number(inv.quantity || 0);
          demoCount++;
        }
      }

      // Purchases (Received status only)
      let purchasedKg = 0;
      let purchasedCount = 0;
      let purchasedCost = 0;
      for (const po of purchases) {
        const poStatus = String(po.status || '').toLowerCase().trim();
        const matchesId = po.productId && String(po.productId) === String(p.id);
        const matchesName =
          po.productName &&
          p.name &&
          po.productName.trim().toLowerCase() === p.name.trim().toLowerCase();

        if (matchesId || matchesName) {
          if (poStatus === 'received') {
            purchasedKg += Number(po.quantity || 0);
            purchasedCount++;
            purchasedCost += Number(po.amount || 0);
          }
        }
      }

      const round3 = (n) => Math.round(n * 1000) / 1000;

      const totalSoldKg = round3(dispatchedKg + deliveredKg);
      const totalOrderedKg = round3(pendingKg + processingKg);
      const totalSoldRevenue = Math.round(dispatchedRevenue + deliveredRevenue);
      const totalOrderedRevenue = Math.round(pendingRevenue + processingRevenue);

      return {
        product: p,
        id: p.id,
        name: p.name,
        category: p.category || 'Uncategorized',
        sku: p.sku || '',
        active: p.active !== false,
        currentStock: Number(p.stock || 0),

        // Sold (Dispatched + Delivered)
        dispatchedKg: round3(dispatchedKg),
        deliveredKg: round3(deliveredKg),
        dispatchedCount,
        deliveredCount,
        dispatchedRevenue: Math.round(dispatchedRevenue),
        deliveredRevenue: Math.round(deliveredRevenue),
        totalSoldKg,
        totalSoldCount: dispatchedCount + deliveredCount,
        totalSoldRevenue,

        // Ordered (Pending + Processing)
        pendingKg: round3(pendingKg),
        processingKg: round3(processingKg),
        pendingCount,
        processingCount,
        pendingRevenue: Math.round(pendingRevenue),
        processingRevenue: Math.round(processingRevenue),
        totalOrderedKg,
        totalOrderedCount: pendingCount + processingCount,
        totalOrderedRevenue,

        // Demo
        demoUsedKg: round3(demoUsedKg),
        demoCount,

        // Total Used = Sold + Demo (only Dispatched, Delivered, Demo)
        totalUsedKg: round3(totalSoldKg + demoUsedKg),

        // Purchased
        purchasedKg: round3(purchasedKg),
        purchasedCount,
        purchasedCost: Math.round(purchasedCost),
      };
    });

    // Grand totals
    const totals = stats.reduce(
      (acc, s) => {
        acc.totalSoldKg += s.totalSoldKg;
        acc.totalOrderedKg += s.totalOrderedKg;
        acc.totalDemoKg += s.demoUsedKg;
        acc.totalPurchasedKg += s.purchasedKg;
        acc.totalUsedKg += s.totalUsedKg;
        acc.totalSoldRevenue += s.totalSoldRevenue;
        acc.totalOrderedRevenue += s.totalOrderedRevenue;
        acc.totalPurchasedCost += s.purchasedCost;
        acc.totalCurrentStock += s.currentStock;
        return acc;
      },
      {
        totalSoldKg: 0,
        totalOrderedKg: 0,
        totalDemoKg: 0,
        totalPurchasedKg: 0,
        totalUsedKg: 0,
        totalSoldRevenue: 0,
        totalOrderedRevenue: 0,
        totalPurchasedCost: 0,
        totalCurrentStock: 0,
      }
    );

    return { stats, totals };
  }, [products, orders, purchases, inventory]);

  // Categories present in products
  const availableCategories = useMemo(() => {
    const cats = new Set(products.map((p) => p.category || 'Uncategorized'));
    return ['All', ...Array.from(cats).sort()];
  }, [products]);

  // Apply filters + sorting
  const filteredStats = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let rows = analytics.stats.filter((s) => {
      if (categoryFilter !== 'All' && s.category !== categoryFilter) return false;
      if (q) {
        const hay = `${s.name} ${s.sku} ${s.category}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    rows.sort((a, b) => {
      let va, vb;
      switch (sortBy) {
        case 'name':
          va = a.name.toLowerCase();
          vb = b.name.toLowerCase();
          return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
        case 'totalSold':
          va = a.totalSoldKg;
          vb = b.totalSoldKg;
          break;
        case 'totalOrdered':
          va = a.totalOrderedKg;
          vb = b.totalOrderedKg;
          break;
        case 'totalDemo':
          va = a.demoUsedKg;
          vb = b.demoUsedKg;
          break;
        case 'totalPurchased':
          va = a.purchasedKg;
          vb = b.purchasedKg;
          break;
        case 'currentStock':
          va = a.currentStock;
          vb = b.currentStock;
          break;
        default:
          va = a.totalSoldKg;
          vb = b.totalSoldKg;
      }
      return sortDir === 'asc' ? va - vb : vb - va;
    });

    return rows;
  }, [analytics.stats, searchQuery, categoryFilter, sortBy, sortDir]);

  const toggleSort = (col) => {
    if (sortBy === col) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(col);
      setSortDir('desc');
    }
  };

  const sortIcon = (col) =>
    sortBy === col ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '';

  const handleExportCsv = () => {
    const rows = filteredStats.map((s) => ({
      Product: s.name,
      SKU: s.sku,
      Category: s.category,
      'Current Stock (Kg)': s.currentStock,
      'Dispatched (Kg)': s.dispatchedKg,
      'Dispatched Orders': s.dispatchedCount,
      'Delivered (Kg)': s.deliveredKg,
      'Delivered Orders': s.deliveredCount,
      'Total Sold (Kg)': s.totalSoldKg,
      'Sold Revenue (₹)': s.totalSoldRevenue,
      'Pending (Kg)': s.pendingKg,
      'Pending Orders': s.pendingCount,
      'Processing (Kg)': s.processingKg,
      'Processing Orders': s.processingCount,
      'Total Ordered (Kg)': s.totalOrderedKg,
      'Demo Used (Kg)': s.demoUsedKg,
      'Demo Entries': s.demoCount,
      'Total Used (Kg)': s.totalUsedKg,
      'Purchased (Kg)': s.purchasedKg,
      'Purchase Orders': s.purchasedCount,
      'Purchase Cost (₹)': s.purchasedCost,
    }));
    downloadCsv('Product_Analytics', rows);
  };

  const { totals } = analytics;

  return (
    <div className="page">
      <PageHeader
        eyebrow="ORDERS / PRODUCT ANALYTICS"
        title="Product Analytics"
        subtitle="Detailed per-product breakdown: sold, ordered, demo usage, and purchases"
        action={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <Button variant="ghost" icon="arrow" onClick={() => navigate('/orders')} style={{ transform: 'scaleX(-1)' }}>
            </Button>
            <Button variant="ghost" onClick={() => navigate('/orders')}>
              ← Back to Orders
            </Button>
            <Button variant="ghost" icon="file" onClick={handleExportCsv}>
              Export CSV
            </Button>
          </div>
        }
      />

      {/* KPI Summary Cards */}
      <div className="kpis">
        <div className="card kpi stack">
          <span className="muted">Total Sold</span>
          <b className="kv" style={{ color: '#059669' }}>
            {formatWeight(totals.totalSoldKg)}
          </b>
          <small className="muted">
            Dispatched + Delivered · {inr(totals.totalSoldRevenue)}
          </small>
        </div>

        <div className="card kpi stack">
          <span className="muted">Total Ordered</span>
          <b className="kv" style={{ color: '#2563eb' }}>
            {formatWeight(totals.totalOrderedKg)}
          </b>
          <small className="muted">
            Pending + Processing · {inr(totals.totalOrderedRevenue)}
          </small>
        </div>

        <div className="card kpi stack">
          <span className="muted">Used in Demo</span>
          <b className="kv" style={{ color: '#7e22ce' }}>
            {formatWeight(totals.totalDemoKg)}
          </b>
          <small className="muted">Customer tasting / samples</small>
        </div>

        <div className="card kpi stack">
          <span className="muted">Total Purchased</span>
          <b className="kv" style={{ color: '#d97706' }}>
            {formatWeight(totals.totalPurchasedKg)}
          </b>
          <small className="muted">
            Received POs · {inr(totals.totalPurchasedCost)}
          </small>
        </div>
      </div>

      {/* Filters Bar */}
      <section className="card pad mb" style={{ padding: '16px 20px' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Search */}
            <label className="search" style={{ minWidth: '220px', margin: 0 }}>
              <Icon name="search" size={18} />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search products…"
                style={{ fontSize: '13px' }}
              />
            </label>

            {/* Category filter */}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              style={{ fontSize: '13px', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--line)' }}
            >
              {availableCategories.map((c) => (
                <option key={c} value={c}>
                  {c === 'All' ? 'All Categories' : c}
                </option>
              ))}
            </select>

            {/* Sort by */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={{ fontSize: '13px', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--line)' }}
            >
              <option value="totalSold">Sort: Most Sold</option>
              <option value="totalOrdered">Sort: Most Ordered</option>
              <option value="totalDemo">Sort: Most Demo</option>
              <option value="totalPurchased">Sort: Most Purchased</option>
              <option value="currentStock">Sort: Current Stock</option>
              <option value="name">Sort: Name</option>
            </select>

            <Button
              variant="ghost"
              onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
              style={{ fontSize: '12px', padding: '4px 8px' }}
            >
              {sortDir === 'desc' ? '▼ Desc' : '▲ Asc'}
            </Button>
          </div>

          <span className="count-label" style={{ margin: 0, fontSize: '13px' }}>
            {filteredStats.length} {filteredStats.length === 1 ? 'product' : 'products'}
          </span>
        </div>
      </section>

      {/* Analytics Table */}
      <section className="card pad mb" style={{ padding: '24px' }}>
        <div className="tw" style={{ border: '1px solid var(--line)', borderRadius: '10px', overflow: 'auto' }}>
          <table style={{ minWidth: '1000px' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                <th style={{ width: '200px', position: 'sticky', left: 0, background: '#f8fafc', zIndex: 2 }}>Product</th>
                <th style={{ textAlign: 'center', cursor: 'pointer' }} onClick={() => toggleSort('currentStock')}>
                  Current Stock{sortIcon('currentStock')}
                </th>
                <th
                  style={{ textAlign: 'center', cursor: 'pointer', background: '#f0fdf4' }}
                  onClick={() => toggleSort('totalSold')}
                >
                  Sold (Dispatched + Delivered){sortIcon('totalSold')}
                </th>
                <th
                  style={{ textAlign: 'center', cursor: 'pointer', background: '#eff6ff' }}
                  onClick={() => toggleSort('totalOrdered')}
                >
                  Ordered (Pending + Processing){sortIcon('totalOrdered')}
                </th>
                <th
                  style={{ textAlign: 'center', cursor: 'pointer', background: '#faf5ff' }}
                  onClick={() => toggleSort('totalDemo')}
                >
                  Used in Demo{sortIcon('totalDemo')}
                </th>
                <th
                  style={{ textAlign: 'center', cursor: 'pointer', background: '#fffbeb' }}
                  onClick={() => toggleSort('totalPurchased')}
                >
                  Purchased (Received){sortIcon('totalPurchased')}
                </th>
                <th style={{ textAlign: 'center' }}>Total Used</th>
              </tr>
            </thead>
            <tbody>
              {filteredStats.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                    No products match the selected filters.
                  </td>
                </tr>
              ) : (
                filteredStats.map((s) => (
                  <tr key={s.id}>
                    {/* Product */}
                    <td style={{ position: 'sticky', left: 0, background: '#fff', zIndex: 1 }}>
                      <div className="cell">
                        <Tile>{initial(s.name)}</Tile>
                        <div>
                          <b>{s.name}</b>
                          <small className="muted block">
                            {s.sku && `${s.sku} · `}{s.category}
                          </small>
                        </div>
                      </div>
                    </td>

                    {/* Current Stock */}
                    <td style={{ textAlign: 'center' }}>
                      <b
                        style={{
                          fontSize: '14px',
                          color:
                            s.currentStock < 0
                              ? '#dc2626'
                              : s.currentStock === 0
                                ? '#d97706'
                                : 'var(--text)',
                        }}
                      >
                        {formatWeight(s.currentStock)}
                      </b>
                    </td>

                    {/* Sold (Dispatched + Delivered) */}
                    <td style={{ textAlign: 'center', background: s.totalSoldKg > 0 ? '#f0fdf4' : undefined }}>
                      {s.totalSoldKg > 0 ? (
                        <div>
                          <b style={{ color: '#059669', fontSize: '14px' }}>
                            {formatWeight(s.totalSoldKg)}
                          </b>
                          <small className="muted block" style={{ fontSize: '10px', marginTop: '2px' }}>
                            {s.dispatchedKg > 0 && (
                              <span>
                                <Badge tone="orange">{s.dispatchedCount} dispatched</Badge>{' '}
                                {formatWeightShort(s.dispatchedKg)}
                              </span>
                            )}
                            {s.dispatchedKg > 0 && s.deliveredKg > 0 && ' · '}
                            {s.deliveredKg > 0 && (
                              <span>
                                <Badge tone="green">{s.deliveredCount} delivered</Badge>{' '}
                                {formatWeightShort(s.deliveredKg)}
                              </span>
                            )}
                          </small>
                          {s.totalSoldRevenue > 0 && (
                            <small className="muted block" style={{ fontSize: '10px' }}>
                              {inr(s.totalSoldRevenue)}
                            </small>
                          )}
                        </div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>

                    {/* Ordered (Pending + Processing) */}
                    <td style={{ textAlign: 'center', background: s.totalOrderedKg > 0 ? '#eff6ff' : undefined }}>
                      {s.totalOrderedKg > 0 ? (
                        <div>
                          <b style={{ color: '#2563eb', fontSize: '14px' }}>
                            {formatWeight(s.totalOrderedKg)}
                          </b>
                          <small className="muted block" style={{ fontSize: '10px', marginTop: '2px' }}>
                            {s.pendingKg > 0 && (
                              <span>
                                <Badge tone="yellow">{s.pendingCount} pending</Badge>{' '}
                                {formatWeightShort(s.pendingKg)}
                              </span>
                            )}
                            {s.pendingKg > 0 && s.processingKg > 0 && ' · '}
                            {s.processingKg > 0 && (
                              <span>
                                <Badge tone="blue">{s.processingCount} processing</Badge>{' '}
                                {formatWeightShort(s.processingKg)}
                              </span>
                            )}
                          </small>
                          {s.totalOrderedRevenue > 0 && (
                            <small className="muted block" style={{ fontSize: '10px' }}>
                              {inr(s.totalOrderedRevenue)}
                            </small>
                          )}
                        </div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>

                    {/* Demo */}
                    <td style={{ textAlign: 'center', background: s.demoUsedKg > 0 ? '#faf5ff' : undefined }}>
                      {s.demoUsedKg > 0 ? (
                        <div>
                          <b style={{ color: '#7e22ce', fontSize: '14px' }}>
                            {formatWeight(s.demoUsedKg)}
                          </b>
                          <small className="muted block" style={{ fontSize: '10px', marginTop: '2px' }}>
                            {s.demoCount} {s.demoCount === 1 ? 'entry' : 'entries'}
                          </small>
                        </div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>

                    {/* Purchased */}
                    <td style={{ textAlign: 'center', background: s.purchasedKg > 0 ? '#fffbeb' : undefined }}>
                      {s.purchasedKg > 0 ? (
                        <div>
                          <b style={{ color: '#d97706', fontSize: '14px' }}>
                            {formatWeight(s.purchasedKg)}
                          </b>
                          <small className="muted block" style={{ fontSize: '10px', marginTop: '2px' }}>
                            {s.purchasedCount} {s.purchasedCount === 1 ? 'PO' : 'POs'}
                            {s.purchasedCost > 0 && ` · ${inr(s.purchasedCost)}`}
                          </small>
                        </div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>

                    {/* Total Used (Sold + Demo only) */}
                    <td style={{ textAlign: 'center' }}>
                      {s.totalUsedKg > 0 ? (
                        <div>
                          <b style={{ fontSize: '14px', color: '#0f172a' }}>
                            {formatWeight(s.totalUsedKg)}
                          </b>
                          <small className="muted block" style={{ fontSize: '9px', marginTop: '2px' }}>
                            Disp + Del + Demo
                          </small>
                        </div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>

            {/* Totals Footer */}
            {filteredStats.length > 0 && (
              <tfoot>
                <tr style={{ background: '#f1f5f9', fontWeight: 700 }}>
                  <td style={{ position: 'sticky', left: 0, background: '#f1f5f9', zIndex: 1 }}>
                    <b>TOTAL ({filteredStats.length} products)</b>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {formatWeight(filteredStats.reduce((s, p) => s + p.currentStock, 0))}
                  </td>
                  <td style={{ textAlign: 'center', background: '#e8f5e9' }}>
                    <span style={{ color: '#059669' }}>
                      {formatWeight(filteredStats.reduce((s, p) => s + p.totalSoldKg, 0))}
                    </span>
                    <small className="muted block" style={{ fontSize: '10px', fontWeight: 400 }}>
                      {inr(filteredStats.reduce((s, p) => s + p.totalSoldRevenue, 0))}
                    </small>
                  </td>
                  <td style={{ textAlign: 'center', background: '#e3f2fd' }}>
                    <span style={{ color: '#2563eb' }}>
                      {formatWeight(filteredStats.reduce((s, p) => s + p.totalOrderedKg, 0))}
                    </span>
                    <small className="muted block" style={{ fontSize: '10px', fontWeight: 400 }}>
                      {inr(filteredStats.reduce((s, p) => s + p.totalOrderedRevenue, 0))}
                    </small>
                  </td>
                  <td style={{ textAlign: 'center', background: '#f3e8ff' }}>
                    <span style={{ color: '#7e22ce' }}>
                      {formatWeight(filteredStats.reduce((s, p) => s + p.demoUsedKg, 0))}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center', background: '#fef3c7' }}>
                    <span style={{ color: '#d97706' }}>
                      {formatWeight(filteredStats.reduce((s, p) => s + p.purchasedKg, 0))}
                    </span>
                    <small className="muted block" style={{ fontSize: '10px', fontWeight: 400 }}>
                      {inr(filteredStats.reduce((s, p) => s + p.purchasedCost, 0))}
                    </small>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <b>{formatWeight(filteredStats.reduce((s, p) => s + p.totalUsedKg, 0))}</b>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {/* Legend */}
      <section className="card pad mb" style={{ padding: '16px 20px' }}>
        <h3 style={{ fontSize: '14px', marginBottom: '8px' }}>📋 How quantities are counted</h3>
        <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', fontSize: '13px' }}>
          <div>
            <Badge tone="green">Sold</Badge>{' '}
            <span className="muted">= Dispatched + Delivered orders</span>
          </div>
          <div>
            <Badge tone="blue">Ordered</Badge>{' '}
            <span className="muted">= Pending + Processing orders (not yet used)</span>
          </div>
          <div>
            <Badge tone="purple">Demo</Badge>{' '}
            <span className="muted">= Used in Demo / customer tasting entries</span>
          </div>
          <div>
            <Badge tone="yellow">Purchased</Badge>{' '}
            <span className="muted">= Received purchase orders from suppliers</span>
          </div>
          <div>
            <b>Total Used</b>{' '}
            <span className="muted">= Sold + Demo only (no other status)</span>
          </div>
        </div>
      </section>
    </div>
  );
}

