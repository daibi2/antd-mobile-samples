const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const bcrypt = require('bcryptjs');
const { createApp, openDb } = require('../server/app');

function createJar() {
  let cookie = '';
  return {
    async request(base, path, options) {
      const opts = options || {};
      const headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
      if (cookie) headers.Cookie = cookie;
      let body = opts.body;
      if (body && typeof body !== 'string') {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(body);
      }
      const res = await fetch(base + path, {
        method: opts.method || 'GET',
        headers,
        body,
      });
      const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
      if (setCookies.length) {
        cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
      }
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data, cookie };
    },
  };
}

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

describe('ledger api', () => {
  let db;
  let server;
  let base;

  before(async () => {
    db = openDb(':memory:');
    const app = createApp({ db });
    const listening = await listen(app);
    server = listening.server;
    base = listening.base;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });

  it('rejects unauthenticated record access', async () => {
    const jar = createJar();
    const res = await jar.request(base, '/api/records');
    assert.equal(res.status, 401);
  });

  it('validates register payload', async () => {
    const jar = createJar();
    const shortName = await jar.request(base, '/api/register', {
      method: 'POST',
      body: { username: 'ab', password: 'password1' },
    });
    assert.equal(shortName.status, 400);
    const shortPass = await jar.request(base, '/api/register', {
      method: 'POST',
      body: { username: 'alice', password: 'short' },
    });
    assert.equal(shortPass.status, 400);
  });

  it('registers, stores a password hash, and isolates records between users', async () => {
    const alice = createJar();
    const bob = createJar();

    const reg = await alice.request(base, '/api/register', {
      method: 'POST',
      body: { username: 'alice', password: 'password1' },
    });
    assert.equal(reg.status, 201);
    assert.equal(reg.data.user.username, 'alice');
    assert.equal(reg.data.user.password_hash, undefined);

    const stored = db.prepare('SELECT password_hash FROM users WHERE username = ?').get('alice');
    assert.ok(stored.password_hash);
    assert.notEqual(stored.password_hash, 'password1');
    assert.equal(bcrypt.compareSync('password1', stored.password_hash), true);

    const dup = await bob.request(base, '/api/register', {
      method: 'POST',
      body: { username: 'Alice', password: 'password1' },
    });
    assert.equal(dup.status, 409);

    const bobReg = await bob.request(base, '/api/register', {
      method: 'POST',
      body: { username: 'bob', password: 'password2' },
    });
    assert.equal(bobReg.status, 201);

    const created = await alice.request(base, '/api/records', {
      method: 'POST',
      body: {
        type: 'income',
        amount: 100.5,
        category: '工资',
        note: '九月',
        occurred_on: '2026-09-01',
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.record.amount_cents, 10050);
    const recordId = created.data.record.id;

    const expense = await alice.request(base, '/api/records', {
      method: 'POST',
      body: {
        type: 'expense',
        amount: '20.00',
        category: '餐饮',
        note: '',
        occurred_on: '2026-09-02',
      },
    });
    assert.equal(expense.status, 201);

    const summary = await alice.request(base, '/api/summary');
    assert.equal(summary.status, 200);
    assert.equal(summary.data.income_cents, 10050);
    assert.equal(summary.data.expense_cents, 2000);
    assert.equal(summary.data.balance_cents, 8050);

    const bobList = await bob.request(base, '/api/records');
    assert.equal(bobList.status, 200);
    assert.equal(bobList.data.records.length, 0);

    const bobSummary = await bob.request(base, '/api/summary');
    assert.equal(bobSummary.data.balance_cents, 0);

    const stolen = await bob.request(base, `/api/records/${recordId}`, {
      method: 'PUT',
      body: {
        type: 'expense',
        amount: 1,
        category: '餐饮',
        note: 'hack',
        occurred_on: '2026-09-01',
      },
    });
    assert.equal(stolen.status, 404);

    const stolenDel = await bob.request(base, `/api/records/${recordId}`, { method: 'DELETE' });
    assert.equal(stolenDel.status, 404);

    const updated = await alice.request(base, `/api/records/${recordId}`, {
      method: 'PUT',
      body: {
        type: 'income',
        amount: 200,
        category: '奖金',
        note: '改',
        occurred_on: '2026-09-03',
      },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.data.record.amount_cents, 20000);
    assert.equal(updated.data.record.category, '奖金');

    const listed = await alice.request(base, '/api/records');
    assert.equal(listed.data.records.length, 2);

    const removed = await alice.request(base, `/api/records/${recordId}`, { method: 'DELETE' });
    assert.equal(removed.status, 200);
    const afterDel = await alice.request(base, '/api/records');
    assert.equal(afterDel.data.records.length, 1);
    assert.equal(afterDel.data.records[0].type, 'expense');
  });

  it('logs in with session cookie and logs out', async () => {
    const jar = createJar();
    const bad = await jar.request(base, '/api/login', {
      method: 'POST',
      body: { username: 'alice', password: 'wrong-password' },
    });
    assert.equal(bad.status, 401);

    const ok = await jar.request(base, '/api/login', {
      method: 'POST',
      body: { username: 'alice', password: 'password1' },
    });
    assert.equal(ok.status, 200);
    const me = await jar.request(base, '/api/me');
    assert.equal(me.status, 200);
    assert.equal(me.data.user.username, 'alice');

    const logout = await jar.request(base, '/api/logout', { method: 'POST' });
    assert.equal(logout.status, 200);
    const me2 = await jar.request(base, '/api/me');
    assert.equal(me2.status, 401);
  });

  it('rejects invalid record payloads', async () => {
    const jar = createJar();
    await jar.request(base, '/api/login', {
      method: 'POST',
      body: { username: 'bob', password: 'password2' },
    });
    const badType = await jar.request(base, '/api/records', {
      method: 'POST',
      body: { type: 'transfer', amount: 10, category: '餐饮', occurred_on: '2026-09-01' },
    });
    assert.equal(badType.status, 400);
    const badCat = await jar.request(base, '/api/records', {
      method: 'POST',
      body: { type: 'expense', amount: 10, category: '工资', occurred_on: '2026-09-01' },
    });
    assert.equal(badCat.status, 400);
  });
});
