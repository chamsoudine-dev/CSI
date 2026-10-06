const test = require('node:test');
const assert = require('node:assert/strict');
const { logAudit } = require('../src/utils/audit');

test('Audit - logAudit', async (t) => {
  await t.test('exécute la requête SQL avec les bons paramètres', async () => {
    let executedQuery = null;
    let executedParams = null;

    const mockClient = {
      query: async (sql, params) => {
        executedQuery = sql;
        executedParams = params;
        return { rows: [] };
      }
    };

    await logAudit({
      utilisateur_id: 1,
      action: 'LOGIN',
      table_cible: 'utilisateurs',
      enregistrement_id: 1,
      details: { role: 'admin' },
      ip_adresse: '127.0.0.1',
      client: mockClient
    });

    assert.ok(executedQuery.includes('INSERT INTO audit_log'));
    assert.equal(executedParams[0], 1);
    assert.equal(executedParams[1], 'LOGIN');
    assert.equal(executedParams[2], 'utilisateurs');
    assert.equal(executedParams[3], 1);
    assert.equal(executedParams[4], JSON.stringify({ role: 'admin' }));
    assert.equal(executedParams[5], '127.0.0.1');
  });

  await t.test('ne lève pas d\'exception si la base de données échoue', async () => {
    const failingClient = {
      query: async () => {
        throw new Error('Connexion DB perdue');
      }
    };

    // Doit gérer l'erreur gracieusement sans crasher l'application
    await assert.doesNotReject(async () => {
      await logAudit({
        action: 'TEST_ERROR',
        client: failingClient
      });
    });
  });
});
