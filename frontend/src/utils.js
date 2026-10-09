export const CATEGORIES = ['Bhajani Chakli', 'Chivda', 'Namkeen', 'Farsan', 'Sweets', 'Papad'];
export const ORDER_STATUS = ['Pending', 'Processing', 'Dispatched', 'Delivered', 'Cancelled'];
export const PO_STATUS = ['Ordered', 'Received', 'Cancelled'];
export const TONE = {
  Pending: 'gray', Processing: 'amber', Dispatched: 'blue', Delivered: 'green', Cancelled: 'red',
  Ordered: 'amber', Received: 'green',
  Wholesale: 'green', Retail: 'blue',
  Active: 'green', Inactive: 'gray', 'On hold': 'red',
  Created: 'green', Updated: 'blue', Deleted: 'red',
  'Stock in': 'green', 'Stock out': 'amber', Adjustment: 'blue',
  Critical: 'red', Low: 'amber', Healthy: 'green',
};

export const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
export const compact = (n) =>
  n >= 1e5 ? `₹${(n / 1e5).toFixed(2)}L` : n >= 1e3 ? `₹${+(n / 1e3).toFixed(1)}k` : `₹${Math.round(n)}`;
export const kfmt = (v) => `₹${+(v / 1000).toFixed(1)}k`;
export const initial = (s) => (s || '?').trim()[0].toUpperCase();
export const stockLevel = (stock, low) => (stock <= low / 2 ? 'Critical' : stock <= low ? 'Low' : 'Healthy');

export function when(iso) {
  const d = new Date(iso);
  const n = new Date();
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase();
  const dayDiff = Math.round((new Date(n.toDateString()) - new Date(d.toDateString())) / 864e5);
  if (dayDiff === 0) return `Today, ${time}`;
  if (dayDiff === 1) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}, ${time}`;
}

export const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

export function downloadCsv(name, rows) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const text = [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}
