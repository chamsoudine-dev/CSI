/**
 * routes/catalogue.js
 * API catalogue national des médicaments du Niger
 * Routes : GET /api/catalogue, GET /api/catalogue/classes
 */

const express = require('express');
const router  = express.Router();
const { pool } = require('../config/database');
const logger  = require('../utils/logger');

const { fragment } = require('../utils/render');

/**
 * Vue HTMX : Liste du catalogue avec recherche fluide
 */
router.get('/view', async (req, res) => {
  const { q = '' } = req.query;
  const { rows } = await pool.query(`
    SELECT m.*, s.dci
    FROM catalogue_medicaments m
    JOIN catalogue_substances s ON s.id = m.substance_id
    WHERE m.nom_commercial ILIKE $1 OR s.dci ILIKE $1
    LIMIT 20
  `, [`%${q}%`]);

  const html = `
    <div class="catalogue-view">
      <h3>💊 Catalogue National</h3>
      <input type="text"
             name="q"
             value="${q}"
             placeholder="Rechercher un médicament..."
             hx-get="/api/catalogue/view"
             hx-trigger="keyup changed delay:300ms"
             hx-target="#catalogue"
             class="search-input">

      <table class="data-table">
        <thead>
          <tr><th>DCI</th><th>Nom Commercial</th><th>Forme</th></tr>
        </thead>
        <tbody>
          ${rows.map(m => `
            <tr>
              <td><strong>${m.dci}</strong></td>
              <td>${m.nom_commercial || '-'}</td>
              <td><span class="badge">${m.forme}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  res.send(html);
});

/**
 * GET /api/catalogue?q=&classe=&forme=&page=&limit=
 * Recherche dans le catalogue (accès public et ouvert)
 */
router.get('/', async (req, res) => {
  try {
    const q      = (req.query.q      || '').trim();
    const classe = (req.query.classe || '').trim();
    const forme  = (req.query.forme  || '').trim();
    const page   = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit  = Math.min(100, Math.max(5, parseInt(req.query.limit || '50', 10)));
    const offset = (page - 1) * limit;

    const conditions = [];
    const params     = [];

    if (q) {
      params.push(q);
      conditions.push(`(
        m.nom_commercial ILIKE '%' || $${params.length} || '%'
        OR s.dci          ILIKE '%' || $${params.length} || '%'
        OR m.classe       ILIKE '%' || $${params.length} || '%'
      )`);
    }
    if (classe) {
      params.push(classe);
      conditions.push(`m.classe ILIKE $${params.length}`);
    }
    if (forme) {
      params.push(forme);
      conditions.push(`m.forme ILIKE $${params.length}`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    // Compter le total
    const countRes = await pool.query(`
      SELECT count(*) FROM catalogue_medicaments m
      JOIN catalogue_substances s ON s.id = m.substance_id
      ${where}
    `, params);
    const total = parseInt(countRes.rows[0].count, 10);

    // Récupérer les résultats
    const dataRes = await pool.query(`
      SELECT
        m.id,
        s.dci,
        s.code_atc,
        m.nom_commercial,
        m.forme,
        m.dosage,
        m.classe,
        m.sur_ordonnance,
        m.disponible_niger
      FROM catalogue_medicaments m
      JOIN catalogue_substances s ON s.id = m.substance_id
      ${where}
      ORDER BY s.dci, m.dosage
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, limit, offset]);

    res.json({
      total,
      page,
      pages: Math.ceil(total / limit),
      limit,
      results: dataRes.rows
    });

  } catch (err) {
    logger.error({ err }, 'Erreur catalogue');
    res.status(500).json({ erreur: 'Erreur serveur catalogue' });
  }
});

/**
 * GET /api/catalogue/classes
 * Liste des classes thérapeutiques disponibles
 */
router.get('/classes', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT classe, count(*) AS nb_medicaments
      FROM catalogue_medicaments
      WHERE classe IS NOT NULL
      GROUP BY classe
      ORDER BY classe
    `);
    res.json(result.rows);
  } catch (err) {
    logger.error({ err }, 'Erreur classes catalogue');
    res.status(500).json({ erreur: 'Erreur serveur' });
  }
});

/**
 * GET /api/catalogue/formes
 * Liste des formes galéniques disponibles
 */
router.get('/formes', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT forme, count(*) AS nb_medicaments
      FROM catalogue_medicaments
      WHERE forme IS NOT NULL
      GROUP BY forme
      ORDER BY nb_medicaments DESC
    `);
    res.json(result.rows);
  } catch (err) {
    logger.error({ err }, 'Erreur formes catalogue');
    res.status(500).json({ erreur: 'Erreur serveur' });
  }
});

/**
 * GET /api/catalogue/stats
 * Statistiques globales du catalogue
 */
router.get('/stats', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        (SELECT count(*) FROM catalogue_substances)  AS nb_substances,
        (SELECT count(*) FROM catalogue_medicaments) AS nb_medicaments,
        (SELECT count(DISTINCT classe) FROM catalogue_medicaments WHERE classe IS NOT NULL) AS nb_classes,
        (SELECT count(DISTINCT forme)  FROM catalogue_medicaments WHERE forme  IS NOT NULL) AS nb_formes
    `);
    res.json(result.rows[0]);
  } catch (err) {
    logger.error({ err }, 'Erreur stats catalogue');
    res.status(500).json({ erreur: 'Erreur serveur' });
  }
});

