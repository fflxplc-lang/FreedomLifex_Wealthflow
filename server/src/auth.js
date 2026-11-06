import jwt from 'jsonwebtoken';
import { db } from './db.js';

const SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';

export const sign = (user) => jwt.sign({ id: user.id }, SECRET, { expiresIn: '12h' });

export function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : req.query.token;
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  try {
    const { id } = jwt.verify(token, SECRET);
    const user = db.prepare('SELECT id, name, email, code, role, level, active FROM users WHERE id = ?').get(id);
    if (!user || !user.active) return res.status(401).json({ error: 'Account disabled' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Session expired' });
  }
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// People a mentor can look at: themselves and everyone who reports to them directly.
export function teamOf(user) {
  if (user?.role !== 'mentor') return [];
  return db.prepare('SELECT id, name, code, level FROM users WHERE parent_id = ? AND active = 1 ORDER BY level DESC, name').all(user.id);
}

// The person whose data a read request shows. Admins see everything (null). A mentor can switch to a
// direct report with the X-View-As header (or ?viewAs= on opened pages); everyone else sees only
// themselves. Anything that changes data always acts as the signed-in person.
export function viewAs(req) {
  if (req.user.role === 'admin') return null;
  const want = Number(req.headers?.['x-view-as'] || req.query?.viewAs) || null;
  if (req.method === 'GET' && want && want !== req.user.id && teamOf(req.user).some((u) => u.id === want)) return want;
  return req.user.id;
}

// Admins see everything; everyone else is scoped to their own earnings (a mentor to the person picked).
export const scopeUser = (req) => viewAs(req);
