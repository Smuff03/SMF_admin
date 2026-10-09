import ResourcePage from './ResourcePage.jsx';
import { Badge, StatusSelect } from '../components/ui.jsx';
import { ORDER_STATUS, inr, when } from '../utils.js';

const columns = [
  { label: 'Order', render: (r) => <b>#{r.id}</b> },
  { label: 'Customer', key: 'customer' },
  { label: 'Type', render: (r) => <Badge>{r.type}</Badge> },
  { label: 'Amount', render: (r) => <b>{inr(r.amount)}</b> },
  { label: 'Status', render: (r, c) => <StatusSelect value={r.status} options={ORDER_STATUS} onChange={(status) => c.update(r, { status }, 'Order status updated')} /> },
  { label: 'When', render: (r) => <span className="muted">{when(r.createdAt)}</span> },
];

const fields = ({ customers = [], wholesalers = [] }) => [
  { name: 'customer', label: 'Customer', required: true, full: true, list: [...customers, ...wholesalers].map((c) => c.name), placeholder: 'Type or pick a customer' },
  { name: 'type', label: 'Order type', type: 'select', options: ['Retail', 'Wholesale'] },
  { name: 'amount', label: 'Amount (₹)', type: 'number', min: 0, step: '0.01', required: true },
  { name: 'status', label: 'Status', type: 'select', options: ORDER_STATUS, default: 'Pending' },
  { name: 'note', label: 'Note', type: 'textarea', placeholder: 'Delivery instructions, items, etc.' },
];

export default function Orders() {
  return (
    <ResourcePage resource="orders" eyebrow="WORKSPACE / ORDERS" title="Orders" subtitle="Track retail and wholesale fulfilment from pending to delivered."
      addLabel="Add order" noun="order" countNoun="orders" columns={columns} fields={fields} lookups={['customers', 'wholesalers']}
      searchKeys={['id', 'customer', 'type']} placeholder="Search orders or customers…"
      tabs={{ options: ORDER_STATUS, test: (r, t) => r.status === t }}
      filters={[{ key: 'type', label: 'All types', options: [{ value: 'Retail', label: 'Retail' }, { value: 'Wholesale', label: 'Wholesale' }], test: (r, v) => r.type === v }]} />
  );
}
