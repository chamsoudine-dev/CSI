const test = require('node:test');
const assert = require('node:assert/strict');

test('Phase 4 — Modules backend', async (t) => {
  await t.test('Les routeurs Phase 4 sont exportés', () => {
    const rapports = require('../src/routes/rapports');
    const unfpa = require('../src/routes/unfpa');
    const referentiels = require('../src/routes/referentiels');
    const admin = require('../src/routes/admin');
    const alertes = require('../src/routes/alertes');

    assert.ok(rapports);
    assert.ok(unfpa);
    assert.ok(referentiels);
    assert.ok(admin);
    assert.ok(alertes);
  });
});
