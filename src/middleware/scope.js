/**
 * middleware/scope.js
 * Contrôle strict du périmètre d'accès (scoping) selon le rôle :
 * - agent : son csi_id uniquement
 * - superviseur : sa region_id uniquement (et les CSI de cette région)
 * - superviseur_national : accès de supervision sur toutes les régions
 * - admin : accès global national
 *
 * Le serveur NE DOIT JAMAIS faire confiance à un csi_id / region_id envoyé
 * par le client sans le comparer à ce périmètre.
 */

const { pool } = require('../config/database');
const logger = require('../utils/logger');

/**
 * Calcule le périmètre d'un utilisateur à partir de req.user
 * @param {Object} user
 * @returns {Object} { role, isAll, csi_id, region_id }
 */
function getScope(user) {
  if (!user) return { role: null, isAll: false, csi_id: null, region_id: null };

  const role = user.role;
  if (role === 'superviseur_national') {
    return { role, isAll: true, csi_id: null, region_id: null };
  }
  if (role === 'admin') {
    return { role: 'admin', isAll: true, csi_id: null, region_id: null };
  }
  if (role === 'superviseur') {
    return {
      role: 'superviseur',
      isAll: false,
      csi_id: null,
      region_id: user.region_id ? parseInt(user.region_id, 10) : null
    };
  }
  if (role === 'agent') {
    return {
      role: 'agent',
      isAll: false,
      csi_id: user.csi_id ? parseInt(user.csi_id, 10) : null,
      region_id: user.region_id ? parseInt(user.region_id, 10) : null
    };
  }
  return { role: null, isAll: false, csi_id: null, region_id: null };
}

/**
 * Middleware qui injecte req.scope sur la requête
 */
function attachScope(req, res, next) {
  req.scope = getScope(req.user);
  next();
}

/**
 * Vérifie si un CSI donné fait partie du périmètre de l'utilisateur
 * @param {number|string} csiId - ID du CSI cible
 * @param {Object} user - req.user
 * @param {Object} [db] - Pool ou client PG optionnel
 * @returns {Promise<boolean>}
 */
async function checkCsiScope(csiId, user, db = pool) {
  if (process.env.MODE_DEV === 'true') return true;
  if (!user) return false;
  const numCsiId = parseInt(csiId, 10);
  if (isNaN(numCsiId)) return false;

  if (user.role === 'admin') return true;
  if (user.role === 'superviseur_national') return true;

  if (user.role === 'agent') {
    return user.csi_id === numCsiId;
  }

  if (user.role === 'superviseur') {
    if (!user.region_id) return false;
    try {
      const { rows } = await db.query(
        `SELECT 1 FROM csi c
         JOIN communes co ON co.id = c.commune_id
         WHERE c.id = $1 AND co.region_id = $2`,
        [numCsiId, user.region_id]
      );
      return rows.length > 0;
    } catch (e) {
      logger.error({ err: e, csiId: numCsiId, userId: user.id }, 'Erreur vérification périmètre CSI');
      return false;
    }
  }

  return false;
}

/**
 * Vérifie si une région donnée fait partie du périmètre de l'utilisateur
 * @param {number|string} regionId - ID de la région
 * @param {Object} user - req.user
 * @returns {boolean}
 */
function checkRegionScope(regionId, user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'superviseur_national') return true;
  const numRegionId = parseInt(regionId, 10);
  if (isNaN(numRegionId)) return false;

  if (user.role === 'superviseur') {
    return user.region_id === numRegionId;
  }

  return false;
}

/**
 * Middleware de validation des paramètres :id (entiers positifs)
 * Évite les erreurs 500 sur parseInt ou NaN
 * @param {string} [paramName='id']
 */
function validateIdParam(paramName = 'id') {
  return (req, res, next) => {
    const val = req.params[paramName];
    if (val !== undefined) {
      const num = Number(val);
      if (!Number.isInteger(num) || num <= 0) {
        return res.status(400).json({ erreur: `Paramètre :${paramName} invalide (entier positif requis)` });
      }
    }
    next();
  };
}

module.exports = {
  getScope,
  attachScope,
  checkCsiScope,
  checkRegionScope,
  validateIdParam
};
