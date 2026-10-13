const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

describe('Phase 3 — Docker & Déploiement', () => {
  test('3.1 docker-compose.yml : syntaxe obligatoire ${VAR:?} et absence de wget healthcheck', () => {
    const composeContent = fs.readFileSync(path.join(__dirname, '..', 'docker-compose.yml'), 'utf8');
    assert.match(composeContent, /\$\{POSTGRES_PASSWORD:\?[^}]+\}/, 'POSTGRES_PASSWORD doit être obligatoire sans valeur par défaut');
    assert.match(composeContent, /\$\{JWT_SECRET:\?[^}]+\}/, 'JWT_SECRET doit être obligatoire sans valeur par défaut');
    assert.match(composeContent, /\$\{ADMIN_PASSWORD:\?[^}]+\}/, 'ADMIN_PASSWORD doit être obligatoire sans valeur par défaut');
    assert.ok(!composeContent.includes('wget -qO-'), 'Le healthcheck wget redondant doit être supprimé de app');
    assert.match(composeContent, /profiles:\s*(\n\s*-\s*dev|\["dev"\])/, 'Le port 5432 doit être sous le profil dev');
  });

  test('3.2 docker-entrypoint.sh : seed_catalogue exécuté et seed_profiles conditionné à SEED_DEMO', () => {
    const entrypoint = fs.readFileSync(path.join(__dirname, '..', 'docker-entrypoint.sh'), 'utf8');
    assert.match(entrypoint, /seed_catalogue\.js/, 'seed_catalogue.js doit être invoqué dans entrypoint');
    assert.match(entrypoint, /SEED_DEMO/, 'seed_profiles.js doit être conditionné par SEED_DEMO');
  });

  test('3.3 .dockerignore et Dockerfile incluent le catalogue CSV', () => {
    const dockerignore = fs.readFileSync(path.join(__dirname, '..', '.dockerignore'), 'utf8');
    const ignoredLines = dockerignore.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    assert.ok(!ignoredLines.includes('catalogue_niger.csv'), 'catalogue_niger.csv ne doit pas être ignoré');
    const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf8');
    assert.match(dockerfile, /catalogue_niger\.csv/, 'catalogue_niger.csv doit être copié dans le Dockerfile');
  });

  test('3.4 scripts/backup.sh existe et est configuré avec pg_dump et rétention', () => {
    const backupScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'backup.sh'), 'utf8');
    assert.match(backupScript, /pg_dump/, 'Le script doit contenir la commande pg_dump');
    assert.match(backupScript, /RETENTION_DAYS/, 'Le script doit gérer la rétention');
    assert.match(backupScript, /gzip/, 'Le script doit compresser les sauvegardes');
  });

  test('3.5 Documentation à jour dans DOCKER.md et README.md', () => {
    const dockerMd = fs.readFileSync(path.join(__dirname, '..', 'DOCKER.md'), 'utf8');
    const readmeMd = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
    assert.match(dockerMd, /backup\.sh/, 'DOCKER.md doit documenter backup.sh');
    assert.match(dockerMd, /migrations_appliquees/, 'DOCKER.md doit documenter les migrations dans healthcheck');
    assert.match(readmeMd, /backup\.sh/, 'README.md doit documenter le script de sauvegarde');
    assert.match(readmeMd, /\/api\/health/, 'README.md doit documenter /api/health');
  });

  test('3.6 stats.js route /health retourne version et migrations_appliquees', async () => {
    const statsRouter = require('../src/routes/stats');
    const routeLayer = statsRouter.stack.find(l => l.route && l.route.path === '/health');
    assert.ok(routeLayer, 'Route GET /health doit être définie');
    const handler = routeLayer.route.stack[0].handle;

    let responseData = null;
    let statusCode = 200;
    const req = { path: '/health' };
    const res = {
      status(code) { statusCode = code; return this; },
      json(data) { responseData = data; return this; }
    };

    await handler(req, res, () => {});
    assert.ok(responseData, 'La route doit renvoyer du JSON');
    if (statusCode === 200) {
      assert.equal(responseData.status, 'ok');
      assert.ok('version' in responseData);
      assert.ok('migrations_appliquees' in responseData);
      assert.ok(Array.isArray(responseData.migrations_appliquees));
    } else {
      assert.equal(statusCode, 503);
      assert.equal(responseData.status, 'error');
      assert.equal(responseData.db, 'down');
    }

    const { pool } = require('../src/config/database');
    await pool.end().catch(() => {});
  });
});
