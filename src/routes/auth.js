const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const { pool } = require('../config/database');
const { auth, signToken } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const logger = require('../utils/logger');

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
    return res.status(401).json({ erreur: 'Email ou mot de passe incorrect' });
  }

  const user = rows[0];
  const ok = await bcrypt.compare(mot_de_passe, user.mot_de_passe_hash);

  if (!ok) {
    logger.warn({ userId: user.id }, 'Tentative connexion mauvais mot de passe');
    return res.status(401).json({ erreur: 'Email ou mot de passe incorrect' });
  }

  // Mettre à jour la dernière connexion
  await pool.query('UPDATE utilisateurs SET derniere_connexion = now() WHERE id = $1', [user.id]);

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

// ─── GET /api/utilisateurs ── Admin uniquement ────────────────────────────────
router.get('/utilisateurs', auth(['admin', 'superviseur']), wrap(async (req, res) => {
  const { role, region_id } = req.user;
  let query = `SELECT u.id, u.email, u.nom, u.role, u.actif, u.csi_id, u.region_id,
                      u.derniere_connexion, c.nom AS csi_nom, g.nom AS region_nom
               FROM utilisateurs u
               LEFT JOIN csi c ON c.id = u.csi_id
               LEFT JOIN regions g ON g.id = u.region_id`;
  const params = [];

  // Superviseur voit uniquement les agents de sa région
  if (role === 'superviseur' && region_id) {
    query += ' WHERE u.region_id = $1 OR (u.csi_id IN (SELECT id FROM csi WHERE commune_id IN (SELECT id FROM communes WHERE region_id = $1)))';
    params.push(region_id);
  }

  query += ' ORDER BY u.role, u.nom';
  const { rows } = await pool.query(query, params);
  res.json(rows);
}));

// ─── POST /api/utilisateurs ── Admin uniquement ───────────────────────────────
router.post('/utilisateurs', auth(['admin']), validate(schemas.utilisateurSchema), wrap(async (req, res) => {
  const { email, nom, mot_de_passe, role, csi_id, region_id } = req.body;

  if (!mot_de_passe) return res.status(400).json({ erreur: 'Mot de passe requis pour créer un utilisateur' });
  if (mot_de_passe.length < 8) return res.status(400).json({ erreur: 'Mot de passe trop court (minimum 8 caractères)' });

  const hash = await bcrypt.hash(mot_de_passe, 12);

  try {
    const { rows } = await pool.query(
      `INSERT INTO utilisateurs (email, nom, mot_de_passe_hash, role, csi_id, region_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email, nom, role, csi_id, region_id`,
      [email.toLowerCase().trim(), nom.trim(), hash, role, csi_id || null, region_id || null]
    );
    logger.info({ adminId: req.user.id, newUserId: rows[0].id }, 'Nouvel utilisateur créé');
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ erreur: 'Cet email est déjà utilisé' });
    throw e;
  }
}));

// ─── PUT /api/utilisateurs/:id ── Admin uniquement ───────────────────────────
router.put('/utilisateurs/:id', auth(['admin']), wrap(async (req, res) => {
  const { id } = req.params;
  const { nom, mot_de_passe, role, csi_id, region_id, actif } = req.body;

  const updates = [];
  const params = [];
  let i = 1;

  if (nom !== undefined)       { updates.push(`nom = $${i++}`);       params.push(nom.trim()); }
  if (role !== undefined)      { updates.push(`role = $${i++}`);      params.push(role); }
  if (csi_id !== undefined)    { updates.push(`csi_id = $${i++}`);    params.push(csi_id || null); }
  if (region_id !== undefined) { updates.push(`region_id = $${i++}`); params.push(region_id || null); }
  if (actif !== undefined)     { updates.push(`actif = $${i++}`);     params.push(actif); }

  if (mot_de_passe) {
    if (mot_de_passe.length < 8) return res.status(400).json({ erreur: 'Mot de passe trop court (minimum 8 caractères)' });
    const hash = await bcrypt.hash(mot_de_passe, 12);
    updates.push(`mot_de_passe_hash = $${i++}`);
    params.push(hash);
  }

  if (updates.length === 0) return res.status(400).json({ erreur: 'Aucune modification fournie' });

  params.push(id);
  const { rows } = await pool.query(
    `UPDATE utilisateurs SET ${updates.join(', ')} WHERE id = $${i} RETURNING id, email, nom, role, actif`,
    params
  );

  if (!rows[0]) return res.status(404).json({ erreur: 'Utilisateur introuvable' });
  logger.info({ adminId: req.user.id, targetId: id }, 'Utilisateur modifié');
  res.json(rows[0]);
}));

// ─── DELETE /api/utilisateurs/:id ── Soft delete, admin uniquement ───────────
router.delete('/utilisateurs/:id', auth(['admin']), wrap(async (req, res) => {
  const { id } = req.params;
  if (parseInt(id) === req.user.id) return res.status(400).json({ erreur: 'Vous ne pouvez pas vous désactiver vous-même' });

  const { rows } = await pool.query(
    'UPDATE utilisateurs SET actif = FALSE WHERE id = $1 RETURNING id, email, nom',
    [id]
  );
  if (!rows[0]) return res.status(404).json({ erreur: 'Utilisateur introuvable' });

  logger.info({ adminId: req.user.id, targetId: id }, 'Utilisateur désactivé');
  res.json({ ok: true, utilisateur: rows[0] });
}));

module.exports = router;
