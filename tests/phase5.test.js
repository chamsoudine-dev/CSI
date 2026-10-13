const test = require('node:test');
const assert = require('node:assert/strict');

test('Phase 5 — Tableaux de bord par rôle', async (t) => {
  await t.test('Le routeur dashboard est bien exporté et contient les 3 routes', () => {
    const dashboard = require('../src/routes/dashboard');
    assert.ok(dashboard);
    assert.ok(dashboard.stack);

    const routes = dashboard.stack
      .filter(s => s.route)
      .map(s => s.route.path);

    assert.ok(routes.includes('/agent'), 'Route /agent présente');
    assert.ok(routes.includes('/superviseur'), 'Route /superviseur présente');
    assert.ok(routes.includes('/admin'), 'Route /admin présente');
  });
});
