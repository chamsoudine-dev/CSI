/**
 * Utilitaire d'audit — CSI Niger v2.0
 * Enregistre les actions importantes dans la table audit_log
 */

const { pool } = require('../config/database');
const logger = require('./logger');

/**
 * Enregistre un événement dans la table audit_log
 * @param {Object} params
 * @param {number|null} params.utilisateur_id - ID de l'utilisateur qui a fait l'action
 * @param {string} params.action - Code action (ex: 'LOGIN', 'CREATE_CSI', 'UPDATE_RAPPORT')
 * @param {string|null} [params.table_cible] - Nom de la table impactée
 * @param {number|null} [params.enregistrement_id] - ID de l'enregistrement impacté
 * @param {Object|null} [params.details] - Données additionnelles en JSON
 * @param {string|null} [params.ip_adresse] - IP de la requête
 * @param {Object} [params.client] - Client PG optionnel si dans une transaction
 */
async function logAudit({
  utilisateur_id = null,
  action,
  table_cible = null,
  enregistrement_id = null,
  details = null,
  ip_adresse = null,
  client = null
}) {
  const db = client || pool;
  try {
    await db.query(
      `INSERT INTO audit_log (utilisateur_id, action, table_cible, enregistrement_id, details, ip_adresse)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        utilisateur_id,
        action,
        table_cible,
        enregistrement_id,
        details ? JSON.stringify(details) : null,
        ip_adresse
      ]
    );
  } catch (err) {
    // Ne bloque pas l'opération principale si l'audit échoue, mais journalise l'erreur
    logger.error({ err, action, utilisateur_id }, "Erreur lors de l'enregistrement de l'audit");
  }
}

module.exports = { logAudit };
