const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { auth } = require('../middleware/auth');
const logger = require('../utils/logger');

const wrap = f => (req, res) => f(req, res).catch(e => {
  logger.error({ err: e, route: req.path, user: req.user?.id }, 'Erreur route alertes');
  res.status(500).json({ erreur: 'Erreur serveur alertes' });
});

const moisDate = m => /^\d{4}-\d{2}$/.test(m) ? m + '-01' : null;

// ─── GET /api/alertes/epidemiologiques ────────────────────────────────────────
router.get('/epidemiologiques', auth(['admin', 'superviseur', 'superviseur_national']), wrap(async (req, res) => {
  const moisQuery = req.query.mois || new Date().toISOString().slice(0, 7);
  const m = moisDate(moisQuery);
  if (!m) return res.status(400).json({ erreur: 'Format mois invalide (YYYY-MM)' });

  const { role, region_id: userRegion } = req.user;
  let regionFilter = null;
  if (role === 'superviseur') {
    regionFilter = userRegion;
  } else if (req.query.region_id) {
    regionFilter = parseInt(req.query.region_id, 10);
  }

  // Récupérer le seuil d'alerte configuré (défaut: 50%)
  let seuilPct = 50;
  try {
    const { rows: pRows } = await pool.query("SELECT valeur FROM parametres WHERE cle = 'seuil_alerte_epidemie_pct'");
    if (pRows[0] && !isNaN(parseInt(pRows[0].valeur, 10))) {
      seuilPct = parseInt(pRows[0].valeur, 10);
    }
  } catch {}

  const baseParams = [m];
  let regClause = '';
  if (regionFilter) {
    baseParams.push(regionFilter);
    regClause = `AND g.id = $${baseParams.length}`;
  }

  // 1. Total consultations du mois par motif
  const moisActuelSql = `
    SELECT c.motif, sum(c.nombre)::int AS total_mois
    FROM consultations c
    JOIN rapports r ON r.id = c.rapport_id
    JOIN csi s ON s.id = r.csi_id
    JOIN communes co ON co.id = s.commune_id
    JOIN regions g ON g.id = co.region_id
    WHERE r.mois = $1 ${regClause}
    GROUP BY c.motif
  `;

  // 2. Moyenne des 3 mois précédents par motif
  const troisMoisSql = `
    SELECT c.motif, (sum(c.nombre) / 3.0)::numeric(10,1) AS moyenne_3mois
    FROM consultations c
    JOIN rapports r ON r.id = c.rapport_id
    JOIN csi s ON s.id = r.csi_id
    JOIN communes co ON co.id = s.commune_id
    JOIN regions g ON g.id = co.region_id
    WHERE r.mois >= (date_trunc('month', $1::date) - interval '3 months')
      AND r.mois < date_trunc('month', $1::date)
      ${regClause}
    GROUP BY c.motif
  `;

  const [actuelRes, historiqueRes] = await Promise.all([
    pool.query(moisActuelSql, baseParams),
    pool.query(troisMoisSql, baseParams)
  ]);

  const histoMap = {};
  for (const h of historiqueRes.rows) {
    histoMap[h.motif] = parseFloat(h.moyenne_3mois) || 0;
  }

  const alertes = [];
  for (const act of actuelRes.rows) {
    const moyennePrec = histoMap[act.motif] || 0;
    const haussePct = moyennePrec > 0 
      ? Math.round(((act.total_mois - moyennePrec) / moyennePrec) * 100)
      : (act.total_mois > 10 ? 100 : 0);

    const estAlerte = haussePct >= seuilPct;

    if (estAlerte) {
      alertes.push({
        motif: act.motif,
        total_mois: act.total_mois,
        moyenne_precedente: moyennePrec,
        hausse_pct: haussePct,
        seuil_pct: seuilPct,
        gravite: haussePct >= seuilPct * 2 ? 'CRITIQUE' : 'ELEVEE'
      });
    }
  }

  res.json({
    mois: moisQuery,
    region_id: regionFilter,
    seuil_applique_pct: seuilPct,
    nb_alertes: alertes.length,
    alertes
  });
}));

// ─── GET /api/alertes/csi-en-retard ───────────────────────────────────────────
router.get('/csi-en-retard', auth(['admin', 'superviseur', 'superviseur_national']), wrap(async (req, res) => {
  const moisQuery = req.query.mois || new Date().toISOString().slice(0, 7);
  const m = moisDate(moisQuery);
  if (!m) return res.status(400).json({ erreur: 'Format mois invalide (YYYY-MM)' });

  const { role, region_id: userRegion } = req.user;
  let regionFilter = null;
  if (role === 'superviseur') {
    regionFilter = userRegion;
  } else if (req.query.region_id) {
    regionFilter = parseInt(req.query.region_id, 10);
  }

  const params = [m];
  let regClause = '';
  if (regionFilter) {
    params.push(regionFilter);
    regClause = `AND g.id = $${params.length}`;
  }

  const { rows } = await pool.query(`
    SELECT s.id AS csi_id, s.nom AS csi_nom, co.nom AS commune_nom, g.nom AS region_nom,
           r.id AS rapport_id, r.statut, r.maj,
           (SELECT MAX(r2.mois) FROM rapports r2 WHERE r2.csi_id = s.id AND r2.statut = 'VALIDE') AS dernier_rapport_valide_mois,
           (SELECT MAX(r3.maj) FROM rapports r3 WHERE r3.csi_id = s.id) AS derniere_activite
    FROM csi s
    JOIN communes co ON co.id = s.commune_id
    JOIN regions g ON g.id = co.region_id
    LEFT JOIN rapports r ON r.csi_id = s.id AND r.mois = $1
    WHERE s.actif
      AND (r.id IS NULL OR r.statut IN ('BROUILLON', 'RENVOYE'))
      ${regClause}
    ORDER BY g.nom, co.nom, s.nom
  `, params);

  res.json({
    mois: moisQuery,
    total_en_retard: rows.length,
    csi_en_retard: rows
  });
}));

module.exports = router;
