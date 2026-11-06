import { useState } from 'react';
import { ShieldCheck, RefreshCw, Download, Search } from 'lucide-react';
import { api, qs } from '../api.js';
import { Card, PageHead, useLoad, Spinner, Empty, exportExcel, timeAgo, localTs } from '../ui.jsx';

export const actionTone = (a) => (/DELETE|PURGE|RESET|FAILED|REJECT/.test(a) ? 'red' : /MAPPING|UPDATE|LOCK|SHARING|RULES/.test(a) ? 'amber' : /IMPORT|CREATE|APPROVED|PAYMENT|LOGIN$/.test(a) ? 'green' : 'gray');

export function AuditTable({ compact }) {
  const [f, setF] = useState({ q: '', action: '', user: '', from: '', to: '' });
  const [limit, setLimit] = useState(100);
  const { data, reload } = useLoad(() => api.get(`/audit${qs({ ...f, limit })}`), [JSON.stringify(f), limit]);
  return (
    <>
      <Card className="card-pad">
        <div className="row gap wrap">
          <div className="input-icon grow"><Search size={14} /><input className="input" placeholder="Search user, action, description..." value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
          {!compact && <select className="select" style={{ width: 220 }} value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}><option value="">All actions</option>{data?.actions.map((a) => <option key={a}>{a}</option>)}</select>}
          {!compact && <select className="select" style={{ width: 220 }} value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })}><option value="">All users</option>{data?.users.map((u) => <option key={u}>{u}</option>)}</select>}
          <input type="date" className="input" style={{ width: 150 }} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
          <input type="date" className="input" style={{ width: 150 }} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
          <button className="icon-btn" onClick={reload} title="Refresh"><RefreshCw size={15} /></button>
        </div>
      </Card>
      <Card className="mt">
        {!data ? <Spinner /> : (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>When</th><th>User</th><th>Action</th><th>Description</th></tr></thead>
              <tbody>
                {!data.rows.length && <tr><td colSpan={4}><Empty title="No activity found" /></td></tr>}
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}><div className="bold">{timeAgo(r.ts)}</div><div className="tiny faint mono">{localTs(r.ts)}</div></td>
                    <td><div className="bold">{r.user_name}</div><div className="tiny faint mono">{r.user_id ? `user_${r.user_id}` : 'system'}</div></td>
                    <td><span className={`badge ${actionTone(r.action)}`}>{r.action}</span></td>
                    <td className="small">{r.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <div className="pager"><span className="pager-info">SHOWING {data.rows.length} OF {data.total} ENTRIES</span>
          {data.rows.length < data.total && <button className="btn btn-xs" onClick={() => setLimit(limit + 200)}>Load more</button>}</div>}
      </Card>
    </>
  );
}

export default function AuditLog() {
  const [key, setKey] = useState(0);
  return (
    <>
      <PageHead icon={<ShieldCheck size={18} />} title="Audit Log" sub="Forensic trail of all user actions, logins, imports, and configuration changes.">
        <button className="btn" onClick={() => setKey(key + 1)}><RefreshCw size={14} />Refresh</button>
        <button className="btn btn-primary" onClick={async () => {
          const r = await api.get('/audit?limit=1000');
          exportExcel(r.rows.map((x) => ({ When: localTs(x.ts), User: x.user_name, Action: x.action, Description: x.description })), 'audit-log.csv');
        }}><Download size={14} />Export CSV</button>
      </PageHead>
      <AuditTable key={key} />
    </>
  );
}
