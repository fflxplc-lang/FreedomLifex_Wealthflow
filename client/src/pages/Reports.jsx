import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layers, Clock, Briefcase, FileText, Users, TrendingUp, ShieldCheck, AlertTriangle, Landmark, Search, Filter, Download, FileDown, Upload, ArrowRight } from 'lucide-react';
import { api, qs, openWithToken } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Card, PageHead, Tabs, Stat, useLoad, useAction, Spinner, Empty, ExportBtn, YearMonth, Segmented, Modal, exportExcel, inr, inrPlain, inrShort, pct } from '../ui.jsx';

function Summary({ f }) {
  const { data } = useLoad(() => api.get(`/reports/summary${qs(f)}`), [f.year, f.month]);
  if (!data) return <Spinner />;
  return (
    <>
      <div className="grid g3">
        <Stat label="System Gross" value={inr(data.gross)} />
        <Stat label="My Net Payout" value={inr(data.myNet)} tone="green" />
        <Stat label="Transactions" value={data.transactions.toLocaleString('en-US')} />
      </div>
      <Card className="mt">
        <div className="card-head"><span className="card-title">Month-wise Gross Breakdown</span></div>
        <table className="t">
          <thead><tr><th>Month</th><th className="c">Volume</th><th className="r">Gross Brokerage (₹)</th><th className="r">Payout Pool (₹)</th></tr></thead>
          <tbody>
            {!data.months.length && <tr><td colSpan={4}><Empty title="No brokerage for this period" /></td></tr>}
            {data.months.map((m) => <tr key={m.period}><td className="bold">{m.period}</td><td className="c">{m.volume.toLocaleString()}</td><td className="r bold">{inrPlain(m.gross)}</td><td className="r semi t-blue">{inrPlain(m.pool)}</td></tr>)}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function Monthly({ f, admin }) {
  const [userId, setUserId] = useState('');
  const [run] = useAction();
  const users = useLoad(() => (admin ? api.get('/users') : Promise.resolve([])), []);
  const { data, reload } = useLoad(() => api.get(`/reports/monthly${qs({ ...f, userId })}`), [f.year, f.month, userId]);
  const setTax = (patch) => run(() => api.put('/reports/invoice-settings', { ...data.invoice, ...patch }).then(reload));
  if (!data) return <Spinner />;
  const inv = data.invoice;
  return (
    <>
      <Card className="card-pad">
        <div className="card-title" style={{ fontSize: 12 }}>Tax Settings for Invoice</div>
        <div className="row gap-lg mt-sm wrap">
          <span className="row gap-sm"><button className={`toggle blue ${inv.gstEnabled ? 'on' : ''}`} disabled={!admin} onClick={() => setTax({ gstEnabled: !inv.gstEnabled })} /><b className="small">GST</b>
            {inv.gstEnabled && <><input className="input sm" style={{ width: 60 }} type="number" value={inv.gstPct} disabled={!admin} onChange={(e) => setTax({ gstPct: Number(e.target.value) })} /> %</>}</span>
          {inv.gstEnabled && <span className="tiny t-blue bold">Will add GST on invoice</span>}
          <span className="row gap-sm"><button className={`toggle ${inv.tdsEnabled ? 'on' : ''}`} disabled={!admin} onClick={() => setTax({ tdsEnabled: !inv.tdsEnabled })} /><b className="small">TDS Deduction</b>
            <input className="input sm" style={{ width: 60 }} type="number" value={inv.tdsPct} disabled={!admin} onChange={(e) => setTax({ tdsPct: Number(e.target.value) })} /> %</span>
          {inv.tdsEnabled && <span className="tiny t-amber bold">Will deduct TDS from net payable</span>}
          {admin && <select className="select sm" style={{ marginLeft: 'auto' }} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">My own payouts</option>{(users.data || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>}
        </div>
      </Card>
      <Card className="mt">
        <div className="card-head"><span className="semi">{data.user.name}</span>
          <ExportBtn onClick={() => exportExcel(data.rows.map((r) => ({ Period: r.period, Transactions: r.txs, 'My Share': r.share, GST: r.gst, TDS: r.tds, 'Net Payable': r.net, Status: r.status || '' })), `monthly-payouts-${data.user.name}.xlsx`)} /></div>
        <table className="t">
          <thead><tr><th>Settlement Period</th><th className="c">Txs</th><th className="r">My Share (₹)</th>{inv.gstEnabled && <th className="r">GST {inv.gstPct}% (₹)</th>}{inv.tdsEnabled && <th className="r">TDS {inv.tdsPct}% (₹)</th>}<th className="r">Net Payable (₹)</th><th className="c">Action</th></tr></thead>
          <tbody>
            {!data.rows.length && <tr><td colSpan={5 + (inv.gstEnabled ? 1 : 0) + (inv.tdsEnabled ? 1 : 0)}><Empty title="No payouts yet" text="Payouts appear once brokerage is imported and clients are mapped to this person." /></td></tr>}
            {data.rows.map((r) => (
              <tr key={r.period}>
                <td className="bold">{r.period}</td><td className="c">{r.txs}</td><td className="r">{inrPlain(r.share)}</td>
                {inv.gstEnabled && <td className="r t-blue">+{inrPlain(r.gst)}</td>}{inv.tdsEnabled && <td className="r t-amber">−{inrPlain(r.tds)}</td>}
                <td className="r bold t-blue">{inrPlain(r.net)}</td>
                <td className="c" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-xs" onClick={() => openWithToken(`/reports/invoice${qs({ period: r.period, userId })}`)}><FileDown size={12} />Invoice</button>{' '}
                  {r.status ? <span className={`badge ${r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : 'amber'}`}>{r.status}</span>
                    : <button className="btn btn-primary btn-xs" onClick={() => run(() => api.post('/reports/settlements', { period: r.period, userId }).then(reload), 'Sent for approval')}>Request Settlement</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function ClientWise({ f }) {
  const [q, setQ] = useState('');
  const { data } = useLoad(() => api.get(`/reports/client-wise${qs(f)}`), [f.year, f.month]);
  if (!data) return <Spinner />;
  const rows = data.rows.filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()) || (r.pan || '').toLowerCase().includes(q.toLowerCase()));
  return (
    <Card>
      <div className="card-head">
        <div className="row gap-lg"><span className="card-title">Investor Breakdown</span>
          <div className="input-icon"><Search size={13} /><input className="input sm" style={{ width: 210 }} placeholder="SEARCH INVESTOR OR PAN..." value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
        <div className="row gap"><span className="badge blue">{rows.length} Investors Found</span>
          <ExportBtn onClick={() => exportExcel(rows.map((r) => ({ Investor: r.name, PAN: r.pan, Txs: r.txs, AUM: r.aum, 'Total Brokerage': r.gross })), 'client-wise.xlsx')} /></div>
      </div>
      <div className="table-wrap scroll">
        <table className="t">
          <thead><tr><th>Investor Name</th><th>PAN</th><th className="c">Txs</th><th className="r">AUM</th><th className="r">Total Brokerage (₹)</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}><td className="bold">{r.name}</td><td className="mono tiny faint">{r.pan || '—'}</td><td className="c semi">{r.txs}</td>
              <td className="r"><div className="bold t-green">{inrShort(r.aum)}</div><div className="cell-sub">{data.aumPeriod}</div></td><td className="r bold" style={{ fontSize: 15 }}>{inr(r.gross, 2)}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </Card>
  );
}

function Logs({ f }) {
  const [page, setPage] = useState(1);
  const { data } = useLoad(() => api.get(`/reports/logs${qs({ ...f, page })}`), [f.year, f.month, page]);
  if (!data) return <Spinner />;
  return (
    <Card>
      <div className="card-head" style={{ justifyContent: 'flex-end' }}>
        <ExportBtn onClick={() => exportExcel(data.rows.map((r) => ({ Date: r.date, Investor: r.investor, Scheme: r.scheme, Gross: r.gross, 'My Rate %': r.myRate ?? '', 'My Share': r.myShare })), 'payout-logs.xlsx')} />
      </div>
      <div className="table-wrap scroll">
        <table className="t">
          <thead><tr><th>Date</th><th>Investor / Scheme</th><th className="r">Gross (₹)</th><th className="c">My Rate (%)</th><th className="r">My Share (₹)</th></tr></thead>
          <tbody>
            {!data.rows.length && <tr><td colSpan={5}><Empty title="No transactions" /></td></tr>}
            {data.rows.map((r) => <tr key={r.id}><td className="muted small">{r.date}</td><td><div className="cell-main small">{r.investor}</div><div className="cell-sub">{r.scheme}</div></td>
              <td className="r small">{inr(r.gross, 3)}</td><td className="c">{r.myRate != null ? pct(r.myRate) : '-'}</td><td className="r bold t-green">{inr(r.myShare)}</td></tr>)}
          </tbody>
        </table>
      </div>
      <div className="pager"><span className="pager-info">PAGE {page}</span><div className="pager-btns">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>Prev</button><button disabled={data.rows.length < 200} onClick={() => setPage(page + 1)}>Next</button></div></div>
    </Card>
  );
}

function Team({ f }) {
  const [q, setQ] = useState('');
  const { data } = useLoad(() => api.get(`/reports/team${qs(f)}`), [f.year, f.month]);
  if (!data) return <Spinner />;
  const rows = data.rows.filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Card>
      <div className="card-head">
        <div className="row gap-lg"><span className="card-title">System-wide Distribution</span>
          <div className="input-icon"><Filter size={13} /><input className="input sm" style={{ width: 210 }} placeholder="SEARCH USER NAME..." value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
        <div className="row gap"><ExportBtn onClick={() => exportExcel(rows.map((r) => ({ Name: r.name, Code: r.code, Level: r.level, Role: r.level_name, Gross: r.gross, Earnings: r.earnings, '% of Gross': r.pctOfGross })), 'team-payouts.xlsx')} /><span className="badge blue">{data.label}</span></div>
      </div>
      <div className="table-wrap scroll">
        <table className="t">
          <thead><tr><th>User Details</th><th>Role / Level</th><th className="r">Gross Brokerage (₹)</th><th className="r">Their Earnings (₹)</th><th className="r">% of Gross</th><th className="c">Status</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td><div className="cell-main">{r.name}</div><div className="cell-sub">{r.code}</div></td>
              <td><div className="upper" style={{ fontSize: 10, color: 'var(--text-2)' }}>{r.level_name}</div><div className="cell-sub">LEVEL {r.level}</div></td>
              <td className="r muted">{inr(r.gross, 3)}</td><td className="r bold">{inr(r.earnings)}</td><td className="r bold t-purple">{pct(r.pctOfGross)}</td>
              <td className="c"><span className="tiny bold"><span className="t-green">●</span> {r.status}</span></td></tr>
          ))}</tbody>
        </table>
      </div>
    </Card>
  );
}

function Delta({ prev, cur }) {
  const d = prev ? ((cur - prev) / Math.abs(prev)) * 100 : null;
  return <span className={`badge ${d === null || Math.abs(d) < 0.005 ? 'gray' : d > 0 ? 'green' : 'red'}`} style={{ padding: '3px 8px' }}>{d === null ? '—' : `${d > 0 ? '+' : ''}${d.toFixed(1)}%`}</span>;
}

function Growth({ f }) {
  const [mode, setMode] = useState('mom');
  const [custom, setCustom] = useState({ curFrom: '', curTo: '', prevFrom: '', prevTo: '' });
  const { data } = useLoad(() => api.get(`/reports/growth${qs({ ...f, mode, ...(mode === 'custom' ? custom : {}) })}`), [f.year, f.month, mode, mode === 'custom' ? JSON.stringify(custom) : '']);
  if (!data) return <Spinner />;
  const span = (r) => (r[0] === r[1] ? r[0] : `${r[0]} → ${r[1]}`);
  const Metric = ({ title, sub, k, hl }) => (
    <Card className="card-pad" style={hl ? { background: 'var(--blue-soft)', borderColor: '#c7d7fe' } : undefined}>
      <div className="row between"><div><div className={`upper ${hl ? 't-blue' : ''}`} style={{ fontSize: 10 }}>{title}</div><div className="tiny faint">{sub}</div></div><Delta prev={data.totals.prev[k]} cur={data.totals.cur[k]} /></div>
      <div className="grid g2 mt"><div><div className="tiny faint upper">Previous</div><b>{inr(data.totals.prev[k], 0)}</b></div><div><div className="tiny faint upper">Current</div><b className={hl ? 't-blue' : ''}>{inr(data.totals.cur[k], 0)}</b></div></div>
    </Card>
  );
  const Pair = ({ p, c, k, blue }) => (
    <div className="row gap-sm" style={{ justifyContent: 'flex-end' }}>
      <div className="right"><div className="tiny faint">PREV</div><span className="muted">{inr(p[k], 0)}</span></div><ArrowRight size={12} className="faint" />
      <div className="right"><div className="tiny faint">CURR</div><b className={blue ? 't-blue' : ''}>{inr(c[k], 0)}</b></div><Delta prev={p[k]} cur={c[k]} />
    </div>
  );
  return (
    <>
      <Card className="card-pad row between wrap gap">
        <div><div className="card-title" style={{ fontSize: 12 }}>Comparison Mode</div>
          <div className="tiny muted">Comparing <b className="t-blue">{span(data.cur)}</b> vs <b>{span(data.prev)}</b> (uses Year/Month filter above)</div></div>
        <Segmented className="solid caps" value={mode} onChange={setMode} options={[{ value: 'mom', label: 'Month-over-Month' }, { value: 'qoq', label: 'Quarter-over-Quarter' }, { value: 'yoy', label: 'Year-over-Year' }, { value: 'custom', label: 'Custom' }]} />
        {mode === 'custom' && <div className="row gap wrap" style={{ width: '100%' }}>
          {['curFrom', 'curTo', 'prevFrom', 'prevTo'].map((k) => <label key={k} className="row gap-sm tiny bold upper faint">{k.replace(/([A-Z])/g, ' $1')}<input type="month" className="input sm" value={custom[k]} onChange={(e) => setCustom({ ...custom, [k]: e.target.value })} /></label>)}
        </div>}
      </Card>
      {!data.hasData && <div className="banner amber mt">No brokerage has been imported for {span(data.cur)} yet, so there is nothing to compare — this is not a fall to zero.</div>}
      <div className="grid g3 mt">
        <Metric title="Avg AUM Growth" sub="Sum of avg_assets per transaction" k="avgAum" />
        <Metric title="Snapshot AUM Growth" sub="Latest value per folio at period end" k="snapAum" />
        <Metric title="Brokerage Share Growth" sub="Actual payout from the sharing engine" k="share" hl />
      </div>
      <Card className="mt">
        <div className="card-head"><span className="card-title">Per-Member Growth ({data.members.length})</span>
          <button className="btn btn-green btn-caps" onClick={() => exportExcel(data.members.map((m) => ({ Member: m.name, Code: m.code, Level: m.level, 'Prev Avg AUM': m.prev.avgAum, 'Curr Avg AUM': m.cur.avgAum, 'Prev Snapshot AUM': m.prev.snapAum, 'Curr Snapshot AUM': m.cur.snapAum, 'Prev Share': m.prev.share, 'Curr Share': m.cur.share })), 'growth-report.xlsx')}><Download size={13} />Export Growth Report</button></div>
        <div className="table-wrap scroll">
          <table className="t">
            <thead><tr><th>Member</th><th className="r">Avg AUM</th><th className="r">Snapshot AUM</th><th className="r">Brokerage Share</th></tr></thead>
            <tbody>{data.members.map((m) => (
              <tr key={m.id}><td><div className="cell-main">{m.name}</div><div className="cell-sub">{m.code} · L{m.level}</div>{!m.cur.avgAum && !m.cur.snapAum && <div className="tiny t-amber bold">⚠ AUM data missing</div>}</td>
                <td><Pair p={m.prev} c={m.cur} k="avgAum" /></td><td><Pair p={m.prev} c={m.cur} k="snapAum" /></td><td><Pair p={m.prev} c={m.cur} k="share" blue /></td></tr>
            ))}</tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function Approvals() {
  const [run] = useAction();
  const { data, reload } = useLoad(() => api.get('/reports/approvals'), []);
  if (!data) return <Spinner />;
  return (
    <Card>
      <div className="card-head" style={{ background: 'var(--blue-soft)', borderRadius: '14px 14px 0 0' }}>
        <div><div className="bold" style={{ color: 'var(--blue-text)' }}>SETTLEMENT QUEUE</div><div className="tiny bold t-blue">ADMIN AUTHORIZATION HUB</div></div>
      </div>
      <table className="t">
        <thead><tr><th>Payee</th><th>Period</th><th className="r">Base (₹)</th><th className="r">Net Payable (₹)</th><th className="c">Status</th><th className="r">Authorization</th></tr></thead>
        <tbody>
          {!data.length && <tr><td colSpan={6}><Empty icon={<ShieldCheck size={30} />} title="Queue is clear" text="Settlement requests from Monthly Payouts land here." /></td></tr>}
          {data.map((s) => (
            <tr key={s.id}>
              <td><div className="cell-main">{s.name}</div><div className="cell-sub upper">{s.level_name}</div></td><td>{s.period}</td><td className="r semi">{inr(s.base)}</td>
              <td className="r"><div className="bold t-blue">{inr(s.net)}</div><div className="cell-sub">{s.gst ? '+GST 18% · ' : ''}{s.tds ? '−TDS' : ''}</div></td>
              <td className="c"><span className="badge amber">Pending Approval</span></td>
              <td className="r" style={{ whiteSpace: 'nowrap' }}>
                <button className="icon-btn" onClick={() => openWithToken(`/reports/invoice${qs({ period: s.period, userId: s.user_id })}`)}><Download size={14} /></button>{' '}
                <button className="btn btn-primary btn-xs btn-caps" onClick={() => run(() => api.post(`/reports/approvals/${s.id}/approve`).then(reload), 'Approved')}>Approve</button>{' '}
                <button className="btn btn-red-soft btn-xs btn-caps" onClick={() => run(() => api.post(`/reports/approvals/${s.id}/reject`).then(reload), 'Rejected')}>Reject</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function BulkPreview({ preview, onClose, onApplied }) {
  const [run, busy] = useAction();
  return (
    <Modal wide title="Review mapping changes" onClose={onClose} footer={<>
      <span className="small muted grow">{preview.ok} change(s) ready · {preview.errors} row(s) need attention</span>
      <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-green" disabled={busy || !preview.ok} onClick={() => run(() => api.post('/reports/bulk-mapping/apply', { rows: preview.rows }).then((r) => { onApplied(); onClose(); return r; }), (r) => `${r.applied} client(s) re-mapped`)}>Apply {preview.ok} change(s)</button>
    </>}>
      <div className="table-wrap scroll card" style={{ maxHeight: 460 }}>
        <table className="t compact">
          <thead><tr><th>Client</th><th>PAN</th><th>RM read as</th><th>BM read as</th><th>Lead by</th><th>Result</th></tr></thead>
          <tbody>{preview.rows.map((r, i) => (
            <tr key={i}><td className="semi">{r.client}</td><td className="mono tiny">{r.pan}</td>
              <td>{r.rm || '—'}{r.rmCorrected && <span className="tiny t-amber"> (spelling corrected)</span>}</td>
              <td>{r.bm || '—'}{r.bmCorrected && <span className="tiny t-amber"> (spelling corrected)</span>}</td>
              <td>{r.leadByName || '—'}</td>
              <td>{r.errors.length ? <span className="tiny t-red">{r.errors.join('; ')}</span> : r.changed ? <span className="badge green">Will change</span> : <span className="badge gray">No change</span>}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </Modal>
  );
}

function Reconciliation({ f }) {
  const nav = useNavigate();
  const [period, setPeriod] = useState('');
  const [exceptions, setExceptions] = useState(null);
  const [preview, setPreview] = useState(null);
  const [rmId, setRmId] = useState('');
  const [run, busy] = useAction();
  const bulk = useRef(), rmFile = useRef();
  const users = useLoad(() => api.get('/users'), []);
  const { data, reload } = useLoad(() => api.get(`/reports/reconciliation${qs(f)}`), [f.year, f.month]);
  const download = () => run(async () => {
    const r = await api.get(`/reports/reconciliation/export${qs(f)}`);
    exportExcel(r.rows.map((x) => ({ Month: x.period, Person: x.person, Code: x.code || '', Transactions: x.txns, 'Net (₹)': x.net })), 'reconciliation.xlsx');
  });
  const upload = (file, url, extra = {}) => { const fd = new FormData(); fd.append('file', file); for (const [k, v] of Object.entries(extra)) fd.append(k, v); return api.post(url, fd); };

  return (
    <div className="col gap-lg">
      <div className="row between wrap gap">
        <div><h2>Monthly Reconciliation</h2><div className="tiny muted semi">Per-RM gross &amp; net plus the unmapped (house) folios for all periods.</div></div>
        <button className="btn btn-green btn-lg" onClick={download}><Download size={16} />Download Reconciliation (Excel)</button>
      </div>

      <div className="panel amber">
        <div className="panel-title t-amber"><AlertTriangle size={16} />Exceptions — what the import could not map</div>
        <p className="small muted">Run this straight after an import. It lists every folio, client and RM that still needs a human: brokerage that reaches nobody, clients with no RM, folios two records both claim, and rows whose investor is not the client they landed on. It only reads — nothing is changed.</p>
        <div className="row gap mt"><input className="input" style={{ width: 250 }} placeholder="Period e.g. 2026-07 (blank = all)" value={period} onChange={(e) => setPeriod(e.target.value)} />
          <button className="btn btn-amber btn-caps btn-lg" disabled={busy} onClick={() => run(() => api.get(`/reports/exceptions${qs({ period })}`).then(setExceptions))}>Run Check</button></div>
        {exceptions && (
          <div className="grid g4 mt" style={{ gap: 10 }}>
            {[['Brokerage reaching nobody', exceptions.noOne, (x) => `${x.folio} · ${x.investor || 'unknown'} · ₹${x.gross.toFixed(2)}`],
              ['Clients with no RM', exceptions.noRM, (x) => `${x.name} · ₹${x.gross.toFixed(2)}`],
              ['Folios on two records', exceptions.shared, (x) => `${x.folio}: ${x.clients}`],
              ['Investor ≠ client', exceptions.mismatched, (x) => `${x.folio}: "${x.investor}" on ${x.client}`]].map(([t, list, fmt]) => (
              <Card key={t} className="card-pad"><div className="row between"><span className="tiny bold upper faint">{t}</span><b className={list.length ? 't-amber' : 't-green'}>{list.length}</b></div>
                <div className="tiny muted mt-sm" style={{ maxHeight: 120, overflow: 'auto' }}>{list.slice(0, 30).map((x, i) => <div key={i}>{fmt(x)}</div>)}{!list.length && 'Clear'}</div></Card>
            ))}
          </div>
        )}
      </div>

      <div className="panel green">
        <div className="panel-title t-green"><Users size={16} />Bulk Client Mapping from Excel</div>
        <p className="small muted">Upload a sheet with <b>Client Name, PAN, RM Name, BM Name</b> and optionally <b>Lead By</b> (the L4+ who brought a lead and passed it to that RM) — one row per client, many RMs at once. You will see exactly what changes <b>before</b> anything is saved. No folio column needed.</p>
        <div className="row gap mt wrap">
          <button className="btn btn-green btn-caps btn-lg" onClick={() => bulk.current.click()}>Choose Excel / CSV</button>
          <button className="btn btn-caps btn-lg" style={{ color: 'var(--green)', borderColor: '#9fdcbf', borderWidth: 2 }} onClick={() => run(() => api.get('/reports/bulk-mapping/current').then((r) => exportExcel(r, 'current-mapping.xlsx')))}>⬇ Download Current Mapping</button>
          <button className="btn btn-caps btn-lg btn-ghost" onClick={() => exportExcel([{ 'Client ID': '', 'Client Name': '', PAN: '', 'RM Name': '', 'BM Name': '' }], 'mapping-template.xlsx')}>Blank Template</button>
          <input ref={bulk} type="file" hidden accept=".xlsx,.xls,.csv" onChange={(e) => { const file = e.target.files[0]; e.target.value = ''; if (file) run(() => upload(file, '/reports/bulk-mapping/preview').then(setPreview)); }} />
        </div>
        <div className="card card-pad mt tiny muted col gap-sm">
          <div><b className="t-green">Recommended:</b> click <b>Download Current Mapping</b>. It contains every client with a <b>Client ID</b> and their current RM/BM.</div>
          <div>Edit <b>only the RM / BM columns</b> and upload it back — you never type a client name, so a spelling mistake cannot break the match.</div>
          <div>For RM and BM you can type the <b>name or the ARN code</b>. Small spelling mistakes are corrected automatically, and the preview shows you exactly which name it read. If two people share a name, it asks for the code instead of guessing.</div>
        </div>
      </div>

      <div className="panel blue">
        <div className="panel-title t-blue"><Users size={16} />Map RM from Registrar File</div>
        <p className="small muted" style={{ maxWidth: 760 }}>Upload an RM's "RM-wise / Investor-wise Brokerage" Excel. Every folio in it is mapped to the selected RM (using their standard hierarchy), then payouts recalculate automatically. This is the one-click monthly reconciliation — do it per RM after importing the brokerage files.</p>
        <div className="row gap mt">
          <select className="select" style={{ width: 460 }} value={rmId} onChange={(e) => setRmId(e.target.value)}>
            <option value="">— Select RM —</option>{(users.data || []).map((u) => <option key={u.id} value={u.id}>{u.name} · L{u.level}</option>)}
          </select>
          <button className="btn btn-lg" disabled={!rmId || busy} onClick={() => rmFile.current.click()}><Upload size={14} />Upload RM File</button>
          <input ref={rmFile} type="file" hidden accept=".xlsx,.xls,.csv" onChange={(e) => { const file = e.target.files[0]; e.target.value = ''; if (file) run(() => upload(file, '/reports/rm-file', { rmId }).then((r) => { reload(); return r; }), (r) => `${r.clients} client(s) mapped, ${r.recalculated} rows recalculated`); }} />
        </div>
      </div>

      <div className="banner amber"><b className="upper">Unmapped Transactions</b><br />These investor accounts have brokerage in the system but are <b>not mapped to any team member</b>, so 100% of their brokerage currently goes to company retention. Map them in <a href="#" onClick={(e) => { e.preventDefault(); nav('/clients?tab=clients'); }}>Clients &amp; Map</a> to credit the right RM. Showing <b>{f.year === 'all' && f.month === 'all' ? 'all periods' : 'the selected period'}</b> (set Year + Month above to narrow).</div>
      {!data ? <Spinner /> : (
        <>
          <div className="grid g2">
            <Stat label="Unmapped Accounts" value={data.accounts} sub={`${data.txns} transactions`} />
            <Stat label="Unattributed Gross" value={inr(data.gross)} tone="amber" sub="currently → company retention" />
          </div>
          <Card>
            <table className="t compact">
              <thead><tr><th>Investor</th><th>PAN</th><th>Folio</th><th className="r">Txns</th><th className="r">Gross (₹)</th></tr></thead>
              <tbody>
                {!data.rows.length && <tr><td colSpan={5}><Empty title="Everything is mapped" /></td></tr>}
                {data.rows.map((r, i) => <tr key={i}><td>{r.investor === 'unknown' ? <i className="faint semi">unknown</i> : r.investor}</td><td className="mono small">{r.pan || '—'}</td><td className="mono small">{r.folio}</td><td className="r bold">{r.txns}</td><td className="r bold t-amber">{r.gross.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>)}
              </tbody>
            </table>
          </Card>
        </>
      )}
      {preview && <BulkPreview preview={preview} onClose={() => setPreview(null)} onApplied={reload} />}
    </div>
  );
}

export default function Reports() {
  const { user } = useAuth();
  const admin = user.role === 'admin';
  const nav = useNavigate();
  const [tab, setTab] = useState('summary');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState('all');
  const f = { year, month };
  const tabs = [
    { value: 'summary', label: 'Summary', icon: <Layers size={13} /> },
    { value: 'monthly', label: 'Monthly Payouts', icon: <Clock size={13} /> },
    { value: 'client', label: 'Client-wise', icon: <Briefcase size={13} /> },
    { value: 'logs', label: 'Logs', icon: <FileText size={13} /> },
    { value: 'team', label: 'Team Payouts', icon: <Users size={13} /> },
    { value: 'growth', label: 'Growth', icon: <TrendingUp size={13} /> },
    ...(admin ? [{ value: 'approvals', label: 'Approvals Queue', icon: <ShieldCheck size={13} /> }, { value: 'recon', label: 'Reconciliation', icon: <AlertTriangle size={13} /> }] : []),
  ];
  return (
    <>
      <PageHead title="Brokerage Settlements" sub="Financial audit and payout management.">
        <YearMonth year={year} month={month} onYear={setYear} onMonth={setMonth} />
        <button className="btn" onClick={() => nav('/payouts')}><Landmark size={14} />Payouts</button>
      </PageHead>
      <Tabs value={tab} onChange={setTab} options={tabs} />
      {tab === 'summary' && <Summary f={f} />}
      {tab === 'monthly' && <Monthly f={f} admin={admin} />}
      {tab === 'client' && <ClientWise f={f} />}
      {tab === 'logs' && <Logs f={f} />}
      {tab === 'team' && <Team f={f} />}
      {tab === 'growth' && <Growth f={f} />}
      {tab === 'approvals' && admin && <Approvals />}
      {tab === 'recon' && admin && <Reconciliation f={f} />}
    </>
  );
}
