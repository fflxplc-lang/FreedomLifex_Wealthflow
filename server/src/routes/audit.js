import { Router } from 'express';
import { db } from '../db.js';
import { requireAdmin } from '../auth.js';

const r = Router();

r.get('/', requireAdmin, (req, res) => {
  const { q = '', action = '', user = '', from = '', to = '' } = req.query;
  const limit = Math.min(1000, Number(req.query.limit) || 100);
  const where = [`(description LIKE ? OR action LIKE ? OR user_name LIKE ?)`];
  const args = [`%${q}%`, `%${q}%`, `%${q}%`];
  if (action) { where.push('action = ?'); args.push(action); }
  if (user) { where.push('user_name = ?'); args.push(user); }
  if (from) { where.push('date(ts) >= ?'); args.push(from); }
  if (to) { where.push('date(ts) <= ?'); args.push(to); }
  const w = where.join(' AND ');
  res.json({
    rows: db.prepare(`SELECT * FROM audit WHERE ${w} ORDER BY id DESC LIMIT ?`).all(...args, limit),
    total: db.prepare(`SELECT COUNT(*) c FROM audit WHERE ${w}`).get(...args).c,
    actions: db.prepare('SELECT DISTINCT action FROM audit ORDER BY action').all().map((x) => x.action),
    users: db.prepare('SELECT DISTINCT user_name FROM audit ORDER BY user_name').all().map((x) => x.user_name),
  });
});

export default r;
