import ResourcePage from './ResourcePage.jsx';
import { Badge } from '../components/ui.jsx';
import { when } from '../utils.js';

const ENTITIES = ['Order', 'Product', 'Inventory', 'Purchase', 'Supplier', 'Customer', 'Wholesaler'];

export default function AuditLogs() {
  return (
    <ResourcePage resource="audit-logs" eyebrow="WORKSPACE / AUDIT LOGS" title="Audit Logs" subtitle="Every create, update and delete across the workspace." immutable
      noun="log" countNoun="log entries" searchKeys={['detail', 'entity', 'user']} placeholder="Search activity…"
      filters={[
        { key: 'entity', label: 'All modules', options: ENTITIES.map((v) => ({ value: v, label: v })), test: (r, v) => r.entity === v },
        { key: 'action', label: 'Any action', panel: true, options: ['Created', 'Updated', 'Deleted'].map((v) => ({ value: v, label: v })), test: (r, v) => r.action === v },
      ]}
      columns={[
        { label: 'When', render: (r) => <span className="muted">{when(r.createdAt)}</span> },
        { label: 'User', render: (r) => <b>{r.user}</b> },
        { label: 'Action', render: (r) => <Badge>{r.action}</Badge> },
        { label: 'Module', key: 'entity' },
        { label: 'Details', key: 'detail' },
      ]}
      fields={() => []} />
  );
}
