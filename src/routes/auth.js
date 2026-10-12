const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const { pool } = require('../config/database');
const { auth, signToken, clearUserCache } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const { validateIdParam } = require('../middleware/scope');
const logger = require('../utils/logger');
const { logAudit } = require('../utils/audit');

const wrap = f => (req, res) => f(req, res).catch(e => {
  logger.error({ err: e, route: req.path, user: req.user?.id }, 'Erreur route auth');
  res.status(500).json({ erreur: 'Erreur serveur' });
});

// ─── POST /api/login ─────────────────────────────────────────────────────────
router.post('/login', validate(schemas.loginSchema), wrap(async (req, res) => {
  const { email, mot_de_passe } = req.body;

  const { rows } = await pool.query(
    'SELECT * FROM utilisateurs WHERE email = $1 AND actif = TRUE',
    [email.toLowerCase().trim()]
  );

  if (!rows[0]) {
    logger.warn({ email }, 'Tentative connexion email inconnu');
    await logAudit({ action: 'LOGIN_FAILED', details: { email }, ip_adresse: req.ip });
    return res.status(401).json({ erreur: 'Email ou mot de passe incorrect' });
  }

  const user = rows[0];
  const ok = await bcrypt.compare(mot_de_passe, user.mot_de_passe_hash);

  if (!ok) {
    logger.warn({ userId: user.id }, 'Tentative connexion mauvais mot de passe');
    await logAudit({ utilisateur_id: user.id, action: 'LOGIN_FAILED', ip_adresse: req.ip });
    return res.status(401).json({ erreur: 'Email ou mot de passe incorrect' });
  }

  // Mettre à jour la dernière connexion
  await pool.query('UPDATE utilisateurs SET derniere_connexion = now() WHERE id = $1', [user.id]);

  await logAudit({
    utilisateur_id: user.id,
    action: 'LOGIN',
    table_cible: 'utilisateurs',
    enregistrement_id: user.id,
    ip_adresse: req.ip
  });

  const token = signToken(user);

  logger.info({ userId: user.id, role: user.role }, 'Utilisateur connecté');
  res.json({
    token,
    utilisateur: {
      id: user.id,
      email: user.email,
      nom: user.nom,
      role: user.role,
      csi_id: user.csi_id,
      region_id: user.region_id
    }
  });
}));

