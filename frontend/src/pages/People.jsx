import ResourcePage from './ResourcePage.jsx';
import { Badge, Muted, Tile } from '../components/ui.jsx';
import { initial, inr } from '../utils.js';

const who = (r, sub) => <div className="cell"><Tile>{initial(r.name)}</Tile><div><b>{r.name}</b><small className="muted">{sub}</small></div></div>;
const or = (v) => v || <Muted>Not set</Muted>;
const statusFilter = (options) => [{ key: 'status', label: 'All statuses', options: options.map((v) => ({ value: v, label: v })), test: (r, v) => r.status === v }];

export function Suppliers() {
  return (
    <ResourcePage resource="suppliers" eyebrow="WORKSPACE / SUPPLIERS" title="Suppliers" subtitle="Vendors who supply your ingredients, oil, spices and packaging."
      addLabel="Add supplier" noun="supplier" countNoun="suppliers" searchKeys={['name', 'contact', 'city', 'supplies']} placeholder="Search suppliers…"
      filters={statusFilter(['Active', 'Inactive'])}
      columns={[
        { label: 'Supplier', render: (r) => who(r, r.city || 'No city') },
        { label: 'Contact', render: (r) => <div><b className="plain">{or(r.contact)}</b><small className="muted block">{r.phone}</small></div> },
        { label: 'Supplies', render: (r) => or(r.supplies) },
        { label: 'Purchased', render: (r) => <div><b>{inr(r.totalPurchased)}</b><small className="muted block">{r.purchases} orders</small></div> },
        { label: 'Status', render: (r) => <Badge>{r.status}</Badge> },
      ]}
      fields={() => [
        { name: 'name', label: 'Supplier name', required: true, full: true }, { name: 'contact', label: 'Contact person' }, { name: 'phone', label: 'Phone' },
        { name: 'email', label: 'Email', type: 'email' }, { name: 'city', label: 'City' }, { name: 'supplies', label: 'What they supply', full: true },
        { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'] },
      ]} />
  );
}

export function Customers() {
  return (
    <ResourcePage resource="customers" eyebrow="WORKSPACE / CUSTOMERS" title="Customers" subtitle="Retail customers and their order history."
      addLabel="Add customer" noun="customer" countNoun="customers" searchKeys={['name', 'phone', 'email', 'city']} placeholder="Search customers…"
      columns={[
        { label: 'Customer', render: (r) => who(r, r.email || 'No email') },
        { label: 'Phone', render: (r) => or(r.phone) },
        { label: 'City', render: (r) => or(r.city) },
        { label: 'Orders', key: 'orders' },
        { label: 'Total spend', render: (r) => <b>{inr(r.totalSpent)}</b> },
      ]}
      fields={() => [
        { name: 'name', label: 'Full name', required: true, full: true }, { name: 'phone', label: 'Phone' }, { name: 'city', label: 'City' },
        { name: 'email', label: 'Email', type: 'email', full: true },
      ]} />
  );
}

export function Wholesalers() {
  return (
    <ResourcePage resource="wholesalers" eyebrow="WORKSPACE / WHOLESALERS" title="Wholesalers" subtitle="Trade accounts, credit limits and outstanding balances."
      addLabel="Add wholesaler" noun="wholesaler" countNoun="wholesalers" searchKeys={['name', 'contact', 'city', 'gstin']} placeholder="Search wholesalers…"
      filters={statusFilter(['Active', 'On hold'])}
      columns={[
        { label: 'Business', render: (r) => who(r, r.city || 'No city') },
        { label: 'Contact', render: (r) => <div><b className="plain">{or(r.contact)}</b><small className="muted block">{r.phone}</small></div> },
        { label: 'GSTIN', render: (r) => or(r.gstin) },
        { label: 'Credit used', render: (r) => {
          const used = r.creditLimit ? Math.min(100, (r.outstanding / r.creditLimit) * 100) : 0;
          return <div className="credit"><b className={used > 80 ? 'low' : 'plain'}>{inr(r.outstanding)}</b><small className="muted block">of {inr(r.creditLimit)}</small><div className="bar"><i style={{ width: `${used}%`, background: used > 80 ? '#dc2626' : '#22c55e' }} /></div></div>;
        } },
        { label: 'Orders', key: 'orders' },
        { label: 'Status', render: (r) => <Badge>{r.status}</Badge> },
      ]}
      fields={() => [
        { name: 'name', label: 'Business name', required: true, full: true }, { name: 'contact', label: 'Contact person' }, { name: 'phone', label: 'Phone' },
        { name: 'city', label: 'City' }, { name: 'gstin', label: 'GSTIN' }, { name: 'creditLimit', label: 'Credit limit (₹)', type: 'number', min: 0, default: '0' },
        { name: 'outstanding', label: 'Outstanding (₹)', type: 'number', min: 0, default: '0' }, { name: 'status', label: 'Status', type: 'select', options: ['Active', 'On hold'] },
      ]} />
  );
}
