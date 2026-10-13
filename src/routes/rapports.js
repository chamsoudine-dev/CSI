const express = require('express');
const router = express.Router();
const { pool, withTransaction } = require('../config/database');
const { auth, checkCsiAccess } = require('../middleware/auth');
const { checkCsiScope, validateIdParam } = require('../middleware/scope');
const { validate, schemas } = require('../middleware/validate');
const logger = require('../utils/logger');
const { logAudit } = require('../utils/audit');

const wrap = f => (req, res) => f(req, res).catch(e => {
  logger.error({ err: e, route: req.path, user: req.user?.id }, 'Erreur route rapport');
  res.status(500).json({ erreur: 'Erreur serveur' });
});

const moisDate = m => /^\d{4}-\d{2}$/.test(m) ? m + '-01' : null;
const n = v => Math.max(0, parseInt(v, 10) || 0);

/**
 * Récupère le jour limite de dépôt configuré dans les paramètres (défaut : 5)
 */
async function getJourLimiteDepot() {
  try {
    const { rows } = await pool.query("SELECT valeur FROM parametres WHERE cle = 'jour_limite_depot_rapport'");
    if (rows[0] && !isNaN(parseInt(rows[0].valeur, 10))) {
      return parseInt(rows[0].valeur, 10);
    }
  } catch {
    // Si la table n'est pas encore migrée
  }
  return 5;
}

/**
 * Détermine si un rapport est en retard par rapport à la date limite
 * @param {string|Date} mois - Mois du rapport (ex: '2026-03-01')
 * @param {string} statut - Statut actuel du rapport
 * @param {Date|null} soumis_le - Date effective de soumission
 * @param {number} jourLimite - Jour limite dans le mois suivant
 */
function estEnRetard(mois, statut, soumis_le, jourLimite = 5) {
  if (!mois) return false;
  const dMois = new Date(mois);
  // Mois suivant le mois rapporté
  const year = dMois.getFullYear();
  const month = dMois.getMonth(); // 0-indexed
  const dateLimite = new Date(year, month + 1, jourLimite, 23, 59, 59);

  if (statut === 'SOUMIS' || statut === 'VALIDE') {
    if (!soumis_le) return false;
    return new Date(soumis_le) > dateLimite;
  }
  // Pas encore soumis : en retard si maintenant > dateLimite
  return new Date() > dateLimite;
}

// ─── GET /api/rapport ── Consultation d'un rapport ────────────────────────────
router.get('/rapport', auth(), wrap(async (req, res) => {
  const { csi_id, mois } = req.query;
  const m = moisDate(mois);
  if (!csi_id || !m) return res.status(400).json({ erreur: 'csi_id et mois requis' });

  // Contrôle du périmètre (agent: son CSI, superviseur: sa région, admin: libre)
  const allowed = await checkCsiScope(csi_id, req.user);
  if (!allowed) {
    return res.status(403).json({ erreur: 'Accès non autorisé à ce CSI' });
  }

  const { rows } = await pool.query(
    `SELECT r.*, u1.nom AS soumis_par_nom, u2.nom AS valide_par_nom
     FROM rapports r
     LEFT JOIN utilisateurs u1 ON u1.id = r.soumis_par
     LEFT JOIN utilisateurs u2 ON u2.id = r.valide_par
     WHERE r.csi_id = $1 AND r.mois = $2`,
    [csi_id, m]
  );
  if (!rows[0]) return res.json(null);

  const rapport = rows[0];
  const jourLimite = await getJourLimiteDepot();
  const q = t => pool.query(`SELECT * FROM ${t} WHERE rapport_id = $1`, [rapport.id]).then(x => x.rows);

  res.json({
    id: rapport.id,
    csi_id: rapport.csi_id,
    mois: rapport.mois,
    statut: rapport.statut || 'BROUILLON',
    soumis_le: rapport.soumis_le,
    soumis_par: rapport.soumis_par,
    soumis_par_nom: rapport.soumis_par_nom,
    valide_le: rapport.valide_le,
    valide_par: rapport.valide_par,
    valide_par_nom: rapport.valide_par_nom,
    commentaire_validation: rapport.commentaire_validation,
    en_retard: estEnRetard(rapport.mois, rapport.statut, rapport.soumis_le, jourLimite),
    consultations: await q('consultations'),
    vaccinations: await q('vaccinations'),
    medicaments: await q('medicaments')
  });
}));

