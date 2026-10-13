const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { auth } = require('../middleware/auth');
const logger = require('../utils/logger');

const wrap = f => (req, res) => f(req, res).catch(e => {
  logger.error({ err: e, route: req.originalUrl }, 'Erreur route dashboard');
  res.status(500).json({ erreur: 'Erreur serveur' });
});

const moisDate = m => /^\d{4}-\d{2}$/.test(m) ? m + '-01' : null;

// ─── GET /api/dashboard/agent ── Tableau de bord spécifique Agent ─────────────
router.get('/agent', auth('agent', 'admin'), wrap(async (req, res) => {
  const csiId = req.user.role === 'agent' ? req.user.csi_id : (parseInt(req.query.csi_id, 10) || req.user.csi_id);
  const m = moisDate(req.query.mois) || new Date().toISOString().slice(0, 7) + '-01';

  if (!csiId) {
    return res.status(400).json({ erreur: 'csi_id requis pour le tableau de bord agent' });
  }

  const [csiInfo, rapportCourant, stockBas, commandesEnCours, naissancesMois, totalPatients] = await Promise.all([
    pool.query(`
      SELECT s.id, s.nom, s.code, co.nom AS commune, r.nom AS region
      FROM csi s
      JOIN communes co ON co.id = s.commune_id
      JOIN regions r ON r.id = co.region_id
      WHERE s.id = $1`, [csiId]),
    pool.query(`
      SELECT id, statut, soumis_le, valide_le, commentaire_validation
      FROM rapports
      WHERE csi_id = $1 AND mois = $2`, [csiId, m]),
    pool.query(`
      SELECT sc.medicament_id, COALESCE(cat.dci, sc.medicament_id) AS medicament_nom, sc.quantite
      FROM stock_courant sc
      LEFT JOIN catalogue_medicaments cat ON cat.id::text = sc.medicament_id OR cat.dci = sc.medicament_id
      WHERE sc.csi_id = $1 AND sc.quantite <= 10
      ORDER BY sc.quantite ASC
      LIMIT 10`, [csiId]),
    pool.query(`
      SELECT id, numero_commande, statut, priorite, cree_le
      FROM demandes_ravitaillement
      WHERE csi_id = $1 AND statut IN ('DEMANDE', 'EN_REVUE', 'APPROUVE', 'EXPEDIE')
      ORDER BY cree_le DESC
      LIMIT 5`, [csiId]),
    pool.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE etat_naissance = 'VIVANT')::int AS vivants,
             COUNT(*) FILTER (WHERE poids_grammes < 2500)::int AS faible_poids
      FROM naissances
      WHERE csi_id = $1 AND date_naissance >= $2::date AND date_naissance < ($2::date + INTERVAL '1 month')`, [csiId, m]),
    pool.query(`
      SELECT COUNT(*)::int AS total
      FROM patients
      WHERE csi_inscription_id = $1`, [csiId])
  ]);

  res.json({
    csi: csiInfo.rows[0] || null,
    mois: m.slice(0, 7),
    rapport: rapportCourant.rows[0] || null,
    stock_critique: stockBas.rows,
    commandes_en_cours: commandesEnCours.rows,
    maternite: naissancesMois.rows[0] || { total: 0, vivants: 0, faible_poids: 0 },
    patients_total: totalPatients.rows[0]?.total || 0
  });
}));

// ─── GET /api/dashboard/superviseur ── Tableau de bord Superviseur Régional ────
router.get('/superviseur', auth('superviseur', 'admin'), wrap(async (req, res) => {
  const regionId = req.user.role === 'superviseur' ? req.user.region_id : (parseInt(req.query.region_id, 10) || req.user.region_id);
  const m = moisDate(req.query.mois) || new Date().toISOString().slice(0, 7) + '-01';

  if (!regionId) {
    return res.status(400).json({ erreur: 'region_id requis pour le tableau de bord superviseur' });
  }

  const [regionInfo, csiStats, rapportsSoumis, alertesEp, commandesAValider] = await Promise.all([
    pool.query(`SELECT id, nom FROM regions WHERE id = $1`, [regionId]),
    pool.query(`
      SELECT COUNT(*)::int AS csi_total,
             COUNT(DISTINCT r.csi_id)::int AS csi_avec_rapport,
             COUNT(DISTINCT r.csi_id) FILTER (WHERE r.statut = 'VALIDE')::int AS csi_valides,
             COUNT(DISTINCT r.csi_id) FILTER (WHERE r.statut = 'SOUMIS')::int AS csi_soumis
      FROM csi s
      JOIN communes co ON co.id = s.commune_id
      LEFT JOIN rapports r ON r.csi_id = s.id AND r.mois = $2
      WHERE co.region_id = $1 AND s.actif`, [regionId, m]),
    pool.query(`
      SELECT r.id, r.csi_id, s.nom AS csi_nom, co.nom AS commune, r.statut, r.soumis_le
      FROM rapports r
      JOIN csi s ON s.id = r.csi_id
      JOIN communes co ON co.id = s.commune_id
      WHERE co.region_id = $1 AND r.mois = $2 AND r.statut = 'SOUMIS'
      ORDER BY r.soumis_le ASC`, [regionId, m]),
    pool.query(`
      SELECT c.motif, COUNT(*)::int AS total
      FROM rapport_consultations c
      JOIN rapports r ON r.id = c.rapport_id
      JOIN csi s ON s.id = r.csi_id
      JOIN communes co ON co.id = s.commune_id
      WHERE co.region_id = $1 AND r.mois = $2
      GROUP BY c.motif
      ORDER BY total DESC
      LIMIT 5`, [regionId, m]),
    pool.query(`
      SELECT d.id, d.numero_commande, s.nom AS csi_nom, d.priorite, d.cree_le
      FROM demandes_ravitaillement d
      JOIN csi s ON s.id = d.csi_id
      JOIN communes co ON co.id = s.commune_id
      WHERE co.region_id = $1 AND d.statut IN ('DEMANDE', 'EN_REVUE')
      ORDER BY d.cree_le DESC`, [regionId])
  ]);

  const stats = csiStats.rows[0] || { csi_total: 0, csi_avec_rapport: 0, csi_valides: 0, csi_soumis: 0 };
  const tauxCouverture = stats.csi_total > 0 ? Math.round((stats.csi_avec_rapport / stats.csi_total) * 100) : 0;

  res.json({
    region: regionInfo.rows[0] || null,
    mois: m.slice(0, 7),
    stats: {
      ...stats,
      taux_couverture: tauxCouverture
    },
    rapports_a_valider: rapportsSoumis.rows,
    top_pathologies: alertesEp.rows,
    commandes_a_valider: commandesAValider.rows
  });
}));

// ─── GET /api/dashboard/admin ── Tableau de bord Administrateur National ──────
router.get('/admin', auth('admin'), wrap(async (req, res) => {
  const m = moisDate(req.query.mois) || new Date().toISOString().slice(0, 7) + '-01';

  const [nationalStats, parRegion, dernieresActionsAudit, alertesNationales] = await Promise.all([
    pool.query(`
      SELECT 
        (SELECT COUNT(*)::int FROM csi WHERE actif) AS total_csi,
        (SELECT COUNT(*)::int FROM utilisateurs WHERE actif) AS total_utilisateurs,
        (SELECT COUNT(*)::int FROM patients) AS total_patients,
        (SELECT COUNT(*)::int FROM rapports WHERE mois = $1) AS rapports_mois,
        (SELECT COUNT(*)::int FROM rapports WHERE mois = $1 AND statut = 'VALIDE') AS rapports_valides,
        (SELECT COUNT(*)::int FROM demandes_ravitaillement WHERE priorite = 'CRITIQUE_RUPTURE' AND statut != 'LIVRE') AS ruptures_critiques
    `, [m]),
    pool.query(`
      SELECT reg.id, reg.nom,
             COUNT(s.id)::int AS total_csi,
             COUNT(r.id)::int AS rapports_recus,
             COUNT(r.id) FILTER (WHERE r.statut = 'VALIDE')::int AS rapports_valides
      FROM regions reg
      JOIN communes com ON com.region_id = reg.id
      JOIN csi s ON s.commune_id = com.id AND s.actif
      LEFT JOIN rapports r ON r.csi_id = s.id AND r.mois = $1
      GROUP BY reg.id, reg.nom
      ORDER BY reg.nom ASC
    `, [m]),
    pool.query(`
      SELECT a.id, a.action, a.table_cible, a.cree_le, u.nom AS utilisateur_nom
      FROM audit_logs a
      LEFT JOIN utilisateurs u ON u.id = a.utilisateur_id
      ORDER BY a.cree_le DESC
      LIMIT 6
    `),
    pool.query(`
      SELECT param.valeur AS jour_limite
      FROM parametres param
      WHERE param.cle = 'jour_limite_depot_rapport'
    `)
  ]);

  res.json({
    mois: m.slice(0, 7),
    indicateurs: nationalStats.rows[0] || {},
    regions: parRegion.rows,
    recents_audits: dernieresActionsAudit.rows,
    jour_limite: parseInt(alertesNationales.rows[0]?.valeur, 10) || 5
  });
}));

module.exports = router;