/**
 * GET /api/catalogue/:id
 * Fiche détaillée d'un médicament et rattachement aux données du CSI
 */
router.get('/:id(\\d+)', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const medRes = await pool.query(`
      SELECT
        m.id,
        m.substance_id,
        s.dci,
        s.code_atc,
        s.classe AS substance_classe,
        m.nom_commercial,
        m.forme,
        m.dosage,
        m.classe,
        m.sur_ordonnance,
        m.disponible_niger,
        m.verifie,
        m.cree_le
      FROM catalogue_medicaments m
      JOIN catalogue_substances s ON s.id = m.substance_id
      WHERE m.id = $1
    `, [id]);

    if (!medRes.rows[0]) {
      return res.status(404).json({ erreur: 'Médicament non trouvé dans le catalogue' });
    }

    const medicament = medRes.rows[0];

    // Soutirer les informations nécessaires rattachées en base de données :
    // 1. Statistiques des délivrances aux patients pour ce médicament
    const statsDisp = await pool.query(`
      SELECT 
        COUNT(*)::int AS nb_dispensations,
        COALESCE(SUM(quantite), 0)::int AS quantite_totale_remise,
        COUNT(DISTINCT patient_nom)::int AS nb_patients_uniques
      FROM dispensations_medicaments
      WHERE medicament_id = $1 OR medicament_nom ILIKE $2
    `, [id, medicament.nom_commercial || medicament.dci]);

    // 2. Dernières délivrances enregistrées dans le CSI pour ce médicament
    const dernieresDisp = await pool.query(`
      SELECT 
        d.id,
        d.patient_nom,
        d.patient_numero,
        d.quantite,
        d.posologie,
        d.motif,
        d.agent_nom,
        d.date_dispensation,
        c.nom AS csi_nom
      FROM dispensations_medicaments d
      LEFT JOIN csi c ON c.id = d.csi_id
      WHERE d.medicament_id = $1 OR d.medicament_nom ILIKE $2
      ORDER BY d.id DESC
      LIMIT 5
    `, [id, medicament.nom_commercial || medicament.dci]);

    // 3. Ravitaillements récents où ce médicament a été commandé
    let ravitaillements = [];
    try {
      const ravRes = await pool.query(`
        SELECT dl.quantite_demandee, dl.quantite_accordee, dl.statut, dr.numero_bordereau, dr.date_demande, c.nom AS csi_nom
        FROM demande_lignes dl
        JOIN demandes_ravitaillement dr ON dr.id = dl.demande_id
        LEFT JOIN csi c ON c.id = dr.csi_id
        WHERE dl.medicament_id = $1
        ORDER BY dr.id DESC
        LIMIT 3
      `, [id]);
      ravitaillements = ravRes.rows;
    } catch (_) {}

    res.json({
      medicament,
      statistiques_csi: statsDisp.rows[0] || { nb_dispensations: 0, quantite_totale_remise: 0, nb_patients_uniques: 0 },
      dernieres_dispensations: dernieresDisp.rows || [],
      ravitaillements_lies: ravitaillements
    });

  } catch (err) {
    logger.error({ err }, 'Erreur consultation fiche médicament');
    res.status(500).json({ erreur: 'Erreur lors de la récupération des informations du médicament' });
  }
});

