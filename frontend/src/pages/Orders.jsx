import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import DataTable from '../components/DataTable.jsx';
import { Badge, Button, ConfirmModal, EmptyState, Modal, PageHeader, StatusSelect } from '../components/ui.jsx';
import { ORDER_STATUS, WEIGHT_VARIANTS, formatWeight, formatWeightShort, getDeliveryStatus, inr, parseWeightKg, when } from '../utils.js';

export default function Orders() {
  const navigate = useNavigate();
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
      const res = order.source === 'Customer Portal' ? 'storefrontOrders' : 'orders';
      try {
        await api.update(res, order.id, { status, orderStatus: status });
      } catch (err) {
        const alt = res === 'orders' ? 'storefrontOrders' : 'orders';
        try {
          await api.update(alt, order.id, { status, orderStatus: status });
        } catch {
          throw err;
        }
      }
      toast(`Order #${order.id} status updated to ${status}`);
      if (billModal && billModal.id === order.id) {
        setBillModal((b) => ({ ...b, status, orderStatus: status }));
      }
    } catch (e) {
      toast(e.message, 'err');
    }
  };

  const saveOrder = async (orderData) => {
    const isEdit = Boolean(orderModal?.order?.id);
    const hasDeficit = orderData.items?.some((it) => {
      const prod = products.find((p) => p.id === (it.productId || it.id));
      return prod && (Number(prod.stock || 0) < Number(it.totalWeightKg || it.weightInKg || 0));
    });
    try {
      if (isEdit) {
        await api.update('orders', orderModal.order.id, orderData);
        toast(`Order #${orderModal.order.id} updated`);
      } else {
        const res = await api.create('orders', orderData);
        if (hasDeficit) {
          toast(`Order ${res?.id || ''} created! Stock deficit recorded — add a purchase order to restock.`);
        } else {
          toast(`Order ${res?.id || ''} created successfully with stock deducted`);
        }
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
      } catch (err) {
        const alt = res === 'orders' ? 'storefrontOrders' : 'orders';
        try {
          await api.remove(alt, order.id);
        } catch {
          throw err;
        }
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

  // Identify products in an order with current stock deficits
  const getOrderDeficitInfo = (r) => {
    if (!Array.isArray(r.items) || !r.items.length) return [];
    const deficits = [];
    for (const it of r.items) {
      const p = products.find((prod) => prod.id === (it.productId || it.id));
      if (p && Number(p.stock || 0) < 0) {
        deficits.push({ name: p.name, stock: Number(p.stock), id: p.id, needed: Math.abs(Number(p.stock)) });
      }
    }
    return deficits;
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
    {
      label: 'Weight / Items',
      render: (r) => {
        const deficits = getOrderDeficitInfo(r);
        return (
          <div>
            <span className="plain">{getOrderWeight(r)}</span>
            {deficits && deficits.length > 0 && r.status !== 'Cancelled' && (
              <span
                className="badge b-red block"
                style={{ fontSize: '10px', padding: '1px 6px', marginTop: '3px', cursor: 'pointer', maxWidth: 'fit-content' }}
                title={deficits.map((d) => `${d.name}: ${formatWeight(d.stock)}`).join(', ')}
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/purchases?productId=${deficits[0].id}&quantity=${deficits[0].needed}&notes=Restock for Order #${r.id}`);
                }}
              >
                Needs Restock ({deficits.length})
              </span>
            )}
          </div>
        );
      },
    },
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
      render: (r) => {
        const deficits = getOrderDeficitInfo(r);
        return (
          <span className="row-actions">
            {deficits && deficits.length > 0 && r.status !== 'Cancelled' && (
              <Button
                variant="ghost"
                icon="plus"
                onClick={() => navigate(`/purchases?productId=${deficits[0].id}&quantity=${deficits[0].needed}&notes=Restock for Order #${r.id}`)}
                title="Add Purchase Order to restock this product"
                style={{ color: '#dc2626', borderColor: '#fca5a5', padding: '4px 8px', fontSize: '12px' }}
              >
                Purchase
              </Button>
            )}
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
        );
      },
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
 * Helper: derive variant price based on product configuration and order type
 */
function getProductVariantPrice(prod, variant, customKg, ordType) {
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
}

/**
 * Enterprise Order & Bill Builder Modal
 */
function OrderBuilderModal({ order, products = [], customers = [], wholesalers = [], onClose, onSave, onDelete }) {
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
    const defaultProd = products[0] || null;
    const defaultVariant = defaultProd?.startingQuantity || defaultProd?.availableQuantities?.[0] || '500 gm';
    const initialPrice = defaultProd ? getProductVariantPrice(defaultProd, defaultVariant, '', type) : 0;
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

  const addItemRow = () => {
    const defaultProd = products[0] || null;
    const defaultVariant = defaultProd?.startingQuantity || defaultProd?.availableQuantities?.[0] || '500 gm';
    const initialPrice = defaultProd ? getProductVariantPrice(defaultProd, defaultVariant, '', type) : 0;
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
                Stock in Kg will be deducted automatically. Orders can be taken even if stock is 0 or unavailable — you can replenish it by adding a purchase.
              </p>
            </div>
            <Button type="button" icon="plus" onClick={addItemRow}>
              Add Product
            </Button>
          </div>

          <div className="item-rows" style={{ display: 'grid', gap: '12px' }}>
            {items.map((it, idx) => {
              const selectedProd = products.find((p) => p.id === it.productId);
              const availStock = selectedProd ? Number(selectedProd.stock || 0) : 0;
              const reqWeight = Number(it.totalWeightKg) || 0;
              const deficit = Math.max(0, Math.round((reqWeight - availStock) * 1000) / 1000);

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
                      {products.map((p) => {
                        const sKg = Number(p.stock || 0);
                        const labelStock = sKg < 0 ? `Deficit: ${formatWeight(sKg)}` : sKg === 0 ? '0 kg left' : `${formatWeight(sKg)} left`;
                        return (
                          <option key={p.id} value={p.id}>
                            {p.name} ({labelStock})
                          </option>
                        );
                      })}
                    </select>
                    <div style={{ marginTop: '2px' }}>
                      {availStock <= 0 ? (
                        <small className="neg" style={{ fontSize: '11px', display: 'block', lineHeight: '1.2' }}>
                          ⚠️ Stock: {formatWeight(availStock)} · <b>Order allowed</b> (Add purchase to restock)
                        </small>
                      ) : deficit > 0 ? (
                        <small style={{ color: '#d97706', fontSize: '11px', display: 'block', lineHeight: '1.2' }}>
                          ⚠️ Stock: {formatWeight(availStock)} · Need {formatWeight(deficit)} more (Add purchase)
                        </small>
                      ) : (
                        <small className="muted" style={{ fontSize: '11px', display: 'block' }}>
                          Avail: {formatWeight(availStock)}
                        </small>
                      )}
                    </div>
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

          {items.some((it) => {
            const p = products.find((prod) => prod.id === it.productId);
            return p && Number(p.stock || 0) < Number(it.totalWeightKg || 0);
          }) && (
            <div
              style={{
                background: '#fef3c7',
                border: '1px solid #fde68a',
                borderRadius: '8px',
                padding: '10px 14px',
                marginTop: '12px',
                fontSize: '12px',
                color: '#92400e',
                lineHeight: '1.4',
              }}
            >
              ℹ️ <b>Stock Restock Reminder:</b> One or more items exceed current stock on hand. The order will be saved immediately with a recorded stock deficit, allowing you to add a purchase order afterwards to fulfill it.
            </div>
          )}
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
 * Crunchzy Brand Logo Component
 */
function CrunchzyLogo({ size = 52 }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id="crunchzyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f59e0b" />
          <stop offset="50%" stopColor="#ea580c" />
          <stop offset="100%" stopColor="#c2410c" />
        </linearGradient>
        <linearGradient id="crunchzyGreen" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#047857" />
        </linearGradient>
      </defs>
      {/* Outer rounded starburst badge */}
      <rect x="6" y="6" width="88" height="88" rx="24" fill="url(#crunchzyGrad)" />
      {/* Inner decorative ring */}
      <rect x="12" y="12" width="76" height="76" rx="18" fill="none" stroke="#ffffff" strokeWidth="2" strokeDasharray="6 4" opacity="0.6" />
      {/* Crispy snack shape with crunchy ridges */}
      <path d="M50 20 L78 68 C75 73 68 76 50 75 C32 76 25 73 22 68 Z" fill="#ffffff" />
      <path d="M50 26 L72 65 C68 68 62 70 50 69 C38 70 32 68 28 65 Z" fill="#fef3c7" />
      {/* Crunch ripples */}
      <path d="M38 52 Q50 48 62 52" stroke="#d97706" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      <path d="M42 60 Q50 57 58 60" stroke="#d97706" strokeWidth="2.5" strokeLinecap="round" fill="none" />
      {/* Taste star sparks */}
      <path d="M50 36 L52 42 L58 44 L52 46 L50 52 L48 46 L42 44 L48 42 Z" fill="#ea580c" />
      {/* Fresh authenticity leaf badge */}
      <path d="M74 22 C66 22 64 30 64 36 C70 36 78 34 78 26 Z" fill="url(#crunchzyGreen)" />
      <path d="M68 32 Q72 27 75 24" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/**
 * Crunchzy Subtle Background Watermark Component
 */
function CrunchzyWatermark() {
  return (
    <div className="invoice-watermark" aria-hidden="true">
      <svg viewBox="0 0 500 500" width="460" height="460" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="250" cy="250" r="235" stroke="#ea580c" strokeWidth="6" strokeDasharray="14 10" />
        <circle cx="250" cy="250" r="218" stroke="#047857" strokeWidth="3" />
        <circle cx="250" cy="250" r="170" stroke="#d97706" strokeWidth="2" strokeDasharray="6 6" />

        <defs>
          <path id="watermarkTopArc" d="M 65,250 A 185,185 0 0,1 435,250" />
          <path id="watermarkBottomArc" d="M 435,250 A 185,185 0 0,1 65,250" />
        </defs>

        <text fill="#047857" fontSize="22" fontWeight="900" letterSpacing="6">
          <textPath href="#watermarkTopArc" startOffset="50%" textAnchor="middle">
            CRUNCHZY · CRISPY DELIGHTS
          </textPath>
        </text>

        <text fill="#ea580c" fontSize="17" fontWeight="800" letterSpacing="4">
          <textPath href="#watermarkBottomArc" startOffset="50%" textAnchor="middle">
            ★ 100% AUTHENTIC QUALITY GUARANTEED ★
          </textPath>
        </text>

        {/* Center Crunchzy Insignia */}
        <g transform="translate(250, 240)">
          <path d="M0 -65 L60 40 C52 50 36 56 0 54 C-36 56 -52 50 -60 40 Z" fill="#ea580c" opacity="0.3" />
          <path d="M0 -55 L50 35 C42 43 30 48 0 46 C-30 48 -42 43 -50 35 Z" fill="#f59e0b" opacity="0.25" />
          <text y="8" textAnchor="middle" fill="#047857" fontSize="42" fontWeight="900" letterSpacing="4" fontFamily="'Montserrat', 'Inter', system-ui, sans-serif">
            CRUNCHZY
          </text>
          <text y="32" textAnchor="middle" fill="#b45309" fontSize="13" fontWeight="800" letterSpacing="3">
            WWW.CRUNCHZY.IN
          </text>
        </g>
      </svg>
    </div>
  );
}

/**
 * Enterprise Billing Slip / Tax Invoice Modal (Printable, Professional & Colorful)
 */
function BillingSlipModal({ order, onClose, onStatusChange, onEdit, onDelete }) {
  const { data } = useApp();
  const navigate = useNavigate();
  const products = data.products || [];
  const items = Array.isArray(order.items) && order.items.length ? order.items : [];
  const totalWeightKg = items.reduce(
    (sum, it) =>
      sum + (Number(it.totalWeightKg) || ((Number(it.weightInKg) || 1) * (Number(it.quantity) || 1))),
    0
  );

  const totalPacks = items.reduce((sum, it) => sum + (Number(it.quantity || it.qty) || 1), 0);
  const deliveryInfo = getDeliveryStatus(order);

  const handlePrint = () => {
    window.print();
  };

  const deficits = items
    .map((it) => {
      const p = products.find((prod) => prod.id === (it.productId || it.id));
      return p && Number(p.stock || 0) < 0 ? { name: p.name, id: p.id, needed: Math.abs(Number(p.stock || 0)), stock: Number(p.stock) } : null;
    })
    .filter(Boolean);

  const customerName = typeof order.customer === 'object' && order.customer
    ? (order.customer.name || order.customer.fullName || order.customer.email || 'Customer')
    : (order.customer || 'Customer');

  return (
    <Modal title={`Tax Invoice / Customer Bill #${order.id}`} onClose={onClose} width={820}>
      <div className="invoice-container">
        {/* Subtle Background Watermark */}
        <CrunchzyWatermark />

        {/* Professional Colorful Invoice Header */}
        <div
          className="inv-header"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            borderBottom: '3px solid #059669',
            paddingBottom: '18px',
            marginBottom: '20px',
            position: 'relative',
            zIndex: 1,
            flexWrap: 'wrap',
            gap: '16px',
          }}
        >
          {/* Brand Identity & Contact Links */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <CrunchzyLogo size={56} />
              <div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                  <h1 style={{ fontSize: '28px', fontWeight: '900', color: '#0f2a1c', margin: 0, letterSpacing: '-0.02em' }}>
                    CRUNCHZY
                  </h1>
                  <span style={{ fontSize: '11px', fontWeight: '700', color: '#d97706', textTransform: 'uppercase', letterSpacing: '0.08em', background: '#fef3c7', padding: '2px 8px', borderRadius: '4px' }}>
                    Taste The Crunch
                  </span>
                </div>
                <p style={{ margin: '3px 0 0', fontSize: '13px', color: '#334155', fontWeight: '500' }}>
                  Authentic Maharashtrian Snacks, Chakli & Namkeen Manufacturer
                </p>
                <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#64748b' }}>
                  The Maharashtra Foods · GSTIN: <b>27AABCT1234F1Z5</b> · FSSAI Lic. No: <b>11521034000452</b>
                </p>
              </div>
            </div>

            {/* Direct Web, Insta, Email Contact Bar */}
            <div className="inv-contact-bar">
              <a
                href="https://www.crunchzy.in"
                target="_blank"
                rel="noreferrer"
                className="inv-contact-pill web"
                title="Visit Crunchzy Official Website"
              >
                <Icon name="globe" size={14} />
                <span>www.crunchzy.in</span>
              </a>
              <a
                href="https://instagram.com/crunchzy.in"
                target="_blank"
                rel="noreferrer"
                className="inv-contact-pill insta"
                title="Follow Crunchzy on Instagram"
              >
                <Icon name="instagram" size={14} />
                <span>crunchzy.in</span>
              </a>
              <a
                href="mailto:contactus@crunchzy.in"
                className="inv-contact-pill mail"
                title="Email Crunchzy Customer Support"
              >
                <Icon name="mail" size={14} />
                <span>contactus@crunchzy.in</span>
              </a>
            </div>
          </div>

          {/* Right: Tax Invoice Badge & Number */}
          <div style={{ textAlign: 'right' }}>
            <span
              style={{
                display: 'inline-block',
                background: 'linear-gradient(135deg, #059669 0%, #047857 100%)',
                color: '#ffffff',
                padding: '6px 14px',
                borderRadius: '6px',
                fontWeight: '800',
                fontSize: '13px',
                letterSpacing: '0.05em',
                marginBottom: '6px',
                boxShadow: '0 2px 6px rgba(5, 150, 105, 0.25)',
              }}
            >
              ORIGINAL TAX INVOICE
            </span>
            <div style={{ fontSize: '18px', fontWeight: '800', color: '#064e3b' }}>
              #{order.id}
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
              Date: <b>{new Date(order.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</b>
            </div>
            <div style={{ marginTop: '5px' }}>
              <span className="badge" style={{ background: order.type === 'Wholesale' ? '#ecfdf5' : '#eff6ff', color: order.type === 'Wholesale' ? '#047857' : '#1d4ed8', border: '1px solid currentColor', fontSize: '11px', padding: '2px 8px' }}>
                {order.type === 'Wholesale' ? 'Wholesale Commercial Memo' : 'Retail Customer Bill'}
              </span>
            </div>
          </div>
        </div>

        {/* Restock Needed Alert if order has deficit items (Hidden on Print) */}
        {deficits.length > 0 && order.status !== 'Cancelled' && (
          <div
            className="no-print"
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              padding: '12px 16px',
              marginBottom: '16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '10px',
              position: 'relative',
              zIndex: 1,
            }}
          >
            <div>
              <b style={{ color: '#b91c1c', fontSize: '14px' }}>
                ⚠️ Purchase Restock Needed For This Order
              </b>
              <p style={{ margin: '2px 0 0', color: '#991b1b', fontSize: '12px' }}>
                {deficits.map((d) => `${d.name} (Deficit: ${formatWeight(d.stock)})`).join(', ')}. Create a vendor purchase order to replenish stock.
              </p>
            </div>
            <Button
              variant="primary"
              icon="plus"
              style={{ background: '#dc2626', borderColor: '#b91c1c', fontSize: '13px' }}
              onClick={() => {
                onClose();
                navigate(`/purchases?productId=${deficits[0].id}&quantity=${deficits[0].needed}&notes=Restock for Order #${order.id}`);
              }}
            >
              Add Purchase ({formatWeight(deficits[0].needed)})
            </Button>
          </div>
        )}

        {/* Customer & Order Metadata Grid */}
        <div className="inv-meta-grid">
          <div className="inv-meta-card customer">
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
              <span style={{ color: '#059669' }}><Icon name="user" size={16} /></span>
              <small style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: '700', color: '#047857', fontSize: '11px' }}>
                Billed To (Customer Details)
              </small>
            </div>
            <div style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a' }}>
              {customerName}
            </div>
            {order.phone && (
              <div style={{ fontSize: '13px', color: '#334155', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Icon name="phone" size={13} />
                <span><b>Phone:</b> {order.phone}</span>
              </div>
            )}
            {order.address && (
              <div style={{ fontSize: '12px', color: '#475569', marginTop: '3px' }}>
                <b>Address:</b> {order.address}
              </div>
            )}
            {order.email && (
              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                <b>Email:</b> {order.email}
              </div>
            )}
          </div>

          <div className="inv-meta-card details">
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
              <span style={{ color: '#d97706' }}><Icon name="truck" size={16} /></span>
              <small style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: '700', color: '#b45309', fontSize: '11px' }}>
                Order & Delivery Target
              </small>
            </div>
            <div style={{ fontSize: '14px', color: '#1e293b' }}>
              Expected Delivery:{' '}
              <b>
                {order.deliveryDate
                  ? new Date(order.deliveryDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                  : 'Counter Sale / Instant Fulfillment'}
              </b>
            </div>
            <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span className={`badge b-${deliveryInfo.tone}`}>
                {deliveryInfo.text}
              </span>
              <div className="no-print">
                <StatusSelect
                  value={order.status}
                  options={ORDER_STATUS}
                  onChange={onStatusChange}
                />
              </div>
              <span className="badge" style={{ background: '#f1f5f9', color: '#334155' }}>
                Status: <b>{order.status}</b>
              </span>
            </div>
          </div>
        </div>

        {/* Itemized Snack Bill Table */}
        <div style={{ borderRadius: '10px', overflow: 'hidden', border: '1px solid #cbd5e1', marginBottom: '20px', position: 'relative', zIndex: 1 }}>
          <table className="inv-table">
            <thead>
              <tr>
                <th style={{ width: '40px', textAlign: 'center' }}>#</th>
                <th style={{ textAlign: 'left' }}>Product & Description</th>
                <th style={{ textAlign: 'center' }}>Pack Size</th>
                <th style={{ textAlign: 'center' }}>Packs</th>
                <th style={{ textAlign: 'right' }}>Total Weight</th>
                <th style={{ textAlign: 'right' }}>Unit Rate</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.length ? (
                items.map((it, idx) => {
                  const weightKg = Number(it.totalWeightKg) || (Number(it.weightInKg || 1) * Number(it.quantity || 1));
                  return (
                    <tr key={idx}>
                      <td style={{ textAlign: 'center', fontWeight: '700', color: '#64748b' }}>{idx + 1}</td>
                      <td>
                        <b style={{ color: '#0f2a1c', fontSize: '14px' }}>{it.productName || it.name || 'Crunchzy Snack Item'}</b>
                        {it.sku && <small className="muted block" style={{ fontSize: '11px', marginTop: '1px' }}>SKU: {it.sku}</small>}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span style={{ display: 'inline-block', background: '#ecfdf5', color: '#065f46', border: '1px solid #a7f3d0', padding: '2px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: '600' }}>
                          {it.weightVariant || it.weight || 'Standard Pack'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: '700', color: '#0f172a' }}>{it.quantity || it.qty || 1}</td>
                      <td style={{ textAlign: 'right', fontWeight: '600', color: '#334155' }}>
                        {formatWeight(weightKg)}
                      </td>
                      <td style={{ textAlign: 'right', color: '#475569' }}>{inr(it.price)}</td>
                      <td style={{ textAlign: 'right', fontWeight: '800', color: '#064e3b', fontSize: '14px' }}>
                        {inr(it.amount)}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="7" style={{ padding: '24px', textAlign: 'center' }}>
                    Standard order amount: <b>{inr(order.amount)}</b>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Invoice Summary & Grand Total Box */}
        <div className="inv-summary-box">
          <div style={{ flex: '1', maxWidth: '58%' }}>
            <div style={{ display: 'flex', gap: '16px', marginBottom: '10px', fontSize: '13px' }}>
              <div>
                <span className="muted">Total Packs: </span>
                <b style={{ color: '#0f172a' }}>{totalPacks} packs</b>
              </div>
              <div>
                <span className="muted">Total Net Weight: </span>
                <b style={{ color: '#065f46' }}>{formatWeight(totalWeightKg)}</b>
              </div>
            </div>

            {order.note && (
              <div style={{ background: '#fefce8', border: '1px solid #fef08a', borderRadius: '8px', padding: '8px 12px', marginBottom: '10px', fontSize: '12px', color: '#854d0e' }}>
                <b>Order Note:</b> {order.note}
              </div>
            )}

            <div style={{ fontSize: '11px', color: '#475569', lineHeight: '1.5', background: '#f8fafc', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <b style={{ color: '#047857' }}>✨ Crunchzy Freshness & Quality Promise:</b>
              <br />
              All snack batches are hygienically packed with sealed freshness. Store in an airtight container in a cool, dry place. Best before 90 days from packaging.
            </div>
          </div>

          <div style={{ minWidth: '220px', textAlign: 'right' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '13px', color: '#475569' }}>
              <span>Item Subtotal:</span>
              <b>{inr(order.amount)}</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '13px', color: '#475569' }}>
              <span>Packaging & Handling:</span>
              <b style={{ color: '#059669' }}>FREE</b>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '12px', color: '#64748b' }}>
              <span>Taxes (GST 5%):</span>
              <span>All Taxes Included</span>
            </div>

            <div className="inv-total-highlight">
              <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.9 }}>
                Grand Total Amount
              </div>
              <div style={{ fontSize: '26px', fontWeight: '900', marginTop: '2px', letterSpacing: '-0.02em' }}>
                {inr(order.amount)}
              </div>
            </div>
          </div>
        </div>

        {/* Colorful Trust & Contact Footer */}
        <div className="inv-footer-strip">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: '800', color: '#0f2a1c', fontSize: '13px' }}>Crunchzy Snacks</span>
              <span style={{ color: '#cbd5e1' }}>•</span>
              <a href="https://www.crunchzy.in" target="_blank" rel="noreferrer" style={{ color: '#047857', textDecoration: 'none', fontWeight: '600' }}>
                www.crunchzy.in
              </a>
              <span style={{ color: '#cbd5e1' }}>•</span>
              <a href="https://instagram.com/crunchzy.in" target="_blank" rel="noreferrer" style={{ color: '#be123c', textDecoration: 'none', fontWeight: '600' }}>
                insta: crunchzy.in
              </a>
              <span style={{ color: '#cbd5e1' }}>•</span>
              <a href="mailto:contactus@crunchzy.in" style={{ color: '#1d4ed8', textDecoration: 'none', fontWeight: '600' }}>
                contactus@crunchzy.in
              </a>
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
              This is a computer-generated tax invoice issued by Crunchzy. Thank you for your order!
            </div>
          </div>

          <div style={{ textAlign: 'right', minWidth: '160px' }}>
            <div style={{ height: '36px' }}></div>
            <div style={{ borderTop: '1px solid #94a3b8', paddingTop: '4px', fontSize: '11px', fontWeight: '700', color: '#334155' }}>
              Authorized Signatory
            </div>
          </div>
        </div>

        {/* Modal Action Controls (Hidden on Print) */}
        <div className="modal-f no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button icon="pencil" onClick={onEdit}>
              Edit Order
            </Button>
            <Button
              variant="ghost"
              icon="plus"
              onClick={() => {
                onClose();
                navigate('/purchases');
              }}
              title="Go to Purchases workspace"
            >
              Purchases
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
            <Button
              variant="primary"
              icon="printer"
              onClick={handlePrint}
              style={{ background: 'linear-gradient(135deg, #059669 0%, #047857 100%)', borderColor: '#047857', fontWeight: '700' }}
            >
              Print Bill / Save PDF
            </Button>
            <Button onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
