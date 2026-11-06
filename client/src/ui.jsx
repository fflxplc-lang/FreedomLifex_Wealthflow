import { useEffect, useState, createContext, useContext, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Download, Loader2 } from 'lucide-react';

// ---------- formatting ----------
export const inr = (n, d = 2) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
export const inrPlain = (n, d = 2) => `₹${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
export function inrShort(n) {
  const v = Number(n || 0), a = Math.abs(v);
  if (a >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  if (a >= 1e3) return `₹${(v / 1e3).toFixed(1)}k`;
  return `₹${v.toFixed(0)}`;
}
export const pct = (n, d = 2) => `${Number(n || 0).toFixed(d)}%`;
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const periodLabel = (p) => (p ? `${MONTHS[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}` : '');
export const shortPeriod = (p) => (p ? `${MONTHS[Number(p.slice(5)) - 1].slice(0, 3)} ${p.slice(0, 4)}` : '');
export const LEVELS = { 1: 'Ninja', 2: 'Super Ninja', 3: 'Sherpa', 4: 'Master Sherpa', 5: 'Monks', 6: 'Zen Monks', 7: 'Company' };
export function timeAgo(ts) {
  const d = new Date(ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
export const localTs = (ts) => new Date(`${ts.replace(' ', 'T')}Z`).toLocaleString('en-IN');

// ---------- Excel export ----------
export function exportExcel(rows, name) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Data');
  XLSX.writeFile(wb, name.endsWith('.xlsx') || name.endsWith('.csv') ? name : `${name}.xlsx`);
}

// ---------- toasts ----------
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, kind = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x, { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">{items.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>)}</div>
    </ToastCtx.Provider>
  );
}

// Runs an async action, toasting the error if it throws.
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn, okMsg) => {
    setBusy(true);
    try { const r = await fn(); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg); return r; }
    catch (e) { toast(e.message, 'err'); return undefined; }
    finally { setBusy(false); }
  };
  return [run, busy];
}

// Loads data from an async function and reloads when deps change.
export function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    fn().then((data) => live && setState({ data, loading: false, error: null }))
      .catch((error) => live && setState({ data: null, loading: false, error }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

// ---------- components ----------
export const Card = ({ className = '', children, ...p }) => <div className={`card ${className}`} {...p}>{children}</div>;

export function PageHead({ title, sub, children, icon }) {
  return (
    <div className="page-head">
      <div className="row gap">
        {icon && <div className="page-icon">{icon}</div>}
        <div><h1>{title}</h1>{sub && <p className="muted">{sub}</p>}</div>
      </div>
      <div className="row gap wrap">{children}</div>
    </div>
  );
}

export function Stat({ label, value, sub, tone, icon, badge }) {
  return (
    <Card className="stat">
      {(icon || badge) && <div className="row between">{icon && <div className={`stat-icon ${tone || ''}`}>{icon}</div>}{badge && <span className="chip">{badge}</span>}</div>}
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone || ''}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </Card>
  );
}

export function Segmented({ value, onChange, options, className = '' }) {
  return (
    <div className={`segmented ${className}`}>
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.icon}{o.label}{o.count !== undefined && <span className="seg-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Tabs({ value, onChange, options }) {
  return (
    <div className="tabs">
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.icon}{o.label}</button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose}><X size={20} /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint, className = '' }) {
  return <label className={`field ${className}`}><span className="field-label">{label}</span>{children}{hint && <span className="hint">{hint}</span>}</label>;
}

export function Pager({ page, total, size = 50, onPage }) {
  const pages = Math.max(1, Math.ceil(total / size));
  const from = total ? (page - 1) * size + 1 : 0;
  const to = Math.min(total, page * size);
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  const nums = Array.from({ length: Math.min(5, pages) }, (_, i) => start + i);
  return (
    <div className="pager">
      <span className="pager-info">SHOWING <b>{from}</b> TO <b>{to}</b> OF <b>{total}</b> RESULTS</span>
      <div className="pager-btns">
        <button disabled={page === 1} onClick={() => onPage(1)}><ChevronsLeft size={14} /></button>
        <button disabled={page === 1} onClick={() => onPage(page - 1)}><ChevronLeft size={14} /></button>
        {nums.map((n) => <button key={n} className={n === page ? 'on' : ''} onClick={() => onPage(n)}>{n}</button>)}
        <button disabled={page === pages} onClick={() => onPage(page + 1)}><ChevronRight size={14} /></button>
        <button disabled={page === pages} onClick={() => onPage(pages)}><ChevronsRight size={14} /></button>
      </div>
    </div>
  );
}

export const Empty = ({ icon, title, text }) => (
  <div className="empty">{icon}<div className="empty-title">{title}</div>{text && <div className="muted">{text}</div>}</div>
);

export const Spinner = () => <div className="spinner"><Loader2 className="spin" size={22} /></div>;

export const ExportBtn = ({ onClick, label = 'Export Excel' }) => (
  <button className="btn btn-green-soft" onClick={onClick}><Download size={14} />{label}</button>
);

export function YearMonth({ year, month, onYear, onMonth, years }) {
  const ys = years || (() => { const y = new Date().getFullYear(); return [y + 1, y, y - 1, y - 2, y - 3]; })();
  return (
    <>
      <select className="select sm" value={month} onChange={(e) => onMonth(e.target.value)}>
        <option value="all">All Months</option>
        {MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
      </select>
      <select className="select sm" value={year} onChange={(e) => onYear(e.target.value)}>
        <option value="all">All Years</option>
        {ys.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
    </>
  );
}

export function Confirm({ title, text, confirmLabel = 'Confirm', danger, onConfirm, onClose, requireText }) {
  const [typed, setTyped] = useState('');
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className={`btn ${danger ? 'btn-red' : 'btn-primary'}`} disabled={requireText && typed !== requireText} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
    </>}>
      <p>{text}</p>
      {requireText && <Field label={`Type ${requireText} to confirm`}><input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} /></Field>}
    </Modal>
  );
}