const { auth } = require('../middleware/auth');

/**
 * GET /api/catalogue/patients-lookup
 * Liste et recherche des patients du CSI pour délivrance de médicaments
 */
router.get('/patients-lookup', auth(), async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    let query = `
      SELECT 
        p.id,
        p.numero_patient,
        p.numero_patient AS numero_dossier,
        p.nom,
        p.prenom,
        p.sexe AS genre,
        p.sexe,
        p.date_naissance,
        EXTRACT(YEAR FROM age(CURRENT_DATE, p.date_naissance))::int AS age_ans,
        p.telephone,
        p.commune_residence,
        p.allergies,
        p.maladies_chroniques,
        p.csi_inscription_id AS csi_id,
        c.nom AS csi_nom
      FROM patients p
      LEFT JOIN csi c ON c.id = p.csi_inscription_id
      WHERE 1=1
    `;
    const params = [];

    // Périmètre strict selon le rôle : filtrer par le CSI de l'agent qui effectue la délivrance
    if (req.user.role === 'agent' && req.user.csi_id) {
      params.push(req.user.csi_id);
      query += ` AND (p.csi_inscription_id = $${params.length} OR p.csi_inscription_id IS NULL)`;
    } else if (req.query.csi_id) {
      params.push(parseInt(req.query.csi_id, 10));
      query += ` AND p.csi_inscription_id = $${params.length}`;
    }

    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      query += ` AND (
        LOWER(p.nom) LIKE $${params.length}
        OR LOWER(p.prenom) LIKE $${params.length}
        OR LOWER(p.numero_patient) LIKE $${params.length}
        OR LOWER(COALESCE(p.prenom,'') || ' ' || COALESCE(p.nom,'')) LIKE $${params.length}
        OR p.telephone LIKE $${params.length}
      )`;
    }

    query += ` ORDER BY p.nom ASC, p.prenom ASC LIMIT 50`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    logger.error({ err }, 'Erreur lookup patients');
    res.status(500).json({ erreur: 'Erreur lors de la récupération des patients' });
  }
});

/**
 * GET /api/catalogue/patients-csi
 * Tous les patients enregistrés dans le CSI de l'agent (pour affichage direct)
 */
router.get('/patients-csi', auth(), async (req, res) => {
  try {
    let csiId = req.user.csi_id;
    if (req.query.csi_id) csiId = parseInt(req.query.csi_id, 10);

    let query = `
      SELECT 
        p.id,
        p.numero_patient,
        p.numero_patient AS numero_dossier,
        p.nom,
        p.prenom,
        p.sexe AS genre,
        p.sexe,
        p.date_naissance,
        EXTRACT(YEAR FROM age(CURRENT_DATE, p.date_naissance))::int AS age_ans,
        p.telephone,
        p.commune_residence,
        p.allergies,
        p.maladies_chroniques,
        p.csi_inscription_id AS csi_id,
        c.nom AS csi_nom
      FROM patients p
      LEFT JOIN csi c ON c.id = p.csi_inscription_id
    `;
    const params = [];

    if (csiId) {
      params.push(csiId);
      query += ` WHERE p.csi_inscription_id = $1 OR p.csi_inscription_id IS NULL`;
    }

    query += ` ORDER BY p.nom ASC, p.prenom ASC LIMIT 100`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    logger.error({ err }, 'Erreur patients CSI');
    res.status(500).json({ erreur: 'Erreur serveur patients CSI' });
  }
});

/**
 * GET /api/catalogue/dispensations
 * Liste des médicaments délivrés aux patients
 */
