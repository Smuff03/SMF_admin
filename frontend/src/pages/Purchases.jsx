import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import ResourcePage from './ResourcePage.jsx';
import { Badge, Button, StatusSelect } from '../components/ui.jsx';
import { PO_STATUS, formatWeight, inr, when } from '../utils.js';

const columns = [
  { label: 'PO #', render: (r) => <b>#{r.id}</b> },
  { label: 'Supplier', key: 'supplier' },
  { label: 'Product', key: 'productName' },
  { label: 'Quantity (Kg)', render: (r) => <b>{formatWeight(r.quantity)}</b> },
  { label: 'Cost / Kg', render: (r) => inr(r.unitCost) },
  { label: 'Total Amount', render: (r) => <b>{inr(r.amount)}</b> },
  { label: 'Status', render: (r, c) => (r.status === 'Ordered'
    ? <StatusSelect value={r.status} options={PO_STATUS} onChange={(status) => c.update(r, { status }, status === 'Received' ? 'Stock received: Quantity (Kg) added to Inventory & Customer Store' : 'Purchase updated')} />
    : <Badge>{r.status}</Badge>) },
  { label: 'Date', render: (r) => <span className="muted">{when(r.createdAt)}</span> },
];

const fields = ({ suppliers = [], products = [] }) => [
  { name: 'supplier', label: 'Supplier', type: 'select', full: true, options: suppliers.filter((s) => s.status === 'Active').map((s) => s.name) },
  {
    name: 'productId',
    label: 'Product',
    type: 'select',
    full: true,
    options: products.map((p) => {
      const stockKg = Number(p.stock || 0);
      let stockNote = `Stock: ${formatWeight(stockKg)}`;
      if (stockKg < 0) stockNote = `⚠️ Deficit: ${formatWeight(stockKg)} · Needs Restock`;
      else if (stockKg === 0) stockNote = `⚠️ 0 kg · Out of stock`;
      return { value: p.id, label: `${p.name} (${stockNote})` };
    }),
  },
  { name: 'quantity', label: 'Quantity (in Kg)', type: 'number', min: 0.1, step: '0.1', required: true, hint: 'Enter batch weight in Kg. Marking as Received increases stock, clears order deficits, and reflects in store.' },
  { name: 'unitCost', label: 'Unit cost per Kg (₹)', type: 'number', min: 0, step: '0.01', required: true, hint: 'Vendor purchase cost per Kg. Automatically sets the product cost price and profit margins across the store.' },
  { name: 'status', label: 'Status', type: 'select', options: PO_STATUS, default: 'Ordered', hint: 'Marking as Received adds stock (Kg) to inventory and locks the purchase order.' },
  { name: 'notes', label: 'Notes & Invoice Ref', type: 'textarea', placeholder: 'Vendor bill number, batch code, order replenishment details…' },
];

function PurchasesOverview({ look, openCreate }) {
  const products = look.products || [];
  const deficitProducts = products.filter((p) => Number(p.stock || 0) < 0);
  const outOfStockProducts = products.filter((p) => Number(p.stock || 0) === 0 && p.active);

  if (!deficitProducts.length && !outOfStockProducts.length) return null;

  return (
    <div className="card pad mb" style={{ background: '#fffbeb', border: '1px solid #fde68a' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <b style={{ color: '#92400e', fontSize: '15px' }}>
            ⚠️ Restock Needed for Order Fulfillment & Inventory
          </b>
          <p className="sub" style={{ margin: '2px 0 0', color: '#b45309', fontSize: '13px' }}>
            {deficitProducts.length > 0
              ? `${deficitProducts.length} product(s) have negative stock balances from accepted orders. Click below to add a purchase order.`
              : `${outOfStockProducts.length} product(s) currently have 0 kg stock. Plan a purchase order to maintain inventory.`}
          </p>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
        {deficitProducts.map((p) => {
          const neededKg = Math.abs(Number(p.stock || 0));
          return (
            <button
              key={p.id}
              type="button"
              className="btn"
              style={{
                fontSize: '12px',
                padding: '5px 12px',
                background: '#dc2626',
                color: '#fff',
                borderRadius: '6px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                border: 'none',
                cursor: 'pointer',
                fontWeight: '600',
              }}
              onClick={() =>
                openCreate?.({
                  productId: p.id,
                  quantity: neededKg,
                  notes: `Restock to cover customer order deficit (${neededKg} kg)`,
                  status: 'Ordered',
                })
              }
            >
              <span>+ Purchase <b>{p.name}</b> (Deficit: {formatWeight(p.stock)})</span>
            </button>
          );
        })}
        {outOfStockProducts.slice(0, 4).map((p) => (
          <button
            key={p.id}
            type="button"
            className="btn"
            style={{
              fontSize: '12px',
              padding: '5px 12px',
              background: '#f59e0b',
              color: '#fff',
              borderRadius: '6px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              border: 'none',
              cursor: 'pointer',
              fontWeight: '600',
            }}
            onClick={() =>
              openCreate?.({
                productId: p.id,
                quantity: 10,
                notes: `Restock out-of-stock item: ${p.name}`,
                status: 'Ordered',
              })
            }
          >
            <span>+ Restock <b>{p.name}</b> (0 kg on hand)</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Purchases() {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const paramProductId = searchParams.get('productId');
  const paramQuantity = searchParams.get('quantity');
  const paramNotes = searchParams.get('notes');

  const initialModal = useMemo(() => {
    if (paramProductId) {
      return {
        row: null,
        initial: {
          productId: paramProductId,
          quantity: paramQuantity || '',
          notes: paramNotes || '',
          status: 'Ordered',
        },
      };
    }
    return null;
  }, [paramProductId, paramQuantity, paramNotes]);

  return (
    <ResourcePage
      resource="purchases"
      eyebrow="WORKSPACE / PURCHASES"
      title="Purchases"
      subtitle="Vendor purchase orders. Received quantities (in Kg) replenish inventory, clear order deficits, and update customer store."
      addLabel="Add purchase order"
      noun="purchase"
      countNoun="purchases"
      columns={columns}
      fields={fields}
      lookups={['suppliers', 'products']}
      searchKeys={['id', 'supplier', 'productName']}
      placeholder="Search purchases…"
      canEdit={(r) => r.status === 'Ordered'}
      tabs={{ options: PO_STATUS, test: (r, t) => r.status === t }}
      above={(props) => <PurchasesOverview {...props} />}
      initialModal={initialModal}
    />
  );
}
