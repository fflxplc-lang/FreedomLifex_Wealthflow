import { useState } from 'react';
import { Mail, Lock, Eye, EyeOff, ArrowRight } from 'lucide-react';
import Logo from '../components/Logo.jsx';
import { api, setToken } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast, LEVELS } from '../ui.jsx';

export default function Login() {
  const { setUser } = useAuth();
  const toast = useToast();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [choose, setChoose] = useState(null);

  // An email with more than one account (a BM and their RM ID) asks which one to open.
  const signIn = async (accountId) => {
    setBusy(true); setError('');
    try {
      const r = await api.post('/auth/login', { login, password, accountId });
      if (r.choose) { setChoose(r.choose); return; }
      setToken(r.token);
      setUser(r.user);
    } catch (err) { setError(err.message); setChoose(null); }
    finally { setBusy(false); }
  };
  const submit = (e) => { e.preventDefault(); signIn(); };
  const recover = async () => {
    if (!login) { setError('Enter your ID or email first, then press Recovery.'); return; }
    const r = await api.post('/auth/recover', { login });
    toast(r.message);
  };

  return (
    <div className="login-page">
      <Logo size="lg" />
      <div className="login-tag">XPERIENCE THE POWER OF LIFEX</div>
      <form className="login-card col gap-lg" onSubmit={submit}>
        <div className="center">
          <h2>Sign In</h2>
          <p className="muted mt-sm">Authorized Access Only</p>
        </div>
        <label className="field">
          <span className="field-label">Employee ID or Email</span>
          <div className="input-icon"><Mail size={17} /><input className="input" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="ID or registered email" autoFocus /></div>
        </label>
        <label className="field">
          <span className="row between"><span className="field-label">Password</span>
            <button type="button" onClick={recover} className="btn-ghost" style={{ border: 0, background: 'none', color: 'var(--blue)', fontSize: 10.5, fontWeight: 800, letterSpacing: '.06em', cursor: 'pointer' }}>RECOVERY?</button></span>
          <div className="input-icon" style={{ position: 'relative' }}>
            <Lock size={17} />
            <input className="input" type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            <button type="button" className="icon-btn" style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)' }} onClick={() => setShow(!show)}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button>
          </div>
        </label>
        {error && <div className="banner red">{error}</div>}
        {choose ? (
          <div className="col gap-sm">
            <div className="small semi">This email has {choose.length} accounts. Which one do you want to open?</div>
            {choose.map((a) => (
              <button type="button" key={a.id} className="btn btn-soft" style={{ justifyContent: 'space-between' }} disabled={busy} onClick={() => signIn(a.id)}>
                <span>{a.name} · L{a.level} {LEVELS[a.level]}</span><span className="tiny">{a.level <= 3 ? 'RM account' : a.role === 'admin' ? 'Admin' : 'BM account'}</span>
              </button>))}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChoose(null)}>Back</button>
          </div>
        ) : <button className="login-btn" disabled={busy}>{busy ? 'Verifying…' : 'Secure Access'} <ArrowRight size={17} /></button>}
      </form>
    </div>
  );
}
