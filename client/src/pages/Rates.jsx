import { useRef, useState } from 'react';
import { Upload, Download, Trash2, Search, Pencil, History, X, CheckCircle2, AlertTriangle, FileText } from 'lucide-react';
import { api, qs } from '../api.js';
import { Card, PageHead, useLoad, useAction, Spinner, Empty, Modal, Field, Confirm, exportExcel, MONTHS } from '../ui.jsx';

export default function Rates() {
  const [f, setF] = useState({ q: '', amc: '', month: '', year: '', current: '1' });
  const [checked, setChecked] = useState(new Set());
  const [edit, setEdit] = useState(null);
  const [history, setHistory] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [run, busy] = useAction();
  const [files, setFiles] = useState([]);
  const [amc, setAmc] = useState('');
  const [password, setPassword] = useState('');
  const [drag, setDrag] = useState(false);
  const [result, setResult] = useState(null);
  const file = useRef();
  const { data, reload } = useLoad(() => api.get(`/rates${qs(f)}`), [JSON.stringify(f)]);

  // Step 1: pick files (button or drag & drop). Step 2: "Process files now" uploads and reads them.
  const OK_FILE = /\.(pdf|xlsx|xlsm|xls|csv|txt|ods)$/i;
  const addFiles = (list) => {
    const picked = [...list].filter((x) => OK_FILE.test(x.name));
    setResult(null);
    setFiles((cur) => [...cur, ...picked.filter((x) => !cur.some((c) => c.name === x.name && c.size === x.size))].slice(0, 20));
  };
  const processFiles = () => run(async () => {
    const fd = new FormData();
    for (const x of files) fd.append('files', x);
    fd.append('period', period);
    if (amc.trim()) fd.append('amc', amc.trim());
    if (password) fd.append('password', password);
    try {
      const r = await api.post('/rates/upload', fd);
      setResult(r);
      if (r.files.every((x) => !x.error)) setFiles([]);
      else setFiles((cur) => cur.filter((x) => r.files.some((y) => y.error && y.file === x.name)));
      reload();
      return r;
    } catch (e) {
      if (/413/.test(e.message)) throw new Error('The file is too large for the web server. Ask your admin to raise client_max_body_size in Nginx (e.g. 50M).');
      throw e;
    }
  }, (r) => (r.total ? `${r.total} scheme rate(s) saved from ${r.files.filter((x) => !x.error).length} file(s)` : 'No rates found. See the details under the upload box.'));
  const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const years = [...new Set((data?.rows || []).map((r) => r.period?.slice(0, 4)))].filter(Boolean);

  return (
    <>
      <PageHead title="BROKERAGE STRUCTURE" sub="Master control for AMC brokerage rates and PDF extraction.">
        <button className="btn btn-green btn-caps" onClick={() => exportExcel((data?.rows || []).map((r) => ({ AMC: r.amc, Scheme: r.scheme, Period: r.period, 'Gross Rate %': r.rate, Source: r.source })), 'brokerage-rates.csv')}><Download size={14} />Export CSV</button>
        <button className="btn btn-caps" onClick={() => setConfirm('reset')}><Trash2 size={14} />Reset Master</button>
      </PageHead>
      <div className="grid g-1-2">
        <div className="col gap-lg">
          <Card className="card-pad col gap">
            <div className={`dropzone ${drag ? 'drag' : ''}`} style={{ padding: 30, border: 'none' }} onClick={() => !busy && file.current.click()}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}>
              <Upload size={34} className="t-blue" />
              <div className="card-title" style={{ color: 'var(--text)' }}>Upload AMC Brokerage File</div>
              <div className="tiny upper bold">PDF, Excel or CSV — any layout, any file name</div>
              <button type="button" className="btn btn-primary btn-caps btn-lg" disabled={busy}>
                {files.length ? `Selected ${files.length} file${files.length === 1 ? '' : 's'}` : 'Select Files'}
              </button>
              <button type="button" className="btn btn-ghost btn-caps btn-xs" style={{ color: 'var(--blue)' }} disabled={!files.length || busy}
                onClick={(e) => { e.stopPropagation(); processFiles(); }}>{busy ? 'Processing…' : 'Process files now'}</button>
              <input ref={file} type="file" hidden multiple accept=".pdf,.xlsx,.xlsm,.xls,.csv,.txt,.ods" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            </div>
            {files.length > 0 && (
              <div className="col gap-sm">
                {files.map((x) => (
                  <div key={x.name + x.size} className="row gap-sm small" style={{ alignItems: 'center' }}>
                    <FileText size={14} className="faint" /><span className="grow semi" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.name}</span>
                    <span className="tiny faint">{kb(x.size)}</span>
                    <button className="icon-btn" title="Remove" disabled={busy} onClick={() => setFiles(files.filter((y) => y !== x))}><X size={13} /></button>
                  </div>
                ))}
                <div className="grid g2" style={{ gap: 8 }}>
                  <Field label="Effective month"><input type="month" className="input sm" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
                  <Field label="AMC (optional)" hint="Leave blank to detect it from the file"><input className="input sm" value={amc} placeholder="e.g. SBI" onChange={(e) => setAmc(e.target.value)} /></Field>
                </div>
                {files.some((x) => /\.pdf$/i.test(x.name)) && (
                  <Field label="PDF password (only if the PDF asks for one)" hint="Used for every selected PDF. Upload PDFs with different passwords one at a time.">
                    <input className="input sm" type="password" autoComplete="off" value={password} placeholder="Leave blank if the PDF opens without a password" onChange={(e) => setPassword(e.target.value)} />
                  </Field>
                )}
              </div>
            )}
            {result && (
              <div className="col gap-sm">
                {result.files.map((x) => (
                  <div key={x.file} className={`banner ${x.error || !x.schemes ? 'amber' : 'green'}`} style={{ display: 'block' }}>
                    <div className="row gap-sm semi small" style={{ alignItems: 'center' }}>
                      {x.error || !x.schemes ? <AlertTriangle size={14} className="t-amber" /> : <CheckCircle2 size={14} className="t-green" />}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.file}</span>
                    </div>
                    <div className="tiny" style={{ marginTop: 4 }}>
                      {x.error || (x.schemes ? `${x.schemes} scheme rate(s): ${x.added} new, ${x.updated} updated${x.amcs?.length ? ` · ${x.amcs.join(', ')}` : ''}` : '')}
                    </div>
                    {!x.error && x.notes?.map((n) => <div key={n} className="tiny muted">{n}</div>)}
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card className="card-pad col gap">
            <div className="card-title">Structure Analytics</div>
            <div className="kv"><span className="upper faint" style={{ fontSize: 9.5 }}>Total Schemes</span><b style={{ fontSize: 18 }}>{data?.stats.schemes ?? 0}</b></div>
            <div className="kv"><span className="upper faint" style={{ fontSize: 9.5 }}>Rate Versions</span><b className="faint" style={{ fontSize: 18 }}>{data?.stats.versions ?? 0}</b></div>
            <div className="kv"><span className="upper faint" style={{ fontSize: 9.5 }}>Tracked AMCs</span><b style={{ fontSize: 18 }}>{data?.stats.amcs ?? 0}</b></div>
          </Card>
        </div>
        <Card>
          <div style={{ padding: 14 }} className="col gap-sm">
            <div className="row gap wrap">
              <div className="input-icon grow"><Search size={14} /><input className="input" placeholder="Search Master List..." value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
              <select className="select sm" value={f.amc} onChange={(e) => setF({ ...f, amc: e.target.value })}><option value="">All AMCs</option>{data?.amcs.map((a) => <option key={a}>{a}</option>)}</select>
              <select className="select sm" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })}><option value="">Months</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
              <select className="select sm" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })}><option value="">Years</option>{years.map((y) => <option key={y}>{y}</option>)}</select>
            </div>
            <div className="row between">
              <label className="check"><input type="checkbox" checked={f.current === '1'} onChange={(e) => setF({ ...f, current: e.target.checked ? '1' : '0' })} />Current rate only</label>
              <div className="row gap">
                {checked.size > 0 && <button className="btn btn-red-soft btn-xs" onClick={() => setConfirm('selected')}><Trash2 size={11} />Delete {checked.size}</button>}
                <span className="tiny upper faint bold">{data?.rows.length ?? 0} master schemes</span>
              </div>
            </div>
          </div>
          {!data ? <Spinner /> : (
            <div className="table-wrap scroll" style={{ maxHeight: 640 }}>
              <table className="t">
                <thead><tr><th style={{ width: 30 }}><input type="checkbox" checked={data.rows.length > 0 && checked.size === data.rows.length} onChange={(e) => setChecked(new Set(e.target.checked ? data.rows.map((r) => r.id) : []))} /></th>
                  <th>AMC &amp; Scheme Name</th><th className="c">Period</th><th className="c">Gross Rate</th><th className="r">Control</th></tr></thead>
                <tbody>
                  {!data.rows.length && <tr><td colSpan={5}><Empty title="No rates yet" text="Upload AMC brokerage PDFs or a rate sheet." /></td></tr>}
                  {data.rows.map((r) => (
                    <tr key={r.id}>
                      <td><input type="checkbox" checked={checked.has(r.id)} onChange={() => { const s = new Set(checked); s.has(r.id) ? s.delete(r.id) : s.add(r.id); setChecked(s); }} /></td>
                      <td><div className="cell-main small">{r.scheme}</div><div className="cell-sub blue upper">{r.amc}</div></td>
                      <td className="c tiny bold faint">{r.period}</td>
                      <td className="c bold" style={{ fontSize: 15 }}>{r.rate}%</td>
                      <td className="r" style={{ whiteSpace: 'nowrap' }}>
                        <button className="icon-btn" title="Rate history" onClick={() => api.get(`/rates/history${qs({ amc: r.amc, scheme: r.scheme })}`).then((h) => setHistory({ r, h }))}><History size={14} /></button>
                        <button className="icon-btn" onClick={() => setEdit({ ...r })}><Pencil size={14} /></button>
                        <button className="icon-btn" onClick={() => run(() => api.post('/rates/delete', { ids: [r.id] }).then(reload), 'Rate deleted')}><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      {edit && <Modal title="Edit Rate" onClose={() => setEdit(null)} footer={<>
        <button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button>
        <button className="btn btn-primary" onClick={() => run(() => api.put(`/rates/${edit.id}`, edit).then(() => { setEdit(null); reload(); }), 'Rate updated')}>Save</button></>}>
        <Field label="Scheme"><input className="input" value={edit.scheme} onChange={(e) => setEdit({ ...edit, scheme: e.target.value })} /></Field>
        <div className="grid g2">
          <Field label="Gross Rate %"><input className="input" type="number" step="0.01" value={edit.rate} onChange={(e) => setEdit({ ...edit, rate: e.target.value })} /></Field>
          <Field label="Period"><input className="input" type="month" value={edit.period} onChange={(e) => setEdit({ ...edit, period: e.target.value })} /></Field>
        </div>
      </Modal>}
      {history && <Modal title="Rate History" onClose={() => setHistory(null)}>
        <div className="semi">{history.r.scheme}</div>
        <table className="t compact card"><thead><tr><th>Period</th><th>Rate</th><th>Source</th></tr></thead>
          <tbody>{history.h.map((x) => <tr key={x.id}><td>{x.period}</td><td className="bold">{x.rate}%</td><td className="tiny muted">{x.source}</td></tr>)}</tbody></table>
      </Modal>}
      {confirm && <Confirm danger title={confirm === 'reset' ? 'Reset the rate master?' : 'Delete selected rates?'} text={confirm === 'reset' ? 'Every scheme rate and its history will be deleted.' : `${checked.size} rate row(s) will be deleted.`}
        confirmLabel={confirm === 'reset' ? 'Reset Master' : 'Delete'} onClose={() => setConfirm(null)}
        onConfirm={() => run(() => (confirm === 'reset' ? api.post('/rates/reset') : api.post('/rates/delete', { ids: [...checked] })).then(() => { setChecked(new Set()); reload(); }), 'Done')} />}
    </>
  );
}
