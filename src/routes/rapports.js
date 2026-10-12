const express = require('express');
const router = express.Router();
const { pool, withTransaction } = require('../config/database');
const { auth, checkCsiAccess } = require('../middleware/auth');
const { checkCsiScope } = require('../middleware/scope');
const { validate, schemas } = require('../middleware/validate');
const logger = require('../utils/logger');
const { logAudit } = require('../utils/audit');

const wrap = f => (req, res) => f(req, res).catch(e => {
  logger.error({ err: e, route: req.path, user: req.user?.id }, 'Erreur route rapport');
  res.status(500).json({ erreur: 'Erreur serveur' });
});

const moisDate = m => /^\d{4}-\d{2}$/.test(m) ? m + '-01' : null;
const n = v => Math.max(0, parseInt(v) || 0);

// ─── GET /api/rapport ── Auth requis ──────────────────────────────────────────
router.get('/rapport', auth(), wrap(async (req, res) => {
  const { csi_id, mois } = req.query;
  const m = moisDate(mois);
  if (!csi_id || !m) return res.status(400).json({ erreur: 'csi_id et mois requis' });

  // Contrôle du périmètre (agent: son CSI, superviseur: sa région, admin: libre)
  const allowed = await checkCsiScope(csi_id, req.user);
  if (!allowed) {
    return res.status(403).json({ erreur: 'Accès non autorisé à ce CSI' });
  }

  const { rows } = await pool.query('SELECT id FROM rapports WHERE csi_id = $1 AND mois = $2', [csi_id, m]);
  if (!rows[0]) return res.json(null);

  const id = rows[0].id;
  const q = t => pool.query(`SELECT * FROM ${t} WHERE rapport_id = $1`, [id]).then(x => x.rows);

  res.json({
    id,
    consultations: await q('consultations'),
    vaccinations: await q('vaccinations'),
    medicaments: await q('medicaments')
  });
}));

// ─── GET /api/rapports/liste ── Liste des rapports avec statut ────────────────
router.get('/rapports/liste', auth(['admin', 'superviseur']), wrap(async (req, res) => {
  const { mois, region_id } = req.query;
  const m = moisDate(mois);
  const { role, region_id: userRegion } = req.user;

  // Superviseur : limité à sa région
  const regionFilter = role === 'superviseur' ? userRegion : region_id || null;

  const { rows } = await pool.query(
    `SELECT s.id AS csi_id, s.nom AS csi, c.nom AS commune, g.nom AS region,
            r.id AS rapport_id, r.mois, r.maj
     FROM csi s
     JOIN communes c ON c.id = s.commune_id
     JOIN regions g ON g.id = c.region_id
     LEFT JOIN rapports r ON r.csi_id = s.id AND ($1::date IS NULL OR r.mois = $1)
     WHERE s.actif
       AND ($2::int IS NULL OR g.id = $2)
     ORDER BY g.nom, c.nom, s.nom`,
    [m, regionFilter]
  );
  res.json(rows);
}));

// ─── PUT /api/rapport ── Agent pour son CSI, superviseur/admin pour tous ──────
router.put('/rapport', auth(), validate(schemas.rapportSchema), checkCsiAccess, wrap(async (req, res) => {
  const { csi_id, mois: moisRaw, consultations, vaccinations, medicaments } = req.body;
  const mois = moisDate(moisRaw);
  if (!mois) return res.status(400).json({ erreur: 'Format mois invalide (YYYY-MM)' });

  // Vérifier que le CSI existe
  const { rows: csiRows } = await pool.query('SELECT id FROM csi WHERE id = $1 AND actif', [csi_id]);
  if (!csiRows[0]) return res.status(404).json({ erreur: 'CSI introuvable ou inactif' });

  const rapportId = await withTransaction(async (db) => {
    const { rows: rRows } = await db.query(
      `INSERT INTO rapports (csi_id, mois) VALUES ($1, $2)
       ON CONFLICT (csi_id, mois) DO UPDATE SET maj = now() RETURNING id`,
      [csi_id, mois]
    );
    const id = rRows[0].id;

    // Supprimer l'ancien contenu et réinsérer
    for (const t of ['consultations', 'vaccinations', 'medicaments']) {
      await db.query(`DELETE FROM ${t} WHERE rapport_id = $1`, [id]);
    }

    for (const c of consultations) {
      await db.query(
        'INSERT INTO consultations VALUES ($1, $2, $3, $4, $5)',
        [id, c.motif, c.tranche, c.sexe, n(c.nombre)]
      );
    }
    for (const v of vaccinations) {
      await db.query(
        'INSERT INTO vaccinations VALUES ($1, $2, $3)',
        [id, v.vaccin, n(v.doses)]
      );
    }
    for (const d of medicaments) {
      await db.query(
        'INSERT INTO medicaments VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [id, d.produit, n(d.stock_debut), n(d.entrees), n(d.sorties), n(d.stock_fin), n(d.jours_rupture)]
      );
    }

    return id;
  });

  logger.info({ userId: req.user.id, csiId: csi_id, mois, rapportId }, 'Rapport enregistré');
  await logAudit({
    utilisateur_id: req.user.id,
    action: 'SAVE_RAPPORT',
    table_cible: 'rapports',
    enregistrement_id: rapportId,
    details: { csi_id, mois, nb_consultations: consultations.length, nb_vaccinations: vaccinations.length, nb_medicaments: medicaments.length },
    ip_adresse: req.ip
  });
  res.json({ ok: true, rapport_id: rapportId });
}));

module.exports = router;
