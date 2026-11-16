const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { auth } = require('../middleware/auth');
const { checkCsiScope, validateIdParam } = require('../middleware/scope');
const logger = require('../utils/logger');
const { logAudit } = require('../utils/audit');

const wrap = f => (req, res) => f(req, res).catch(e => {
  logger.error({ err: e, route: req.path, user: req.user?.id }, 'Erreur route UNFPA');
  res.status(500).json({ erreur: 'Erreur serveur' });
});

// ─── GET /api/unfpa ── Lecture d'une enquête ou liste par périmètre ───────────
router.get('/', auth(), wrap(async (req, res) => {
  const { csi_id, annee } = req.query;
  const curYear = annee ? parseInt(annee, 10) : new Date().getFullYear();

  // Si csi_id est fourni : recherche spécifique
  if (csi_id) {
    const targetCsi = parseInt(csi_id, 10);
    const allowed = await checkCsiScope(targetCsi, req.user);
    if (!allowed) return res.status(403).json({ erreur: 'Accès non autorisé à ce CSI' });

    const { rows } = await pool.query(
      `SELECT e.*, s.nom AS csi_nom, c.nom AS commune_nom, g.nom AS region_nom, u.nom AS auteur_nom
       FROM enquetes_unfpa e
       JOIN csi s ON s.id = e.csi_id
       JOIN communes c ON c.id = s.commune_id
       JOIN regions g ON g.id = c.region_id
       LEFT JOIN utilisateurs u ON u.id = e.auteur_id
       WHERE e.csi_id = $1 AND e.annee = $2`,
      [targetCsi, curYear]
    );
    return res.json(rows[0] || null);
  }

  // Sinon liste des enquêtes filtrée selon le périmètre de l'utilisateur
  const { role, csi_id: userCsi, region_id: userRegion } = req.user;
  let where = 'WHERE e.annee = $1';
  const params = [curYear];

  if (role === 'agent') {
    params.push(userCsi);
    where += ` AND e.csi_id = $${params.length}`;
  } else if (role === 'superviseur') {
    params.push(userRegion);
    where += ` AND g.id = $${params.length}`;
  } else if (req.query.region_id) {
    params.push(parseInt(req.query.region_id, 10));
    where += ` AND g.id = $${params.length}`;
  }

  const { rows } = await pool.query(
    `SELECT e.id, e.csi_id, e.annee, e.statut, e.soumis_le, e.cree_le, e.modifie_le,
            s.nom AS csi_nom, c.nom AS commune_nom, g.nom AS region_nom, u.nom AS auteur_nom
     FROM enquetes_unfpa e
     JOIN csi s ON s.id = e.csi_id
     JOIN communes c ON c.id = s.commune_id
     JOIN regions g ON g.id = c.region_id
     LEFT JOIN utilisateurs u ON u.id = e.auteur_id
     ${where}
     ORDER BY g.nom, c.nom, s.nom`,
    params
  );

  res.json(rows);
}));

// ─── PUT /api/unfpa ── Enregistrement d'un brouillon d'enquête ─────────────────
router.put('/', auth(), wrap(async (req, res) => {
  const { csi_id, annee, reponses } = req.body;
  if (!csi_id) return res.status(400).json({ erreur: 'csi_id requis' });
  const year = annee ? parseInt(annee, 10) : new Date().getFullYear();
  const targetCsi = parseInt(csi_id, 10);

  const allowed = await checkCsiScope(targetCsi, req.user);
  if (!allowed) return res.status(403).json({ erreur: 'Accès non autorisé à ce CSI' });

  // Vérifier statut si existant
  const { rows: existants } = await pool.query(
    'SELECT id, statut FROM enquetes_unfpa WHERE csi_id = $1 AND annee = $2',
    [targetCsi, year]
  );
  if (existants[0] && existants[0].statut === 'VALIDE' && req.user.role !== 'admin') {
    return res.status(403).json({ erreur: 'Enquête validée et verrouillée. Seul un administrateur peut la modifier.' });
  }

  const reponsesJson = typeof reponses === 'object' && reponses !== null ? JSON.stringify(reponses) : '{}';

  const { rows } = await pool.query(
    `INSERT INTO enquetes_unfpa (csi_id, annee, reponses, auteur_id, statut, modifie_le)
     VALUES ($1, $2, $3::jsonb, $4, 'BROUILLON', now())
     ON CONFLICT (csi_id, annee) DO UPDATE SET
       reponses = EXCLUDED.reponses,
       auteur_id = EXCLUDED.auteur_id,
       modifie_le = now(),
       statut = CASE WHEN enquetes_unfpa.statut = 'VALIDE' THEN 'VALIDE' ELSE 'BROUILLON' END
     RETURNING id, statut`,
    [targetCsi, year, reponsesJson, req.user.id]
  );

  const id = rows[0].id;
  await logAudit({
    utilisateur_id: req.user.id,
    action: 'SAVE_ENQUETE_UNFPA',
    table_cible: 'enquetes_unfpa',
    enregistrement_id: id,
    details: { csi_id: targetCsi, annee: year },
    ip_adresse: req.ip
  });

  res.json({ ok: true, id, statut: rows[0].statut });
}));