// ─── GET /api/rapports/liste ── Liste des rapports avec statut & filtres ──────
router.get('/rapports/liste', auth(['admin', 'superviseur']), wrap(async (req, res) => {
  const { mois, region_id, statut } = req.query;
  const m = moisDate(mois);
  const { role, region_id: userRegion } = req.user;

  // Superviseur : strictement limité à sa région
  const regionFilter = role === 'superviseur' ? userRegion : region_id || null;

  const baseParams = [m, regionFilter];
  let statutClause = '';
  if (statut) {
    baseParams.push(statut);
    statutClause = `AND r.statut = $${baseParams.length}`;
  }

  const { rows } = await pool.query(
    `SELECT s.id AS csi_id, s.nom AS csi, c.nom AS commune, g.nom AS region, g.id AS region_id,
            r.id AS rapport_id, r.mois, r.maj,
            COALESCE(r.statut, 'NON_DEPOSE') AS statut,
            r.soumis_le, r.soumis_par, r.valide_le, r.valide_par, r.commentaire_validation,
            u1.nom AS soumis_par_nom, u2.nom AS valide_par_nom
     FROM csi s
     JOIN communes c ON c.id = s.commune_id
     JOIN regions g ON g.id = c.region_id
     LEFT JOIN rapports r ON r.csi_id = s.id AND ($1::date IS NULL OR r.mois = $1)
     LEFT JOIN utilisateurs u1 ON u1.id = r.soumis_par
     LEFT JOIN utilisateurs u2 ON u2.id = r.valide_par
     WHERE s.actif
       AND ($2::int IS NULL OR g.id = $2)
       ${statutClause}
     ORDER BY g.nom, c.nom, s.nom`,
    baseParams
  );

  const jourLimite = await getJourLimiteDepot();
  const resultats = rows.map(r => ({
    ...r,
    en_retard: r.mois ? estEnRetard(r.mois, r.statut, r.soumis_le, jourLimite) : false
  }));

  res.json(resultats);
}));

