import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutGrid, Upload, Users, FileText, Landmark, Briefcase, Wallet, ShieldCheck, Settings as Cog,
  Search, Cloud, Moon, Sun, LogOut, Bell, CheckCheck, Clock,
} from 'lucide-react';
import Logo from './Logo.jsx';
import { api, setToken, getViewAs, setViewAs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { timeAgo, LEVELS } from '../ui.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutGrid },
  { to: '/imports', label: 'Imports & Data', icon: Upload, admin: true },
  { to: '/clients', label: 'Clients & Map', icon: Users },
  { to: '/reports', label: 'Reports & Payouts', icon: FileText },
  { to: '/rates', label: 'Brokerage Rates', icon: Landmark, admin: true },
  { to: '/partner', label: 'Partner Brokerage', icon: Briefcase },
  { to: '/payouts', label: 'Payouts', icon: Wallet },
  { to: '/audit', label: 'Audit Log', icon: ShieldCheck, admin: true },
  { to: '/settings', label: 'Admin Console', icon: Cog },
];

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  const ref = useRef();
  const nav = useNavigate();
  useEffect(() => {
    const k = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); ref.current?.focus(); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => api.get(`/dashboard/search?q=${encodeURIComponent(q)}`).then(setHits).catch(() => {}), 200);
    return () => clearTimeout(t);
  }, [q]);
  const go = (h) => { setQ(''); setHits([]); nav(h.type === 'user' ? `/clients?tab=hierarchy&q=${encodeURIComponent(h.label)}` : `/clients?tab=clients&q=${encodeURIComponent(h.label)}`); };
  return (
    <div className="search">
      <Search size={14} className="s-icon" />
      <input ref={ref} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search anything..." onBlur={() => setTimeout(() => setHits([]), 200)} />
      <kbd>⌘K</kbd>
      {hits.length > 0 && (
        <div className="search-results">
          {hits.map((h, i) => (
            <button key={i} onMouseDown={() => go(h)}>
              <div className="semi">{h.label}</div><div className="tiny faint">{h.type === 'user' ? 'Team member' : 'Client'} · {h.sub}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const load = () => api.get('/dashboard/notifications').then(setItems).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  const unread = items.filter((n) => !n.read).length;
  return (
    <div style={{ position: 'relative' }}>
      <button className="icon-btn" onClick={() => setOpen(!open)} title="Notifications">
        <Bell size={18} />{unread > 0 && <span className="bell-count">{unread}</span>}
      </button>
      {open && (
        <div className="notif">
          <div className="notif-head">Notifications
            <button className="btn btn-ghost btn-xs t-blue" onClick={() => api.post('/dashboard/notifications/read').then(load)}><CheckCheck size={12} />Mark all read</button>
          </div>
          {!items.length && <div className="empty small">You're all caught up.</div>}
          {items.map((n) => (
            <div key={n.id} className="notif-item">
              <div className="notif-dot"><Bell size={13} /></div>
              <div>
                <div className="semi">{n.title} {!n.read && <span className="t-blue">●</span>}</div>
                <div className="muted">{n.body}</div>
                <div className="tiny faint row gap-sm mt-sm"><Clock size={10} />{timeAgo(n.ts).toUpperCase()}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Layout({ children }) {
  const { user, setUser } = useAuth();
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || 'light');
  const toggleTheme = () => {
    const t = theme === 'dark' ? 'light' : 'dark';
    setTheme(t);
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('wf_theme', t); } catch { /* ignore */ }
  };
  const signOut = async () => {
    try { await api.post('/auth/logout'); } catch { /* ignore */ }
    setToken(null); setViewAs(null); setUser(null);
  };
  const admin = user.role === 'admin';
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="side-logo"><Logo /></div>
        <nav className="nav">
          {NAV.filter((n) => admin || !n.admin).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}><n.icon size={17} />{n.label === 'Admin Console' && !admin ? 'Settings' : n.label}</NavLink>
          ))}
        </nav>
        <div className="side-user">
          <div className="row gap">
            <div className="avatar">{user.name[0]}</div>
            <div style={{ minWidth: 0 }}>
              <div className="semi small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name}</div>
              <div className="tiny faint bold">{user.role.toUpperCase()}</div>
            </div>
          </div>
          <button className="signout" onClick={signOut}><LogOut size={13} />Sign Out</button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <GlobalSearch />
          <div className="row gap">
            {user.linked?.length > 0 && (
              <select className="select sm" style={{ width: 'auto', maxWidth: 260 }} title="Accounts on your email" value={user.id}
                onChange={async (e) => { const r = await api.post('/auth/switch', { accountId: Number(e.target.value) }); setViewAs(''); setToken(r.token); window.location.assign(import.meta.env.BASE_URL); }}>
                {[user, ...user.linked].sort((a, b) => b.level - a.level).map((a) => <option key={a.id} value={a.id}>Account: L{a.level} {LEVELS[a.level]}{a.level <= 3 ? ' (RM)' : ' (BM)'}</option>)}
              </select>
            )}
            {user.role === 'mentor' && user.team?.length > 0 && (
              <select className="select sm" style={{ width: 'auto', maxWidth: 240 }} title="Whose data to show" value={getViewAs()}
                onChange={(e) => { setViewAs(e.target.value); window.location.reload(); }}>
                <option value="">Viewing: me</option>
                {user.team.map((t) => <option key={t.id} value={t.id}>Viewing: {t.name} · L{t.level}</option>)}
              </select>
            )}
            <span className="live"><Cloud size={11} />LIVE</span>
            <button className="icon-btn" onClick={toggleTheme} title="Toggle theme">{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
            <button className="icon-btn" onClick={signOut} title="Sign out"><LogOut size={18} /></button>
            <Notifications />
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
