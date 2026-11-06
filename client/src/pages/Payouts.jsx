import { useRef, useState } from 'react';
import { RefreshCw, Download, Upload, Search, ShieldAlert, ChevronDown, Calendar } from 'lucide-react';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Card, PageHead, Stat, useLoad, useAction, Spinner, Empty, Modal, Field, exportExcel, inrShort, inr, periodLabel } from '../ui.jsx';

const n = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function RecordPayment({ row, period, onClose, onDone }) {
  const [f, setF] = useState({ amount: Math.max(0, row.owed).toFixed(2), paidOn: new Date().toISOString().slice(0, 10), reference: '' });
  const [run, busy] = useAction();
  return (
    <Modal title="Record Payment" onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api.post('/payouts/payments', { userId: row.id, period, ...f }).then(() => { onDone(); onClose(); }), 'Payment recorded')}>Save Payment</button></>}>
      <div className="semi">{row.name} · {periodLabel(period)}</div>
      <div className="banner blue small">Still owed: <b>{n(row.owed)}</b> (payable this month {n(row.payable)} plus {n(row.broughtFwd)} brought forward)</div>
      <div className="grid g2">
        <Field label="Amount (₹)"><input className="input" type="number" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Paid on"><input className="input" type="date" value={f.paidOn} onChange={(e) => setF({ ...f, paidOn: e.target.value })} /></Field>
      </div>
      <Field label="Reference (UTR / cheque no.)"><input className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
    </Modal>
  );
}

