const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('Phase 3 — Architecture & Déploiement (mode local direct)', () => {
  test('3.1 Les fichiers Docker ont été supprimés (migration vers le mode local)', () => {
    const dockerFiles = [
      'docker-compose.yml',
      'docker-compose.dev.yml',
      'Dockerfile',
      'docker-entrypoint.sh',
      'DOCKER.md'
    ];
    for (const f of dockerFiles) {
      assert.ok(!fs.existsSync(path.join(__dirname, '..', f)), `Le fichier ${f} ne doit plus exister (Docker supprimé)`);
    }
  });

  test('3.2 scripts/backup.sh existe et est configuré avec pg_dump et rétention', () => {
    const backupScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'backup.sh'), 'utf8');
    assert.match(backupScript, /pg_dump/, 'Le script doit contenir la commande pg_dump');
    assert.match(backupScript, /RETENTION_DAYS/, 'Le script doit gérer la rétention');
    assert.match(backupScript, /gzip/, 'Le script doit compresser les sauvegardes');
  });

  test('3.3 stats.js route /health retourne version et migrations_appliquees', async () => {
    const statsRouter = require('../src/routes/stats');
    const { pool } = require('../src/config/database');
    const routeLayer = statsRouter.stack.find(l => l.route && l.route.path === '/health');
    assert.ok(routeLayer, 'Route GET /health doit être définie');
    const handler = routeLayer.route.stack[0].handle;

    const originalQuery = pool.query;
    try {
      pool.query = async (query) => ({
        rows: query.includes('FROM migrations') ? [{ fichier: '001_schema.sql' }] : []
      });

      let responseData = null;
      const req = { path: '/health' };
      const res = {
        json(data) { responseData = data; return this; }
      };

      await handler(req, res, () => {});
      assert.equal(responseData.status, 'ok');
      assert.ok('version' in responseData);
      assert.ok('migrations_appliquees' in responseData);
      assert.deepEqual(responseData.migrations_appliquees, ['001_schema.sql']);

      let errorStatus = null;
      responseData = null;
      pool.query = async () => { throw new Error('Database unavailable'); };
      await handler(req, {
        status(code) { errorStatus = code; return this; },
        json(data) { responseData = data; return this; }
      }, () => {});
      assert.equal(errorStatus, 503);
      assert.equal(responseData.status, 'error');
      assert.equal(responseData.db, 'down');
    } finally {
      pool.query = originalQuery;
    }
  });
});