const test = require('node:test');
const assert = require('node:assert/strict');
const { schemas } = require('../src/middleware/validate');

test('Validation - utilisateurUpdateSchema', async (t) => {
  await t.test('valide une modification partielle du nom et email', () => {
    const valid = schemas.utilisateurUpdateSchema.validate({
      nom: 'Fatima Abdou',
      email: 'fatima@csi-niger.ne'
    });
    assert.equal(valid.error, undefined);
  });

  await t.test('valide un changement de mot de passe', () => {
    const valid = schemas.utilisateurUpdateSchema.validate({
      mot_de_passe: 'NouveauPass2026'
    });
    assert.equal(valid.error, undefined);
  });

  await t.test('valide le rôle de superviseur national', () => {
    const valid = schemas.utilisateurSchema.validate({
      email: 'superviseur.national@example.ne',
      nom: 'Superviseur National',
      mot_de_passe: 'NouveauPass2026',
      role: 'superviseur_national'
    });
    assert.equal(valid.error, undefined);
  });

  await t.test('rejette un rôle non prévu par le système', () => {
    const invalid = schemas.utilisateurSchema.validate({
      email: 'inconnu@example.ne',
      nom: 'Compte Inconnu',
      mot_de_passe: 'NouveauPass2026',
      role: 'superviseur_international'
    });
    assert.ok(invalid.error);
  });

  await t.test('rejette un email mal formaté', () => {
    const invalid = schemas.utilisateurUpdateSchema.validate({
      email: 'email_non_valide'
    });
    assert.ok(invalid.error);
  });

  await t.test('rejette un mot de passe trop court', () => {
    const invalid = schemas.utilisateurUpdateSchema.validate({
      mot_de_passe: 'court'
    });
    assert.ok(invalid.error);
  });

  await t.test('valide la modification du statut actif', () => {
    const valid = schemas.utilisateurUpdateSchema.validate({
      actif: false
    });
    assert.equal(valid.error, undefined);
  });
});
