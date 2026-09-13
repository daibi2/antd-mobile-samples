const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { openDb } = require('./db');

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SESSION_COOKIE = 'ledger_sid';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const BCRYPT_ROUNDS = 10;
const MAX_NOTE = 200;
const MAX_CATEGORY = 32;
const MAX_AMOUNT_CENTS = 9999999999;

const INCOME_CATEGORIES = ['工资', '奖金', '理财', '其他'];
const EXPENSE_CATEGORIES = ['餐饮', '交通', '购物', '住房', '娱乐', '其他'];

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  String(header).split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch (e) {
      out[key] = value;
    }
  });
  return out;
}

function sendJson(res, status, body) {
  res.status(status).json(body);
}

function setSessionCookie(res, sessionId) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

function publicUser(row) {
  return { id: row.id, username: row.username };
}

function publicRecord(row) {
  return {
    id: row.id,
    type: row.type,
    amount_cents: row.amount_cents,
    category: row.category,
    note: row.note,
    occurred_on: row.occurred_on,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function parseAmountToCents(amount) {
  if (typeof amount === 'number' && Number.isFinite(amount)) {
    if (amount <= 0) return null;
    return Math.round(amount * 100);
  }
  if (typeof amount === 'string' && amount.trim()) {
    const n = Number(amount.trim());
    if (!Number.isFinite(n) || n <= 0) return null;
    return Math.round(n * 100);
  }
  return null;
}

function validateRecordBody(body) {
  const type = body && body.type;
  if (type !== 'income' && type !== 'expense') {
    return { error: 'type 必须是 income 或 expense' };
  }
  const amountCents = parseAmountToCents(body.amount);
  if (amountCents == null || amountCents > MAX_AMOUNT_CENTS) {
    return { error: '金额必须大于 0' };
  }
  const category = String(body.category || '').trim();
  if (!category || category.length > MAX_CATEGORY) {
    return { error: '请填写分类' };
  }
  const allowed = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  if (allowed.indexOf(category) === -1) {
    return { error: '分类不合法' };
  }
  const note = String(body.note || '');
  if (note.length > MAX_NOTE) {
    return { error: '备注过长' };
  }
  const occurredOn = String(body.occurred_on || '');
  if (!DATE_RE.test(occurredOn)) {
    return { error: '日期格式应为 YYYY-MM-DD' };
  }
  return {
    value: {
      type,
      amount_cents: amountCents,
      category,
      note,
      occurred_on: occurredOn,
    },
  };
}

function createApp(options) {
  const db = options && options.db ? options.db : openDb(options && options.dbPath);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  function getUserFromRequest(req) {
    const cookies = parseCookies(req.headers.cookie);
    const sid = cookies[SESSION_COOKIE];
    if (!sid) return null;
    const now = Date.now();
    const session = db.prepare(
      'SELECT s.id AS session_id, s.expires_at, u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?'
    ).get(sid);
    if (!session || session.expires_at < now) {
      if (session) {
        db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
      }
      return null;
    }
    return session;
  }

  function requireAuth(req, res, next) {
    const user = getUserFromRequest(req);
    if (!user) {
      return sendJson(res, 401, { error: '请先登录' });
    }
    req.user = user;
    next();
  }

  app.get('/api/meta', (req, res) => {
    sendJson(res, 200, {
      incomeCategories: INCOME_CATEGORIES,
      expenseCategories: EXPENSE_CATEGORIES,
    });
  });

  app.post('/api/register', (req, res) => {
    const username = String((req.body && req.body.username) || '').trim();
    const password = String((req.body && req.body.password) || '');
    if (!USERNAME_RE.test(username)) {
      return sendJson(res, 400, { error: '用户名需为 3-32 位字母、数字或下划线' });
    }
    if (password.length < 8 || password.length > 72) {
      return sendJson(res, 400, { error: '密码长度需为 8-72 位' });
    }
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      return sendJson(res, 409, { error: '用户名已存在' });
    }
    const passwordHash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
    const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, passwordHash);
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(result.lastInsertRowid);
    const sessionId = crypto.randomBytes(24).toString('hex');
    db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(
      sessionId,
      user.id,
      Date.now() + SESSION_TTL_MS
    );
    setSessionCookie(res, sessionId);
    sendJson(res, 201, { user: publicUser(user) });
  });

  app.post('/api/login', (req, res) => {
    const username = String((req.body && req.body.username) || '').trim();
    const password = String((req.body && req.body.password) || '');
    const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return sendJson(res, 401, { error: '用户名或密码错误' });
    }
    const sessionId = crypto.randomBytes(24).toString('hex');
    db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(
      sessionId,
      user.id,
      Date.now() + SESSION_TTL_MS
    );
    setSessionCookie(res, sessionId);
    sendJson(res, 200, { user: publicUser(user) });
  });

  app.post('/api/logout', (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const sid = cookies[SESSION_COOKIE];
    if (sid) {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(sid);
    }
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
  });

  app.get('/api/me', requireAuth, (req, res) => {
    sendJson(res, 200, { user: publicUser(req.user) });
  });

  app.get('/api/summary', requireAuth, (req, res) => {
    const row = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount_cents ELSE 0 END), 0) AS income_cents,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount_cents ELSE 0 END), 0) AS expense_cents
      FROM records
      WHERE user_id = ?
    `).get(req.user.id);
    const income = Number(row.income_cents);
    const expense = Number(row.expense_cents);
    sendJson(res, 200, {
      income_cents: income,
      expense_cents: expense,
      balance_cents: income - expense,
    });
  });

  app.get('/api/records', requireAuth, (req, res) => {
    const rows = db.prepare(
      'SELECT * FROM records WHERE user_id = ? ORDER BY occurred_on DESC, id DESC'
    ).all(req.user.id);
    sendJson(res, 200, { records: rows.map(publicRecord) });
  });

  app.post('/api/records', requireAuth, (req, res) => {
    const parsed = validateRecordBody(req.body);
    if (parsed.error) {
      return sendJson(res, 400, { error: parsed.error });
    }
    const v = parsed.value;
    const result = db.prepare(`
      INSERT INTO records (user_id, type, amount_cents, category, note, occurred_on)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.user.id, v.type, v.amount_cents, v.category, v.note, v.occurred_on);
    const row = db.prepare('SELECT * FROM records WHERE id = ? AND user_id = ?').get(result.lastInsertRowid, req.user.id);
    sendJson(res, 201, { record: publicRecord(row) });
  });

  app.put('/api/records/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return sendJson(res, 400, { error: '无效的记录 id' });
    }
    const existing = db.prepare('SELECT id FROM records WHERE id = ? AND user_id = ?').get(id, req.user.id);
    if (!existing) {
      return sendJson(res, 404, { error: '记录不存在' });
    }
    const parsed = validateRecordBody(req.body);
    if (parsed.error) {
      return sendJson(res, 400, { error: parsed.error });
    }
    const v = parsed.value;
    db.prepare(`
      UPDATE records
      SET type = ?, amount_cents = ?, category = ?, note = ?, occurred_on = ?, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?
    `).run(v.type, v.amount_cents, v.category, v.note, v.occurred_on, id, req.user.id);
    const row = db.prepare('SELECT * FROM records WHERE id = ? AND user_id = ?').get(id, req.user.id);
    sendJson(res, 200, { record: publicRecord(row) });
  });

  app.delete('/api/records/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return sendJson(res, 400, { error: '无效的记录 id' });
    }
    const result = db.prepare('DELETE FROM records WHERE id = ? AND user_id = ?').run(id, req.user.id);
    if (!result.changes) {
      return sendJson(res, 404, { error: '记录不存在' });
    }
    sendJson(res, 200, { ok: true });
  });

  const distDir = path.join(__dirname, '..', 'dist');
  const indexFile = path.join(__dirname, '..', 'index.html');
  app.use('/dist', express.static(distDir));
  app.get('/', (req, res) => {
    res.sendFile(indexFile);
  });

  app.use((req, res) => {
    if (req.path.indexOf('/api/') === 0) {
      return sendJson(res, 404, { error: '接口不存在' });
    }
    res.status(404).send('Not found');
  });

  return app;
}

module.exports = { createApp, openDb, INCOME_CATEGORIES, EXPENSE_CATEGORIES };