// ─── GET /api/me ─────────────────────────────────────────────────────────────
router.get('/me', auth(), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.nom, u.role, u.csi_id, u.region_id,
            c.nom AS csi_nom, g.nom AS region_nom
     FROM utilisateurs u
     LEFT JOIN csi c ON c.id = u.csi_id
     LEFT JOIN regions g ON g.id = u.region_id
     WHERE u.id = $1 AND u.actif = TRUE`,
    [req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ erreur: 'Utilisateur introuvable' });
  res.json(rows[0]);
}));

// ─── POST /api/me/mot-de-passe (Phase 2.2) ──────────────────────────────────
router.post('/me/mot-de-passe', auth(), validate(schemas.changementMotDePasseSchema), wrap(async (req, res) => {
  const { ancien_mot_de_passe, nouveau_mot_de_passe } = req.body;

  const { rows } = await pool.query('SELECT id, mot_de_passe_hash FROM utilisateurs WHERE id = $1', [req.user.id]);
  if (!rows[0]) return res.status(404).json({ erreur: 'Utilisateur introuvable' });

  const ok = await bcrypt.compare(ancien_mot_de_passe, rows[0].mot_de_passe_hash);
  if (!ok) {
    return res.status(400).json({ erreur: 'Ancien mot de passe incorrect' });
  }

  const hash = await bcrypt.hash(nouveau_mot_de_passe, 12);
  await pool.query('UPDATE utilisateurs SET mot_de_passe_hash = $1 WHERE id = $2', [hash, req.user.id]);

  clearUserCache(req.user.id);

  await logAudit({
    utilisateur_id: req.user.id,
    action: 'CHANGE_PASSWORD',
    table_cible: 'utilisateurs',
    enregistrement_id: req.user.id,
    ip_adresse: req.ip
  });

  res.json({ message: 'Mot de passe modifié avec succès' });
}));

// ─── GET /api/utilisateurs ── Admin et superviseur ───────────────────────────
router.get('/utilisateurs', auth(['admin', 'superviseur']), wrap(async (req, res) => {
  const { role, region_id } = req.user;
  let query = `SELECT u.id, u.email, u.nom, u.role, u.actif, u.csi_id, u.region_id, u.cree_par,
                      u.derniere_connexion, u.cree_le, c.nom AS csi_nom, g.nom AS region_nom,
                      createur.nom AS cree_par_nom
               FROM utilisateurs u
               LEFT JOIN csi c ON c.id = u.csi_id
               LEFT JOIN regions g ON g.id = u.region_id
               LEFT JOIN utilisateurs createur ON createur.id = u.cree_par`;
  const params = [];

  // Superviseur voit uniquement les agents de sa région
  if (role === 'superviseur' && region_id) {
    query += ` WHERE (u.role = 'agent' AND (u.region_id = $1 OR (u.csi_id IN (SELECT c.id FROM csi c JOIN communes co ON co.id = c.commune_id WHERE co.region_id = $1))))`;
    params.push(region_id);
  }

  query += ' ORDER BY u.role, u.nom';
  const { rows } = await pool.query(query, params);
  res.json(rows);
}));

// ─── POST /api/utilisateurs ── Admin et superviseur (Phase 2.8) ───────────────
router.post('/utilisateurs', auth(['admin', 'superviseur']), validate(schemas.utilisateurSchema), wrap(async (req, res) => {
  const { email, nom, mot_de_passe, role, csi_id, region_id } = req.body;

  if (!mot_de_passe) return res.status(400).json({ erreur: 'Mot de passe requis pour créer un utilisateur' });
  if (mot_de_passe.length < 8) return res.status(400).json({ erreur: 'Mot de passe trop court (minimum 8 caractères)' });

  // Contrôle d'accès superviseur (agents de sa région uniquement)
  if (req.user.role === 'superviseur') {
    if (role !== 'agent') {
      return res.status(403).json({ erreur: 'Un superviseur ne peut créer que des comptes ayant le rôle agent' });
    }
    if (!csi_id) {
      return res.status(400).json({ erreur: 'Un CSI est obligatoire pour créer un compte agent' });
    }
    // Vérifier que le CSI appartient bien à la région du superviseur
    const { rows: csiCheck } = await pool.query(
      `SELECT 1 FROM csi c JOIN communes co ON co.id = c.commune_id WHERE c.id = $1 AND co.region_id = $2`,
      [csi_id, req.user.region_id]
    );
    if (!csiCheck[0]) {
      return res.status(403).json({ erreur: 'Le CSI spécifié n\'appartient pas à votre région' });
    }
  }

  const userRegionId = req.user.role === 'superviseur' ? req.user.region_id : (region_id || null);
  const hash = await bcrypt.hash(mot_de_passe, 12);

  try {
    const { rows } = await pool.query(
      `INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role, csi_id, region_id, cree_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, email, nom, role, csi_id, region_id, cree_par, actif, cree_le`,
      [email.toLowerCase().trim(), nom.trim(), hash, role, csi_id || null, userRegionId, req.user.id]
    );
    logger.info({ creatorId: req.user.id, newUserId: rows[0].id }, 'Nouvel utilisateur créé');
    await logAudit({
      utilisateur_id: req.user.id,
      action: 'CREATE_USER',
      table_cible: 'utilisateurs',
      enregistrement_id: rows[0].id,
      details: { email: rows[0].email, role: rows[0].role, cree_par: req.user.id },
      ip_adresse: req.ip
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ erreur: 'Cet email est déjà utilisé' });
    throw e;
  }
}));

// ─── PUT /api/utilisateurs/:id ── Admin ou Superviseur (Phase 2.8 & 2.9) ─────
router.put('/utilisateurs/:id', auth(['admin', 'superviseur']), validateIdParam('id'), validate(schemas.utilisateurUpdateSchema), wrap(async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  const { email, nom, mot_de_passe, role, csi_id, region_id, actif } = req.body;

  const { rows: existingRows } = await pool.query('SELECT * FROM utilisateurs WHERE id = $1', [targetId]);
  if (!existingRows[0]) return res.status(404).json({ erreur: 'Utilisateur introuvable' });
  const targetUser = existingRows[0];

  // Règle 2.8 : Superviseur ne gère que les agents de sa région
  if (req.user.role === 'superviseur') {
    if (targetUser.role !== 'agent') {
      return res.status(403).json({ erreur: 'Vous ne pouvez modifier que les comptes agents' });
    }
    // Vérifier que le CSI actuel de l'agent appartient à la région du superviseur
    if (targetUser.csi_id) {
      const { rows: csiCheck } = await pool.query(
        `SELECT 1 FROM csi c JOIN communes co ON co.id = c.commune_id WHERE c.id = $1 AND co.region_id = $2`,
        [targetUser.csi_id, req.user.region_id]
      );
      if (!csiCheck[0]) {
        return res.status(403).json({ erreur: 'Cet agent n\'appartient pas à votre région' });
      }
    }
    // Le superviseur ne peut pas changer le rôle vers autre chose qu'agent
    if (role && role !== 'agent') {
      return res.status(403).json({ erreur: 'Un superviseur ne peut pas modifier le rôle d\'un utilisateur' });
    }
    // Si csi_id modifié, vérifier qu'il reste dans sa région
    if (csi_id) {
      const { rows: newCsiCheck } = await pool.query(
        `SELECT 1 FROM csi c JOIN communes co ON co.id = c.commune_id WHERE c.id = $1 AND co.region_id = $2`,
        [csi_id, req.user.region_id]
      );
      if (!newCsiCheck[0]) {
        return res.status(403).json({ erreur: 'Le nouveau CSI doit appartenir à votre région' });
      }
    }
  }

  // Règle 2.8 Admin :
  // - Tout admin peut gérer tous les comptes (règle créateur retirée).
  // - Ne peut pas se désactiver lui-même
  if (targetId === req.user.id && actif === false) {
    return res.status(400).json({ erreur: 'Vous ne pouvez pas désactiver votre propre compte' });
  }

  // - Ne peut pas désactiver le dernier admin actif
  if (targetUser.role === 'admin' && actif === false) {
    const { rows: adminCount } = await pool.query(
      `SELECT count(*) FROM utilisateurs WHERE role = 'admin' AND actif = TRUE AND id != $1`,
      [targetId]
    );
    if (parseInt(adminCount[0].count, 10) === 0) {
      return res.status(400).json({ erreur: 'Impossible de désactiver le dernier administrateur actif du système' });
    }
  }

  const updates = [];
  const params = [];
  let i = 1;

  if (email !== undefined) {
    const cleanEmail = email.toLowerCase().trim();
    const { rows: emailCheck } = await pool.query('SELECT id FROM utilisateurs WHERE email = $1 AND id != $2', [cleanEmail, targetId]);
    if (emailCheck[0]) return res.status(409).json({ erreur: 'Cet email est déjà utilisé par un autre compte' });
    updates.push(`email = $${i++}`);
    params.push(cleanEmail);
  }

  if (nom !== undefined)       { updates.push(`nom = $${i++}`);       params.push(nom.trim()); }
  if (role !== undefined && req.user.role === 'admin') { updates.push(`role = $${i++}`); params.push(role); }
  if (csi_id !== undefined)    { updates.push(`csi_id = $${i++}`);    params.push(csi_id || null); }
  if (region_id !== undefined && req.user.role === 'admin') { updates.push(`region_id = $${i++}`); params.push(region_id || null); }
  if (actif !== undefined)     { updates.push(`actif = $${i++}`);     params.push(actif); }

  if (mot_de_passe) {
    if (mot_de_passe.length < 8) return res.status(400).json({ erreur: 'Mot de passe trop court (minimum 8 caractères)' });
    const hash = await bcrypt.hash(mot_de_passe, 12);
    updates.push(`mot_de_passe_hash = $${i++}`);
    params.push(hash);
  }

  if (updates.length === 0) return res.status(400).json({ erreur: 'Aucune modification fournie' });

  params.push(targetId);
  const { rows } = await pool.query(
    `UPDATE utilisateurs SET ${updates.join(', ')} WHERE id = $${i} RETURNING id, email, nom, role, actif, csi_id, region_id, cree_par`,
    params
  );

  clearUserCache(targetId);

  logger.info({ operatorId: req.user.id, targetId }, 'Utilisateur modifié');
  await logAudit({
    utilisateur_id: req.user.id,
    action: 'UPDATE_USER',
    table_cible: 'utilisateurs',
    enregistrement_id: targetId,
    details: { champs: Object.keys(req.body).filter(k => k !== 'mot_de_passe') },
    ip_adresse: req.ip
  });
  res.json(rows[0]);
}));

// ─── DELETE /api/utilisateurs/:id ── Admin ou Superviseur (Phase 2.8 & 2.9) ──
router.delete('/utilisateurs/:id', auth(['admin', 'superviseur']), validateIdParam('id'), wrap(async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  if (targetId === req.user.id) {
    return res.status(400).json({ erreur: 'Vous ne pouvez pas vous supprimer ou vous désactiver vous-même' });
  }

  const { rows: existingRows } = await pool.query('SELECT * FROM utilisateurs WHERE id = $1', [targetId]);
  if (!existingRows[0]) return res.status(404).json({ erreur: 'Utilisateur introuvable' });
  const targetUser = existingRows[0];

  // Superviseur : agents de sa région uniquement (désactivation uniquement)
  if (req.user.role === 'superviseur') {
    if (targetUser.role !== 'agent') {
      return res.status(403).json({ erreur: 'Vous ne pouvez désactiver que les comptes agents' });
    }
    if (targetUser.csi_id) {
      const { rows: csiCheck } = await pool.query(
        `SELECT 1 FROM csi c JOIN communes co ON co.id = c.commune_id WHERE c.id = $1 AND co.region_id = $2`,
        [targetUser.csi_id, req.user.region_id]
      );
      if (!csiCheck[0]) {
        return res.status(403).json({ erreur: 'Cet agent n\'appartient pas à votre région' });
      }
    }
  }

  // Admin : ne pas supprimer ou désactiver le dernier admin actif
  if (targetUser.role === 'admin') {
    const { rows: adminCount } = await pool.query(
      `SELECT count(*) FROM utilisateurs WHERE role = 'admin' AND actif = TRUE AND id != $1`,
      [targetId]
    );
    if (parseInt(adminCount[0].count, 10) === 0) {
      return res.status(400).json({ erreur: 'Impossible de supprimer ou désactiver le dernier administrateur actif' });
    }
  }

  const permanent = req.query.permanent === 'true' && req.user.role === 'admin';

  if (permanent) {
    try {
      await pool.query('DELETE FROM utilisateurs WHERE id = $1', [targetId]);
      clearUserCache(targetId);
      logger.info({ adminId: req.user.id, targetId }, 'Utilisateur supprimé définitivement');
      await logAudit({
        utilisateur_id: req.user.id,
        action: 'DELETE_USER_PERMANENT',
        table_cible: 'utilisateurs',
        enregistrement_id: targetId,
        details: { email: targetUser.email, nom: targetUser.nom },
        ip_adresse: req.ip
      });
      return res.json({ ok: true, message: 'Utilisateur supprimé avec succès', id: targetId });
    } catch (err) {
      logger.warn({ err, targetId }, 'Suppression physique impossible, désactivation à la place');
    }
  }

  const { rows } = await pool.query(
    'UPDATE utilisateurs SET actif = FALSE WHERE id = $1 RETURNING id, email, nom, role, actif, cree_par',
    [targetId]
  );

  clearUserCache(targetId);

  logger.info({ operatorId: req.user.id, targetId }, 'Utilisateur désactivé');
  await logAudit({
    utilisateur_id: req.user.id,
    action: 'DEACTIVATE_USER',
    table_cible: 'utilisateurs',
    enregistrement_id: targetId,
    details: { email: rows[0].email },
    ip_adresse: req.ip
  });
  res.json({ ok: true, utilisateur: rows[0] });
}));

module.exports = router;
