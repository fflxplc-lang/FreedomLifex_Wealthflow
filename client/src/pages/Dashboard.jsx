import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, Landmark, Users, ShieldAlert, Clock, Trophy, TrendingDown, Building2, UserCheck, Briefcase, Medal } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell } from 'recharts';
import { api } from '../api.js';
import { Card, Stat, Segmented, useLoad, Spinner, inrShort, inr, shortPeriod } from '../ui.jsx';

const CAT_COLORS = { Equity: '#3b82f6', Hybrid: '#10b981', Other: '#f59e0b', Arbitrage: '#8b5cf6', Debt: '#ef4444', Liquid: '#06b6d4' };

export default function Dashboard() {
  const [range, setRange] = useState('all');
  const [top, setTop] = useState('aum');
  const nav = useNavigate();
  const { data, loading } = useLoad(() => api.get(`/dashboard?range=${range}&top=${top}`), [range, top]);
  if (loading && !data) return <Spinner />;
  const d = data;
  const catTotal = d.categories.reduce((s, c) => s + c.value, 0) || 1;

  return (
    <>
      <div className="page-head">
        <div><h1>System Performance</h1><p className="muted">Real-time analytics across all hierarchies.</p></div>
        <Segmented className="solid caps" value={range} onChange={setRange} options={[{ value: 'all', label: 'All' }, { value: 'month', label: 'Month' }, { value: 'quarter', label: 'Quarter' }, { value: 'year', label: 'Year' }]} />
      </div>

      <div className="grid g3">
        <Stat icon={<TrendingUp size={16} />} badge="Live Sync" label="Enterprise Gross Volume" value={inrShort(d.kpis.gross)} sub="Aggregated Brokerage" />
        <Stat icon={<Landmark size={16} />} tone="green" badge="Live Sync" label="Total Payout Pool" value={inr(d.kpis.pool)} sub="Realized Earnings" />
        <Stat icon={<Users size={16} />} tone="purple" badge="Live Sync" label="Portfolio Count" value={d.kpis.clients.toLocaleString('en-IN')} sub={`${d.kpis.transactions.toLocaleString('en-IN')} Active Transactions`} />
      </div>

      <Card className="mt">
        <div className="card-head">
          <div className="row gap-sm semi"><ShieldAlert size={15} className="t-amber" />Compliance attention</div>
          <span className="badge amber">{d.compliance.length}</span>
        </div>
        <div className="table-wrap scroll" style={{ maxHeight: 250 }}>
          {!d.compliance.length && <div className="empty small">Every ARN and EUIN is on file and valid.</div>}
          {d.compliance.slice(0, 50).map((c, i) => (
            <div key={i} className="list-row">
              <div><div className="semi">{c.name} <span className="mono tiny faint">({c.code || '—'})</span></div><div className="tiny muted">{c.kind}</div></div>
              <div className="row gap-sm"><span className="tag">{c.kind}</span>
                <span className={`tag ${c.status !== 'MISSING' ? 't-red' : ''}`}><Clock size={9} style={{ verticalAlign: -1 }} /> {c.status}{c.date ? ` · ${c.date}` : ''}</span></div>
            </div>
          ))}
        </div>
        {d.compliance.length > 50 && <div className="center tiny muted" style={{ padding: 8, borderTop: '1px solid var(--border)' }}>+ {d.compliance.length - 50} more — review in Settings</div>}
      </Card>

      <div className="grid g2 mt">
        <Card>
          <div className="card-head">
            <div className="row gap-sm semi"><Trophy size={15} className="t-amber" />Top Clients</div>
            <Segmented className="caps" value={top} onChange={setTop} options={[{ value: 'aum', label: 'AUM' }, { value: 'brokerage', label: 'Brokerage' }]} />
          </div>
          {!d.topClients.length && <div className="empty small">Import brokerage files to see top clients.</div>}
          {d.topClients.map((c, i) => (
            <div key={c.id} className="list-row" style={{ cursor: 'pointer' }} onClick={() => nav(`/clients?tab=clients&q=${encodeURIComponent(c.name)}`)}>
              <div className="row gap">
                <span className="avatar" style={{ background: i < 3 ? '#fef3c7' : undefined, color: i < 3 ? '#b45309' : undefined, width: 24, height: 24, fontSize: 11 }}>{i + 1}</span>
                <div><div className="cell-main">{c.name}</div><div className="cell-sub mono">{c.pan || '—'} · {c.txns} TXNS</div></div>
              </div>
              <div className="right"><div className="bold">{inrShort(c.aum)} <span className="badge green" style={{ padding: '2px 6px' }}>LATEST</span></div><div className="cell-sub">{inr(c.brokerage, 0)} BROKERAGE</div></div>
            </div>
          ))}
        </Card>
        <Card>
          <div className="card-head">
            <div className="row gap-sm semi"><TrendingDown size={15} className="t-red" />Recent Redemptions</div>
            <span className="badge red">LAST 60D · {d.redemptions.length}</span>
          </div>
          {!d.redemptions.length && <div className="empty small">No redemptions in the last 60 days of imported transactions.</div>}
          {d.redemptions.map((x, i) => (
            <div key={i} className="list-row">
              <div className="row gap"><span className="stat-icon" style={{ background: 'var(--red-soft)', color: 'var(--red)', width: 26, height: 26 }}><TrendingDown size={13} /></span>
                <div><div className="cell-main">{x.investor}</div><div className="tiny muted">{x.scheme}</div></div></div>
              <div className="right"><div className="bold t-red">{inr(Math.abs(x.amount), 0)}</div><div className="cell-sub">{x.trxn_date} · REDEMPTION</div></div>
            </div>
          ))}
        </Card>
      </div>

      <div className="grid g-2-1 mt">
        <Card className="card-pad">
          <h3>Revenue Growth</h3><div className="card-sub">Net monthly share trends (INR)</div>
          <div style={{ height: 230, marginTop: 14 }}>
            <ResponsiveContainer>
              <AreaChart data={d.revenue.map((r) => ({ ...r, label: shortPeriod(r.period) }))} margin={{ left: 0, right: 10 }}>
                <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.25} /><stop offset="100%" stopColor="#10b981" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={50} />
                <Tooltip formatter={(v, n) => [inr(v), n === 'share' ? 'Payout share' : 'Gross']} contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)' }} />
                <Area dataKey="gross" stroke="#3b82f6" fill="transparent" strokeWidth={2} />
                <Area dataKey="share" stroke="#10b981" fill="url(#g)" strokeWidth={2.5} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="card-pad">
          <h3>Top Producers</h3><div className="card-sub">Real-time performance</div>
          <div className="col gap mt">
            {[['Asset Management', d.producers.amc, Building2, 'var(--blue-soft)', 'var(--blue)'],
              ['Key Investor', d.producers.investor, UserCheck, 'var(--green-soft)', 'var(--green)'],
              ['Prime Scheme', d.producers.scheme, Briefcase, 'var(--purple-soft)', 'var(--purple)']].map(([label, p, Icon, bg, fg]) => (
              <div key={label} className="producer" style={{ background: bg }}>
                <div className="row gap-sm upper" style={{ color: fg, fontSize: 9.5 }}><Icon size={12} />{label}</div>
                <div className="row between mt-sm"><span className="semi" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{p?.name || '—'}</span><span className="bold" style={{ color: fg }}>{inrShort(p?.v || 0)}</span></div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid g2 mt">
        <Card className="card-pad">
          <h3>Fund Category Breakdown</h3><div className="card-sub">Gross brokerage by category</div>
          <div className="row gap-lg mt" style={{ alignItems: 'center' }}>
            <div style={{ width: 150, height: 150 }}>
              <ResponsiveContainer>
                <PieChart><Pie data={d.categories} dataKey="value" innerRadius={45} outerRadius={70} paddingAngle={2} stroke="none">
                  {d.categories.map((c) => <Cell key={c.name} fill={CAT_COLORS[c.name] || '#94a3b8'} />)}
                </Pie></PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grow col gap-sm">
              {!d.categories.length && <span className="muted">No brokerage imported yet.</span>}
              {d.categories.map((c) => (
                <div key={c.name} className="row between small">
                  <span className="row gap-sm semi"><span style={{ width: 9, height: 9, borderRadius: 9, background: CAT_COLORS[c.name] || '#94a3b8' }} />{c.name}</span>
                  <span><span className="muted">{((c.value / catTotal) * 100).toFixed(1)}%</span> &nbsp;<b>{inrShort(c.value)}</b></span>
                </div>
              ))}
            </div>
          </div>
        </Card>
        <Card className="card-pad">
          <h3 className="row gap-sm"><Trophy size={16} className="t-amber" />RM Leaderboard</h3><div className="card-sub">Top performers by earnings</div>
          <div className="col gap-sm mt">
            {!d.leaderboard.length && <span className="muted">Map clients to RMs to rank earnings.</span>}
            {d.leaderboard.map((u, i) => (
              <div key={u.id} className={`leader ${i === 0 ? 'first' : ''}`}>
                {i < 3 ? <Medal size={18} color={['#d97706', '#64748b', '#b45309'][i]} /> : <span className="bold faint" style={{ width: 18 }}>#{i + 1}</span>}
                <div className="grow"><div className="semi">{u.name}</div><div className="tiny muted">{u.txns} transactions</div></div>
                <span className="bold t-green">{inr(u.earnings, 0)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
