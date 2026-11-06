import { useEffect, useMemo, useState } from 'react';
import { User, Shield, Users, GitBranch, ClipboardList, AlertTriangle, CreditCard, MapPin, Save, RefreshCw, Lock, Unlock, Search, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Card, PageHead, Segmented, useLoad, useAction, Spinner, Empty, Field, Confirm, inr, LEVELS, shortPeriod } from '../ui.jsx';
import { AuditTable } from './AuditLog.jsx';

// ---------- Profile ----------
function Profile() {
  const { user, setUser } = useAuth();
  const { data } = useLoad(() => api.get(`/users/${user.id}`), []);
  const [f, setF] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => { if (data) setF({ ...data, bank: data.bank || {}, address: { country: 'India', ...(data.address || {}) } }); }, [data]);
  if (!f) return <Spinner />;
  const setIn = (o, k, v) => setF({ ...f, [o]: { ...f[o], [k]: v } });
  const onSig = (file) => {
    if (!file) return;
    if (file.size > 400 * 1024) { alert('Signature must be under 400 KB'); return; }
    const r = new FileReader(); r.onload = () => setF({ ...f, signature: r.result }); r.readAsDataURL(file);
  };
  const save = () => run(async () => {
    const u = await api.put(`/users/${user.id}`, { name: f.name, bank: f.bank, address: f.address, gst: f.gst, pan: f.pan, arn: f.arn, arn_valid: f.arn_valid, euin: f.euin, euin_valid: f.euin_valid, signature: f.signature });
    setUser({ ...user, name: u.name });
  }, 'Profile saved');
  const ctx = `${user.role.toUpperCase()} - Level ${f.level} (${LEVELS[f.level]})`;
  return (
    <div className="col gap-lg">
      <div className="grid g2">
        <Card className="card-pad col gap">
          <h3 className="row gap-sm"><User size={16} />Personal Information</h3>
          <Field label="Display Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Account Context"><input className="input bold" disabled value={ctx} style={{ background: 'var(--surface-3)' }} /></Field>
        </Card>
        <Card className="card-pad col gap">
          <h3 className="row gap-sm"><CreditCard size={16} />Bank Details</h3>
          <Field label="Account Name"><input className="input" value={f.bank.holder || ''} onChange={(e) => setIn('bank', 'holder', e.target.value)} placeholder={f.name} /></Field>
          <div className="grid g2">
            <Field label="Account Number"><input className="input" value={f.bank.account || ''} onChange={(e) => setIn('bank', 'account', e.target.value)} placeholder="XXXXXX1234" /></Field>
            <Field label="IFSC Code"><input className="input" value={f.bank.ifsc || ''} onChange={(e) => setIn('bank', 'ifsc', e.target.value.toUpperCase())} placeholder="HDFC0001234" /></Field>
            <Field label="Bank Name"><input className="input" value={f.bank.bankName || ''} onChange={(e) => setIn('bank', 'bankName', e.target.value)} placeholder="HDFC Bank" /></Field>
            <Field label="Branch"><input className="input" value={f.bank.branch || ''} onChange={(e) => setIn('bank', 'branch', e.target.value)} placeholder="Mumbai Main" /></Field>
          </div>
        </Card>
      </div>
      <Card className="card-pad col gap">
        <h3 className="row gap-sm"><MapPin size={16} />Address &amp; Contact</h3>
        <Field label="Street Address"><input className="input" value={f.address.street || ''} onChange={(e) => setIn('address', 'street', e.target.value)} placeholder="123, Wealth Street, Business Park" /></Field>
        <div className="grid g2">
          <Field label="City"><input className="input" value={f.address.city || ''} onChange={(e) => setIn('address', 'city', e.target.value)} placeholder="Mumbai" /></Field>
          <Field label="State / Province"><input className="input" value={f.address.state || ''} onChange={(e) => setIn('address', 'state', e.target.value)} placeholder="Maharashtra" /></Field>
          <Field label="Pincode / Zip"><input className="input" value={f.address.pincode || ''} onChange={(e) => setIn('address', 'pincode', e.target.value)} placeholder="400001" /></Field>
          <Field label="Country"><input className="input" value={f.address.country || ''} onChange={(e) => setIn('address', 'country', e.target.value)} /></Field>
        </div>
      </Card>
      <div className="grid g2">
        <Card className="card-pad col gap">
          <div><h3>SEBI/AMFI Registration</h3><p className="tiny muted mt-sm">ARN expires every 3 years; EUIN every 5. Dashboard alerts fire 30 days before expiry.</p></div>
          <div className="grid g2">
            <Field label="ARN Number"><input className="input" value={f.arn || ''} onChange={(e) => setF({ ...f, arn: e.target.value })} placeholder="ARN-12345" /></Field>
            <Field label="ARN Valid Till"><input className="input" type="date" value={f.arn_valid || ''} onChange={(e) => setF({ ...f, arn_valid: e.target.value })} /></Field>
            <Field label="EUIN Number"><input className="input" value={f.euin || ''} onChange={(e) => setF({ ...f, euin: e.target.value })} placeholder="E123456" /></Field>
            <Field label="EUIN Valid Till"><input className="input" type="date" value={f.euin_valid || ''} onChange={(e) => setF({ ...f, euin_valid: e.target.value })} /></Field>
          </div>
        </Card>
        <Card className="card-pad col gap">
          <div className="card-title">Invoice Details</div>
          <div className="grid g2">
            <Field label="GSTIN (GST added to invoice only if set)"><input className="input" value={f.gst || ''} onChange={(e) => setF({ ...f, gst: e.target.value.toUpperCase() })} placeholder="27ABCDE1234F1Z5" /></Field>
            <Field label="PAN"><input className="input" value={f.pan || ''} onChange={(e) => setF({ ...f, pan: e.target.value.toUpperCase() })} placeholder="ABCDE1234F" /></Field>
          </div>
          <Field label='Signature (auto-added above "Authorised Signatory")' hint="PNG or JPEG, transparent background recommended, under 400 KB.">
            <div className="row gap"><input type="file" accept="image/png,image/jpeg" onChange={(e) => onSig(e.target.files[0])} />{f.signature && <img src={f.signature} alt="signature" style={{ maxHeight: 40 }} />}</div>
          </Field>
        </Card>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn btn-primary btn-lg" disabled={busy} onClick={save}><Save size={16} />Save Profile Changes</button></div>
    </div>
  );
}

