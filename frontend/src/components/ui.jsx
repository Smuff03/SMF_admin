import { useEffect, useId, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { TONE } from '../utils.js';
import { MAX_IMAGES, checkImage } from '../storage.js';

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
      if (f.type === 'images') return [f.name, (Array.isArray(v) ? v : []).map((i) => ({ key: i.path, url: i.url, path: i.path }))];
      if (f.type === 'array' || Array.isArray(v)) return [f.name, Array.isArray(v) ? v : (f.default ?? [])];
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
            if (f.type === 'hidden') return null;
            const id = `${uid}-${f.name}`;
            return (
              <div key={f.name} className={`field ${f.full || f.type === 'textarea' ? 'full' : ''}`}>
                {f.label && <label htmlFor={id}>{f.label}{f.required && <span className="req"> *</span>}</label>}
                {f.render ? (
                  f.render({ id, value: values[f.name], values, onChange: (v) => set(f.name, v), setField: set })
                ) : f.type === 'images' ? (
                  <ImagePicker id={id} value={values[f.name]} onChange={(v) => set(f.name, v)} />
                ) : f.type === 'select' ? (
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

/**
 * Value is a list of { key, url, path?, file? }: saved images carry url + path, newly picked ones carry the File and a
 * local preview URL. Nothing is uploaded until the form is submitted (see onBeforeSave in ResourcePage).
 */
function ImagePicker({ id, value, onChange, max = MAX_IMAGES }) {
  const input = useRef(null);
  const [msg, setMsg] = useState('');
  const live = useRef(value);
  live.current = value;
  useEffect(() => () => live.current.forEach((i) => i.file && URL.revokeObjectURL(i.url)), []);

  const add = (files) => {
    const next = [];
    let problem = '';
    for (const f of Array.from(files)) {
      const err = checkImage(f);
      if (err) { problem = err; continue; }
      if (value.length + next.length >= max) { problem = `You can add up to ${max} images.`; break; }
      next.push({ key: crypto.randomUUID(), url: URL.createObjectURL(f), file: f });
    }
    setMsg(problem);
    if (next.length) onChange([...value, ...next]);
  };
  const remove = (item) => {
    if (item.file) URL.revokeObjectURL(item.url);
    onChange(value.filter((i) => i.key !== item.key));
  };
  const makeCover = (item) => onChange([item, ...value.filter((i) => i.key !== item.key)]);

  return (
    <div className="img-picker" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files); }}>
      <div className="img-grid">
        {value.map((it, i) => (
          <div className="img-thumb" key={it.key}>
            <img src={it.url} alt="" />
            {i === 0 && <span className="img-cover">Cover</span>}
            <div className="img-actions">
              {i > 0 && <button type="button" onClick={() => makeCover(it)} title="Make cover image" aria-label="Make cover image">★</button>}
              <button type="button" onClick={() => remove(it)} title="Remove image" aria-label="Remove image"><Icon name="x" size={14} /></button>
            </div>
          </div>
        ))}
        {value.length < max && (
          <button type="button" className="img-add" onClick={() => input.current?.click()}>
            <Icon name="plus" size={22} /><span>Add images</span>
          </button>
        )}
      </div>
      <input ref={input} id={id} type="file" accept="image/*" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      {msg && <small className="img-msg" role="alert">{msg}</small>}
    </div>
  );
}

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
