const at = (daysAgo, h, m) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const CATALOGUE = {
  'Bhajani Chakli': ['BHA', [['Bhajani chakali Special', 12], ['Mini bhajani chakali', 18], ['Garlic Mini bhajani chakali', 24], ['Methi Mini bhajani chakali', 15], ['Spicy bhajani chakali', 62]]],
  Chivda: ['CHI', [['Poha Chivda', 84], ['Makai Chivda', 56], ['Diet Chivda', 41], ['Bhadang Chivda', 70], ['Cornflakes Chivda', 38]]],
  Namkeen: ['NAM', [['Ratlami Sev', 96], ['Nylon Sev', 72], ['Khara Boondi', 64], ['Aloo Bhujia', 120], ['Moong Dal', 48]]],
  Farsan: ['FAR', [['Kothimbir Vadi', 33], ['Khakhra Methi', 45], ['Farali Chivda', 52], ['Sabudana Chakli', 28]]],
  Sweets: ['SWE', [['Besan Laddoo', 40], ['Rava Laddoo', 35], ['Shankarpali', 58], ['Karanji', 27], ['Anarsa', 31]]],
  Papad: ['PAP', [['Urad Papad', 110], ['Nachni Papad', 66], ['Sabudana Papad', 90], ['Rice Papad', 54]]],
};

const products = [];
for (const [category, [prefix, items]] of Object.entries(CATALOGUE)) {
  items.forEach(([name, stock], i) => products.push({
    id: `p${products.length + 1}`, sku: `TMF-${prefix}-${String(i + 1).padStart(3, '0')}`, name, category,
    mrp: null, retailPrice: null, wholesalePrice: null, stock, active: true, createdAt: at(30, 10, 0),
  }));
}

const retailPool = [
  ['Rohan Mehta', '98220 41822', 'Pune'], ['Neha Kulkarni', '98908 22314', 'Pune'], ['Priya Deshmukh', '97650 11872', 'Nashik'],
  ['Amit Joshi', '99230 55410', 'Mumbai'], ['Sneha Patil', '98500 77301', 'Kolhapur'], ['Vikram Shinde', '98818 90021', 'Pune'],
  ['Anjali Kale', '97300 18874', 'Satara'], ['Rahul Pawar', '98903 66142', 'Pune'],
];
const wholesalePool = [
  ['Maya Kirana Store', 'Maya Ghate', 'Pune', 150000, 42000], ['Fresh Basket Market', 'Sunil Bhosale', 'Mumbai', 200000, 168000],
  ['Shree Ganesh Traders', 'Ganesh Rane', 'Nashik', 100000, 12000], ['Pune Namkeen Depot', 'Ajay Gokhale', 'Pune', 250000, 96000],
  ['Sai Super Mart', 'Sai Jadhav', 'Satara', 120000, 0], ['Gokul General Stores', 'Gokul More', 'Kolhapur', 80000, 76500],
  ['Daily Needs Bazaar', 'Meena Sathe', 'Thane', 180000, 54000],
];

const statuses = ['Pending', 'Pending', 'Processing', 'Pending', 'Dispatched', 'Pending', 'Pending', 'Delivered', 'Pending', 'Pending', 'Processing', 'Pending', 'Pending', 'Dispatched', 'Pending', 'Pending', 'Delivered', 'Pending', 'Processing', 'Pending', 'Pending', 'Delivered', 'Pending', 'Dispatched', 'Pending', 'Processing', 'Pending', 'Delivered'];
const orders = [
  { id: 'TMF-1048', customer: 'Maya Kirana Store', type: 'Wholesale', amount: 18420, status: 'Processing', createdAt: at(0, 10, 42) },
  { id: 'TMF-1047', customer: 'Rohan Mehta', type: 'Retail', amount: 1280, status: 'Dispatched', createdAt: at(0, 9, 18) },
  { id: 'TMF-1046', customer: 'Fresh Basket Market', type: 'Wholesale', amount: 12650, status: 'Pending', createdAt: at(1, 18, 30) },
  { id: 'TMF-1045', customer: 'Neha Kulkarni', type: 'Retail', amount: 760, status: 'Delivered', createdAt: at(1, 16, 12) },
];
statuses.forEach((status, i) => {
  const wholesale = i % 3 !== 0;
  orders.push({
    id: `TMF-${1044 - i}`,
    customer: wholesale ? wholesalePool[i % wholesalePool.length][0] : retailPool[i % retailPool.length][0],
    type: wholesale ? 'Wholesale' : 'Retail',
    amount: wholesale ? 8000 + ((i * 2371) % 14000) : 300 + ((i * 379) % 1900),
    status, createdAt: at(2 + Math.floor(i / 6), 20 - 2 * (i % 6), (i * 17) % 60),
  });
});

