const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET || process.env.SECRET;
const JWT_EXPIRES = process.env.JWT_EXPIRES || '7d';

/**
 * Génère un token JWT pour un utilisateur
 */
function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      nom: user.nom,
      csi_id: user.csi_id || null,
      region_id: user.region_id || null
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

/**
 * Middleware d'authentification avec contrôle de rôle optionnel.
 * @param {string[]} roles - Rôles autorisés (vide = tout utilisateur connecté)
 */
function auth(roles = []) {
  return (req, res, next) => {
    // Chercher le token dans Authorization: Bearer xxx ou x-token (compatibilité v1)
    let token = null;
    const authHeader = req.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else {
      token = req.get('x-token');
    }

    if (!token) {
      return res.status(401).json({ erreur: 'Connexion requise' });
    }

    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = payload;
    } catch (e) {
      if (e.name === 'TokenExpiredError') {
        return res.status(401).json({ erreur: 'Session expirée, veuillez vous reconnecter' });
      }
      return res.status(401).json({ erreur: 'Token invalide' });
    }

    // Vérification du rôle si spécifié
    if (roles.length > 0 && !roles.includes(req.user.role)) {
      logger.warn({ userId: req.user.id, role: req.user.role, requiredRoles: roles }, 'Accès refusé');
      return res.status(403).json({ erreur: 'Vous n\'avez pas les droits nécessaires pour cette action' });
    }

    next();
  };
}

/**
 * Vérifie que l'agent ne modifie que les données de son propre CSI,
 * sauf si superviseur/admin.
 */
function checkCsiAccess(req, res, next) {
  const { role, csi_id } = req.user;
  const requestedCsiId = parseInt(req.body?.csi_id || req.query?.csi_id);

  if (role === 'admin' || role === 'superviseur') return next();
  if (role === 'agent' && csi_id && csi_id === requestedCsiId) return next();

  return res.status(403).json({ erreur: 'Vous ne pouvez accéder qu\'aux données de votre propre CSI' });
}

module.exports = { auth, signToken, checkCsiAccess };