export default function Payouts() {
  const { user } = useAuth();
  const admin = user.role === 'admin';
  const [period, setPeriod] = useState('');
  const [product, setProduct] = useState('all');
  const [q, setQ] = useState('');
  const [owedOnly, setOwedOnly] = useState(false);
  const [pay, setPay] = useState(null);
  const [open, setOpen] = useState(null);
  const [run] = useAction();
  const file = useRef();
  const { data, reload } = useLoad(() => api.get(`/payouts${qs({ period, product })}`), [period, product]);
  if (!data) return <Spinner />;
  const k = data.kpis;
  const rows = data.rows.filter((r) => (!owedOnly || r.owed > 0.005) && (!q || r.name.toLowerCase().includes(q.toLowerCase())));
  const importPayments = (fl) => run(async () => {
    const fd = new FormData(); fd.append('file', fl); fd.append('period', data.period);
    const r = await api.post('/payouts/payments/import', fd); reload(); return r;
  }, (r) => `${r.recorded} payment(s) recorded${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}`);

  return (
    <>
      <PageHead title="Payouts" sub="What every BM and RM has earned, what has been paid, and what is still owed.">
        <select className="select sm" value={product} onChange={(e) => setProduct(e.target.value)}><option value="all">All products</option><option value="mf">Mutual funds</option><option value="partner">Partner broking</option></select>
        <select className="select sm" value={data.period} onChange={(e) => setPeriod(e.target.value)}>
          {(data.periods.includes(data.period) ? data.periods : [data.period, ...data.periods]).map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
        </select>
        <button className="btn" onClick={reload}><RefreshCw size={14} />Refresh</button>
        <button className="btn" onClick={() => exportExcel(rows.map((r) => ({ Person: r.name, Code: r.code, Level: r.level, 'Brought Fwd': r.broughtFwd, Earned: r.earned, GST: r.gst, TDS: r.tds, Payable: r.payable, Paid: r.paid, 'Still Owed': r.owed })), `payouts-${data.period}.xlsx`)}><Download size={14} />Export</button>
        {admin && <button className="btn btn-primary" onClick={() => file.current.click()}><Upload size={14} />Import payments</button>}
        <input ref={file} type="file" hidden accept=".xlsx,.xls,.csv" onChange={(e) => { const fl = e.target.files[0]; e.target.value = ''; if (fl) importPayments(fl); }} />
      </PageHead>
      <div className="grid g4">
        <Stat label="Brought Forward" value={inrShort(k.broughtFwd)} sub="unpaid from earlier months" />
        <Stat label="Earned This Month" value={inrShort(k.earned)} sub={`${k.people} people`} />
        <Stat label="GST On Top" value={inr(k.gst, 0)} sub="added when GST is on" />
        <Stat label="Payable (After GST & TDS)" value={inrShort(k.payable)} tone="green" sub="what the cheques come to" />
        <Stat label="Paid" value={inrShort(k.paid)} tone="green" sub="recorded against this month" />
        <Stat label="Still Owed" value={inrShort(k.owed)} tone={k.owed > 0 ? 'red' : 'green'} sub="carries into next month" />
      </div>

      {admin && (
        <div className="card mt" style={{ borderColor: '#f5cf5f', borderWidth: 2, background: 'var(--surface)' }}>
          <div className="row gap-sm" style={{ padding: '10px 16px', background: 'var(--amber-soft)', borderRadius: '12px 12px 0 0' }}><ShieldAlert size={15} className="t-amber" /><b className="small">Attribution health</b><span className="tiny muted">money that may be reaching the wrong person</span></div>
          <div className="health">
            {[['noRM', 'Clients with no RM', data.health.noRM, (x) => `${x.name} · ${n(x.gross)}`], ['shared', 'Folios on two clients', data.health.shared, (x) => `${x.folio}: ${x.clients}`]].map(([key, label, h, fmt]) => (
              <div key={key} style={{ cursor: 'pointer' }} onClick={() => setOpen(open === key ? null : key)}>
                <div className="row between"><b style={{ fontSize: 22 }} className={h.count ? 't-amber' : 't-green'}>{h.count}</b><ChevronDown size={14} className="faint" /></div>
                <div className="small semi">{label}</div><div className="tiny faint">{n(h.amount)} this month</div>
                {open === key && <div className="tiny muted mt-sm" style={{ maxHeight: 140, overflow: 'auto' }}>{h.items.map((x, i) => <div key={i}>{fmt(x)}</div>)}{!h.items.length && 'clear'}</div>}
              </div>
            ))}
            <div><b style={{ fontSize: 22 }} className="t-green">{data.rows.filter((r) => r.owed < -0.5).length}</b><div className="small semi">People overpaid</div><div className="tiny faint">paid more than they were owed</div></div>
          </div>
        </div>
      )}

      <Card className="mt">
        <div className="card-head">
          <span className="row gap-sm semi"><Calendar size={15} />{periodLabel(data.period)}</span>
          <div className="row gap">
            <label className="check"><input type="checkbox" checked={owedOnly} onChange={(e) => setOwedOnly(e.target.checked)} />Only those still owed</label>
            <div className="input-icon"><Search size={13} /><input className="input sm" placeholder="Search person..." value={q} onChange={(e) => setQ(e.target.value)} /></div>
          </div>
        </div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Person</th><th className="r">Brought Fwd</th><th className="r">Earned</th><th className="r">GST</th><th className="r">TDS</th><th className="r">Payable</th><th className="r">Paid</th><th className="r">Still Owed</th><th /></tr></thead>
            <tbody>
              {!rows.length && <tr><td colSpan={9}><Empty title="Nothing earned this month" text="Import brokerage and map clients to see payouts." /></td></tr>}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><div className="cell-main">{r.name}</div><div className="cell-sub mono">{r.code} · L{r.level}</div></td>
                  <td className="r mono small faint">{n(r.broughtFwd)}</td><td className="r mono small bold">{n(r.earned)}</td>
                  <td className="r mono small faint">{n(r.gst)}</td><td className="r mono small faint">{n(r.tds)}</td>
                  <td className="r mono small bold">{n(r.payable)} {r.estimated && <span className="tiny t-amber">EST</span>}</td>
                  <td className="r mono small t-green">{n(r.paid)}</td>
                  <td className={`r mono small bold ${r.owed > 0.005 ? 't-red' : 't-green'}`}>{n(r.owed)}</td>
                  <td className="r">{admin && <button className="btn btn-xs btn-caps" onClick={() => setPay(r)}>Record Payment</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {pay && <RecordPayment row={pay} period={data.period} onClose={() => setPay(null)} onDone={reload} />}
    </>
  );
}
