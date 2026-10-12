const test = require('node:test');
const assert = require('node:assert/strict');
const { getScope, checkRegionScope, validateIdParam } = require('../src/middleware/scope');
const { schemas } = require('../src/middleware/validate');

test('Phase 2 - Scope & Périmètres', async (t) => {
  await t.test('calcule le périmètre admin (isAll: true)', () => {
    const scope = getScope({ id: 1, role: 'admin' });
    assert.equal(scope.role, 'admin');
    assert.equal(scope.isAll, true);
    assert.equal(scope.region_id, null);
    assert.equal(scope.csi_id, null);
  });

  await t.test('calcule le périmètre superviseur (region_id forcé)', () => {
    const scope = getScope({ id: 2, role: 'superviseur', region_id: 3 });
    assert.equal(scope.role, 'superviseur');
    assert.equal(scope.isAll, false);
    assert.equal(scope.region_id, 3);
    assert.equal(scope.csi_id, null);
  });

  await t.test('calcule le périmètre agent (csi_id forcé)', () => {
    const scope = getScope({ id: 3, role: 'agent', csi_id: 15 });
    assert.equal(scope.role, 'agent');
    assert.equal(scope.isAll, false);
    assert.equal(scope.csi_id, 15);
  });

  await t.test('checkRegionScope respecte les rôles', () => {
    assert.equal(checkRegionScope(3, { role: 'admin' }), true);
    assert.equal(checkRegionScope(3, { role: 'superviseur', region_id: 3 }), true);
    assert.equal(checkRegionScope(4, { role: 'superviseur', region_id: 3 }), false);
    assert.equal(checkRegionScope(3, { role: 'agent', csi_id: 1 }), false);
  });

  await t.test('validateIdParam bloque les identifiants non entiers', () => {
    const mw = validateIdParam('id');
    let statusSent = null;
    let jsonSent = null;
    const res = {
      status: (code) => { statusSent = code; return res; },
      json: (d) => { jsonSent = d; }
    };

    let nextCalled = false;
    mw({ params: { id: 'abc' } }, res, () => { nextCalled = true; });
    assert.equal(statusSent, 400);
    assert.equal(nextCalled, false);

    nextCalled = false;
    mw({ params: { id: '12' } }, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
  });
});

test('Phase 2 - Validation Joi Santé Maternelle & Ravitaillement', async (t) => {
  await t.test('valide une naissance correcte', () => {
    const val = schemas.naissanceSchema.validate({
      csi_id: 5,
      nom_mere: 'Amina Moussa',
      sexe: 'F',
      date_naissance: '2026-03-15',
      poids_grammes: 3200
    });
    assert.equal(val.error, undefined);
  });

  await t.test('rejette une naissance sans nom de mère ou poids invalide', () => {
    const val = schemas.naissanceSchema.validate({
      csi_id: 5,
      sexe: 'F',
      date_naissance: '2026-03-15',
      poids_grammes: 200 // Trop faible (< 400g)
    });
    assert.ok(val.error);
  });

  await t.test('valide une commande de ravitaillement', () => {
    const val = schemas.ravitaillementSchema.validate({
      csi_id: 10,
      priorite: 'URGENTE',
      lignes: [{ medicament_id: 1, quantite_demandee: 50 }]
    });
    assert.equal(val.error, undefined);
  });

  await t.test('rejette une commande de ravitaillement sans lignes', () => {
    const val = schemas.ravitaillementSchema.validate({
      csi_id: 10,
      lignes: []
    });
    assert.ok(val.error);
  });

  await t.test('valide le changement de mot de passe (min 8 car)', () => {
    const ok = schemas.changementMotDePasseSchema.validate({
      ancien_mot_de_passe: 'AncienPass123',
      nouveau_mot_de_passe: 'NouveauPass2026'
    });
    assert.equal(ok.error, undefined);

    const tropCourt = schemas.changementMotDePasseSchema.validate({
      ancien_mot_de_passe: 'AncienPass123',
      nouveau_mot_de_passe: 'court'
    });
    assert.ok(tropCourt.error);
  });
});