// ─── PUT /api/rapport ── Enregistrement en brouillon (Agent / Sup / Admin) ─────
router.put('/rapport', auth(), validate(schemas.rapportSchema), checkCsiAccess, wrap(async (req, res) => {
  const { csi_id, mois: moisRaw, consultations, vaccinations, medicaments } = req.body;
  const mois = moisDate(moisRaw);
  if (!mois) return res.status(400).json({ erreur: 'Format mois invalide (YYYY-MM)' });

  // Contrôle de cohérence stricte des stocks : stock_fin = stock_debut + entrees - sorties
  for (const d of medicaments) {
    const debut = n(d.stock_debut);
    const entrees = n(d.entrees);
    const sorties = n(d.sorties);
    const fin = n(d.stock_fin);
    const theorique = debut + entrees - sorties;
    if (fin !== theorique) {
      return res.status(400).json({
        erreur: `Incohérence de stock pour ${d.produit} : stock final (${fin}) ≠ stock début (${debut}) + entrées (${entrees}) − sorties (${sorties}) [attendu: ${theorique}]`
      });
    }
  }

  // Vérifier que le CSI existe et est actif
  const { rows: csiRows } = await pool.query('SELECT id FROM csi WHERE id = $1 AND actif', [csi_id]);
  if (!csiRows[0]) return res.status(404).json({ erreur: 'CSI introuvable ou inactif' });

  // Vérifier si un rapport existe déjà et son statut
  const { rows: existants } = await pool.query(
    'SELECT id, statut FROM rapports WHERE csi_id = $1 AND mois = $2',
    [csi_id, mois]
  );
  if (existants[0] && existants[0].statut === 'VALIDE' && req.user.role !== 'admin') {
    return res.status(403).json({
      erreur: 'Ce rapport est déjà validé et verrouillé. Seul un administrateur national peut le modifier.'
    });
  }

  const rapportId = await withTransaction(async (db) => {
    // Si existant et non validé, passe ou reste en BROUILLON
    const { rows: rRows } = await db.query(
      `INSERT INTO rapports (csi_id, mois, statut) VALUES ($1, $2, 'BROUILLON')
       ON CONFLICT (csi_id, mois) DO UPDATE SET 
         maj = now(),
         statut = CASE WHEN rapports.statut = 'VALIDE' THEN rapports.statut ELSE 'BROUILLON' END
       RETURNING id, statut`,
      [csi_id, mois]
    );
    const id = rRows[0].id;

    // Supprimer l'ancien contenu détaillé et insérer le nouveau
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

  logger.info({ userId: req.user.id, csiId: csi_id, mois, rapportId }, 'Rapport enregistré en brouillon');
  await logAudit({
    utilisateur_id: req.user.id,
    action: 'SAVE_RAPPORT_BROUILLON',
    table_cible: 'rapports',
    enregistrement_id: rapportId,
    details: { csi_id, mois, nb_consultations: consultations.length, nb_vaccinations: vaccinations.length, nb_medicaments: medicaments.length },
    ip_adresse: req.ip
  });

  res.json({ ok: true, rapport_id: rapportId, statut: 'BROUILLON' });
}));

// ─── POST /api/rapport/:id/soumettre ── Soumission par l'agent ou responsable ─
router.post('/rapport/:id/soumettre', auth(), validateIdParam, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rows } = await pool.query('SELECT * FROM rapports WHERE id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ erreur: 'Rapport introuvable' });

  const rapport = rows[0];
  const allowed = await checkCsiScope(rapport.csi_id, req.user);
  if (!allowed) return res.status(403).json({ erreur: 'Accès non autorisé à ce CSI' });

  if (rapport.statut === 'VALIDE') {
    return res.status(409).json({ erreur: 'Le rapport est déjà validé.' });
  }

  await pool.query(
    `UPDATE rapports 
     SET statut = 'SOUMIS', soumis_le = now(), soumis_par = $1, maj = now() 
     WHERE id = $2`,
    [req.user.id, id]
  );

  logger.info({ userId: req.user.id, rapportId: id }, 'Rapport soumis');
  await logAudit({
    utilisateur_id: req.user.id,
    action: 'SOUMETTRE_RAPPORT',
    table_cible: 'rapports',
    enregistrement_id: id,
    details: { csi_id: rapport.csi_id, mois: rapport.mois },
    ip_adresse: req.ip
  });

  res.json({ ok: true, statut: 'SOUMIS' });
}));

