const { Pool } = require('pg');
const logger = require('../utils/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,                        // max 20 connexions simultanées
  min: 2,                         // garder 2 connexions en veille
  idleTimeoutMillis: 30000,       // ferme les connexions inactives après 30s
  connectionTimeoutMillis: 5000,  // timeout si aucune connexion disponible
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
});

// Gérer les erreurs inattendues du pool
pool.on('error', (err, client) => {
  logger.error({ err }, 'Erreur inattendue du pool PostgreSQL');
});

pool.on('connect', () => {
  logger.debug('Nouvelle connexion DB établie');
});

/**
 * Exécute une transaction et rollback automatiquement en cas d'erreur
 * @param {Function} fn - fonction async qui reçoit le client DB
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, withTransaction };
