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
  { name: 'productId', label: 'Product', type: 'select', full: true, options: products.map((p) => ({ value: p.id, label: `${p.name} (Current: ${formatWeight(p.stock)})` })) },
  { name: 'quantity', label: 'Quantity (in Kg)', type: 'number', min: 0.1, step: '0.1', required: true, hint: 'Enter batch weight in Kg. Marking as Received increases stock and reflects in customer portal.' },
  { name: 'unitCost', label: 'Unit cost per Kg (₹)', type: 'number', min: 0, step: '0.01', required: true, hint: 'Vendor purchase cost per Kg. Automatically sets the product cost price and profit margins across the store.' },
  { name: 'status', label: 'Status', type: 'select', options: PO_STATUS, default: 'Ordered', hint: 'Marking as Received adds stock (Kg) to inventory and locks the purchase order.' },
  { name: 'notes', label: 'Notes & Invoice Ref', type: 'textarea', placeholder: 'Vendor bill number, batch code, vehicle details…' },
];

export default function Purchases() {
  return (
    <ResourcePage resource="purchases" eyebrow="WORKSPACE / PURCHASES" title="Purchases" subtitle="Vendor purchase orders. Received quantities (in Kg) replenish inventory and update the customer portal."
      addLabel="Add purchase order" noun="purchase" countNoun="purchases" columns={columns} fields={fields} lookups={['suppliers', 'products']}
      searchKeys={['id', 'supplier', 'productName']} placeholder="Search purchases…" canEdit={(r) => r.status === 'Ordered'}
      tabs={{ options: PO_STATUS, test: (r, t) => r.status === t }} />
  );
}
