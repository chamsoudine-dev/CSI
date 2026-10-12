const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { auth } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

// ── Génération du numéro patient unique ──────────────────────────────────────
async function genererNumeroPatient() {
  const annee = new Date().getFullYear();
  const { rows } = await pool.query(`SELECT nextval('patient_numero_seq') AS n`);
  const num = String(rows[0].n).padStart(5, '0');
  return `NIG-${annee}-${num}`;
}

// ── GET /api/patients — Liste / recherche nationale ──────────────────────────
// Admin & superviseur : tous patients
// Agent : patients de son CSI uniquement
router.get('/', auth(), async (req, res) => {
  try {
    const { q = '', sexe, region, csi_id, page = 1, limit = 30 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const conditions = [];
    const params = [];
    let pi = 1;

    // Filtre par rôle agent (son CSI uniquement)
    if (req.user.role === 'agent' && req.user.csi_id) {
      conditions.push(`p.csi_inscription_id = $${pi++}`);
      params.push(req.user.csi_id);
    }

    // Recherche full-text ou partielle
    if (q) {
      conditions.push(`(
        LOWER(p.nom) LIKE $${pi} OR
        LOWER(p.prenom) LIKE $${pi} OR
        p.numero_patient ILIKE $${pi} OR
        p.telephone LIKE $${pi}
      )`);
      params.push(`%${q.toLowerCase()}%`);
      pi++;
    }

    if (sexe) { conditions.push(`p.sexe = $${pi++}`); params.push(sexe); }
    if (region) { conditions.push(`p.region_id = $${pi++}`); params.push(parseInt(region, 10)); }
    if (csi_id && req.user.role !== 'agent') {
      conditions.push(`p.csi_inscription_id = $${pi++}`);
      params.push(parseInt(csi_id, 10));
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const [dataRes, countRes] = await Promise.all([
      pool.query(`
        SELECT
          p.id, p.numero_patient, p.nom, p.prenom, p.sexe,
          p.date_naissance,
          DATE_PART('year', AGE(p.date_naissance))::INT AS age,
          p.commune_residence, p.telephone, p.groupe_sanguin,
          r.nom AS region_nom,
          c.nom AS csi_inscription_nom,
          (SELECT COUNT(*) FROM dossiers_consultation dc WHERE dc.patient_id = p.id) AS nb_visites,
          (SELECT MAX(dc.date_visite) FROM dossiers_consultation dc WHERE dc.patient_id = p.id) AS derniere_visite
        FROM patients p
        LEFT JOIN regions r ON r.id = p.region_id
        LEFT JOIN csi c ON c.id = p.csi_inscription_id
        ${where}
        ORDER BY p.nom, p.prenom
        LIMIT $${pi} OFFSET $${pi + 1}
      `, [...params, parseInt(limit, 10), offset]),
      pool.query(`SELECT COUNT(*) FROM patients p ${where}`, params)
    ]);

    res.json({
      patients: dataRes.rows,
      total: parseInt(countRes.rows[0].count, 10),
      page: parseInt(page, 10),
      limit: parseInt(limit, 10)
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erreur: e.message, error: e.message });
  }
});

// ── GET /api/patients/stats — Statistiques nationales patients ───────────────
router.get('/stats', auth(['admin', 'superviseur']), async (req, res) => {
  try {
    const { region } = req.query;
    const params = [];
    let cond = '';
    if (region) {
      params.push(parseInt(region, 10));
      cond = `WHERE p.region_id = $${params.length}`;
    }

    const { rows } = await pool.query(`
      SELECT
        COUNT(DISTINCT p.id)                    AS total_patients,
        COUNT(DISTINCT p.id) FILTER (WHERE p.sexe = 'F') AS femmes,
        COUNT(DISTINCT p.id) FILTER (WHERE p.sexe = 'M') AS hommes,
        COUNT(dc.id)                            AS total_visites,
        COUNT(DISTINCT dc.csi_id)               AS csi_actifs,
        (SELECT COUNT(*) FROM patients WHERE DATE_PART('month', cree_le) = DATE_PART('month', NOW())
          AND DATE_PART('year', cree_le) = DATE_PART('year', NOW())) AS nouveaux_ce_mois
      FROM patients p
      LEFT JOIN dossiers_consultation dc ON dc.patient_id = p.id
      ${cond}
    `, params);
    res.json(rows[0] || {});
  } catch (e) {
    console.error(e);
    res.status(500).json({ erreur: e.message, error: e.message });
  }
});

// ── GET /api/patients/:id — Fiche complète patient ───────────────────────────
router.get('/:id', auth(), async (req, res) => {
  try {
    const { id } = req.params;

    const patRes = await pool.query(`
      SELECT
        p.*,
        r.nom AS region_nom,
        c.nom AS csi_inscription_nom,
        co.nom AS csi_commune,
        u.nom AS enregistre_par_nom
      FROM patients p
      LEFT JOIN regions r ON r.id = p.region_id
      LEFT JOIN csi c ON c.id = p.csi_inscription_id
      LEFT JOIN communes co ON co.id = c.commune_id
      LEFT JOIN utilisateurs u ON u.id = p.enregistre_par_id
      WHERE p.id = $1
    `, [id]);

    if (!patRes.rows.length) return res.status(404).json({ erreur: 'Patient introuvable', error: 'Patient introuvable' });

    const patient = patRes.rows[0];

    // Restriction agent : seulement son CSI
    if (req.user.role === 'agent' && patient.csi_inscription_id !== req.user.csi_id) {
      return res.status(403).json({ erreur: 'Accès non autorisé', error: 'Accès non autorisé' });
    }

    // Historique des visites
    const visRes = await pool.query(`
      SELECT
        dc.*,
        c.nom AS csi_nom,
        u.nom AS agent_nom
      FROM dossiers_consultation dc
      LEFT JOIN csi c ON c.id = dc.csi_id
      LEFT JOIN utilisateurs u ON u.id = dc.agent_id
      WHERE dc.patient_id = $1
      ORDER BY dc.date_visite DESC
    `, [id]);

    res.json({ patient, visites: visRes.rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ erreur: e.message, error: e.message });
  }
});

// ── POST /api/patients — Enregistrer un nouveau patient ─────────────────────
router.post('/', auth(), async (req, res) => {
  try {
    const {
      nom, prenom, sexe, date_naissance, lieu_naissance,
      commune_residence, region_id, telephone, groupe_sanguin,
      allergies, maladies_chroniques
    } = req.body;

    if (!nom) return res.status(400).json({ erreur: 'Le nom est obligatoire', error: 'Le nom est obligatoire' });

    const numero_patient = await genererNumeroPatient();

    // CSI de l'agent ou celui spécifié (admin)
    const csi_inscription_id = req.user.csi_id || req.body.csi_inscription_id || null;

    const { rows } = await pool.query(`
      INSERT INTO patients
        (numero_patient, nom, prenom, sexe, date_naissance, lieu_naissance,
         commune_residence, region_id, telephone, groupe_sanguin,
         allergies, maladies_chroniques, csi_inscription_id, enregistre_par_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *
    `, [
      numero_patient, nom, prenom || null, sexe || null,
      date_naissance || null, lieu_naissance || null,
      commune_residence || null, region_id || null,
      telephone || null, groupe_sanguin || 'Inconnu',
      allergies || null, maladies_chroniques || null,
      csi_inscription_id, req.user.id
    ]);

    await logAudit({
      utilisateur_id: req.user.id,
      action: 'CREATE_PATIENT',
      table_cible: 'patients',
      enregistrement_id: rows[0].id,
      details: { numero_patient: rows[0].numero_patient, nom: rows[0].nom, csi_inscription_id },
      ip_adresse: req.ip
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    if (e.code === '23505') return res.status(409).json({ erreur: 'Patient déjà enregistré', error: 'Patient déjà enregistré' });
    res.status(500).json({ erreur: e.message, error: e.message });
  }
});

// ── PUT /api/patients/:id — Modifier un patient ──────────────────────────────
router.put('/:id', auth(), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nom, prenom, sexe, date_naissance, lieu_naissance,
      commune_residence, region_id, telephone, groupe_sanguin,
      allergies, maladies_chroniques
    } = req.body;

    const { rows } = await pool.query(`
      UPDATE patients SET
        nom = COALESCE($1, nom),
        prenom = COALESCE($2, prenom),
        sexe = COALESCE($3, sexe),
        date_naissance = COALESCE($4, date_naissance),
        lieu_naissance = COALESCE($5, lieu_naissance),
        commune_residence = COALESCE($6, commune_residence),
        region_id = COALESCE($7, region_id),
        telephone = COALESCE($8, telephone),
        groupe_sanguin = COALESCE($9, groupe_sanguin),
        allergies = COALESCE($10, allergies),
        maladies_chroniques = COALESCE($11, maladies_chroniques),
        modifie_le = NOW()
      WHERE id = $12
      RETURNING *
    `, [
      nom, prenom, sexe, date_naissance, lieu_naissance,
      commune_residence, region_id, telephone, groupe_sanguin,
      allergies, maladies_chroniques, id
    ]);

    if (!rows.length) return res.status(404).json({ erreur: 'Patient introuvable', error: 'Patient introuvable' });
    await logAudit({
      utilisateur_id: req.user.id,
      action: 'UPDATE_PATIENT',
      table_cible: 'patients',
      enregistrement_id: id,
      details: { nom: rows[0].nom, prenom: rows[0].prenom },
      ip_adresse: req.ip
    });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ erreur: e.message, error: e.message });
  }
});

