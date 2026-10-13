const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { auth } = require('../middleware/auth');
const logger = require('../utils/logger');
const { logAudit } = require('../utils/audit');

const wrap = f => (req, res) => f(req, res).catch(e => {
  logger.error({ err: e, route: req.path, user: req.user?.id }, 'Erreur route admin');
  res.status(500).json({ erreur: 'Erreur serveur admin' });
});

// ─── GET /api/admin/audit ── Journal d'audit paginé & filtrable (Admin) ────────
router.get('/audit', auth(['admin']), wrap(async (req, res) => {
  const { utilisateur_id, action, table_cible, date_debut, date_fin, page = 1, limit = 50, format } = req.query;
  const p = Math.max(1, parseInt(page, 10));
  const l = Math.min(500, Math.max(1, parseInt(limit, 10)));
  const offset = (p - 1) * l;

  const conditions = [];
  const params = [];
  let pi = 1;

  if (utilisateur_id) {
    conditions.push(`a.utilisateur_id = $${pi++}`);
    params.push(parseInt(utilisateur_id, 10));
  }
  if (action) {
    conditions.push(`a.action ILIKE $${pi++}`);
    params.push(`%${action}%`);
  }
  if (table_cible) {
    conditions.push(`a.table_cible = $${pi++}`);
    params.push(table_cible);
  }
  if (date_debut) {
    conditions.push(`a.cree_le >= $${pi++}::timestamptz`);
    params.push(date_debut);
  }
  if (date_fin) {
    conditions.push(`a.cree_le <= $${pi++}::timestamptz`);
    params.push(date_fin);
  }

  const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  if (format === 'csv') {
    const { rows } = await pool.query(`
      SELECT a.id, a.cree_le, u.nom AS utilisateur_nom, u.email AS utilisateur_email,
             a.action, a.table_cible, a.enregistrement_id, a.ip_adresse, a.details
      FROM audit a
      LEFT JOIN utilisateurs u ON u.id = a.utilisateur_id
      ${whereClause}
      ORDER BY a.cree_le DESC
      LIMIT 2000
    `, params);

    const escapeCsv = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const entete = ['ID', 'Date', 'Utilisateur', 'Email', 'Action', 'Table', 'Enregistrement ID', 'IP', 'Détails'].join(';');
    const lignes = rows.map(r => [
      r.id,
      new Date(r.cree_le).toISOString(),
      escapeCsv(r.utilisateur_nom || 'Système'),
      escapeCsv(r.utilisateur_email || '-'),
      escapeCsv(r.action),
      escapeCsv(r.table_cible || '-'),
      r.enregistrement_id || '',
      escapeCsv(r.ip_adresse || ''),
      escapeCsv(JSON.stringify(r.details || {}))
    ].join(';'));

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="audit_csi_niger.csv"');
    return res.send([entete, ...lignes].join('\n'));
  }

  const [dataRes, countRes] = await Promise.all([
    pool.query(`
      SELECT a.id, a.cree_le, u.nom AS utilisateur_nom, u.email AS utilisateur_email, u.role AS utilisateur_role,
             a.action, a.table_cible, a.enregistrement_id, a.ip_adresse, a.details
      FROM audit a
      LEFT JOIN utilisateurs u ON u.id = a.utilisateur_id
      ${whereClause}
      ORDER BY a.cree_le DESC
      LIMIT $${pi} OFFSET $${pi + 1}
    `, [...params, l, offset]),
    pool.query(`SELECT COUNT(*)::int AS total FROM audit a ${whereClause}`, params)
  ]);

  res.json({
    total: countRes.rows[0]?.total || 0,
    page: p,
    limit: l,
    data: dataRes.rows
  });
}));

// ─── GET /api/admin/parametres ── Lecture des paramètres système ───────────────
router.get('/parametres', auth(['admin', 'superviseur']), wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM parametres ORDER BY cle ASC');
  const paramsMap = rows.reduce((acc, row) => {
    acc[row.cle] = { valeur: row.valeur, description: row.description, modifie_le: row.modifie_le };
    return acc;
  }, {});
  res.json({ parametres: rows, map: paramsMap });
}));

// ─── PUT /api/admin/parametres ── Modification des paramètres système (Admin) ──
router.put('/parametres', auth(['admin']), wrap(async (req, res) => {
  const { cle, valeur, description } = req.body;
  if (!cle || valeur === undefined) {
    return res.status(400).json({ erreur: 'Clé et valeur requises' });
  }

  const { rows } = await pool.query(`
    INSERT INTO parametres (cle, valeur, description, modifie_le, modifie_par)
    VALUES ($1, $2, $3, NOW(), $4)
    ON CONFLICT (cle) DO UPDATE SET
      valeur = EXCLUDED.valeur,
      description = COALESCE(EXCLUDED.description, parametres.description),
      modifie_le = NOW(),
      modifie_par = EXCLUDED.modifie_par
    RETURNING *
  `, [cle.trim(), String(valeur).trim(), description || null, req.user.id]);

  await logAudit({
    utilisateur_id: req.user.id,
    action: 'UPDATE_PARAMETRE',
    table_cible: 'parametres',
    enregistrement_id: null,
    details: { cle, nouvelle_valeur: valeur },
    ip_adresse: req.ip
  });

  res.json({ message: 'Paramètre mis à jour avec succès', parametre: rows[0] });
}));

module.exports = router;
