const test = require('node:test');
const assert = require('node:assert/strict');
const missions = require('../src/routes/missions');
const migration = require('node:fs').readFileSync(
  require('node:path').join(__dirname, '..', 'migrations', '015_mission_acceptation_periode.sql'),
  'utf8'
);

const { completionPercent, normalizePeriod, validateAnswers } = missions.helpers;

test('Missions - période de publication', () => {
  assert.deepEqual(normalizePeriod('2026-11-01', '2026-11-15', true), {
    start: '2026-11-01',
    end: '2026-11-15'
  });
  assert.throws(() => normalizePeriod(null, '2026-11-15', true), { status: 400 });
  assert.throws(() => normalizePeriod('2026-11-16', '2026-11-15', true), { status: 400 });
  assert.throws(() => normalizePeriod('2026-02-31', '2026-03-15', true), { status: 400 });
  assert.deepEqual(normalizePeriod(null, null, false), { start: null, end: null });
});

test('Missions - avancement et réponses obligatoires', () => {
  const form = { fields: [
    { id: 'site', label: 'CSI', type: 'text', required: true, options: [] },
    { id: 'visite', label: 'Visite faite', type: 'checkbox', required: false, options: [] }
  ] };

  assert.equal(completionPercent(form, { site: 'CSI Test' }), 50);
  assert.equal(validateAnswers(form, {}, true), 'La question « CSI » est obligatoire.');
  assert.equal(validateAnswers(form, { site: 'CSI Test', visite: false }, true), null);
});

test('Missions - schéma d’acceptation et routes de suivi présentes', () => {
  assert.match(migration, /ACCEPTEE/);
  assert.match(migration, /date_debut DATE/);
  const paths = missions.stack.filter(layer => layer.route).map(layer => layer.route.path);
  assert.ok(paths.includes('/:id/accepter'));
  assert.ok(paths.includes('/:id/reponses'));
});