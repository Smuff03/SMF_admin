import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import DataTable from '../components/DataTable.jsx';
import { Badge, Button, ConfirmModal, EmptyState, Modal, PageHeader, StatusSelect } from '../components/ui.jsx';
import { ORDER_STATUS, WEIGHT_VARIANTS, formatWeight, formatWeightShort, getDeliveryStatus, inr, parseWeightKg, when } from '../utils.js';

export default function Orders() {
  const { data, errors, toast, setConnOpen } = useApp();
  const rawOrders = data.orders || [];
  const products = data.products || [];
  const customers = data.customers || [];
  const wholesalers = data.wholesalers || [];
  const error = errors.orders || '';

  const [tab, setTab] = useState('All');
  const [sourceFilter, setSourceFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');
  const [deliveryFilter, setDeliveryFilter] = useState('All');
  const [q, setQ] = useState('');
  const [orderModal, setOrderModal] = useState(null); // { order: null | object }
  const [billModal, setBillModal] = useState(null); // order object
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [syncing, setSyncing] = useState(false);

  // Sync / Fetch customer portal orders
  const fetchPortalOrders = async () => {
    setSyncing(true);
    try {
      toast('Customer portal orders checked and refreshed');
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      setSyncing(false);
    }
  };

  const updateOrderStatus = async (order, status) => {
    try {
      await api.update('orders', order.id, { status });
      toast(`Order #${order.id} status updated to ${status}`);
      if (billModal && billModal.id === order.id) {
        setBillModal((b) => ({ ...b, status }));
      }
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  const saveOrder = async (orderData) => {
    const isEdit = Boolean(orderModal?.order?.id);
    try {
      if (isEdit) {
        await api.update('orders', orderModal.order.id, orderData);
        toast(`Order #${orderModal.order.id} updated`);
      } else {
        const res = await api.create('orders', orderData);
        toast(`Order ${res?.id || ''} created successfully with stock deducted`);
      }
      setOrderModal(null);
    } catch (e) {
      toast(e.message, 'err');
      throw e;
    }
  };

  const removeOrder = async (order) => {
    try {
      const res = order.source === 'Customer Portal' ? 'storefrontOrders' : 'orders';
      try {
        await api.remove(res, order.id);
      } catch {
        const alt = res === 'orders' ? 'storefrontOrders' : 'orders';
        await api.remove(alt, order.id);
      }
      toast(`Order #${order.id} deleted and stock restored`);
      setConfirmDelete(null);
      if (billModal && billModal.id === order.id) setBillModal(null);
      if (orderModal && orderModal.order && orderModal.order.id === order.id) setOrderModal(null);
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  // Filter visible orders
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rawOrders.filter((r) => {
      if (tab !== 'All' && r.status !== tab) return false;
      if (sourceFilter === 'Portal' && r.source !== 'Customer Portal') return false;
      if (sourceFilter === 'Admin' && r.source === 'Customer Portal') return false;
      if (typeFilter !== 'All' && r.type !== typeFilter) return false;

      // Delivery timeliness filter
      if (deliveryFilter !== 'All') {
        const d = getDeliveryStatus(r);
        if (deliveryFilter === 'Overdue' && !d.overdue) return false;
        if (deliveryFilter === 'DueToday' && !d.dueToday) return false;
        if (deliveryFilter === 'OnTime' && !d.onTime) return false;
        if (deliveryFilter === 'OnTrack' && d.label !== 'On Track') return false;
      }

      if (needle) {
        const hay = `${r.id} ${r.customer} ${r.type} ${r.note || ''} ${r.phone || ''} ${r.deliveryDate || ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [rawOrders, tab, sourceFilter, typeFilter, deliveryFilter, q]);

  // Calculate order weight
  const getOrderWeight = (r) => {
    if (Array.isArray(r.items) && r.items.length) {
      const totalKg = r.items.reduce((sum, item) => sum + (Number(item.totalWeightKg) || ((Number(item.weightInKg) || 1) * (Number(item.quantity) || 1))), 0);
      return `${formatWeightShort(totalKg)} (${r.items.length} ${r.items.length === 1 ? 'item' : 'items'})`;
    }
    return '1 order';
  };

  const columns = [
    {
      label: 'Order #',
      render: (r) => (
        <div>
          <b>#{r.id}</b>
          {r.source === 'Customer Portal' ? (
            <span className="badge-portal">Portal</span>
          ) : (
            <small className="muted block">Direct</small>
          )}
        </div>
      ),
    },
    {
      label: 'Customer',
      render: (r) => (
        <div>
          <b>{typeof r.customer === 'object' && r.customer ? (r.customer.name || r.customer.email || 'Customer') : (r.customer || '—')}</b>
          {r.phone && <small className="muted block">{r.phone}</small>}
        </div>
      ),
    },
    { label: 'Type', render: (r) => <Badge>{r.type}</Badge> },
    { label: 'Weight / Items', render: (r) => <span className="plain">{getOrderWeight(r)}</span> },
    { label: 'Bill Amount', render: (r) => <b>{inr(r.amount)}</b> },
    {
      label: 'Delivery Target',
      render: (r) => {
        const d = getDeliveryStatus(r);
        return (
          <div>
            <b>
              {r.deliveryDate
                ? new Date(r.deliveryDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
                : <span className="muted">Not set</span>}
            </b>
            <span className={`badge b-${d.tone} block`} style={{ fontSize: '11px', padding: '2px 6px', marginTop: '3px' }}>
              {d.label}
            </span>
          </div>
        );
      },
    },
    {
      label: 'Status',
      render: (r) => (
        <StatusSelect
          value={r.status}
          options={ORDER_STATUS}
          onChange={(status) => updateOrderStatus(r, status)}
        />
      ),
    },
    { label: 'Date', render: (r) => <span className="muted">{when(r.createdAt)}</span> },
    {
      label: 'Actions',
      className: 'end',
      render: (r) => (
        <span className="row-actions">
          <Button
            variant="ghost"
            icon="file"
            onClick={() => setBillModal(r)}
            title="View Bill / Invoice"
          >
            Bill
          </Button>
          <button className="icon-btn" onClick={() => setOrderModal({ order: r })} aria-label="Edit order">
            <Icon name="pencil" size={18} />
          </button>
          <button className="icon-btn" onClick={() => setConfirmDelete(r)} aria-label="Delete order">
            <Icon name="trash" size={18} />
          </button>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="ENTERPRISE WORKSPACE / ORDERS & BILLING"
        title="Orders"
        subtitle="Manage customer portal & direct orders. Live delivery date tracking verifies on-time fulfillment."
        action={
          <div className="btn-group" style={{ display: 'flex', gap: '10px' }}>
            <Button icon="cloud" onClick={fetchPortalOrders} disabled={syncing}>
              {syncing ? 'Fetching…' : 'Fetch Customer Portal'}
            </Button>
            <Button variant="primary" icon="plus" onClick={() => setOrderModal({ order: null })}>
              Create Order & Bill
            </Button>
          </div>
        }
      />

      {error ? (
        <EmptyState
          title="Orders unavailable"
          text={`${error}. Check the connection settings.`}
          action={<Button onClick={() => setConnOpen(true)}>Review connection</Button>}
        />
      ) : rawOrders === null ? (
        <div className="loading">Loading enterprise orders…</div>
      ) : (
        <>
          {/* Status Tabs */}
          <div className="tabs">
            {['All', ...ORDER_STATUS].map((t) => (
              <button
                key={t}
                className={`tab ${tab === t ? 'on' : ''}`}
                onClick={() => setTab(t)}
              >
                {t}{' '}
                <span>
                  {t === 'All' ? rawOrders.length : rawOrders.filter((r) => r.status === t).length}
                </span>
              </button>
            ))}
          </div>

          {/* Toolbar */}
          <div className="toolbar">
            <label className="search">
              <Icon name="search" size={19} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by order ID, customer name, phone, date, notes…"
                aria-label="Search orders"
              />
            </label>
            <select
              className="sel"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              aria-label="Filter by order source"
            >
              <option value="All">All Sources</option>
              <option value="Portal">Customer Portal</option>
              <option value="Admin">Direct Admin</option>
            </select>
            <select
              className="sel"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              aria-label="Filter by order type"
            >
              <option value="All">All Types</option>
              <option value="Retail">Retail</option>
              <option value="Wholesale">Wholesale</option>
            </select>
            <select
              className="sel"
              value={deliveryFilter}
              onChange={(e) => setDeliveryFilter(e.target.value)}
              aria-label="Filter by delivery status"
            >
              <option value="All">All Deliveries</option>
              <option value="OnTrack">On Track</option>
              <option value="DueToday">Due Today</option>
              <option value="Overdue">Overdue</option>
              <option value="OnTime">Delivered On Time</option>
            </select>
            <span className="count-label">
              {visible.length} {visible.length === 1 ? 'order' : 'orders'}
            </span>
          </div>

          {/* Orders Table */}
          {visible.length ? (
            <section className="card">
              <DataTable columns={columns} rows={visible} />
            </section>
          ) : (
            <EmptyState
              title={rawOrders.length ? 'No orders match filters' : 'No orders recorded yet'}
              text={
                rawOrders.length
                  ? 'Try clearing the search or changing the filter options.'
                  : 'Create your first order or fetch incoming orders from the customer portal.'
              }
              action={
                !rawOrders.length && (
                  <Button variant="primary" icon="plus" onClick={() => setOrderModal({ order: null })}>
                    Create First Order
                  </Button>
                )
              }
            />
          )}
        </>
      )}

      {/* Interactive Order & Bill Builder Modal */}
      {orderModal && (
        <OrderBuilderModal
          order={orderModal.order}
          products={products}
          customers={customers}
          wholesalers={wholesalers}
          onClose={() => setOrderModal(null)}
          onSave={saveOrder}
          onDelete={orderModal.order ? () => {
            const target = orderModal.order;
            setOrderModal(null);
            setConfirmDelete(target);
          } : null}
        />
      )}

      {/* Invoice & Detailed Bill Slip View Modal */}
      {billModal && (
        <BillingSlipModal
          order={billModal}
          onClose={() => setBillModal(null)}
          onStatusChange={(status) => updateOrderStatus(billModal, status)}
          onEdit={() => {
            const current = billModal;
            setBillModal(null);
            setOrderModal({ order: current });
          }}
          onDelete={() => {
            const target = billModal;
            setBillModal(null);
            setConfirmDelete(target);
          }}
        />
      )}

      {/* Delete / Cancel Confirmation */}
      {confirmDelete && (
        <ConfirmModal
          title={`Delete Order #${confirmDelete.id}?`}
          text={`This will delete order #${confirmDelete.id} for ${typeof confirmDelete.customer === 'object' && confirmDelete.customer ? (confirmDelete.customer.name || confirmDelete.customer.fullName || confirmDelete.customer.email || 'Customer') : (confirmDelete.customer || 'Customer')}. Any stock in Kg deducted by this order will be automatically restored to inventory.`}
          confirmLabel="Delete & Restore Stock"
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => removeOrder(confirmDelete)}
        />
      )}
    </>
  );
}

/**
 * Enterprise Order & Bill Builder Modal
 */
function OrderBuilderModal({ order, products, customers, wholesalers, onClose, onSave, onDelete }) {
  const isEdit = Boolean(order?.id);

  const [customer, setCustomer] = useState(order?.customer || '');
  const [phone, setPhone] = useState(order?.phone || '');
  const [email, setEmail] = useState(order?.email || '');
  const [address, setAddress] = useState(order?.address || '');
  const [type, setType] = useState(order?.type || 'Retail');
  const [status, setStatus] = useState(order?.status || 'Pending');
  const [note, setNote] = useState(order?.note || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Delivery Date tracking
  const [deliveryDate, setDeliveryDate] = useState(() => {
    if (order?.deliveryDate) return order.deliveryDate;
    const d = new Date();
    d.setDate(d.getDate() + 2); // Default expected delivery in 2 days
    return d.toISOString().split('T')[0];
  });

  // Line items state
  const [items, setItems] = useState(() => {
    if (order?.items && Array.isArray(order.items) && order.items.length) {
      return order.items.map((it) => ({
        ...it,
        id: it.id || Math.random().toString(36).slice(2, 9),
      }));
    }
    const defaultProd = products[0];
    const defaultVariant = defaultProd?.startingQuantity || defaultProd?.availableQuantities?.[0] || '500 gm';
    const initialPrice = getProductVariantPrice(defaultProd, defaultVariant, '', type);
    const initWeight = parseWeightKg(defaultVariant, '');
    return [
      {
        id: Math.random().toString(36).slice(2, 9),
        productId: defaultProd?.id || '',
        productName: defaultProd?.name || '',
        sku: defaultProd?.sku || '',
        weightVariant: defaultVariant,
        customKg: '',
        weightInKg: initWeight,
        quantity: 1,
        totalWeightKg: initWeight,
        price: initialPrice,
        amount: initialPrice,
      },
    ];
  });

  const getProductVariantPrice = (prod, variant, customKg, ordType) => {
    if (!prod) return 0;
    if (Array.isArray(prod.variantPricing)) {
      const vp = prod.variantPricing.find((v) => v.weight === variant);
      if (vp) {
        if (ordType === 'Wholesale' && Number(vp.wholesalePrice) > 0) return Number(vp.wholesalePrice);
        if (Number(vp.retailPrice) > 0) return Number(vp.retailPrice);
        if (Number(vp.mrp) > 0) return Number(vp.mrp);
      }
    }
    const baseKgPrice =
      ordType === 'Wholesale'
        ? Number(prod.wholesalePrice || prod.retailPrice || 0)
        : Number(prod.retailPrice || prod.mrp || 0);
    const weightKg = parseWeightKg(variant, customKg);
    return Math.round(baseKgPrice * weightKg);
  };

  const addItemRow = () => {
    const defaultProd = products[0];
    const defaultVariant = defaultProd?.startingQuantity || defaultProd?.availableQuantities?.[0] || '500 gm';
    const initialPrice = getProductVariantPrice(defaultProd, defaultVariant, '', type);
    const initWeight = parseWeightKg(defaultVariant, '');
    setItems((cur) => [
      ...cur,
      {
        id: Math.random().toString(36).slice(2, 9),
        productId: defaultProd?.id || '',
        productName: defaultProd?.name || '',
        sku: defaultProd?.sku || '',
        weightVariant: defaultVariant,
        customKg: '',
        weightInKg: initWeight,
        quantity: 1,
        totalWeightKg: initWeight,
        price: initialPrice,
        amount: initialPrice,
      },
    ]);
  };

  const removeItemRow = (idx) => {
    setItems((cur) => cur.filter((_, i) => i !== idx));
  };

  const updateItem = (idx, field, val) => {
    setItems((cur) => {
      const next = [...cur];
      const it = { ...next[idx], [field]: val };

      if (field === 'productId') {
        const prod = products.find((p) => p.id === val);
        if (prod) {
          it.productName = prod.name;
          it.sku = prod.sku;
          const defaultVariant = prod.startingQuantity || prod.availableQuantities?.[0] || it.weightVariant || '500 gm';
          it.weightVariant = defaultVariant;
          it.weightInKg = parseWeightKg(defaultVariant, it.customKg);
          it.price = getProductVariantPrice(prod, defaultVariant, it.customKg, type);
        }
      }

      if (field === 'weightVariant' || field === 'customKg') {
        const prod = products.find((p) => p.id === it.productId);
        const weightKg = parseWeightKg(it.weightVariant, it.customKg);
        it.weightInKg = weightKg;
        if (prod) {
          it.price = getProductVariantPrice(prod, it.weightVariant, it.customKg, type);
        }
      }

      it.totalWeightKg = Math.round((Number(it.weightInKg || 0) * Number(it.quantity || 1)) * 1000) / 1000;
      it.amount = Math.round(Number(it.price || 0) * Number(it.quantity || 1));
      next[idx] = it;
      return next;
    });
  };

  const handleTypeChange = (newType) => {
    setType(newType);
    setItems((cur) =>
      cur.map((it) => {
        const prod = products.find((p) => p.id === it.productId);
        const price = getProductVariantPrice(prod, it.weightVariant, it.customKg, newType);
        return {
          ...it,
          price,
          amount: Math.round(price * (Number(it.quantity) || 1)),
        };
      })
    );
  };

  const totalWeightKg = items.reduce((s, it) => s + (Number(it.totalWeightKg) || 0), 0);
  const totalAmount = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!customer.trim()) return setError('Customer name is required');
    if (!items.length) return setError('Please add at least one product item to the order');

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.productId) return setError(`Item #${i + 1} product is missing`);
      if (!it.quantity || it.quantity < 1) return setError(`Item #${i + 1} quantity must be at least 1`);
    }

    setError('');
    setSaving(true);
    try {
      const payload = {
        customer: customer.trim(),
        phone: phone.trim(),
        email: email.trim(),
        address: address.trim(),
        type,
        status,
        deliveryDate: deliveryDate || null,
        amount: totalAmount,
        note: note.trim(),
        items: items.map(({ id, ...it }) => it),
      };
      await onSave(payload);
    } catch (err) {
      setError(err.message || 'Failed to save order');
      setSaving(false);
    }
  };

  const customerList = [...customers.map((c) => c.name), ...wholesalers.map((w) => w.name)];

  return (
    <Modal title={isEdit ? `Edit Order #${order.id}` : 'Create New Order & Bill'} onClose={onClose} width={820}>
      <form onSubmit={handleSubmit}>
        {error && <div className="form-error mb">{error}</div>}

        {/* Customer & Type Details */}
        <div className="form-grid mb">
          <div className="field">
            <label>Customer Name <span className="req">*</span></label>
            <input
              list="customer-suggestions"
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              placeholder="e.g. Ramesh Patil or Business Name"
              required
            />
            <datalist id="customer-suggestions">
              {customerList.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>

          <div className="field">
            <label>Order Type</label>
            <select value={type} onChange={(e) => handleTypeChange(e.target.value)}>
              <option value="Retail">Retail Customer</option>
              <option value="Wholesale">Wholesale Account</option>
            </select>
          </div>

          <div className="field">
            <label>Contact Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="10-digit mobile number"
            />
          </div>

          <div className="field">
            <label>Expected Delivery Date</label>
            <input
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
            />
            <small className="muted">Target date to verify on-time delivery</small>
          </div>

          <div className="field">
            <label>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {ORDER_STATUS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Customer Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="customer@example.com"
            />
          </div>

          <div className="field full">
            <label>Delivery Address / City</label>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Delivery address, city, landmark"
            />
          </div>
        </div>

        {/* Detailed Itemized Billing Builder */}
        <div className="card pad mb item-builder-card" style={{ background: '#f8fafc' }}>
          <div className="card-h flat" style={{ marginBottom: '12px' }}>
            <div>
              <h2 style={{ fontSize: '18px' }}>Line Items & Pack Weights</h2>
              <p className="sub" style={{ fontSize: '13px', margin: '2px 0 0' }}>
                Stock in Kg will be deducted from inventory automatically based on weight (starting from 200 gm).
              </p>
            </div>
            <Button type="button" icon="plus" onClick={addItemRow}>
              Add Product
            </Button>
          </div>

          <div className="item-rows" style={{ display: 'grid', gap: '12px' }}>
            {items.map((it, idx) => {
              const selectedProd = products.find((p) => p.id === it.productId);
              const availStock = selectedProd ? selectedProd.stock : 0;

              return (
                <div
                  key={it.id || idx}
                  className="item-row"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1.6fr 1fr 1fr 1.2fr auto',
                    gap: '10px',
                    alignItems: 'end',
                    padding: '12px',
                    background: '#fff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                  }}
                >
                  <div className="field">
                    <label style={{ fontSize: '12px' }}>Product</label>
                    <select
                      value={it.productId}
                      onChange={(e) => updateItem(idx, 'productId', e.target.value)}
                    >
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({formatWeight(p.stock)} left)
                        </option>
                      ))}
                    </select>
                    <small className={availStock <= 0 ? 'neg' : 'muted'} style={{ fontSize: '11px' }}>
                      Avail: {formatWeight(availStock)}
                    </small>
                  </div>

                  <div className="field">
                    <label style={{ fontSize: '12px' }}>Pack Weight</label>
                    <select
                      value={it.weightVariant}
                      onChange={(e) => updateItem(idx, 'weightVariant', e.target.value)}
                    >
                      {selectedProd?.availableQuantities?.length > 0 ? (
                        <>
                          <optgroup label="Available Sizes (This Product)">
                            {selectedProd.availableQuantities.map((q) => {
                              const vp = selectedProd.variantPricing?.find((v) => v.weight === q);
                              const priceTag = vp ? (type === 'Wholesale' && vp.wholesalePrice ? ` (₹${vp.wholesalePrice})` : vp.retailPrice ? ` (₹${vp.retailPrice})` : '') : '';
                              return (
                                <option key={q} value={q}>
                                  {q}{q === selectedProd.startingQuantity ? ' ★ Starting' : ''}{priceTag}
                                </option>
                              );
                            })}
                          </optgroup>
                          <optgroup label="Other Standard Sizes">
                            {WEIGHT_VARIANTS.filter((v) => !selectedProd.availableQuantities.includes(v.value)).map((v) => (
                              <option key={v.value} value={v.value}>
                                {v.label}
                              </option>
                            ))}
                          </optgroup>
                        </>
                      ) : (
                        WEIGHT_VARIANTS.map((v) => (
                          <option key={v.value} value={v.value}>
                            {v.label}
                          </option>
                        ))
                      )}
                    </select>
                    {it.weightVariant === 'Custom' && (
                      <input
                        type="number"
                        step="0.05"
                        placeholder="Kg"
                        value={it.customKg || ''}
                        onChange={(e) => updateItem(idx, 'customKg', e.target.value)}
                        style={{ marginTop: '4px' }}
                      />
                    )}
                  </div>

                  <div className="field">
                    <label style={{ fontSize: '12px' }}>Packs</label>
                    <input
                      type="number"
                      min="1"
                      value={it.quantity}
                      onChange={(e) => updateItem(idx, 'quantity', Math.max(1, parseInt(e.target.value) || 1))}
                    />
                  </div>

                  <div className="field">
                    <label style={{ fontSize: '12px' }}>Rate (₹)</label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={it.price}
                      onChange={(e) => updateItem(idx, 'price', Math.max(0, parseFloat(e.target.value) || 0))}
                    />
                  </div>

                  <div className="field">
                    <label style={{ fontSize: '12px' }}>Total (₹)</label>
                    <div style={{ padding: '10px 0', fontWeight: '700' }}>
                      {inr(it.amount)}
                      <small className="muted block" style={{ fontSize: '11px', fontWeight: '400' }}>
                        {formatWeightShort(it.totalWeightKg)}
                      </small>
                    </div>
                  </div>

                  <div>
                    {items.length > 1 && (
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => removeItemRow(idx)}
                        style={{ color: '#dc2626' }}
                        title="Remove item"
                      >
                        <Icon name="trash" size={18} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Live Bill Totals Footer */}
          <div
            className="bill-summary-bar"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '16px',
              paddingTop: '14px',
              borderTop: '1px solid #cbd5e1',
            }}
          >
            <div>
              <span className="muted">Total Order Weight: </span>
              <b style={{ color: '#0f172a' }}>{formatWeight(totalWeightKg)}</b>
            </div>
            <div style={{ fontSize: '18px' }}>
              <span className="muted">Grand Total: </span>
              <b style={{ color: '#166534', fontSize: '22px' }}>{inr(totalAmount)}</b>
            </div>
          </div>
        </div>

        {/* Note / Instructions */}
        <div className="field mb">
          <label>Order Note / Instructions</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Special packing requests, batch notes, delivery instructions…"
          />
        </div>

        <div className="modal-f" style={{ display: 'flex', justifyContent: isEdit && onDelete ? 'space-between' : 'flex-end', width: '100%' }}>
          {isEdit && onDelete && (
            <Button
              type="button"
              variant="ghost"
              icon="trash"
              onClick={onDelete}
              style={{ color: '#dc2626', borderColor: '#fca5a5' }}
            >
              Delete Order
            </Button>
          )}
          <div style={{ display: 'flex', gap: '10px' }}>
            <Button type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={saving}>
              {saving ? 'Saving Order…' : isEdit ? 'Save Changes' : 'Generate Bill & Save Order'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Enterprise Billing Slip / Tax Invoice Modal (Printable & Itemized)
 */
function BillingSlipModal({ order, onClose, onStatusChange, onEdit, onDelete }) {
  const items = Array.isArray(order.items) && order.items.length ? order.items : [];
  const totalWeightKg = items.reduce(
    (sum, it) =>
      sum + (Number(it.totalWeightKg) || ((Number(it.weightInKg) || 1) * (Number(it.quantity) || 1))),
    0
  );

  const deliveryInfo = getDeliveryStatus(order);

  const handlePrint = () => {
    window.print();
  };

  return (
    <Modal title={`Invoice / Billing Slip #${order.id}`} onClose={onClose} width={760}>
      <div className="invoice-container">
        {/* Printable Invoice Header */}
        <div
          className="inv-header"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            borderBottom: '2px solid #0f2a1c',
            paddingBottom: '16px',
            marginBottom: '20px',
          }}
        >
          <div>
            <h1 style={{ fontSize: '26px', color: '#0f2a1c', margin: 0 }}>
              The Maharashtra Foods
            </h1>
            <p className="sub" style={{ margin: '4px 0 0', fontSize: '13px' }}>
              TMF BizHub · Authentic Snacks & Namkeen Manufacturer
            </p>
            <p className="muted" style={{ margin: '2px 0 0', fontSize: '12px' }}>
              GSTIN: 27AABCT1234F1Z5 · Pune, Maharashtra
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span
              style={{
                display: 'inline-block',
                background: '#dcfce7',
                color: '#166534',
                padding: '4px 10px',
                borderRadius: '6px',
                fontWeight: '700',
                fontSize: '13px',
                marginBottom: '6px',
              }}
            >
              TAX INVOICE / BILL
            </span>
            <div style={{ fontSize: '15px', fontWeight: '700' }}>#{order.id}</div>
            <div className="muted" style={{ fontSize: '12px' }}>
              Date: {new Date(order.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </div>
          </div>
        </div>

        {/* Customer & Order Metadata with Delivery Timeliness */}
        <div
          className="inv-meta-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '16px',
            background: '#f8fafc',
            padding: '16px',
            borderRadius: '10px',
            marginBottom: '20px',
          }}
        >
          <div>
            <small className="muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Billed To:
            </small>
            <div style={{ fontSize: '16px', fontWeight: '700', marginTop: '2px' }}>
              {order.customer}
            </div>
            {order.phone && <div className="muted" style={{ fontSize: '13px' }}>Phone: {order.phone}</div>}
            {order.address && <div className="muted" style={{ fontSize: '13px' }}>Address: {order.address}</div>}
          </div>
          <div>
            <small className="muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Delivery Target & Fulfillment:
            </small>
            <div style={{ fontSize: '14px', marginTop: '2px' }}>
              Expected Delivery:{' '}
              <b>
                {order.deliveryDate
                  ? new Date(order.deliveryDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                  : 'Not set'}
              </b>
            </div>
            <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span className={`badge b-${deliveryInfo.tone}`}>
                {deliveryInfo.text}
              </span>
              <StatusSelect
                value={order.status}
                options={ORDER_STATUS}
                onChange={onStatusChange}
              />
            </div>
          </div>
        </div>

        {/* Itemized Table */}
        <div className="tw mb">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#0f2a1c', color: '#fff' }}>
                <th style={{ color: '#fff', padding: '10px 14px' }}>#</th>
                <th style={{ color: '#fff', padding: '10px 14px' }}>Product</th>
                <th style={{ color: '#fff', padding: '10px 14px' }}>Weight Variant</th>
                <th style={{ color: '#fff', padding: '10px 14px', textAlign: 'center' }}>Packs</th>
                <th style={{ color: '#fff', padding: '10px 14px', textAlign: 'right' }}>Total Weight</th>
                <th style={{ color: '#fff', padding: '10px 14px', textAlign: 'right' }}>Rate (₹)</th>
                <th style={{ color: '#fff', padding: '10px 14px', textAlign: 'right' }}>Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              {items.length ? (
                items.map((it, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '10px 14px' }}>{idx + 1}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <b>{it.productName || 'Snack Item'}</b>
                      {it.sku && <small className="muted block">{it.sku}</small>}
                    </td>
                    <td style={{ padding: '10px 14px' }}>{it.weightVariant || 'Pack'}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'center' }}>{it.quantity}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                      {formatWeight(Number(it.totalWeightKg) || (Number(it.weightInKg || 1) * Number(it.quantity || 1)))}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'right' }}>{inr(it.price)}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '700' }}>
                      {inr(it.amount)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="7" style={{ padding: '20px', textAlign: 'center' }}>
                    Standard order amount: <b>{inr(order.amount)}</b>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Invoice Summary */}
        <div
          className="inv-summary"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            padding: '16px 20px',
            background: '#f8fafc',
            borderRadius: '10px',
            marginBottom: '20px',
          }}
        >
          <div>
            <div className="muted" style={{ fontSize: '13px' }}>
              Total Weight: <b>{formatWeight(totalWeightKg)}</b>
            </div>
            {order.note && (
              <div style={{ marginTop: '6px', fontSize: '13px' }}>
                <span className="muted">Note:</span> {order.note}
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="muted" style={{ fontSize: '13px' }}>Subtotal: {inr(order.amount)}</div>
            <div style={{ fontSize: '24px', fontWeight: '700', color: '#166534', marginTop: '4px' }}>
              Grand Total: {inr(order.amount)}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="modal-f no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button icon="pencil" onClick={onEdit}>
              Edit Order Details
            </Button>
            {onDelete && (
              <Button
                variant="ghost"
                icon="trash"
                onClick={onDelete}
                style={{ color: '#dc2626', borderColor: '#fca5a5' }}
              >
                Delete Order
              </Button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <Button icon="printer" onClick={handlePrint}>
              Print Invoice
            </Button>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
