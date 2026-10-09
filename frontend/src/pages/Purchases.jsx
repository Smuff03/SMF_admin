import ResourcePage from './ResourcePage.jsx';
import { Badge, StatusSelect } from '../components/ui.jsx';
import { PO_STATUS, inr, when } from '../utils.js';

const columns = [
  { label: 'PO', render: (r) => <b>#{r.id}</b> },
  { label: 'Supplier', key: 'supplier' },
  { label: 'Product', key: 'productName' },
  { label: 'Qty', key: 'quantity' },
  { label: 'Unit cost', render: (r) => inr(r.unitCost) },
  { label: 'Amount', render: (r) => <b>{inr(r.amount)}</b> },
  { label: 'Status', render: (r, c) => (r.status === 'Ordered'
    ? <StatusSelect value={r.status} options={PO_STATUS} onChange={(status) => c.update(r, { status }, status === 'Received' ? 'Stock received and added to inventory' : 'Purchase updated')} />
    : <Badge>{r.status}</Badge>) },
  { label: 'Date', render: (r) => <span className="muted">{when(r.createdAt)}</span> },
];

const fields = ({ suppliers = [], products = [] }) => [
  { name: 'supplier', label: 'Supplier', type: 'select', full: true, options: suppliers.filter((s) => s.status === 'Active').map((s) => s.name) },
  { name: 'productId', label: 'Product', type: 'select', full: true, options: products.map((p) => ({ value: p.id, label: p.name })) },
  { name: 'quantity', label: 'Quantity', type: 'number', min: 1, step: '1', required: true },
  { name: 'unitCost', label: 'Unit cost (₹)', type: 'number', min: 0, step: '0.01', required: true },
  { name: 'status', label: 'Status', type: 'select', options: PO_STATUS, default: 'Ordered', hint: 'Marking as Received adds stock and locks the purchase.' },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];

export default function Purchases() {
  return (
    <ResourcePage resource="purchases" eyebrow="WORKSPACE / PURCHASES" title="Purchases" subtitle="Raw material and stock purchase orders from your suppliers."
      addLabel="Add purchase" noun="purchase" countNoun="purchases" columns={columns} fields={fields} lookups={['suppliers', 'products']}
      searchKeys={['id', 'supplier', 'productName']} placeholder="Search purchases…" canEdit={(r) => r.status === 'Ordered'}
      tabs={{ options: PO_STATUS, test: (r, t) => r.status === t }} />
  );
}
