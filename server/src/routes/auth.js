import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, audit } from '../db.js';
import { sign, requireAuth, teamOf } from '../auth.js';

const r = Router();

const brief = (u) => ({ id: u.id, name: u.name, code: u.code, level: u.level, role: u.role });
// Other active accounts on the same email (a BM and their RM ID), for the account switcher.
const linkedTo = (u) => db.prepare('SELECT * FROM users WHERE lower(email) = lower(?) AND id <> ? AND active = 1 ORDER BY level DESC').all(u.email, u.id).map(brief);
const session = (u) => ({ token: sign(u), user: { ...publicUser(u), team: teamOf(u), linked: linkedTo(u) } });

// Accepts an employee/ARN code or the registered email. An email with several accounts asks which one.
r.post('/login', (req, res) => {
  const { login = '', password = '', accountId } = req.body || {};
  const id = login.trim().toLowerCase();
  const byCode = db.prepare('SELECT * FROM users WHERE lower(code) = ?').get(id);
  const found = byCode ? [byCode] : db.prepare('SELECT * FROM users WHERE lower(email) = ? ORDER BY level DESC').all(id);
  const ok = found.filter((u) => bcrypt.compareSync(password, u.password_hash));
  if (!ok.length) {
    audit(null, 'LOGIN_FAILED', `Failed sign-in for "${login}"`);
    return res.status(401).json({ error: 'Invalid ID or password' });
  }
  const live = ok.filter((u) => u.active);
  if (!live.length) return res.status(403).json({ error: 'This account is disabled' });
  const user = live.length === 1 ? live[0] : live.find((u) => u.id === Number(accountId));
  if (!user) return res.json({ choose: live.map(brief) });
  audit(user, 'LOGIN', `${user.name} signed in (L${user.level})`);
  res.json(session(user));
});

r.get('/me', requireAuth, (req, res) => {
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ ...publicUser(me), team: teamOf(me), linked: linkedTo(me) });
});

// Move to another account on the same email without signing in again.
r.post('/switch', requireAuth, (req, res) => {
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const to = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(Number(req.body.accountId));
  if (!to || to.email.toLowerCase() !== me.email.toLowerCase()) throw new Error('That account is not linked to your email');
  audit(to, 'LOGIN', `${to.name} switched to L${to.level} account`);
  res.json(session(to));
});

r.post('/logout', requireAuth, (req, res) => {
  audit(req.user, 'LOGOUT', `${req.user.name} signed out`);
  res.json({ ok: true });
});

// Recovery: no mail server is configured, so a request is logged for the admin to act on.
r.post('/recover', (req, res) => {
  const { login = '' } = req.body || {};
  audit(null, 'PASSWORD_RECOVERY', `Password recovery requested for "${login}"`);
  db.prepare('INSERT INTO notifications(title, body) VALUES(?, ?)').run('Password recovery', `Recovery requested for ${login}`);
  res.json({ ok: true, message: 'Your administrator has been notified to reset your password.' });
});

export function publicUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  for (const k of ['bank', 'address', 'extra_levels', 'custom_split']) {
    try { rest[k] = rest[k] ? JSON.parse(rest[k]) : null; } catch { rest[k] = null; }
  }
  return rest;
}

export default r;