// ── POST /api/patients/:id/visites — Enregistrer une consultation ────────────
router.post('/:id/visites', auth(), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      motif, diagnostic, traitement, ordonnance,
      tension_arterielle, temperature, poids_kg,
      observations, statut = 'CONSULTE'
    } = req.body;

    if (!motif) return res.status(400).json({ erreur: 'Le motif est obligatoire', error: 'Le motif est obligatoire' });

    const csi_id = req.user.csi_id || req.body.csi_id;
    if (!csi_id) return res.status(400).json({ erreur: 'CSI manquant', error: 'CSI manquant' });

    const { rows } = await pool.query(`
      INSERT INTO dossiers_consultation
        (patient_id, csi_id, agent_id, motif, diagnostic, traitement,
         ordonnance, tension_arterielle, temperature, poids_kg,
         observations, statut)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *
    `, [
      id, csi_id, req.user.id,
      motif, diagnostic || null, traitement || null,
      ordonnance || null, tension_arterielle || null,
      temperature || null, poids_kg || null,
      observations || null, statut
    ]);

    await logAudit({
      utilisateur_id: req.user.id,
      action: 'CREATE_VISITE',
      table_cible: 'dossiers_consultation',
      enregistrement_id: rows[0].id,
      details: { patient_id: id, motif, csi_id },
      ip_adresse: req.ip
    });
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ erreur: e.message, error: e.message });
  }
});

module.exports = router;
