const test = require('node:test');
const assert = require('node:assert/strict');
const { schemas } = require('../src/middleware/validate');

test('Validation - loginSchema', async (t) => {
  await t.test('valide un email et mot de passe corrects', () => {
    const valid = schemas.loginSchema.validate({
      email: 'admin@csi-niger.ne',
      mot_de_passe: 'secret123'
    });
    assert.equal(valid.error, undefined);
  });

  await t.test('rejette un email invalide', () => {
    const invalid = schemas.loginSchema.validate({
      email: 'pas-un-email',
      mot_de_passe: 'secret123'
    });
    assert.ok(invalid.error);
    assert.match(invalid.error.message, /Format email invalide/);
  });

  await t.test('rejette un mot de passe trop court', () => {
    const invalid = schemas.loginSchema.validate({
      email: 'test@csi.ne',
      mot_de_passe: '123'
    });
    assert.ok(invalid.error);
  });
});

test('Validation - csiSchema', async (t) => {
  await t.test('valide un CSI complet', () => {
    const valid = schemas.csiSchema.validate({
      nom: 'CSI Birni',
      region_id: 8,
      commune: 'Zinder',
      type: 'urbaine',
      latitude: 13.8,
      longitude: 8.9,
      services: ['Consultation', 'Maternité']
    });
    assert.equal(valid.error, undefined);
  });

  await t.test('rejette un CSI sans nom ni région', () => {
    const invalid = schemas.csiSchema.validate({
      commune: 'Zinder'
    });
    assert.ok(invalid.error);
  });

  await t.test('rejette une latitude hors limites', () => {
    const invalid = schemas.csiSchema.validate({
      nom: 'CSI Test',
      region_id: 1,
      commune: 'Agadez',
      latitude: 150
    });
    assert.ok(invalid.error);
  });
});

test('Validation - utilisateurSchema', async (t) => {
  await t.test('valide un agent avec csi_id', () => {
    const valid = schemas.utilisateurSchema.validate({
      nom: 'Moussa Ibrahim',
      email: 'moussa@csi.ne',
      mot_de_passe: 'Pass12345',
      role: 'agent',
      csi_id: 12
    });
    assert.equal(valid.error, undefined);
  });

  await t.test('rejette un rôle inconnu', () => {
    const invalid = schemas.utilisateurSchema.validate({
      nom: 'Inconnu',
      email: 'inconnu@csi.ne',
      role: 'hacker'
    });
    assert.ok(invalid.error);
  });
});

test('Validation - rapportSchema', async (t) => {
  await t.test('valide un rapport avec consultations et stocks', () => {
    const valid = schemas.rapportSchema.validate({
      csi_id: 5,
      mois: '2026-09',
      consultations: [
        { motif: 'Paludisme', tranche: 'moins5', sexe: 'M', nombre: 14 }
      ],
      vaccinations: [
        { vaccin: 'BCG', doses: 25 }
      ],
      medicaments: [
        { produit: 'ACT', stock_debut: 50, entrees: 100, sorties: 30, stock_fin: 120, jours_rupture: 0 }
      ]
    });
    assert.equal(valid.error, undefined);
  });

  await t.test('rejette un format de mois invalide', () => {
    const invalid = schemas.rapportSchema.validate({
      csi_id: 5,
      mois: '09-2026'
    });
    assert.ok(invalid.error);
  });
});