const levelNums = (o) => Object.keys(o || {}).map(Number).sort((x, y) => x - y);

// Mirrors server/src/services/payout.js splitGross for the levels marked as assigned.
// `passedBy` is the level of an L4+ who brought the lead and passed it down (or null).
export function simulate(gross, sharing, assigned, passedBy = null) {
  const pay = {}; let company = 0;
  const add = (l, pct) => { if (pct > 0) pay[l] = (pay[l] || 0) + gross * pct / 100; };
  const top = levelNums(sharing.top);
  const topTotal = top.reduce((s, l) => s + Number(sharing.top[l] || 0), 0);
  let carry = 0;
  for (const l of top) { const pct = carry + Number(sharing.top[l] || 0); if (assigned.has(l)) { add(l, pct); carry = 0; } else carry = pct; }
  company += gross * carry / 100;
  const pool = Math.max(0, 100 - topTotal);
  const lead = [1, 2, 3, 4, 5, 6, 7].find((l) => assigned.has(l));
  if (!lead) return { pay, company: company + gross * pool / 100, pool, topTotal, lead: null, mgr: null };
  let mgr = null;
  for (let l = Math.max(lead + 1, 4); l <= 7; l++) if (assigned.has(l)) { mgr = l; break; }
  const rate = (l) => Number(sharing.rates[l]) || 0;
  if (passedBy && passedBy >= 4 && passedBy > lead) {
    const fee = Math.min(pool, Number(sharing.leadFee) || 0);
    add(passedBy, fee);
    const left = pool - fee;
    if (lead <= 3) { const own = left * rate(lead) / 100; add(lead, own); add(mgr || passedBy, left - own); } else add(lead, left);
  } else if (lead <= 3) {
    const own = Math.min(pool, rate(lead));
    add(lead, own);
    if (mgr) add(mgr, pool - own); else company += gross * (pool - own) / 100;
  } else add(lead, pool);
  return { pay, company, pool, topTotal, lead, mgr };
}

