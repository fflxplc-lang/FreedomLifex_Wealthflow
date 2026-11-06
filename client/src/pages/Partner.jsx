import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Upload, Link2, Landmark, Users } from 'lucide-react';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Card, PageHead, Stat, useLoad, useAction, Spinner, Empty, Modal, Field, inr, inrShort, periodLabel } from '../ui.jsx';

const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function AttachCode({ item, partner, onClose, onDone }) {
  const [q, setQ] = useState(item.client_name || '');
  const [clientId, setClientId] = useState('');
  const [run, busy] = useAction();
  const { data } = useLoad(() => api.get(`/clients${qs({ q, size: 20 })}`), [q]);
  return (
    <Modal title="Attach Client Code" onClose={onClose} footer={<>
      <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={!clientId || busy} onClick={() => run(() => api.post('/partner/map', { partner, code: item.code, clientId }).then((r) => { onDone(); onClose(); return r; }), (r) => `${r.rows} row(s) re-attributed`)}>Attach</button></>}>
      <div className="semi">Code <span className="mono">{item.code}</span> · {item.client_name}</div>
      <Field label="Find client"><input className="input" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
      <div className="card select-list" style={{ maxHeight: 260, overflow: 'auto' }}>
        {data?.rows.map((c) => <button key={c.id} className={String(clientId) === String(c.id) ? 'on' : ''} onClick={() => setClientId(c.id)}><span className="semi">{c.name}</span><span className="mono tiny faint">{c.pan}</span></button>)}
        {data && !data.rows.length && <div className="empty small">No matching client — add them in Clients &amp; Map first.</div>}
      </div>
    </Modal>
  );
}

