import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }) {
  const [summary, setSummary] = useState({ pendingOrders: 0, lowStock: 0, lowStockThreshold: 25 });
  const [online, setOnline] = useState(true);
  const [connOpen, setConnOpen] = useState(false);
  const [toasts, setToasts] = useState([]);

  const refresh = useCallback(
    () => api.get('/summary').then((s) => { setSummary(s); setOnline(true); }).catch(() => setOnline(false)),
    []
  );
  useEffect(() => { refresh(); }, [refresh]);

  const toast = useCallback((message, type = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  return (
    <Ctx.Provider value={{ summary, online, refresh, toast, connOpen, setConnOpen }}>
      {children}
      <div className="toasts" role="status">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.type}`}>{t.message}</div>)}
      </div>
    </Ctx.Provider>
  );
}