// ─── POST /api/rapport/:id/valider ── Validation Superviseur / Admin ──────────
router.post('/rapport/:id/valider', auth(['admin', 'superviseur']), validateIdParam, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { commentaire } = req.body || {};

  const { rows } = await pool.query('SELECT * FROM rapports WHERE id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ erreur: 'Rapport introuvable' });

  const rapport = rows[0];
  const allowed = await checkCsiScope(rapport.csi_id, req.user);
  if (!allowed) return res.status(403).json({ erreur: 'Accès non autorisé à la région de ce CSI' });

  if (rapport.statut !== 'SOUMIS' && req.user.role !== 'admin') {
    return res.status(409).json({ erreur: `Impossible de valider un rapport avec le statut ${rapport.statut}` });
  }

  await withTransaction(async (db) => {
    // 1. Mettre à jour le statut du rapport
    await db.query(
      `UPDATE rapports 
       SET statut = 'VALIDE', valide_le = now(), valide_par = $1, 
           commentaire_validation = $2, maj = now() 
       WHERE id = $3`,
      [req.user.id, commentaire || null, id]
    );

    // 2. Synchroniser le stock_fin avec stock_courant
    const { rows: meds } = await db.query(
      `SELECT m.produit, m.stock_fin, cm.id AS medicament_id
       FROM medicaments m
       LEFT JOIN catalogue_medicaments cm ON LOWER(TRIM(cm.designation)) = LOWER(TRIM(m.produit))
       WHERE m.rapport_id = $1`,
      [id]
    );

    for (const med of meds) {
      if (med.medicament_id) {
        await db.query(
          `INSERT INTO stock_courant (csi_id, medicament_id, quantite, maj_le)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (csi_id, medicament_id) 
           DO UPDATE SET quantite = EXCLUDED.quantite, maj_le = now()`,
          [rapport.csi_id, med.medicament_id, med.stock_fin]
        );
      }
    }
  });

  logger.info({ userId: req.user.id, rapportId: id }, 'Rapport validé et stock courant mis à jour');
  await logAudit({
    utilisateur_id: req.user.id,
    action: 'VALIDER_RAPPORT',
    table_cible: 'rapports',
    enregistrement_id: id,
    details: { csi_id: rapport.csi_id, mois: rapport.mois, commentaire },
    ip_adresse: req.ip
  });

  res.json({ ok: true, statut: 'VALIDE' });
}));

// ─── POST /api/rapport/:id/renvoyer ── Renvoi avec motif Superviseur / Admin ──
router.post('/rapport/:id/renvoyer', auth(['admin', 'superviseur']), validateIdParam, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { commentaire } = req.body || {};

  if (!commentaire || !commentaire.trim()) {
    return res.status(400).json({ erreur: 'Un commentaire explicatif est obligatoire pour renvoyer un rapport.' });
  }

  const { rows } = await pool.query('SELECT * FROM rapports WHERE id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ erreur: 'Rapport introuvable' });

  const rapport = rows[0];
  const allowed = await checkCsiScope(rapport.csi_id, req.user);
  if (!allowed) return res.status(403).json({ erreur: 'Accès non autorisé à la région de ce CSI' });

  await pool.query(
    `UPDATE rapports 
     SET statut = 'RENVOYE', commentaire_validation = $1, maj = now() 
     WHERE id = $2`,
    [commentaire.trim(), id]
  );

  logger.info({ userId: req.user.id, rapportId: id }, 'Rapport renvoyé pour correction');
  await logAudit({
    utilisateur_id: req.user.id,
    action: 'RENVOYER_RAPPORT',
    table_cible: 'rapports',
    enregistrement_id: id,
    details: { csi_id: rapport.csi_id, mois: rapport.mois, commentaire },
    ip_adresse: req.ip
  });

  res.json({ ok: true, statut: 'RENVOYE' });
}));

// ─── POST /api/rapport/:id/rouvrir ── Rouverture exceptionnelle (Admin seul) ──
router.post('/rapport/:id/rouvrir', auth(['admin']), validateIdParam, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { rows } = await pool.query('SELECT * FROM rapports WHERE id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ erreur: 'Rapport introuvable' });

  const rapport = rows[0];
  await pool.query(
    `UPDATE rapports 
     SET statut = 'BROUILLON', maj = now() 
     WHERE id = $1`,
    [id]
  );

  logger.warn({ userId: req.user.id, rapportId: id }, 'Rapport rouvert par un administrateur');
  await logAudit({
    utilisateur_id: req.user.id,
    action: 'ROUVRIR_RAPPORT',
    table_cible: 'rapports',
    enregistrement_id: id,
    details: { csi_id: rapport.csi_id, mois: rapport.mois, ancien_statut: rapport.statut },
    ip_adresse: req.ip
  });

  res.json({ ok: true, statut: 'BROUILLON' });
}));

module.exports = router;