export default function Partner() {
  const { user } = useAuth();
  const admin = user.role === 'admin';
  const [month, setMonth] = useState('');
  const [partner, setPartner] = useState('MOFSL');
  const [sharing, setSharing] = useState({});
  const [attach, setAttach] = useState(null);
  const [upl, setUpl] = useState(false);
  const [run, busy] = useAction();
  const { data, reload } = useLoad(() => api.get(`/partner${qs({ partner, month })}`), [partner, month]);
  useEffect(() => { if (data) setSharing(data.sharing); }, [data]);
  if (!data) return <Spinner />;
  const k = data.kpis;
  const m = data.months;

  return (
    <>
      <PageHead title="Partner Brokerage" sub={`Broking revenue from Motilal Oswal and other partners — separate from mutual fund trail.`}>
        {data.partners.length > 1 && <select className="select sm" value={partner} onChange={(e) => setPartner(e.target.value)}>{data.partners.map((p) => <option key={p}>{p}</option>)}</select>}
        <button className="btn" onClick={reload}><RefreshCw size={14} />Refresh</button>
        {admin && <button className="btn btn-primary" onClick={() => setUpl(true)}><Upload size={14} />Upload statement</button>}
      </PageHead>
      <div className="grid g4">
        <Stat label="Total Brokerage" value={inrShort(k.total)} sub="what the partner billed" />
        <Stat label="Mentor Brokerage" value={inrShort(k.mentor)} tone="green" sub="our side of the split, stated by the file" />
        <Stat label="Partner Brokerage" value={inrShort(k.partner)} sub={`retained by ${partner}`} />
        <Stat label="Payout Brokerage" value={inrShort(k.payout)} sub={k.payout ? 'reaches the team by level %' : 'no sharing % set yet — set one below'} />
      </div>
      <div className="row gap mt">
        <span className="upper faint" style={{ fontSize: 10 }}>Month</span>
        <select className="select sm" value={month} onChange={(e) => setMonth(e.target.value)}><option value="">All months</option>{m.map((x) => <option key={x.period} value={x.period}>{periodLabel(x.period)}</option>)}</select>
        <span className="tiny muted">{m.length} month imported · {m.reduce((s, x) => s + x.rows, 0)} rows, {m.reduce((s, x) => s + x.codes, 0)} codes</span>
      </div>

      <Card className="card-pad mt">
        <h3>Sharing for {partner}</h3>
        <p className="tiny muted mt-sm" style={{ maxWidth: 760 }}>The statement says what the firm earns; it says nothing about what reaches a person, because broking carries no level ladder of its own. Set a percentage against the hierarchy level that should be paid — most clients here sit at level 3 (RM) with their manager at level 4.</p>
        <div className="row gap wrap mt" style={{ alignItems: 'flex-end' }}>
          {[1, 2, 3, 4, 5, 6, 7].map((l) => (
            <Field key={l} label={`Level ${l}`}><div className="row" style={{ position: 'relative' }}>
              <input className="input sm" style={{ width: 70 }} type="number" disabled={!admin} value={sharing[l] ?? 0} onChange={(e) => setSharing({ ...sharing, [l]: e.target.value })} /><span className="tiny faint" style={{ position: 'absolute', right: 8 }}>%</span></div></Field>
          ))}
          {admin && <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api.put('/partner/sharing', { partner, sharing }).then(reload), 'Sharing saved')}>Save sharing</button>}
        </div>
      </Card>

      {data.unmapped.length > 0 && (
        <div className="panel red mt" style={{ background: 'var(--red-soft)' }}>
          <div className="row gap-sm bold t-red"><Link2 size={16} />{data.unmapped.length} client codes are not attached to a client yet.</div>
          <p className="tiny t-red mt-sm" style={{ maxWidth: 600 }}>The statement has no RM column — every row is one branch — so until a code is attached, nobody but an admin can see it and it reaches no payout. Attach them below; later imports of the same code then attribute themselves.</p>
          <div className="card mt">
            <table className="t compact"><thead><tr><th>Code</th><th>Name on statement</th><th className="r">Rows</th><th className="r">Total</th><th className="r">Mentor</th><th /></tr></thead>
              <tbody>{data.unmapped.map((u) => <tr key={u.code}><td className="mono">{u.code}</td><td>{u.client_name}</td><td className="r">{u.rows}</td><td className="r">{fmt(u.total)}</td><td className="r bold">{fmt(u.mentor)}</td>
                <td className="r">{admin && <button className="btn btn-xs btn-soft" onClick={() => setAttach(u)}><Link2 size={11} />Attach</button>}</td></tr>)}</tbody></table>
          </div>
        </div>
      )}

      <Card className="mt">
        <div className="card-head"><span className="row gap-sm semi"><Landmark size={15} />By month</span></div>
        <table className="t"><thead><tr><th>Partner</th><th>Month</th><th className="r">Rows</th><th className="r">Codes</th><th className="r">Total Brokerage</th><th className="r">Mentor Brokerage</th><th className="r">Partner Brokerage</th><th className="r">Unmapped</th></tr></thead>
          <tbody>{!m.length && <tr><td colSpan={8}><Empty title="No statements imported" /></td></tr>}
            {m.map((x) => <tr key={x.period}><td>{partner}</td><td className="mono">{x.period}</td><td className="r">{x.rows}</td><td className="r">{x.codes}</td><td className="r mono">{fmt(x.total)}</td><td className="r mono bold">{fmt(x.mentor)}</td><td className="r mono">{fmt(x.partner_share)}</td><td className="r t-red">{x.unmapped}</td></tr>)}</tbody></table>
      </Card>
      <Card className="mt">
        <div className="card-head"><span className="row gap-sm semi"><Landmark size={15} />By segment</span></div>
        <table className="t"><thead><tr><th>Partner</th><th>Segment</th><th className="r">Rows</th><th className="r">Total Brokerage</th><th className="r">Our Share</th></tr></thead>
          <tbody>{data.segments.map((s) => <tr key={s.segment}><td>{partner}</td><td className="mono">{s.segment}</td><td className="r">{s.rows}</td><td className="r mono">{fmt(s.total)}</td><td className="r mono bold">{fmt(s.ours)}</td></tr>)}</tbody></table>
      </Card>
      <div className="grid g2 mt">
        <Card>
          <div className="card-head"><span className="row gap-sm semi">By client</span></div>
          <div className="table-wrap scroll" style={{ maxHeight: 380 }}><table className="t compact"><thead><tr><th>Code</th><th>Client</th><th className="r">Total</th><th className="r">Mentor</th></tr></thead>
            <tbody>{data.byClient.map((c) => <tr key={c.code}><td className="mono small">{c.code}</td><td>{c.name}{!c.client_id && <span className="badge red" style={{ marginLeft: 6 }}>unattached</span>}</td><td className="r">{fmt(c.total)}</td><td className="r bold">{fmt(c.mentor)}</td></tr>)}</tbody></table></div>
        </Card>
        <Card>
          <div className="card-head"><span className="row gap-sm semi"><Users size={15} />Payout by person</span></div>
          <table className="t compact"><thead><tr><th>Person</th><th>Level</th><th className="r">Payout</th></tr></thead>
            <tbody>{!data.payouts.length && <tr><td colSpan={3}><Empty title="" text="Set sharing % and attach codes to see payouts." /></td></tr>}
              {data.payouts.map((p) => <tr key={p.id}><td className="semi">{p.name}</td><td>L{p.level}</td><td className="r bold t-green">{inr(p.amount)}</td></tr>)}</tbody></table>
        </Card>
      </div>
      {attach && <AttachCode item={attach} partner={partner} onClose={() => setAttach(null)} onDone={reload} />}
      {upl && <UploadStatement onClose={() => setUpl(false)} onDone={reload} />}
    </>
  );
}

function UploadStatement({ onClose, onDone }) {
  const [partner, setPartner] = useState('MOFSL');
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [run, busy] = useAction();
  const file = useRef();
  const send = (fl) => run(async () => {
    const fd = new FormData(); fd.append('file', fl); fd.append('partner', partner); fd.append('period', period);
    const r = await api.post('/partner/upload', fd); onDone(); onClose(); return r;
  }, (r) => `${r.rows} statement row(s) imported`);
  return (
    <Modal title="Upload Statement" onClose={onClose}>
      <div className="grid g2">
        <Field label="Partner"><input className="input" value={partner} onChange={(e) => setPartner(e.target.value.toUpperCase())} /></Field>
        <Field label="Statement month"><input className="input" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
      </div>
      <div className="dropzone" onClick={() => file.current.click()}><Upload size={26} />{busy ? 'Importing…' : 'Choose the partner Excel / CSV'}<span className="tiny">Needs Client Code, Total Brokerage and Mentor (our) Brokerage columns</span></div>
      <input ref={file} type="file" hidden accept=".xlsx,.xls,.csv" onChange={(e) => { const fl = e.target.files[0]; e.target.value = ''; if (fl) send(fl); }} />
    </Modal>
  );
}
