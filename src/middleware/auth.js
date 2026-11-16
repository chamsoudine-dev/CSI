const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const logger = require('../utils/logger');
const { checkCsiScope } = require('./scope');

const JWT_SECRET = process.env.JWT_SECRET || process.env.SECRET || 'cle-de-test-super-securisee-pour-antigravity-123';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '8h';

// Cache court (60s) en mémoire pour recharger l'utilisateur sans saturer la DB
const userCache = new Map();

function clearUserCache(userId) {
  if (userId) userCache.delete(parseInt(userId, 10));
  else userCache.clear();
}

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
      region_id: user.region_id || null,
      session_version: user.session_version || 0,
      statut_2fa: Boolean(user.statut_2fa)
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

/**
 * Middleware d'authentification avec contrôle de rôle optionnel
 * et vérification de l'utilisateur actif en base (cache court 60s).
 * @param {string[]} roles - Rôles autorisés (vide = tout utilisateur connecté)
 */
function auth(roles = []) {
  return (req, res, next) => {
    // Mode Développement Total
    if (process.env.MODE_DEV === 'true') {
      req.user = { id: 1, role: 'admin', csi_id: 1, region_id: 1 };
      return next();
    }

    // ... reste du code original ...
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

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      if (e.name === 'TokenExpiredError') {
        return res.status(401).json({ erreur: 'Session expirée, veuillez vous reconnecter' });
      }
      return res.status(401).json({ erreur: 'Token invalide' });
    }

    req.user = payload;

    // 1. Contrôle synchrone immédiat du rôle si spécifié
    if (roles.length > 0 && !roles.includes(req.user.role)) {
      logger.warn({ userId: req.user.id, role: req.user.role, requiredRoles: roles }, 'Accès refusé');
      return res.status(403).json({ erreur: 'Vous n\'avez pas les droits nécessaires pour cette action' });
    }

    // 2. Si aucune base configurée (ex: tests unitaires purs), passer immédiatement
    if (!process.env.DATABASE_URL) {
      return next();
    }

    // 3. Vérification du cache 60s
    const now = Date.now();
    const cached = userCache.get(payload.id);
    if (cached && cached.expiresAt > now) {
      if (cached.data.actif === false) {
        return res.status(401).json({ erreur: 'Compte désactivé. Veuillez contacter votre administrateur.' });
      }
      if (Number(cached.data.session_version || 0) !== Number(payload.session_version || 0)) {
        return res.status(401).json({ erreur: 'Session révoquée. Veuillez vous reconnecter.' });
      }
      req.user = { ...payload, ...cached.data };
      if (roles.length > 0 && !roles.includes(req.user.role)) {
        return res.status(403).json({ erreur: 'Vous n\'avez pas les droits nécessaires pour cette action' });
      }
      return next();
    }

    // 4. Rechargement asynchrone en base pour vérifier actif = true
    pool.query(
      'SELECT id, email, nom, role, csi_id, region_id, actif, session_version, statut_2fa FROM utilisateurs WHERE id = $1',
      [payload.id]
    ).then(({ rows }) => {
      if (rows.length === 0) {
        return res.status(401).json({ erreur: 'Utilisateur introuvable ou supprimé' });
      }
      const dbUser = rows[0];
      userCache.set(payload.id, { data: dbUser, expiresAt: now + 60000 });

      if (dbUser.actif === false) {
        return res.status(401).json({ erreur: 'Compte désactivé. Veuillez contacter votre administrateur.' });
      }
      if (Number(dbUser.session_version || 0) !== Number(payload.session_version || 0)) {
        return res.status(401).json({ erreur: 'Session révoquée. Veuillez vous reconnecter.' });
      }

      req.user = { ...payload, ...dbUser };
      if (roles.length > 0 && !roles.includes(req.user.role)) {
        return res.status(403).json({ erreur: 'Vous n\'avez pas les droits nécessaires pour cette action' });
      }
      next();
    }).catch(err => {
      logger.error({ err, userId: payload.id }, 'Erreur DB rechargement utilisateur auth');
      res.status(503).json({ erreur: 'Service d’authentification temporairement indisponible.' });
    });
  };
}

/**
 * 2.6 Vérifie que l'utilisateur a accès au CSI demandé :
 * - admin et superviseur national : accès à tous les CSI
 * - agent : son propre csi_id uniquement (synchrone)
 * - superviseur : CSI de sa région uniquement (vérifié via checkCsiScope)
 */
function checkCsiAccess(req, res, next) {
  const { role, csi_id } = req.user;
  const requestedCsiId = parseInt(req.body?.csi_id || req.query?.csi_id, 10);

  if (role === 'admin' || role === 'superviseur_national') return next();

  if (role === 'agent') {
    if (csi_id && csi_id === requestedCsiId) return next();
    return res.status(403).json({ erreur: 'Vous ne pouvez accéder qu\'aux données de votre propre CSI' });
  }

  if (role === 'superviseur') {
    if (!process.env.DATABASE_URL) return next();
    checkCsiScope(requestedCsiId, req.user).then(allowed => {
      if (allowed) return next();
      return res.status(403).json({ erreur: 'Vous ne pouvez accéder qu\'aux données des CSI de votre région' });
    }).catch(e => {
      logger.error({ err: e }, 'Erreur checkCsiAccess superviseur');
      return res.status(500).json({ erreur: 'Erreur vérification droits CSI' });
    });
    return;
  }

  return res.status(403).json({ erreur: 'Vous ne pouvez accéder qu\'aux données de votre propre CSI' });
}

module.exports = { auth, signToken, checkCsiAccess, clearUserCache };