const curve = () => {
  const anchors = [[0, 21], [4, 23], [8, 19], [12, 32], [16, 29], [20, 39], [24, 36], [29, 51]];
  return Array.from({ length: 30 }, (_, i) => {
    let k = 0;
    while (k < anchors.length - 2 && i > anchors[k + 1][0]) k++;
    const [x0, y0] = anchors[k], [x1, y1] = anchors[k + 1];
    return (y0 + ((y1 - y0) * (i - x0)) / (x1 - x0)) * 1000 + Math.sin(i * 0.9) * 800;
  });
};
const fit = (arr, total, fixed = {}) => {
  const fixedSum = Object.values(fixed).reduce((a, b) => a + b, 0);
  const free = arr.reduce((a, v, i) => a + (i in fixed ? 0 : v), 0);
  const out = arr.map((v, i) => (i in fixed ? fixed[i] : Math.round((v * (total - fixedSum)) / free)));
  out[14] += total - out.reduce((a, b) => a + b, 0);
  return out;
};
const series = [
  ...fit(curve().map((v) => v * 0.75), 640000),
  ...fit(curve().map((v, i) => v * 0.9 + Math.cos(i) * 900), 798707),
  ...fit(curve(), 864200, { 28: 37938, 29: 42680 }),
];

const mv = (daysAgo, h, p, type, quantity, note) => ({
  id: `m${daysAgo}${h}${p}`, productId: `p${p}`, productName: products[p - 1].name, sku: products[p - 1].sku, type, quantity,
  balance: products[p - 1].stock, note, createdAt: at(daysAgo, h, 5),
});

const po = (n, supplier, p, quantity, unitCost, status, daysAgo) => ({
  id: `PO-${n}`, supplier, productId: `p${p}`, productName: products[p - 1].name, quantity, unitCost,
  amount: quantity * unitCost, status, notes: '', createdAt: at(daysAgo, 11, 20),
});

export const seed = () => ({
  meta: { series, mix: { retail: 328396, wholesale: 535804 }, historicalOrders: 216 },
  orders,
  products,
  inventory: [
    mv(0, 9, 1, 'Stock out', 8, 'Wholesale dispatch TMF-1048'), mv(0, 8, 4, 'Stock out', 5, 'Retail orders'),
    mv(1, 17, 3, 'Stock out', 12, 'Wholesale dispatch TMF-1046'), mv(2, 12, 2, 'Adjustment', -2, 'Damaged packs removed'),
    mv(3, 10, 6, 'Stock in', 40, 'Fresh batch from kitchen'), mv(4, 15, 12, 'Stock in', 25, 'Fresh batch from kitchen'),
  ],
  purchases: [
    po(3024, 'Shivam Agro Foods', 1, 200, 38, 'Ordered', 1), po(3023, 'Krishna Oil Mills', 6, 120, 52, 'Ordered', 3),
    po(3022, 'Om Packaging Solutions', 3, 500, 4, 'Received', 6), po(3021, 'Pune Spice Traders', 8, 80, 61, 'Received', 9),
  ],
  suppliers: [
    { id: 's1', name: 'Shivam Agro Foods', contact: 'Prakash Shivam', phone: '98220 10234', email: 'orders@shivamagro.in', city: 'Pune', supplies: 'Bhajani flour, besan', status: 'Active' },
    { id: 's2', name: 'Krishna Oil Mills', contact: 'Krishna Rao', phone: '98900 44821', email: 'sales@krishnaoil.in', city: 'Solapur', supplies: 'Groundnut and sunflower oil', status: 'Active' },
    { id: 's3', name: 'Pune Spice Traders', contact: 'Imran Shaikh', phone: '97630 55192', email: 'hello@punespice.in', city: 'Pune', supplies: 'Spices, chilli powder', status: 'Active' },
    { id: 's4', name: 'Om Packaging Solutions', contact: 'Deepak Om', phone: '99700 31544', email: 'om.pack@gmail.com', city: 'Pimpri', supplies: 'Pouches, cartons, labels', status: 'Active' },
    { id: 's5', name: 'Maharashtra Poha Mill', contact: 'Suresh Wagh', phone: '98230 72011', email: 'mpm@pohamill.in', city: 'Nashik', supplies: 'Thick poha, makai', status: 'Inactive' },
  ],
  customers: retailPool.map(([name, phone, city], i) => ({ id: `c${i + 1}`, name, phone, email: `${name.split(' ')[0].toLowerCase()}@mail.com`, city })),
  wholesalers: wholesalePool.map(([name, contact, city, creditLimit, outstanding], i) => ({
    id: `w${i + 1}`, name, contact, phone: `98${i}20 5${i}412`, city, gstin: `27AAB${i}M${1200 + i * 37}F1Z${i + 2}`, creditLimit, outstanding,
    status: outstanding / creditLimit > 0.9 ? 'On hold' : 'Active',
  })),
  'audit-logs': [
    ['Updated', 'Order', 'TMF-1048', 0, 10], ['Created', 'Order', 'TMF-1047', 0, 9], ['Updated', 'Product', 'Mini bhajani chakali', 1, 14],
    ['Created', 'Purchase', 'PO-3024', 1, 11], ['Created', 'Inventory', 'Stock in 40 x Poha Chivda', 3, 10], ['Created', 'Supplier', 'Shivam Agro Foods', 6, 12],
    ['Created', 'Wholesaler', 'Maya Kirana Store', 8, 15],
  ].map(([action, entity, detail, d, h], i) => ({ id: `a${i}`, user: 'Admin', action, entity, detail, createdAt: at(d, h, 12) })),
});
