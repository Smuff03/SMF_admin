import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../context.jsx';
import Icon from '../components/Icon.jsx';
import DataTable from '../components/DataTable.jsx';
import { Button, ConfirmModal, EmptyState, FormModal, PageHeader } from '../components/ui.jsx';

export default function ResourcePage({
  resource, eyebrow, title, subtitle, addLabel, columns, fields, lookups = [], searchKeys = ['name'], placeholder = 'Search…',
  tabs, filters = [], banner, countNoun = 'records', above, expand, immutable, canEdit = () => true, noun = 'record',
}) {
  const { refresh, toast, setConnOpen, summary } = useApp();
  const [rows, setRows] = useState(null);
  const [look, setLook] = useState({});
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('All');
  const [fv, setFv] = useState({});
  const [panel, setPanel] = useState(false);
  const [modal, setModal] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [open, setOpen] = useState(null);
  const [bannerOn, setBannerOn] = useState(true);
  const threshold = summary.lowStockThreshold;

  const load = useCallback(async () => {
    try {
      const [data, ...extra] = await Promise.all([api.get(`/${resource}`), ...lookups.map((l) => api.get(`/${l}`))]);
      setRows(data);
      setLook(Object.fromEntries(lookups.map((l, i) => [l, extra[i]])));
      setError('');
    } catch (e) {
      setError(e.message);
      setRows([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resource]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, message) => {
    try { await fn(); await load(); refresh(); toast(message); } catch (e) { toast(e.message, 'err'); }
  };
  const ctx = {
    look, rows: rows || [], threshold,
    update: (row, patch, message = 'Changes saved') => run(() => api.put(`/${resource}/${row.id}`, patch), message),
    edit: (row) => setModal({ row }),
    remove: (row) => setConfirm(row),
  };

  const save = async (values) => {
    const row = modal.row;
    if (row) await api.put(`/${resource}/${row.id}`, values); else await api.post(`/${resource}`, values);
    await load();
    refresh();
    toast(row ? 'Changes saved' : `${addLabel?.replace(/^Add /, '').replace(/^./, (c) => c.toUpperCase()) || 'Record'} added`);
    setModal(null);
  };

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows || []).filter((r) =>
      (tab === 'All' || tabs.test(r, tab)) &&
      filters.every((f) => !fv[f.key] || f.test(r, fv[f.key], { threshold })) &&
      (!needle || searchKeys.some((k) => String(r[k] ?? '').toLowerCase().includes(needle)))
    );
  }, [rows, q, tab, fv, tabs, filters, searchKeys, threshold]);

  const cols = [...columns];
  if (expand) cols.push({ label: '', className: 'end', render: (r) => (
    <button className={`icon-btn chev ${open === r.id ? 'on' : ''}`} onClick={() => setOpen(open === r.id ? null : r.id)} aria-label="Toggle details"><Icon name="chevron" /></button>
  ) });
  else if (!immutable) cols.push({ label: '', className: 'end', render: (r) => canEdit(r) && (
    <span className="row-actions">
      <button className="icon-btn" onClick={() => ctx.edit(r)} aria-label="Edit"><Icon name="pencil" size={18} /></button>
      <button className="icon-btn" onClick={() => ctx.remove(r)} aria-label="Delete"><Icon name="trash" size={18} /></button>
    </span>
  ) });

  const primary = filters.filter((f) => !f.panel);
  const secondary = filters.filter((f) => f.panel);
  const note = banner && rows?.length ? banner(rows) : null;
  const FilterSelect = ({ f }) => (
    <select className="sel" value={fv[f.key] || ''} onChange={(e) => setFv({ ...fv, [f.key]: e.target.value })} aria-label={f.label}>
      <option value="">{f.label}</option>
      {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );

  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} subtitle={subtitle}
        action={addLabel && !error && <Button variant="primary" icon="plus" onClick={() => setModal({ row: null })}>{addLabel}</Button>} />

      {note && bannerOn && (
        <div className="banner">
          <Icon name="box" size={22} />
          <p><b>{note.strong}</b> {note.text}</p>
          <button className="icon-btn" onClick={() => setBannerOn(false)} aria-label="Dismiss"><Icon name="x" size={18} /></button>
        </div>
      )}
      {rows && above?.({ rows, look, threshold })}

      {error ? (
        <EmptyState title={`${title} workspace unavailable`} text={`${error}. Make sure the API is running, then check the connection settings.`}
          action={<Button onClick={() => setConnOpen(true)}>Review connection settings</Button>} />
      ) : rows === null ? (
        <div className="loading">Loading {title.toLowerCase()}…</div>
      ) : (
        <>
          {tabs && (
            <div className="tabs">
              {['All', ...tabs.options].map((t) => (
                <button key={t} className={`tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
                  {t} <span>{t === 'All' ? rows.length : rows.filter((r) => tabs.test(r, t)).length}</span>
                </button>
              ))}
            </div>
          )}
          <div className="toolbar">
            <label className="search">
              <Icon name="search" size={19} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Search" />
            </label>
            {primary.map((f) => <FilterSelect key={f.key} f={f} />)}
            {secondary.length > 0 && <Button icon="sliders" onClick={() => setPanel(!panel)}>Filters</Button>}
            <span className="count-label">{visible.length} {countNoun}</span>
          </div>
          {panel && <div className="filter-panel">{secondary.map((f) => <FilterSelect key={f.key} f={f} />)}<Button onClick={() => setFv({})}>Clear filters</Button></div>}

          {visible.length ? (
            <section className="card"><DataTable columns={cols} rows={visible} ctx={ctx} expanded={open} renderExpanded={expand && ((r) => expand(r, ctx))} /></section>
          ) : (
            <EmptyState title={rows.length ? 'No matches found' : `No ${countNoun} yet`}
              text={rows.length ? 'Try a different search or clear the filters.' : `Add your first ${noun} to get started.`}
              action={!rows.length && addLabel && <Button variant="primary" icon="plus" onClick={() => setModal({ row: null })}>{addLabel}</Button>} />
          )}
        </>
      )}

      {modal && (
        <FormModal title={modal.row ? `Edit ${noun}` : addLabel} fields={fields(look)} initial={modal.row || {}} onClose={() => setModal(null)}
          onSubmit={save} submitLabel={modal.row ? 'Save changes' : addLabel} />
      )}
      {confirm && (
        <ConfirmModal title={`Delete ${noun}?`} text="This permanently removes the record. This action is recorded in the audit log."
          onClose={() => setConfirm(null)} onConfirm={() => { const r = confirm; setConfirm(null); run(() => api.del(`/${resource}/${r.id}`), 'Deleted'); }} />
      )}
    </>
  );
}
