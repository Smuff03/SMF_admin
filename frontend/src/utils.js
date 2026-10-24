export const LOW_STOCK = 25;
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

export const WEIGHT_VARIANTS = [
  { label: '200 gm', value: '200 gm', kg: 0.2 },
  { label: '250 gm', value: '250 gm', kg: 0.25 },
  { label: '500 gm (1/2 kg)', value: '500 gm', kg: 0.5 },
  { label: '1 kg', value: '1 kg', kg: 1.0 },
  { label: '2 kg', value: '2 kg', kg: 2.0 },
  { label: '5 kg', value: '5 kg', kg: 5.0 },
  { label: '10 kg (Bulk)', value: '10 kg', kg: 10.0 },
  { label: '25 kg (Bori)', value: '25 kg', kg: 25.0 },
  { label: 'Custom weight', value: 'Custom', kg: 0 },
];

export function parseWeightKg(variant, customKg) {
  if (variant === 'Custom') return Math.max(0, Number(customKg) || 0);
  const found = WEIGHT_VARIANTS.find((v) => v.value === variant);
  if (found && found.kg > 0) return found.kg;
  const s = String(variant || '').toLowerCase().trim();
  if (s.includes('1/2') || s === '500 gm' || s === '500g') return 0.5;
  if (s.includes('200')) return 0.2;
  if (s.includes('250')) return 0.25;
  if (s.includes('1 kg') || s === '1kg') return 1.0;
  if (s.includes('2 kg') || s === '2kg') return 2.0;
  if (s.includes('5 kg') || s === '5kg') return 5.0;
  const num = parseFloat(s);
  if (s.includes('gm') || s.includes('g')) return (num || 0) / 1000;
  if (s.includes('kg')) return num || 0;
  return Number(customKg || num || 1);
}

export function formatWeight(kg) {
  const n = Number(kg || 0);
  if (n <= 0) return '0 kg';
  if (n >= 1) {
    const whole = Math.floor(n);
    const grams = Math.round((n - whole) * 1000);
    if (grams === 0) return `${whole} kg`;
    return `${whole} kg ${grams} gm`;
  }
  return `${Math.round(n * 1000)} gm`;
}

export function formatWeightShort(kg) {
  const n = Number(kg || 0);
  if (n <= 0) return '0 kg';
  if (n % 1 === 0) return `${n} kg`;
  return `${Number(n.toFixed(2))} kg`;
}

export function getDeliveryStatus(order) {
  const { status, deliveryDate, deliveredAt } = order || {};
  if (status === 'Cancelled') return { label: 'Cancelled', tone: 'gray', text: 'Cancelled' };
  if (!deliveryDate) return { label: 'No schedule', tone: 'gray', text: 'Not set' };

  const parts = String(deliveryDate).split('-');
  const target = new Date(Number(parts[0]), Number(parts[1] || 1) - 1, Number(parts[2] || 1), 23, 59, 59).getTime();
  const formattedDate = new Date(deliveryDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

  if (status === 'Delivered') {
    const deliveredTime = deliveredAt ? new Date(deliveredAt).getTime() : Date.now();
    if (deliveredTime <= target) {
      return { label: 'On Time', tone: 'green', text: `Delivered on time (${formattedDate})`, onTime: true };
    }
    return { label: 'Late', tone: 'amber', text: `Delivered late (${formattedDate})`, onTime: false };
  }

  const now = Date.now();
  if (now > target) {
    const daysLate = Math.max(1, Math.floor((now - target) / 864e5));
    return { label: 'Overdue', tone: 'red', text: `Overdue by ${daysLate}d (${formattedDate})`, overdue: true };
  }

  const daysLeft = Math.ceil((target - now) / 864e5);
  if (daysLeft === 0) return { label: 'Due Today', tone: 'amber', text: `Due today (${formattedDate})`, dueToday: true };
  if (daysLeft === 1) return { label: 'Due Tomorrow', tone: 'blue', text: `Due tomorrow (${formattedDate})` };
  return { label: 'On Track', tone: 'green', text: `Expected: ${formattedDate} (${daysLeft}d left)` };
}

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
