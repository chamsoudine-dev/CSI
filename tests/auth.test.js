const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'cle-de-test-super-securisee-pour-antigravity-123';
const { signToken, auth, checkCsiAccess } = require('../src/middleware/auth');

test('Auth - signToken et vérification JWT', async (t) => {
  const user = {
    id: 42,
    email: 'agent@csi-niger.ne',
    nom: 'Ali Amadou',
    role: 'agent',
    csi_id: 10,
    region_id: 3
  };

  const token = signToken(user);
  assert.ok(token);

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  assert.equal(decoded.id, 42);
  assert.equal(decoded.email, 'agent@csi-niger.ne');
  assert.equal(decoded.role, 'agent');
  assert.equal(decoded.csi_id, 10);
});

test('Auth - Middleware auth()', async (t) => {
  await t.test('bloque une requête sans token (401)', () => {
    const req = { get: () => null };
    let statusSent = null;
    let jsonSent = null;
    const res = {
      status: (code) => { statusSent = code; return res; },
      json: (data) => { jsonSent = data; }
    };
    let nextCalled = false;

    auth() (req, res, () => { nextCalled = true; });

    assert.equal(statusSent, 401);
    assert.equal(nextCalled, false);
    assert.match(jsonSent.erreur, /Connexion requise/);
  });

  await t.test('autorise un token valide dans Authorization Header', () => {
    const token = signToken({ id: 1, role: 'admin', nom: 'Admin' });
    const req = { get: (header) => (header === 'Authorization' ? `Bearer ${token}` : null) };
    const res = {};
    let nextCalled = false;

    auth(['admin']) (req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.equal(req.user.id, 1);
    assert.equal(req.user.role, 'admin');
  });

  await t.test('refuse un rôle insuffisant (403)', () => {
    const token = signToken({ id: 2, role: 'agent', nom: 'Agent' });
    const req = { get: (h) => (h === 'Authorization' ? `Bearer ${token}` : null) };
    let statusSent = null;
    const res = {
      status: (code) => { statusSent = code; return res; },
      json: () => {}
    };
    let nextCalled = false;

    auth(['admin']) (req, res, () => { nextCalled = true; });

    assert.equal(statusSent, 403);
    assert.equal(nextCalled, false);
  });
});

test('Auth - checkCsiAccess', async (t) => {
  await t.test('autorise un admin pour n\'importe quel CSI', () => {
    const req = { user: { role: 'admin' }, body: { csi_id: 99 } };
    let nextCalled = false;
    checkCsiAccess(req, {}, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  });

  await t.test('autorise un agent pour son propre CSI', () => {
    const req = { user: { role: 'agent', csi_id: 5 }, body: { csi_id: 5 } };
    let nextCalled = false;
    checkCsiAccess(req, {}, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  });

  await t.test('interdit un agent pour un autre CSI', () => {
    const req = { user: { role: 'agent', csi_id: 5 }, body: { csi_id: 8 } };
    let statusSent = null;
    const res = {
      status: (code) => { statusSent = code; return res; },
      json: () => {}
    };
    let nextCalled = false;
    checkCsiAccess(req, res, () => { nextCalled = true; });
    assert.equal(statusSent, 403);
    assert.equal(nextCalled, false);
  });
});
