const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { auth } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const logger = require('../utils/logger');
const { logAudit } = require('../utils/audit');

const wrap = f => (req, res) => f(req, res).catch(e => {
  logger.error({ err: e, route: req.path }, 'Erreur route CSI');
  res.status(500).json({ erreur: 'Erreur serveur' });
});

// ─── GET /api/regions ── Public ───────────────────────────────────────────────
router.get('/regions', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM regions ORDER BY nom');
  res.json(rows);
}));

// ─── GET /api/csi ── Public avec pagination ───────────────────────────────────
router.get('/csi', wrap(async (req, res) => {
  const { region, q, page = 1, limit = 100 } = req.query;
  const offset = (Math.max(1, parseInt(page)) - 1) * Math.min(200, parseInt(limit) || 100);
  const lim = Math.min(200, parseInt(limit) || 100);

  const { rows } = await pool.query(
    `SELECT s.id, s.nom, s.latitude, s.longitude, s.services, s.actif,
            c.nom AS commune, c.type, g.nom AS region, g.id AS region_id
     FROM csi s
     JOIN communes c ON c.id = s.commune_id
     JOIN regions g ON g.id = c.region_id
     WHERE s.actif
       AND ($1::int IS NULL OR g.id = $1)
       AND ($2::text IS NULL OR s.nom ILIKE $2 OR c.nom ILIKE $2)
     ORDER BY g.nom, c.nom, s.nom
     LIMIT $3 OFFSET $4`,
    [region || null, q ? `%${q}%` : null, lim, offset]
  );

  // Total pour la pagination
  const { rows: countRows } = await pool.query(
    `SELECT count(*) FROM csi s
     JOIN communes c ON c.id = s.commune_id
     JOIN regions g ON g.id = c.region_id
     WHERE s.actif
       AND ($1::int IS NULL OR g.id = $1)
       AND ($2::text IS NULL OR s.nom ILIKE $2 OR c.nom ILIKE $2)`,
    [region || null, q ? `%${q}%` : null]
  );

  res.json({
    csis: rows,
    total: parseInt(countRows[0].count),
    page: parseInt(page),
    limit: lim
  });
}));

const { validateIdParam } = require('../middleware/scope');

// ─── GET /api/csi/:id ── Public ───────────────────────────────────────────────
router.get('/csi/:id', validateIdParam('id'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.id, s.nom, s.latitude, s.longitude, s.services, s.actif, s.cree_le,
            c.nom AS commune, c.type, g.nom AS region, g.id AS region_id
     FROM csi s
     JOIN communes c ON c.id = s.commune_id
     JOIN regions g ON g.id = c.region_id
     WHERE s.id = $1`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ erreur: 'CSI introuvable' });
  res.json(rows[0]);
}));

// ─── POST /api/csi ── Admin ou superviseur ────────────────────────────────────
router.post('/csi', auth(['admin', 'superviseur']), validate(schemas.csiSchema), wrap(async (req, res) => {
  const { nom, region_id, commune, type, latitude, longitude, services } = req.body;

  // Superviseur : vérifier qu'il agit dans sa région
  if (req.user.role === 'superviseur' && req.user.region_id && req.user.region_id !== parseInt(region_id)) {
    return res.status(403).json({ erreur: 'Vous ne pouvez ajouter des CSI que dans votre région' });
  }

  // Upsert de la commune
  const commRes = await pool.query(
    `INSERT INTO communes (nom, region_id, type) VALUES ($1, $2, $3)
     ON CONFLICT (nom, region_id) DO UPDATE SET type = EXCLUDED.type RETURNING id`,
    [commune.trim(), region_id, type]
  );

  try {
    const { rows } = await pool.query(
      `INSERT INTO csi (nom, commune_id, latitude, longitude, services)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, nom`,
      [nom.trim(), commRes.rows[0].id, latitude || null, longitude || null, services || []]
    );
    logger.info({ userId: req.user.id, csiId: rows[0].id, nom: rows[0].nom }, 'CSI créé');
    await logAudit({
      utilisateur_id: req.user.id,
      action: 'CREATE_CSI',
      table_cible: 'csi',
      enregistrement_id: rows[0].id,
      details: { nom: rows[0].nom, commune, region_id },
      ip_adresse: req.ip
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ erreur: 'Ce CSI existe déjà dans cette commune' });
    throw e;
  }
}));

// ─── PUT /api/csi/:id ── Admin uniquement ────────────────────────────────────
router.put('/csi/:id', auth(['admin']), validateIdParam('id'), wrap(async (req, res) => {
  const { id } = req.params;
  const { nom, latitude, longitude, services, actif } = req.body;

  const updates = [];
  const params = [];
  let i = 1;

  if (nom !== undefined)       { updates.push(`nom = $${i++}`);       params.push(nom.trim()); }
  if (latitude !== undefined)  { updates.push(`latitude = $${i++}`);  params.push(latitude || null); }
  if (longitude !== undefined) { updates.push(`longitude = $${i++}`); params.push(longitude || null); }
  if (services !== undefined)  { updates.push(`services = $${i++}`);  params.push(services); }
  if (actif !== undefined)     { updates.push(`actif = $${i++}`);     params.push(actif); }

  if (updates.length === 0) return res.status(400).json({ erreur: 'Aucune modification fournie' });

  params.push(id);
  const { rows } = await pool.query(
    `UPDATE csi SET ${updates.join(', ')} WHERE id = $${i} RETURNING id, nom, actif`,
    params
  );

  if (!rows[0]) return res.status(404).json({ erreur: 'CSI introuvable' });
  logger.info({ userId: req.user.id, csiId: id }, 'CSI modifié');
  await logAudit({
    utilisateur_id: req.user.id,
    action: 'UPDATE_CSI',
    table_cible: 'csi',
    enregistrement_id: id,
    details: { champs: Object.keys(req.body) },
    ip_adresse: req.ip
  });
  res.json(rows[0]);
}));

// ─── DELETE /api/csi/:id ── Soft delete, admin uniquement ────────────────────
router.delete('/csi/:id', auth(['admin']), validateIdParam('id'), wrap(async (req, res) => {
  const { rows } = await pool.query(
    'UPDATE csi SET actif = FALSE WHERE id = $1 RETURNING id, nom',
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ erreur: 'CSI introuvable' });
  logger.info({ userId: req.user.id, csiId: req.params.id }, 'CSI désactivé');
  await logAudit({
    utilisateur_id: req.user.id,
    action: 'DEACTIVATE_CSI',
    table_cible: 'csi',
    enregistrement_id: req.params.id,
    details: { nom: rows[0].nom },
    ip_adresse: req.ip
  });
  res.json({ ok: true, csi: rows[0] });
}));

module.exports = router;