// ---------- Global rules ----------
function GlobalRules() {
  const { data, reload } = useLoad(() => api.get('/settings/global'), []);
  const [f, setF] = useState(null);
  const [run, busy] = useAction();
  useEffect(() => { if (data) setF(structuredClone(data)); }, [data]);
  if (!f) return <Spinner />;
  const firm = (k, v) => setF({ ...f, firm: { ...f.firm, [k]: v } });
  const save = () => run(() => api.put('/settings/global', { firm: f.firm }).then(reload), 'Firm details saved');
  const F = ({ k, label, ph }) => <Field label={label}><input className="input" value={f.firm[k] ?? ''} placeholder={ph} onChange={(e) => firm(k, e.target.value)} /></Field>;
  return (
    <div className="col gap-lg" style={{ maxWidth: 900 }}>
      <div className="row between"><h2>Global Payout Rules</h2>
        <button className="btn btn-primary" disabled={busy} onClick={save}><Save size={14} />Save Firm Details</button></div>
      <div className="banner blue small">The lead payout policy (L1–L7 percentages) is set in the <b>Lead Source</b> tab.</div>
      <Card className="card-pad col gap">
        <div><h3>Firm GST Registration</h3><div className="tiny muted mt-sm">Used on invoices and to compute the GST split. If the payee is in the same state, the GST splits into CGST+SGST; otherwise it's IGST.</div></div>
        <div className="grid g2">
          {F({ k: 'name', label: 'Firm Name' })}{F({ k: 'state', label: 'Registered State' })}
          {F({ k: 'gstin', label: 'Firm GSTIN' })}{F({ k: 'pan', label: 'Firm PAN', ph: 'ABCDE1234F' })}
          {F({ k: 'stateCode', label: 'GST State Code' })}
        </div>
        {F({ k: 'address1', label: 'Company Address — Line 1' })}
        {F({ k: 'address2', label: 'Company Address — Line 2' })}
        <div className="grid g2">{F({ k: 'hsn', label: 'Default HSN/SAC' })}{F({ k: 'tds', label: 'Default TDS %' })}{F({ k: 'gst', label: 'Default GST %' })}</div>
        <div className="tiny faint">These appear as the "To" (company) block, HSN/SAC and default taxes on every RM tax invoice. GST is added when the GST switch in Reports → Monthly Payouts is on.</div>
      </Card>
    </div>
  );
}

