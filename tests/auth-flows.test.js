const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const router = require('../src/routes/auth');
const { schemas } = require('../src/middleware/validate');
const { pool } = require('../src/config/database');
const { signToken } = require('../src/middleware/auth');

test('Authentification - parcours disponibles', () => {
  const routes = router.stack
    .filter(layer => layer.route)
    .map(layer => `${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`);

  for (const route of [
    'POST /login',
    'POST /login/verify-code',
    'POST /mot-de-passe-oublie',
    'POST /mot-de-passe-oublie/valider',
    'POST /me/mot-de-passe/demander-code',
    'POST /me/mot-de-passe/valider',
    'POST /me/2fa/demander-code',
    'POST /me/2fa/verifier-code'
  ]) {
    assert.ok(routes.includes(route), `${route} doit être déclarée`);
  }
  assert.ok(!routes.some(route => /quick-login|quick-users/.test(route)));
});

test('Authentification - le superviseur national peut gérer les utilisateurs mais pas les fonctions admin', () => {
  const userRoute = router.stack.find(layer => layer.route && layer.route.path === '/utilisateurs');
  assert.ok(userRoute, 'La route de gestion des utilisateurs doit exister');
  const accessMiddleware = userRoute.route.stack[0].handle;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const token = signToken({ id: 44, role: 'superviseur_national', nom: 'Superviseur National' });
    const req = { get: name => name === 'Authorization' ? `Bearer ${token}` : null };
    let allowed = false;
    accessMiddleware(req, { status() { return this; }, json() { return this; } }, () => { allowed = true; });
    assert.equal(allowed, true);

    const adminRouter = require('../src/routes/admin');
    const auditRoute = adminRouter.stack.find(layer => layer.route && layer.route.path === '/audit');
    const adminOnly = auditRoute.route.stack[0].handle;
    let adminOnlyAllowed = false;
    adminOnly(req, { status() { return this; }, json() { return this; } }, () => { adminOnlyAllowed = true; });
    assert.equal(adminOnlyAllowed, false);
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

test('Authentification - validation des entrées', () => {
  assert.ok(schemas.loginSchema.validate({ email: 'agent@example.ne' }).error);
  assert.equal(schemas.loginSchema.validate({
    email: 'AGENT@example.ne',
    mot_de_passe: 'mot-de-passe'
  }).error, undefined);
  assert.ok(schemas.verificationCodeSchema.validate({
    challenge_id: 'not-a-uuid',
    code: '123456'
  }).error);
  assert.ok(schemas.verificationCodeSchema.validate({
    challenge_id: '38e25865-48a5-4db1-9af7-d7e968c2309b',
    code: '12345'
  }).error);
  assert.ok(schemas.changementMotDePasseSchema.validate({
    challenge_id: '38e25865-48a5-4db1-9af7-d7e968c2309b',
    code: '123456',
    nouveau_mot_de_passe: 'court'
  }).error);
  const profile = schemas.profilSchema.validate({
    telephone: '+227 90 00 00 00',
    statut_2fa: true
  }, { stripUnknown: true });
  assert.equal(profile.error, undefined);
  assert.equal(profile.value.statut_2fa, undefined);
});

test('Authentification - exige un mot de passe valide avant de délivrer un jeton', async () => {
  const loginRoute = router.stack.find(layer => layer.route && layer.route.path === '/login');
  const [validateLogin, login] = loginRoute.route.stack.map(layer => layer.handle);
  const user = {
    id: 8,
    email: 'agent@example.ne',
    nom: 'Agent',
    role: 'agent',
    csi_id: 3,
    region_id: 2,
    actif: true,
    statut_2fa: false,
    session_version: 0,
    mot_de_passe_hash: await bcrypt.hash('MotDePasseValide2026', 4)
  };
  const originalQuery = pool.query;
  pool.query = async sql => sql.includes('SELECT * FROM utilisateurs')
    ? { rows: [user] }
    : { rows: [] };

  async function submit(credentials) {
    const req = { body: credentials, ip: '127.0.0.1' };
    let statusCode = 200;
    let body;
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { body = data; return this; }
    };
    let validationFailed = false;
    validateLogin(req, res, () => {});
    if (statusCode === 400) validationFailed = true;
    if (!validationFailed) await login(req, res);
    return { statusCode, body };
  }

  try {
    const missingPassword = await submit({ email: user.email });
    assert.equal(missingPassword.statusCode, 400);
    const wrongPassword = await submit({ email: user.email, mot_de_passe: 'incorrect' });
    assert.equal(wrongPassword.statusCode, 401);
    assert.equal(wrongPassword.body.token, undefined);
    const validPassword = await submit({ email: user.email, mot_de_passe: 'MotDePasseValide2026' });
    assert.equal(validPassword.statusCode, 200);
    assert.ok(validPassword.body.token);
    assert.equal(validPassword.body.utilisateur.email, user.email);
  } finally {
    pool.query = originalQuery;
  }
});