router.get('/dispensations', auth(), async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const date = (req.query.date || '').trim();
    let query = `
      SELECT d.*, c.nom AS csi_nom
      FROM dispensations_medicaments d
      LEFT JOIN csi c ON c.id = d.csi_id
      WHERE 1=1
    `;
    const params = [];

    if (req.user.role === 'agent' && req.user.csi_id) {
      params.push(req.user.csi_id);
      query += ` AND d.csi_id = $${params.length}`;
    } else if (req.query.csi_id) {
      params.push(parseInt(req.query.csi_id, 10));
      query += ` AND d.csi_id = $${params.length}`;
    }

    if (q) {
      params.push(q);
      query += ` AND (
        d.patient_nom ILIKE '%' || $${params.length} || '%'
        OR d.medicament_nom ILIKE '%' || $${params.length} || '%'
        OR d.patient_numero ILIKE '%' || $${params.length} || '%'
      )`;
    }

    if (date) {
      params.push(date);
      query += ` AND d.date_dispensation = $${params.length}`;
    }

    query += ` ORDER BY d.id DESC LIMIT 100`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    logger.error({ err }, 'Erreur liste dispensations');
    res.status(500).json({ erreur: 'Erreur serveur dispensations' });
  }
});

/**
 * POST /api/catalogue/dispensations
 * Enregistrer un médicament reçu par un patient dans le CSI
 * et synchroniser automatiquement le stock restant
 */
router.post('/dispensations', auth(), async (req, res) => {
  try {
    const {
      patient_id,
      patient_nom,
      patient_numero,
      medicament_id,
      medicament_nom,
      forme,
      dosage,
      quantite,
      posologie,
      motif,
      date_dispensation
    } = req.body;

    if (!patient_nom || !patient_nom.trim()) {
      return res.status(400).json({ erreur: 'Le nom du patient est obligatoire.' });
    }
    if (!medicament_nom || !medicament_nom.trim()) {
      return res.status(400).json({ erreur: 'Le nom du médicament est obligatoire.' });
    }

    const csi_id = req.user.csi_id || req.body.csi_id || 1;
    const qte = Math.max(1, parseInt(quantite || 1, 10));
    const dateDisp = date_dispensation || new Date().toISOString().slice(0, 10);
    const medId = medicament_id ? parseInt(medicament_id, 10) : null;
    const patId = patient_id ? parseInt(patient_id, 10) : null;

    const result = await pool.query(`
      INSERT INTO dispensations_medicaments (
        csi_id, patient_id, patient_nom, patient_numero,
        medicament_id, medicament_nom, forme, dosage,
        quantite, posologie, motif,
        agent_id, agent_nom, date_dispensation
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `, [
      csi_id,
      patId,
      patient_nom.trim(),
      patient_numero ? patient_numero.trim() : null,
      medId,
      medicament_nom.trim(),
      forme ? forme.trim() : null,
      dosage ? dosage.trim() : null,
      qte,
      posologie ? posologie.trim() : null,
      motif ? motif.trim() : null,
      req.user.id,
      req.user.nom || 'Agent CSI',
      dateDisp
    ]);

    // Décrémenter le stock courant du CSI si le médicament est lié au catalogue
    if (csi_id && medId) {
      try {
        await pool.query(`
          UPDATE stock_courant
          SET quantite = GREATEST(0, quantite - $1),
              maj_le = NOW()
          WHERE csi_id = $2 AND medicament_id = $3
        `, [qte, csi_id, medId]);
      } catch (errStock) {
        logger.warn({ errStock: errStock.message }, 'Avertissement MAJ stock lors dispensation');
      }
    }

    res.status(201).json({
      message: 'Médicament délivré avec succès au patient',
      dispensation: result.rows[0]
    });
  } catch (err) {
    logger.error({ err }, 'Erreur création dispensation');
    res.status(500).json({ erreur: 'Erreur lors de l\'enregistrement de la délivrance' });
  }
});

/**
 * DELETE /api/catalogue/dispensations/:id
 * Annuler une délivrance
 */
router.delete('/dispensations/:id', auth(), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const result = await pool.query('DELETE FROM dispensations_medicaments WHERE id = $1 RETURNING id', [id]);
    if (!result.rows[0]) {
      return res.status(404).json({ erreur: 'Délivrance introuvable' });
    }
    res.json({ message: 'Délivrance annulée' });
  } catch (err) {
    logger.error({ err }, 'Erreur suppression dispensation');
    res.status(500).json({ erreur: 'Erreur serveur' });
  }
});

module.exports = router;
