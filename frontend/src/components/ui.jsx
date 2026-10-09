import { useEffect, useId, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { TONE } from '../utils.js';

export const Button = ({ variant = 'ghost', icon, children, ...p }) => (
  <button className={`btn btn-${variant}`} {...p}>{icon && <Icon name={icon} size={18} />}{children}</button>
);

export const Badge = ({ children, tone }) => <span className={`badge b-${tone || TONE[children] || 'gray'}`}>{children}</span>;

export const Tile = ({ children }) => <span className="tile">{children}</span>;

export const Muted = ({ children = 'Not set' }) => <span className="muted">{children}</span>;

export function StatusSelect({ value, options, onChange }) {
  return (
    <select className={`status-select b-${TONE[value] || 'gray'}`} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Change status">
      {options.map((o) => <option key={o}>{o}</option>)}
    </select>
  );
}

export function PageHeader({ eyebrow, title, subtitle, action }) {
  return (
    <header className="ph">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="title">{title}</h1>
        <p className="sub">{subtitle}</p>
      </div>
      {action}
    </header>
  );
}

export function EmptyState({ title, text, action }) {
  return (
    <div className="empty card">
      <div className="eicon"><Icon name="file" size={28} /></div>
      <h2>{title}</h2>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function Modal({ title, onClose, children, width = 560 }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: `min(${width}px,100%)` }} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-h">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmModal({ title, text, confirmLabel = 'Delete', onConfirm, onClose }) {
  return (
    <Modal title={title} onClose={onClose} width={440}>
      <p className="sub" style={{ marginTop: 0 }}>{text}</p>
      <div className="modal-f">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}

export function FormModal({ title, fields, initial = {}, onSubmit, onClose, submitLabel = 'Save' }) {
  const uid = useId();
  const [values, setValues] = useState(() =>
    Object.fromEntries(fields.map((f) => {
      const v = initial[f.name];
      return [f.name, v === null || v === undefined ? f.default ?? (f.type === 'select' ? opt(f.options[0]).value : '') : String(v)];
    }))
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setValues((s) => ({ ...s, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try { await onSubmit(values); } catch (err) { setError(err.message); setSaving(false); }
  };

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          {fields.map((f) => {
            const id = `${uid}-${f.name}`;
            return (
              <div key={f.name} className={`field ${f.full || f.type === 'textarea' ? 'full' : ''}`}>
                <label htmlFor={id}>{f.label}{f.required && <span className="req"> *</span>}</label>
                {f.type === 'select' ? (
                  <select id={id} value={values[f.name]} onChange={(e) => set(f.name, e.target.value)} required={f.required}>
                    {f.options.map((o) => <option key={opt(o).value} value={opt(o).value}>{opt(o).label}</option>)}
                  </select>
                ) : f.type === 'textarea' ? (
                  <textarea id={id} rows={3} value={values[f.name]} onChange={(e) => set(f.name, e.target.value)} placeholder={f.placeholder} />
                ) : (
                  <>
                    <input id={id} type={f.type || 'text'} step={f.step} min={f.min} value={values[f.name]} placeholder={f.placeholder} required={f.required}
                      list={f.list ? `${id}-list` : undefined} onChange={(e) => set(f.name, e.target.value)} />
                    {f.list && <datalist id={`${id}-list`}>{f.list.map((x) => <option key={x} value={x} />)}</datalist>}
                  </>
                )}
                {f.hint && <small className="muted">{f.hint}</small>}
              </div>
            );
          })}
        </div>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="modal-f">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Saving…' : submitLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}
const opt = (o) => (typeof o === 'object' ? o : { value: o, label: o });

export function Popover({ trigger, children, label }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="pop-wrap" ref={ref}>
      <button className="icon-btn" aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}>{trigger}</button>
      {open && <div className="pop" onClick={() => setOpen(false)}>{children}</div>}
    </div>
  );
}
