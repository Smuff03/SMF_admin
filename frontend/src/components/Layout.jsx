import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import Icon from './Icon.jsx';
import { Button, Modal, Popover } from './ui.jsx';
import { useApp } from '../context.jsx';
import { useAuth } from '../auth.jsx';
import { firebaseConfigured, firebaseProject, functionsRegion, useEmulators } from '../firebase.js';

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'dashboard' },
  { to: '/orders', label: 'Orders', icon: 'cart', badge: true },
  { to: '/products', label: 'Products', icon: 'box' },
  { to: '/inventory', label: 'Inventory', icon: 'warehouse' },
  { to: '/purchases', label: 'Purchases', icon: 'truck' },
  { to: '/suppliers', label: 'Suppliers', icon: 'users' },
  { to: '/customers', label: 'Customers', icon: 'users' },
  { to: '/wholesalers', label: 'Wholesalers', icon: 'shield' },
  { to: '/reports', label: 'Reports', icon: 'file' },
  { to: '/audit-logs', label: 'Audit Logs', icon: 'sliders' },
];

function ConnectionModal({ onClose }) {
  const { errors, data, online } = useApp();
  const { user } = useAuth();
  const failed = Object.keys(errors);
  const total = Object.keys(data).length;
  const loaded = Object.values(data).filter((v) => v !== null && v !== undefined).length;
  const sync = failed.length ? ['Problem with: ' + failed.join(', '), 'bad'] : loaded < total ? ['Connecting…', ''] : ['Live', 'ok'];
  const rows = [
    ['Firebase project', firebaseConfigured ? `${firebaseProject}${useEmulators ? ' (local emulators)' : ''}` : 'Not configured', firebaseConfigured ? 'ok' : 'bad'],
    ['Signed in as', user?.email || 'Unknown', 'ok'],
    ['Network', online ? 'Online' : 'Offline', online ? 'ok' : 'bad'],
    ['Live sync (Firestore)', ...sync],
    ['Write functions region', functionsRegion, ''],
  ];
  return (
    <Modal title="Connection settings" onClose={onClose} width={480}>
      <div className="conn">
        {rows.map(([k, v, st]) => <div key={k}><span>{k}</span><b className={st}>{v}</b></div>)}
      </div>
      {failed.length > 0 && <p className="form-error">{errors[failed[0]]}.</p>}
      <p className="sub">Firebase values come from the <code>VITE_FIREBASE_*</code> variables in <code>.env</code>. Restart the dev server after changing them.</p>
      <div className="modal-f"><Button variant="primary" onClick={onClose}>Done</Button></div>
    </Modal>
  );
}

export default function Layout() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const { summary, connOpen, setConnOpen } = useApp();
  const { user, signOut } = useAuth();
  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [pathname]);
  const page = NAV.find((n) => (n.to === '/' ? pathname === '/' : pathname.startsWith(n.to)))?.label || 'Dashboard';
  const alerts = summary.pendingOrders + summary.lowStock > 0;

  return (
    <div className="app">
      <aside className={`side ${open ? 'open' : ''}`}>
        <div className="brand">
          <span className="logo">TM</span>
          <div><b>TMF <span>BizHub</span></b><small>Admin workspace</small></div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon name={n.icon} size={22} />
              <span>{n.label}</span>
              {n.badge && summary.pendingOrders > 0 && <span className="count">{summary.pendingOrders}</span>}
            </NavLink>
          ))}
        </nav>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}

      <div className="main">
        <div className="topbar">
          <div className="crumbs">
            <button className="icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Open menu"><Icon name="menu" /></button>
            <span className="crumb-root">TMF BizHub</span><span className="sep crumb-root">/</span><b>{page}</b>
          </div>
          <div className="top-actions">
            <Popover trigger={<Icon name="help" size={24} />} label="Help">
              <div className="pop-body">
                <b>Quick help</b>
                <p>Use the sidebar to switch modules. Change an order or purchase status straight from its table row.</p>
                <p>Stock updates automatically when inventory records are added or purchases are received.</p>
              </div>
            </Popover>
            <Popover trigger={<><Icon name="bell" size={24} />{alerts && <i className="dot" />}</>} label="Notifications">
              <Link className="pop-item" to="/orders"><b>{summary.pendingOrders} pending orders</b><span>Waiting to be processed</span></Link>
              <Link className="pop-item" to="/inventory"><b>{summary.lowStock} low-stock products</b><span>At or below {summary.lowStockThreshold} units</span></Link>
            </Popover>
            <Popover trigger={<span className="avatar">{(user.email || 'AD').slice(0, 2).toUpperCase()}</span>} label="Account">
              <div className="pop-body"><b>Admin</b><span className="muted">{user.email}</span></div>
              <button className="pop-item" onClick={() => setConnOpen(true)}><b>Connection settings</b><span>Firebase status</span></button>
              <button className="pop-item" onClick={signOut}><b>Sign out</b><span>End this session</span></button>
            </Popover>
          </div>
        </div>
        <main className="page"><Outlet /></main>
      </div>
      {connOpen && <ConnectionModal onClose={() => setConnOpen(false)} />}
    </div>
  );
}
