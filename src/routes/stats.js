const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const logger = require('../utils/logger');

const wrap = f => (req, res) => f(req, res).catch(e => {
  logger.error({ err: e, route: req.path }, 'Erreur route stats');
  res.status(500).json({ erreur: 'Erreur serveur' });
});

const moisDate = m => /^\d{4}-\d{2}$/.test(m) ? m + '-01' : null;

// ─── GET /api/stats ── Public ─────────────────────────────────────────────────
router.get('/stats', wrap(async (req, res) => {
  const m = moisDate(req.query.mois) || new Date().toISOString().slice(0, 7) + '-01';
  const { region } = req.query;
  const q = (sql, params = [m]) => pool.query(sql, params).then(x => x.rows);

  const J = `
    JOIN rapports r ON r.id = x.rapport_id
    JOIN csi s ON s.id = r.csi_id
    JOIN communes c ON c.id = s.commune_id
    JOIN regions g ON g.id = c.region_id
    WHERE r.mois = $1 ${region ? 'AND g.id = $2' : ''}`;

  // Statistiques globales ou par région
  const baseParams = region ? [m, region] : [m];

  const [csi_total, rapports_total, consultations, vaccinations, ruptures, regions, evolution] =
    await Promise.all([
      pool.query(
        `SELECT count(*) FROM csi s
         JOIN communes c ON c.id = s.commune_id
         JOIN regions g ON g.id = c.region_id
         WHERE s.actif ${region ? 'AND g.id = $1' : ''}`,
        region ? [region] : []
      ).then(r => +r.rows[0].count),

      pool.query(
        `SELECT count(DISTINCT r.id)
         FROM rapports r
         JOIN csi s ON s.id = r.csi_id
         JOIN communes c ON c.id = s.commune_id
         JOIN regions g ON g.id = c.region_id
         WHERE r.mois = $1 ${region ? 'AND g.id = $2' : ''}`,
        baseParams
      ).then(r => +r.rows[0].count),

      q(`SELECT motif AS nom, sum(nombre)::int AS total
         FROM consultations x ${J}
         GROUP BY motif ORDER BY 2 DESC`, baseParams),

      q(`SELECT vaccin AS nom, sum(doses)::int AS total
         FROM vaccinations x ${J}
         GROUP BY vaccin ORDER BY 2 DESC`, baseParams),

      q(`SELECT produit AS nom, sum(jours_rupture)::int AS total
         FROM medicaments x ${J}
         GROUP BY produit HAVING sum(jours_rupture) > 0 ORDER BY 2 DESC`, baseParams),

      q(`SELECT g.nom, count(DISTINCT s.id)::int AS csi, count(DISTINCT r.id)::int AS rapports
         FROM regions g
         LEFT JOIN communes co ON co.region_id = g.id
         LEFT JOIN csi s ON s.commune_id = co.id AND s.actif
         LEFT JOIN rapports r ON r.csi_id = s.id AND r.mois = $1
         ${region ? 'WHERE g.id = $2' : ''}
         GROUP BY g.id ORDER BY g.nom`, baseParams),

      // Évolution sur les 6 derniers mois (pour graphique)
      pool.query(
        `SELECT to_char(r.mois, 'YYYY-MM') AS mois, count(DISTINCT r.id)::int AS rapports,
                sum(con.nombre)::int AS consultations_total
         FROM rapports r
         JOIN csi s ON s.id = r.csi_id
         JOIN communes c ON c.id = s.commune_id
         JOIN regions g ON g.id = c.region_id
         LEFT JOIN consultations con ON con.rapport_id = r.id
         WHERE r.mois >= (date_trunc('month', $1::date) - interval '5 months')
           AND r.mois <= $1::date
           ${region ? 'AND g.id = $2' : ''}
         GROUP BY r.mois ORDER BY r.mois`,
        baseParams
      ).then(r => r.rows)
    ]);

  res.json({ csi_total, rapports_total, consultations, vaccinations, ruptures, regions, evolution });
}));

// ─── GET /health ── Monitoring ────────────────────────────────────────────────
router.get('/health', wrap(async (req, res) => {
  try {
    const start = Date.now();
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      db: 'ok',
      db_latency_ms: Date.now() - start,
      uptime_s: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '2.0.0'
    });
  } catch (e) {
    logger.error({ err: e }, 'Health check DB failed');
    res.status(503).json({ status: 'error', db: 'down', timestamp: new Date().toISOString() });
  }
}));

module.exports = router;