// ---------- User sharing ----------
function UserSharing() {
  const { data: users, reload } = useLoad(() => api.get('/users'), []);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const [split, setSplit] = useState({});
  const [run, busy] = useAction();
  useEffect(() => { if (sel) setSplit(sel.custom_split || {}); }, [sel]);
  if (!users) return <Spinner />;
  const list = users.filter((u) => u.role !== 'admin' && (!q || u.name.toLowerCase().includes(q.toLowerCase())));
  const levels = sel ? [...new Set([sel.level, ...(sel.extra_levels || [])])].sort() : [];
  const save = (clear) => run(() => api.put(`/users/${sel.id}/sharing`, { custom_split: clear ? null : Object.fromEntries(Object.entries(split).filter(([, v]) => v !== '' && v != null)), recalculate: true })
    .then(() => { reload(); setSel(null); }), clear ? 'Custom sharing cleared' : 'Custom sharing saved and applied');
  return (
    <div className="grid g-1-2" style={{ alignItems: 'start' }}>
      <Card>
        <div className="card-pad"><h3>Select User</h3><div className="input-icon mt"><Search size={14} /><input className="input" placeholder="Search user..." value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
        <div className="select-list" style={{ maxHeight: 520, overflow: 'auto', borderTop: '1px solid var(--border)' }}>
          {list.map((u) => (
            <button key={u.id} className={sel?.id === u.id ? 'on' : ''} onClick={() => setSel(u)}>
              <div><div className="bold small">{u.name}</div><div className="tiny faint upper">{u.code || '—'} • Level {u.level}</div></div>
              <span className={`badge ${u.custom_split ? 'green' : 'gray'}`}>{u.custom_split ? 'Custom' : u.sharing_pct ? `${u.sharing_pct}%` : 'Global'}</span>
            </button>
          ))}
          {!list.length && <div className="empty small">No team members yet.</div>}
        </div>
      </Card>
      <Card className="card-pad" style={{ minHeight: 400 }}>
        {!sel ? <Empty icon={<Users size={40} />} title="Userwise Sharing" text="Select a team member from the list to set custom brokerage sharing percentages that override global rules." /> : (
          <div className="col gap">
            <div><h3>{sel.name}</h3><div className="tiny muted">Primary level L{sel.level} · own sharing {sel.sharing_pct || 0}% · leave a level blank to use the default.</div></div>
            {levels.map((l) => (
              <div key={l} className="kv" style={{ alignItems: 'center' }}>
                <div className="row gap"><span className="level-circle">L{l}</span><span className="semi">{LEVELS[l]}</span></div>
                <div className="row gap-sm"><input className="input right" style={{ width: 90 }} type="number" placeholder="default" value={split[l] ?? ''} onChange={(e) => setSplit({ ...split, [l]: e.target.value })} />%</div>
              </div>
            ))}
            <div className="banner blue small">For L1–L3 the % is what this person gets on their own lead (on a lead passed down by an L4+, it is applied to what is left after that person's share). For L5–L7 a custom % replaces their top share. Order: custom % for the level → own sharing % → the policy rate in Lead Source. Managers always get the rest, so an L4 override has no effect.</div>
            <div className="row gap" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" disabled={busy} onClick={() => save(true)}>Clear Override</button>
              <button className="btn btn-primary" disabled={busy} onClick={() => save(false)}>Save &amp; Recalculate</button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------- Lead source (brokerage sharing model) ----------
const PctInput = ({ value, onChange }) => (
  <div className="row gap-sm"><input className="input bold right" style={{ width: 76, height: 38 }} type="number" step="0.01" value={value ?? ''} onChange={(e) => onChange(e.target.value)} /><span className="faint">%</span></div>
);

function LeadSource() {
  const { data, reload } = useLoad(() => api.get('/settings/global'), []);
  const [sh, setSh] = useState(null);
  const [gross, setGross] = useState(100);
  const [assigned, setAssigned] = useState(new Set([1, 4, 5, 6, 7]));
  const [passedBy, setPassedBy] = useState('');
  const [run, busy] = useAction();
  useEffect(() => { if (data) setSh(structuredClone(data.sharing)); }, [data]);
  const sim = useMemo(() => (sh ? simulate(Number(gross) || 0, sh, assigned, Number(passedBy) || null) : null), [sh, gross, assigned, passedBy]);
  if (!sh) return <Spinner />;
  const top = levelNums(sh.top).reverse();
  const pool = sim.pool, fee = Number(sh.leadFee) || 0;
  const r = (l) => Number(sh.rates[l]) || 0;
  const set = (group, l, v) => setSh({ ...sh, [group]: { ...sh[group], [l]: v } });
  const toggle = (l) => { const n = new Set(assigned); n.has(l) ? n.delete(l) : n.add(l); setAssigned(n); };
  const money = (v) => `₹${v.toFixed(2)}`;
  const save = () => run(() => api.put('/settings/global', { sharing: sh, recalculate: true }).then(reload), 'Lead policy saved and payouts recalculated');
  const label = (l) => l === sim.lead ? ' (handles the client)' : l === Number(passedBy) && sim.lead && l > sim.lead ? ' (brought the lead)' : l === sim.mgr ? ' (manager)' : assigned.has(l) ? '' : ' (not assigned)';
  return (
    <Card className="card-pad col gap">
      <div><h3 className="row gap-sm" style={{ fontSize: 16 }}><GitBranch size={17} className="t-blue" />Lead Reporting &amp; Brokerage Distribution</h3><div className="small muted mt-sm">How every client's brokerage is split.</div></div>
      <div className="panel blue" style={{ background: 'var(--blue-soft)' }}>
        <div className="bold">Top share first, then the lead and their L4+ manager</div>
        <div className="small mt-sm">On every client's brokerage, first <b>{sim.topTotal}%</b> goes to the top levels ({top.map((l) => `L${l} ${sh.top[l] || 0}%`).join(', ')}). From the other <b>{pool}%</b>:</div>
        <ul className="small" style={{ margin: '6px 0 0 18px', lineHeight: 1.6 }}>
          <li><b>L1, L2 or L3 brings the lead:</b> they get {r(1)}% / {r(2)}% / {r(3)}% of the brokerage, and the rest of the {pool}% goes to their reporting manager (the nearest L4 or higher).</li>
          <li><b>L4 or higher brings the lead and handles it:</b> they get the whole {pool}%.</li>
          <li><b>L4 or higher brings the lead and passes it to a subordinate:</b> they get {fee}% first. The direct subordinate gets their {r(1)}/{r(2)}/{r(3)}% of the remaining {pool - fee}%, and what is left goes to their manager.</li>
        </ul>
        <div className="tiny muted mt-sm">On ₹100: L1's own lead → L1 ₹{r(1)}, manager ₹{pool - r(1)}. L4's lead passed to an L1 → L4 ₹{fee} + ₹{((pool - fee) * (1 - r(1) / 100)).toFixed(2)} as manager, L1 ₹{((pool - fee) * r(1) / 100).toFixed(2)}. A passed-down lead is marked with "Lead brought by" in Clients &amp; Map → Map Account.</div>
      </div>
      <div className="grid g3">
        <Card className="card-pad col gap-sm"><div className="upper faint" style={{ fontSize: 9.5 }}>Top share ({sim.topTotal}%)</div>
          {top.map((l) => <div key={l} className="row between"><span className="semi">L{l} {LEVELS[l]}</span><PctInput value={sh.top[l]} onChange={(v) => set('top', l, v)} /></div>)}
          <div className="tiny faint">of the total brokerage; an empty level passes its share up</div></Card>
        <Card className="card-pad col gap-sm"><div className="upper faint" style={{ fontSize: 9.5 }}>Lead by L1 – L3</div>
          {[1, 2, 3].map((l) => <div key={l} className="row between"><span className="semi">L{l} {LEVELS[l]}<div className="tiny faint">own lead: manager gets {pool - r(l)}%</div></span><PctInput value={sh.rates[l]} onChange={(v) => set('rates', l, v)} /></div>)}</Card>
        <Card className="card-pad col gap-sm"><div className="upper faint" style={{ fontSize: 9.5 }}>Lead by L4 and higher</div>
          <div className="row between"><span className="semi">Kept when passed down<div className="tiny faint">handled themselves: the whole {pool}%</div></span><PctInput value={sh.leadFee} onChange={(v) => setSh({ ...sh, leadFee: v })} /></div></Card>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn btn-primary" disabled={busy} onClick={save}><Save size={14} />Save &amp; Recalculate</button></div>

      <div className="simulator">
        <div className="row between wrap gap">
          <div className="row gap-sm bold" style={{ color: '#60a5fa', fontSize: 15 }}><RefreshCw size={15} />Try it</div>
          <div className="row gap-sm"><span className="tiny" style={{ color: '#94a3b8' }}>Brokerage ₹</span><input className="input" style={{ width: 140 }} type="number" value={gross} onChange={(e) => setGross(e.target.value)} /></div>
        </div>
        <div className="tiny mt" style={{ color: '#94a3b8' }}>Click a level to mark it as assigned or missing on the client. The lowest level switched on handles the client.</div>
        <div className="row gap-sm wrap mt-sm">{[1, 2, 3, 4, 5, 6, 7].map((l) => <button key={l} className={`level-chip ${assigned.has(l) ? 'on' : ''}`} onClick={() => toggle(l)}>L{l}</button>)}
          <span className="tiny" style={{ color: '#94a3b8', marginLeft: 8 }}>Lead brought by</span>
          <select className="select sm" value={passedBy} onChange={(e) => setPassedBy(e.target.value)}><option value="">the person handling it</option>{[4, 5, 6, 7].map((l) => <option key={l} value={l}>L{l} {LEVELS[l]}</option>)}</select></div>
        <div style={{ borderTop: '1px solid #334155', margin: '14px 0 6px' }} />
        {[7, 6, 5, 4, 3, 2, 1].map((l) => <div key={l} className="sim-row" style={{ opacity: assigned.has(l) || sim.pay[l] ? 1 : 0.45 }}><span>L{l} {LEVELS[l]}{label(l)}</span><span>{money(sim.pay[l] || 0)}</span></div>)}
        <div className="sim-row" style={{ borderTop: '1px solid #334155', paddingTop: 10, marginTop: 6 }}><b>Company</b><b style={{ color: '#f87171' }}>{money(sim.company)}</b></div>
      </div>
    </Card>
  );
}

// ---------- System / Danger zone ----------
const Section = ({ title, icon, children }) => <div style={{ padding: '22px 24px', borderTop: '1px solid var(--border)' }}><h3 className="row gap-sm">{icon}{title}</h3><div className="col gap mt-sm">{children}</div></div>;

function System() {
  const [run, busy] = useAction();
  const locks = useLoad(() => api.get('/settings/locks'), []);
  const users = useLoad(() => api.get('/users'), []);
  const [upTo, setUpTo] = useState('');
  const [own, setOwn] = useState(null);
  const [assign, setAssign] = useState({ folios: '', userId: '', move: 'none' });
  const [branch, setBranch] = useState({ fromId: '', toId: '' });
  const [branchCheck, setBranchCheck] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const months = locks.data || [];
  const allLocked = months.length > 0 && months.every((m) => m.locked);
  return (
    <div style={{ maxWidth: 720 }}>
      <Card style={{ borderColor: 'var(--red-border)', overflow: 'hidden' }}>
        <div className="row gap-sm bold t-red" style={{ padding: '18px 24px', background: 'var(--red-soft)', fontSize: 15 }}><AlertTriangle size={17} />Danger Zone</div>
        <Section title="Recalculate Payouts">
          <p className="small muted">Forces the system to re-run the sharing logic on all imported transactions using the current global and user-specific rules.</p>
          <div><button className="btn btn-primary btn-caps btn-lg" disabled={busy} onClick={() => run(() => api.post('/settings/recalculate'), (r) => `${r.recalculated} brokerage row(s) recalculated`)}><RefreshCw size={14} />Recalculate All Transactions</button></div>
        </Section>
        <Section title="Lock months" icon={<Lock size={15} />}>
          <p className="small muted">A locked month keeps its payouts exactly as they were paid. Imports, rate changes, promotions, re-mapping and Recalculate never touch it. Lock a month once it has been paid.</p>
          {!locks.data ? <span className="tiny faint">Loading...</span> : <>
            <div className="row gap"><span className="upper faint" style={{ fontSize: 10 }}>Lock every month up to</span>
              <select className="select sm" value={upTo} onChange={(e) => setUpTo(e.target.value)}>
                <option value="">{allLocked ? 'Everything is locked' : 'Choose month'}</option>{months.filter((m) => !m.locked).map((m) => <option key={m.period} value={m.period}>{shortPeriod(m.period)}</option>)}
              </select>
              <button className="btn btn-soft btn-caps btn-xs" style={{ height: 32 }} disabled={!upTo || busy} onClick={() => run(() => api.post('/settings/locks', { upTo }).then((r) => { setUpTo(''); locks.reload(); return r; }), (r) => `${r.locked} month(s) locked`)}><Lock size={12} />Lock</button></div>
            <div className="card" style={{ maxHeight: 420, overflow: 'auto' }}>
              <table className="t compact"><thead><tr><th>Month</th><th className="r">Rows</th><th className="r">Brokerage</th><th>Status</th><th /></tr></thead>
                <tbody>{!months.length && <tr><td colSpan={5} className="faint small">No brokerage imported yet.</td></tr>}
                  {months.map((m) => <tr key={m.period}><td className="bold">{shortPeriod(m.period)}</td><td className="r mono small">{m.rows.toLocaleString()}</td><td className="r mono small">{inr(m.brokerage, 0)}</td>
                    <td>{m.locked ? <span className="t-green semi small row gap-sm"><Lock size={12} />Locked</span> : <span className="faint small">Open</span>}</td>
                    <td className="r">{m.locked && <button className="btn btn-ghost btn-xs btn-caps" onClick={() => run(() => api.del(`/settings/locks/${m.period}`).then(locks.reload), `${m.period} unlocked`)}><Unlock size={11} />Unlock</button>}</td></tr>)}</tbody></table>
            </div>
            <div className="tiny faint">Locking up to a month also covers every earlier one.</div>
          </>}
        </Section>
        <Section title="Folio ownership">
          <p className="small muted">Finds folios claimed by more than one client and removes the claim from every record that is not the owner. The owner is decided from the investor name on that folio's own statements — and only when exactly one claimant matches it. Anything less certain is listed for you rather than guessed at. Folios are never added to a record.</p>
          <div className="row gap"><button className="btn btn-dark btn-caps btn-lg" disabled={busy} onClick={() => run(() => api.get('/settings/folio-ownership').then(setOwn))}><Search size={14} />Check Only</button>
            <button className="btn btn-primary btn-caps btn-lg" disabled={!own?.resolved.length || busy} onClick={() => run(() => api.post('/settings/folio-ownership/cleanup').then((r) => { setOwn(null); return r; }), (r) => `${r.cleaned} folio(s) cleaned, ${r.unsure} left for review`)}><GitBranch size={14} />Clean Up</button></div>
          {own && <div className="card card-pad small col gap-sm">
            <b>{own.resolved.length} can be cleaned · {own.unsure.length} need a human</b>
            {own.resolved.map((x) => <div key={x.folio}>✓ {x.folio}: keep on <b>{x.owner}</b>, remove from {x.removeFrom.join(', ')}</div>)}
            {own.unsure.map((x) => <div key={x.folio} className="t-amber">? {x.folio}: {x.claimants.join(' | ')} — {x.reason}</div>)}
            {!own.resolved.length && !own.unsure.length && <span className="t-green">No folio is claimed twice.</span>}
          </div>}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }} className="col gap">
            <div className="upper faint" style={{ fontSize: 10 }}>Assign folios to one RM</div>
            <p className="tiny muted">When AdvisorKhoj splits one investor between two RMs by folio, say which RM each folio belongs to. The folio stays on that RM's record and leaves every other. Optionally the chosen month's rows move too, so the report corrects without re-uploading the month.</p>
            <textarea className="textarea mono" placeholder="Folios, separated by commas or new lines" value={assign.folios} onChange={(e) => setAssign({ ...assign, folios: e.target.value })} />
            <div className="row gap">
              <select className="select" value={assign.userId} onChange={(e) => setAssign({ ...assign, userId: e.target.value })}><option value="">Belongs to...</option>{(users.data || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
              <select className="select" style={{ width: 240 }} value={assign.move} onChange={(e) => setAssign({ ...assign, move: e.target.value })}><option value="none">Do not move any rows</option><option value="all">Move rows for all months</option>{months.map((m) => <option key={m.period} value={m.period}>Move {shortPeriod(m.period)} rows</option>)}</select>
            </div>
            <div><button className="btn btn-primary btn-caps" disabled={!assign.folios || !assign.userId || busy} onClick={() => run(() => api.post('/settings/assign-folios', assign), (r) => `${r.assigned} folio(s) assigned${r.skipped.length ? `; not on that RM's records: ${r.skipped.join(', ')}` : ''}`)}><GitBranch size={13} />Assign</button></div>
          </div>
        </Section>
        <Section title="Branch restructure">
          <p className="small muted">Use when a manager is promoted and a new BM is placed beneath them. Everyone who reports to the first person is moved to report to the second, and clients that sat under the first with <b>no manager at the second's level</b> get the second placed there. A slot that is already filled is never overwritten. Check first, it changes nothing.</p>
          <div className="grid g2">
            <Field label="Everyone currently under"><select className="select" value={branch.fromId} onChange={(e) => { setBranch({ ...branch, fromId: e.target.value }); setBranchCheck(null); }}><option value="">Choose a person</option>{(users.data || []).map((u) => <option key={u.id} value={u.id}>{u.name} · L{u.level}</option>)}</select></Field>
            <Field label="Move them under"><select className="select" value={branch.toId} onChange={(e) => { setBranch({ ...branch, toId: e.target.value }); setBranchCheck(null); }}><option value="">Choose a person</option>{(users.data || []).map((u) => <option key={u.id} value={u.id}>{u.name} · L{u.level}</option>)}</select></Field>
          </div>
          <div className="row gap">
            <button className="btn btn-caps" style={{ background: '#94a3b8', color: '#fff' }} disabled={!branch.fromId || !branch.toId || busy} onClick={() => run(() => api.post('/settings/branch-restructure', { ...branch, check: true }).then(setBranchCheck))}><Search size={13} />Check Only</button>
            <button className="btn btn-primary btn-caps" disabled={!branchCheck || busy} onClick={() => run(() => api.post('/settings/branch-restructure', branch).then((r) => { setBranchCheck(null); users.reload(); return r; }), (r) => `${r.moved} report(s) moved, ${r.clients} client(s) updated`)}><GitBranch size={13} />Move Branch</button>
          </div>
          {branchCheck && <div className="banner blue small">{branchCheck.reports.length} person(s) will move: {branchCheck.reports.join(', ') || 'none'}. {branchCheck.clients} client(s) get the new manager placed.</div>}
        </Section>
        <Section title="System Reset">
          <p className="small muted">Clearing the data will permanently delete all imported transactions, clients, and custom team members from the database. This action is irreversible.</p>
          <div><button className="btn btn-red btn-caps btn-lg" onClick={() => setConfirm(true)}><Trash2 size={14} />Factory Reset Application</button></div>
        </Section>
      </Card>
      {confirm && <Confirm danger requireText="RESET" title="Factory reset?" text="Every import, client, rate, payout, payment and non-admin user will be permanently deleted. Admin accounts and settings stay." confirmLabel="Factory Reset"
        onClose={() => setConfirm(false)} onConfirm={() => run(() => api.post('/settings/factory-reset', { confirm: 'RESET' }).then(() => { locks.reload(); users.reload(); }), 'Application reset')} />}
    </div>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const admin = user.role === 'admin';
  const [tab, setTab] = useState('profile');
  const opts = [
    { value: 'profile', label: 'Profile', icon: <User size={14} /> },
    ...(admin ? [
      { value: 'global', label: 'Global Rules', icon: <Shield size={14} /> },
      { value: 'sharing', label: 'User Sharing', icon: <Users size={14} /> },
      { value: 'lead', label: 'Lead Source', icon: <GitBranch size={14} /> },
      { value: 'activity', label: 'Activity Log', icon: <ClipboardList size={14} /> },
      { value: 'system', label: 'System', icon: <AlertTriangle size={14} /> },
    ] : []),
  ];
  return (
    <>
      <PageHead title="Settings" sub="System behavior and profile management."><Segmented value={tab} onChange={setTab} options={opts} /></PageHead>
      {tab === 'profile' && <Profile />}
      {tab === 'global' && <GlobalRules />}
      {tab === 'sharing' && <UserSharing />}
      {tab === 'lead' && <LeadSource />}
      {tab === 'activity' && <><Card className="card-pad mb"><h3 className="row gap-sm"><ClipboardList size={16} />Activity Log</h3><div className="small muted">System-wide audit trail of user actions.</div></Card><AuditTable compact /></>}
      {tab === 'system' && <System />}
    </>
  );
}
