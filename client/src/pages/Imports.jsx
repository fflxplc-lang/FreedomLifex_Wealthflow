import { useRef, useState } from 'react';
import { CloudUpload, Database, Trash2, RefreshCw, Calendar, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api, qs } from '../api.js';
import { Card, PageHead, Segmented, useLoad, useAction, Spinner, Empty, Confirm, MONTHS, periodLabel, inrPlain } from '../ui.jsx';

const TYPES = [
  { kind: 'transactions', title: '1 · Transactions (Full)', note: 'WBR2 / MFSD201 — PAN + full names', opts: [['CAMS', 'CAMS WBR2'], ['KARVY', 'Karvy MFSD201']] },
  { kind: 'folio', title: '2 · Folio Master', note: 'WBR9 / MFSD211 — investor master only', opts: [['CAMS', 'CAMS WBR9'], ['KARVY', 'Karvy MFSD211']] },
  { kind: 'brokerage', title: '3 · Brokerage Statement', note: 'CAMS (normal, then SIF), then Karvy', opts: [['CAMS', 'CAMS'], ['KARVY', 'Karvy']] },
];

function NewUpload({ onDone }) {
  const now = new Date();
  const [sel, setSel] = useState({ kind: 'transactions', source: 'CAMS' });
  const [month, setMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [result, setResult] = useState(null);
  const [drag, setDrag] = useState(false);
  const [run, busy] = useAction();
  const input = useRef();

  const send = (file) => run(async () => {
    const fd = new FormData();
    fd.append('file', file); fd.append('kind', sel.kind); fd.append('source', sel.source); fd.append('period', `${year}-${month}`);
    const r = await api.post('/imports/upload', fd);
    setResult(r); onDone();
    return r;
  }, (r) => `${r.fileName}: ${r.rows} rows imported`);

  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() + 1 - i);
  return (
    <div className="grid g-1-2">
      <div className="col gap-lg">
        <Card className="card-pad col gap">
          <h3 className="row gap"><span className="step-num">1</span>Source &amp; Period</h3>
          {TYPES.map((t) => (
            <div key={t.kind}>
              <div className="row between mt-sm"><span className="upper" style={{ fontSize: 10 }}>{t.title}</span><span className="tiny faint">{t.note}</span></div>
              <div className="grid g2 mt-sm" style={{ gap: 8 }}>
                {t.opts.map(([src, label]) => {
                  const on = sel.kind === t.kind && sel.source === src;
                  return <button key={src} className={`btn ${on ? 'btn-primary' : ''}`} style={{ height: 36 }} onClick={() => setSel({ kind: t.kind, source: src })}>{label}</button>;
                })}
              </div>
            </div>
          ))}
          <div className="upper row gap-sm mt-sm" style={{ fontSize: 10 }}><Calendar size={12} />Settlement Month</div>
          <div className="grid g2" style={{ gap: 8 }}>
            <select className="select" value={month} onChange={(e) => setMonth(e.target.value)}>{MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}</select>
            <select className="select" value={year} onChange={(e) => setYear(e.target.value)}>{years.map((y) => <option key={y}>{y}</option>)}</select>
          </div>
        </Card>
        <Card className="card-pad col gap">
          <h3 className="row gap"><span className="step-num">2</span>Select File</h3>
          <div className={`dropzone ${drag ? 'drag' : ''}`} onClick={() => input.current.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) send(e.dataTransfer.files[0]); }}>
            {busy ? <RefreshCw className="spin" size={28} /> : <CloudUpload size={30} />}
            <span>{busy ? 'Processing…' : 'Upload Spreadsheet'}</span>
            <span className="tiny">.xls, .xlsx, .csv, .dbf</span>
          </div>
          <input ref={input} type="file" hidden accept=".xls,.xlsx,.csv,.txt,.dbf" onChange={(e) => { if (e.target.files[0]) send(e.target.files[0]); e.target.value = ''; }} />
        </Card>
      </div>
      <Card className="card-pad" style={{ borderStyle: result ? 'solid' : 'dashed', borderWidth: result ? 1 : 2 }}>
        {!result ? <Empty icon={<Database size={34} />} title="" text="Upload spreadsheet to start automated processing." /> : (
          <div className="col gap">
            <div className="row gap"><CheckCircle2 className="t-green" /><div><h3>{result.fileName}</h3><div className="tiny muted">{result.source} {result.variant} · {periodLabel(result.period)}</div></div></div>
            <div className="grid g4" style={{ gap: 10 }}>
              <div className="kv col"><span className="tiny faint upper">Rows</span><b>{result.rows.toLocaleString()}</b><span className="tiny faint">was {result.rawRows}</span></div>
              <div className="kv col"><span className="tiny faint upper">Total business</span><b>{inrPlain(result.total, 2)}</b></div>
              <div className="kv col"><span className="tiny faint upper">New clients</span><b>{result.newClients}</b></div>
              <div className="kv col"><span className="tiny faint upper">Unmapped rows</span><b className={result.unmapped ? 't-amber' : ''}>{result.unmapped}</b></div>
            </div>
            {result.duplicatesRemoved > 0 && <div className="banner amber">{result.duplicatesRemoved} exact duplicate row(s) in the file were skipped.</div>}
            {result.unmapped > 0 && <div className="banner amber">Some brokerage rows have no client yet. Import the Folio Master, then use Batch History → Re-map Unmapped.</div>}
            <div className="table-wrap scroll" style={{ maxHeight: 360 }}>
              <table className="t compact">
                <thead><tr>{Object.keys(result.sample[0] || {}).map((k) => <th key={k}>{k.replace('_', ' ')}</th>)}</tr></thead>
                <tbody>{result.sample.map((r, i) => <tr key={i}>{Object.values(r).map((v, j) => <td key={j} className="small">{String(v ?? '')}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <div className="tiny faint">Showing the first {result.sample.length} cleaned rows.</div>
          </div>
        )}
      </Card>
    </div>
  );
}

function BatchTable({ status, onChange }) {
  const [q, setQ] = useState('');
  const [month, setMonth] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [run] = useAction();
  const { data, reload } = useLoad(() => api.get(`/imports/batches${qs({ status, q, month })}`), [status, q, month]);
  const act = (fn, msg) => run(async () => { const r = await fn(); reload(); onChange(); return r; }, msg);
  if (!data) return <Spinner />;
  const trash = status === 'deleted';
  return (
    <Card>
      {trash
        ? <div className="banner amber" style={{ borderRadius: '14px 14px 0 0', border: 0, borderBottom: '1px solid var(--amber-border)' }}><AlertTriangle size={13} style={{ verticalAlign: -2 }} /> Deleted batches are hidden from reports but kept for restoration. Permanently purge to free space.</div>
        : <div className="card-head"><span className="small muted">After importing a Folio Master, use this to link any new investors' brokerage to their client.</span>
          <button className="btn btn-primary" onClick={() => act(() => api.post('/imports/remap'), (r) => `Re-mapped ${r.mapped} of ${r.scanned} unmapped row(s)`)}><RefreshCw size={14} />Re-map Unmapped</button></div>}
      <div className="row gap" style={{ padding: '14px 18px' }}>
        <input className="input sm" style={{ width: 190 }} placeholder="Search file name..." value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="select sm" value={month} onChange={(e) => setMonth(e.target.value)}>
          <option value="">All months</option>{data.periods.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
        </select>
        <span className="tiny muted">Showing {data.rows.length} of {trash ? data.trash : data.live}</span>
      </div>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>Batch File</th><th>{trash ? 'Deleted On' : 'Import Date'}</th><th className="c">Type</th><th className="c">Rows</th><th className="r">Total Business</th>{!trash && <th className="c">Status</th>}<th className="c">Actions</th></tr></thead>
          <tbody>
            {!data.rows.length && <tr><td colSpan={7}><Empty title={trash ? 'Trash is empty' : 'No batches yet'} text={trash ? '' : 'Upload a registrar file in New Upload.'} /></td></tr>}
            {data.rows.map((b) => (
              <tr key={b.id}>
                <td><div className="cell-main">{b.file_name}</div><div className="cell-sub upper">{periodLabel(b.period)}</div></td>
                <td className="muted">{new Date(`${(trash ? b.deleted_at : b.created_at).replace(' ', 'T')}Z`).toLocaleString('en-IN')}</td>
                <td className="c"><span className="tag">{b.source} {b.variant}</span><div className="cell-sub">{b.kind}</div></td>
                <td className="c"><b>{b.rows.toLocaleString()}</b>{b.raw_rows !== b.rows && <div className="cell-sub">WAS {b.raw_rows.toLocaleString()}</div>}</td>
                <td className="r"><b className="t-blue">{inrPlain(b.total, 2)}</b>{Math.abs(b.raw_total - b.total) > 0.001 && <div className="cell-sub">WAS {inrPlain(b.raw_total, 3)}</div>}</td>
                {!trash && <td className="c"><span className="badge green">Live</span></td>}
                <td className="c">
                  {trash ? (
                    <div className="row gap-sm" style={{ justifyContent: 'center' }}>
                      <button className="btn btn-primary btn-xs" onClick={() => act(() => api.post(`/imports/batches/${b.id}/restore`), 'Batch restored')}><RefreshCw size={11} />Restore</button>
                      <button className="btn btn-red-soft btn-xs" onClick={() => setConfirm(b)}><Trash2 size={11} />Delete Forever</button>
                    </div>
                  ) : <button className="icon-btn t-red" onClick={() => act(() => api.del(`/imports/batches/${b.id}`), 'Moved to trash')}><Trash2 size={15} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {confirm && <Confirm danger title="Delete forever?" text={`${confirm.file_name} and its ${confirm.rows} rows will be permanently removed. This cannot be undone.`} confirmLabel="Delete Forever"
        onClose={() => setConfirm(null)} onConfirm={() => act(() => api.del(`/imports/batches/${confirm.id}/purge`), 'Batch permanently deleted')} />}
    </Card>
  );
}

export default function Imports() {
  const [tab, setTab] = useState('new');
  const { data, reload } = useLoad(() => api.get('/imports/batches?status=deleted'), []);
  return (
    <>
      <PageHead title="Data Import" sub="Processing brokerage files with automated name standardization.">
        <Segmented value={tab} onChange={setTab} options={[{ value: 'new', label: 'New Upload' }, { value: 'history', label: 'Batch History' }, { value: 'trash', label: 'Trash', icon: <Trash2 size={13} />, count: data?.trash ?? 0 }]} />
      </PageHead>
      {tab === 'new' && <NewUpload onDone={reload} />}
      {tab === 'history' && <BatchTable status="live" onChange={reload} />}
      {tab === 'trash' && <BatchTable status="deleted" onChange={reload} />}
    </>
  );
}