// ─── POST /api/unfpa/:id/soumettre ── Soumission de l'enquête ─────────────────
router.post('/:id/soumettre', auth(), validateIdParam, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rows } = await pool.query('SELECT * FROM enquetes_unfpa WHERE id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ erreur: 'Enquête introuvable' });

  const enq = rows[0];
  const allowed = await checkCsiScope(enq.csi_id, req.user);
  if (!allowed) return res.status(403).json({ erreur: 'Accès non autorisé' });

  if (enq.statut === 'VALIDE') {
    return res.status(409).json({ erreur: 'Cette enquête est déjà validée' });
  }

  await pool.query(
    "UPDATE enquetes_unfpa SET statut = 'SOUMIS', soumis_le = now(), modifie_le = now() WHERE id = $1",
    [id]
  );

  await logAudit({
    utilisateur_id: req.user.id,
    action: 'SOUMETTRE_ENQUETE_UNFPA',
    table_cible: 'enquetes_unfpa',
    enregistrement_id: id,
    details: { csi_id: enq.csi_id, annee: enq.annee },
    ip_adresse: req.ip
  });

  res.json({ ok: true, statut: 'SOUMIS' });
}));

// ─── POST /api/unfpa/:id/valider ── Validation Superviseur / Admin ────────────
router.post('/:id/valider', auth(['admin', 'superviseur', 'superviseur_national']), validateIdParam, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rows } = await pool.query('SELECT * FROM enquetes_unfpa WHERE id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ erreur: 'Enquête introuvable' });

  const enq = rows[0];
  const allowed = await checkCsiScope(enq.csi_id, req.user);
  if (!allowed) return res.status(403).json({ erreur: 'Accès non autorisé à la région de ce CSI' });

  await pool.query(
    "UPDATE enquetes_unfpa SET statut = 'VALIDE', modifie_le = now() WHERE id = $1",
    [id]
  );

  await logAudit({
    utilisateur_id: req.user.id,
    action: 'VALIDER_ENQUETE_UNFPA',
    table_cible: 'enquetes_unfpa',
    enregistrement_id: id,
    details: { csi_id: enq.csi_id, annee: enq.annee },
    ip_adresse: req.ip
  });

  res.json({ ok: true, statut: 'VALIDE' });
}));

// ─── GET /api/unfpa/synthese ── Synthèse agrégée régionale et nationale ───────
router.get('/synthese', auth(), wrap(async (req, res) => {
  const annee = req.query.annee ? parseInt(req.query.annee, 10) : new Date().getFullYear();
  const { role, region_id: userRegion } = req.user;

  let regionFilter = null;
  if (role === 'superviseur') {
    regionFilter = userRegion;
  } else if (req.query.region_id) {
    regionFilter = parseInt(req.query.region_id, 10);
  }

  const baseParams = [annee];
  let regClause = '';
  if (regionFilter) {
    baseParams.push(regionFilter);
    regClause = `AND g.id = $${baseParams.length}`;
  }

  // Nombre total de CSI actifs et nombre d'enquêtes par statut
  const [csiTotalRes, enqRes, parRegionRes] = await Promise.all([
    pool.query(
      `SELECT count(s.id)::int AS total
       FROM csi s
       JOIN communes c ON c.id = s.commune_id
       JOIN regions g ON g.id = c.region_id
       WHERE s.actif ${regClause}`,
      regionFilter ? [regionFilter] : []
    ),
    pool.query(
      `SELECT e.statut, count(e.id)::int AS count
       FROM enquetes_unfpa e
       JOIN csi s ON s.id = e.csi_id
       JOIN communes c ON c.id = s.commune_id
       JOIN regions g ON g.id = c.region_id
       WHERE e.annee = $1 ${regClause}
       GROUP BY e.statut`,
      baseParams
    ),
    pool.query(
      `SELECT g.id AS region_id, g.nom AS region,
              count(DISTINCT s.id)::int AS csi_total,
              count(DISTINCT e.id)::int AS enquetes_total,
              count(DISTINCT CASE WHEN e.statut = 'VALIDE' THEN e.id END)::int AS validees,
              count(DISTINCT CASE WHEN e.statut = 'SOUMIS' THEN e.id END)::int AS soumises
       FROM regions g
       JOIN communes c ON c.region_id = g.id
       JOIN csi s ON s.commune_id = c.id AND s.actif
       LEFT JOIN enquetes_unfpa e ON e.csi_id = s.id AND e.annee = $1
       ${regionFilter ? 'WHERE g.id = $2' : ''}
       GROUP BY g.id, g.nom
       ORDER BY g.nom`,
      baseParams
    )
  ]);

  const totalCsi = csiTotalRes.rows[0]?.total || 0;
  const statuts = enqRes.rows.reduce((acc, row) => {
    acc[row.statut] = row.count;
    acc.total += row.count;
    return acc;
  }, { total: 0, BROUILLON: 0, SOUMIS: 0, VALIDE: 0 });

  res.json({
    annee,
    region_id: regionFilter,
    csi_total: totalCsi,
    taux_couverture_pct: totalCsi > 0 ? Math.round((statuts.total / totalCsi) * 100) : 0,
    statuts,
    regions: parRegionRes.rows
  });
}));

module.exports = router;
