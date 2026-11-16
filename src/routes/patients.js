const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { auth } = require('../middleware/auth');
const { validateIdParam, checkCsiScope } = require('../middleware/scope');
const { logAudit } = require('../utils/audit');

// ── Génération du numéro patient unique ──────────────────────────────────────
async function genererNumeroPatient() {
  const annee = new Date().getFullYear();
  const { rows } = await pool.query(`SELECT nextval('patient_numero_seq') AS n`);
  const num = String(rows[0].n).padStart(5, '0');
  return `NIG-${annee}-${num}`;
}

// ── Vue HTMX : Liste des patients ────────────────────────────────────────────
router.get('/view', async (req, res) => {
  const { q = '' } = req.query;
  const { rows } = await pool.query(`
    SELECT id, numero_patient, nom, prenom, telephone
    FROM patients
    WHERE nom ILIKE $1 OR prenom ILIKE $1
    ORDER BY nom
    LIMIT 50
  `, [`%${q}%`]);

  const html = `
    <div class="patients-view">
      <h3>🧑‍⚕️ Dossier & Patients</h3>
      <input type="text"
             name="q"
             value="${q}"
             placeholder="Rechercher un patient..."
             hx-get="/api/patients/view"
             hx-trigger="keyup changed delay:300ms"
             hx-target="#patients"
             class="search-input">

      <table class="data-table">
        <thead>
          <tr><th>Numéro</th><th>Nom</th><th>Prénom</th><th>Téléphone</th></tr>
        </thead>
        <tbody>
          ${rows.map(p => `
            <tr>
              <td><strong>${p.numero_patient}</strong></td>
              <td>${p.nom}</td>
              <td>${p.prenom || '-'}</td>
              <td>${p.telephone || '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  res.send(html);
});

// ── GET /api/patients — Liste filtrée selon le périmètre (Phase 2.4) ─────────
router.get('/', auth(), async (req, res) => {
  try {
    const { q = '', sexe, region, csi_id, page = 1, limit = 30 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const conditions = [];
    const params = [];
    let pi = 1;

    // Périmètre strict selon le rôle
    if (req.user.role === 'agent') {
      conditions.push(`p.csi_inscription_id = $${pi++}`);
      params.push(req.user.csi_id);
    } else if (req.user.role === 'superviseur') {
      // Superviseur : restreint aux patients de sa région
      conditions.push(`(p.region_id = $${pi} OR p.csi_inscription_id IN (SELECT c.id FROM csi c JOIN communes co ON co.id = c.commune_id WHERE co.region_id = $${pi}))`);
      params.push(req.user.region_id);
      pi++;
    } else {
      // Admin national : filtres optionnels
      if (region) {
        conditions.push(`p.region_id = $${pi++}`);
        params.push(parseInt(region, 10));
      }
      if (csi_id) {
        conditions.push(`p.csi_inscription_id = $${pi++}`);
        params.push(parseInt(csi_id, 10));
      }
    }

    // Recherche textuelle
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

    if (sexe) {
      conditions.push(`p.sexe = $${pi++}`);
      params.push(sexe);
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

// ── GET /api/patients/stats — Statistiques filtrées selon périmètre (Phase 2.4) 
router.get('/stats', auth(), async (req, res) => {
  try {
    const { region } = req.query;
    const params = [];
    const conditions = [];

    if (req.user.role === 'agent') {
      params.push(req.user.csi_id);
      conditions.push(`p.csi_inscription_id = $${params.length}`);
    } else if (req.user.role === 'superviseur') {
      params.push(req.user.region_id);
      conditions.push(`(p.region_id = $${params.length} OR p.csi_inscription_id IN (SELECT c.id FROM csi c JOIN communes co ON co.id = c.commune_id WHERE co.region_id = $${params.length}))`);
    } else if (region) {
      params.push(parseInt(region, 10));
      conditions.push(`p.region_id = $${params.length}`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const { rows } = await pool.query(`
      SELECT
        COUNT(DISTINCT p.id)                    AS total_patients,
        COUNT(DISTINCT p.id) FILTER (WHERE p.sexe = 'F') AS femmes,
        COUNT(DISTINCT p.id) FILTER (WHERE p.sexe = 'M') AS hommes,
        COUNT(dc.id)                            AS total_visites,
        COUNT(DISTINCT dc.csi_id)               AS csi_actifs,
        (SELECT COUNT(*) FROM patients p2
         ${where ? where.replace(/p\./g, 'p2.') + ' AND' : 'WHERE'}
         DATE_PART('month', p2.cree_le) = DATE_PART('month', NOW())
         AND DATE_PART('year', p2.cree_le) = DATE_PART('year', NOW())) AS nouveaux_ce_mois
      FROM patients p
      LEFT JOIN dossiers_consultation dc ON dc.patient_id = p.id
      ${where}
    `, params);

    res.json(rows[0] || {});
  } catch (e) {
    console.error(e);
    res.status(500).json({ erreur: e.message, error: e.message });
  }
});

// ── GET /api/patients/:id — Fiche complète patient (Phase 2.4 & 2.9) ───────────
router.get('/:id', auth(), validateIdParam('id'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);

    const patRes = await pool.query(`
      SELECT
        p.*,
        r.nom AS region_nom,
        c.nom AS csi_inscription_nom,
        co.nom AS csi_commune,
        co.region_id AS csi_region_id,
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

    // Vérification du périmètre d'accès
    if (req.user.role === 'agent') {
      if (patient.csi_inscription_id !== req.user.csi_id) {
        return res.status(403).json({ erreur: 'Accès non autorisé à ce patient', error: 'Accès non autorisé' });
      }
    } else if (req.user.role === 'superviseur') {
      const isInRegion = (patient.region_id === req.user.region_id) || (patient.csi_region_id === req.user.region_id);
      if (!isInRegion) {
        return res.status(403).json({ erreur: 'Ce patient n\'appartient pas à votre région', error: 'Accès non autorisé' });
      }
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

    // CSI d'inscription imposé selon rôle
    let csi_inscription_id = null;
    let patRegionId = region_id || null;

    if (req.user.role === 'agent') {
      csi_inscription_id = req.user.csi_id;
    } else if (req.user.role === 'superviseur') {
      csi_inscription_id = req.body.csi_inscription_id || null;
      if (csi_inscription_id) {
        const allowed = await checkCsiScope(csi_inscription_id, req.user);
        if (!allowed) {
          return res.status(403).json({ erreur: 'Le CSI spécifié n\'appartient pas à votre région' });
        }
      }
      patRegionId = req.user.region_id;
    } else {
      csi_inscription_id = req.body.csi_inscription_id || null;
    }

    // Détection de doublons patients (Phase 4C) : même nom, prénom, date de naissance, téléphone
    if (!req.body.ignorer_doublon && nom && prenom && date_naissance && telephone) {
      const { rows: doublons } = await pool.query(`
        SELECT id, numero_patient, nom, prenom, date_naissance, telephone
        FROM patients
        WHERE LOWER(TRIM(nom)) = LOWER(TRIM($1))
          AND LOWER(TRIM(prenom)) = LOWER(TRIM($2))
          AND date_naissance = $3::date
          AND TRIM(telephone) = TRIM($4)
      `, [nom, prenom, date_naissance, telephone]);

      if (doublons.length > 0) {
        return res.status(409).json({
          doublon: true,
          erreur: `Doublon potentiel détecté : un patient (${doublons[0].numero_patient} - ${doublons[0].prenom} ${doublons[0].nom}) avec les mêmes coordonnées existe déjà.`,
          patient_existant: doublons[0]
        });
      }
    }

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
      commune_residence || null, patRegionId,
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

// ── PUT /api/patients/:id — Modifier un patient (Phase 2.4 & 2.9) ────────────
// "PUT ne doit modifier que les champs fournis"
router.put('/:id', auth(), validateIdParam('id'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);

    const { rows: existingRows } = await pool.query(`
      SELECT p.*, co.region_id AS csi_region_id
      FROM patients p
      LEFT JOIN csi c ON c.id = p.csi_inscription_id
      LEFT JOIN communes co ON co.id = c.commune_id
      WHERE p.id = $1
    `, [id]);

    if (!existingRows.length) return res.status(404).json({ erreur: 'Patient introuvable', error: 'Patient introuvable' });
    const patient = existingRows[0];

    // Vérification du périmètre
    if (req.user.role === 'agent') {
      if (patient.csi_inscription_id !== req.user.csi_id) {
        return res.status(403).json({ erreur: 'Accès non autorisé', error: 'Accès non autorisé' });
      }
    } else if (req.user.role === 'superviseur') {
      const isInRegion = (patient.region_id === req.user.region_id) || (patient.csi_region_id === req.user.region_id);
      if (!isInRegion) {
        return res.status(403).json({ erreur: 'Ce patient n\'appartient pas à votre région', error: 'Accès non autorisé' });
      }
    }

    // Construction dynamique : ne modifier que les champs expressément fournis
    const allowedFields = [
      'nom', 'prenom', 'sexe', 'date_naissance', 'lieu_naissance',
      'commune_residence', 'region_id', 'telephone', 'groupe_sanguin',
      'allergies', 'maladies_chroniques'
    ];

    const updates = [];
    const params = [];
    let pi = 1;

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${pi++}`);
        params.push(req.body[field]);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ erreur: 'Aucun champ à modifier fourni' });
    }

    updates.push(`modifie_le = NOW()`);
    params.push(id);

    const { rows } = await pool.query(`
      UPDATE patients
      SET ${updates.join(', ')}
      WHERE id = $${pi}
      RETURNING *
    `, params);

    await logAudit({
      utilisateur_id: req.user.id,
      action: 'UPDATE_PATIENT',
      table_cible: 'patients',
      enregistrement_id: id,
      details: { champs_modifies: Object.keys(req.body).filter(k => allowedFields.includes(k)) },
      ip_adresse: req.ip
    });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ erreur: e.message, error: e.message });
  }
});

// ── POST /api/patients/:id/visites — Consultation (Phase 2.4 & 2.9) ─────────
router.post('/:id/visites', auth(), validateIdParam('id'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const {
      motif, diagnostic, traitement, ordonnance,
      tension_arterielle, temperature, poids_kg,
      observations, statut = 'CONSULTE'
    } = req.body;

    if (!motif) return res.status(400).json({ erreur: 'Le motif est obligatoire', error: 'Le motif est obligatoire' });

    // Vérifier l'existence et l'accès au patient
    const { rows: patRows } = await pool.query(`
      SELECT p.*, co.region_id AS csi_region_id
      FROM patients p
      LEFT JOIN csi c ON c.id = p.csi_inscription_id
      LEFT JOIN communes co ON co.id = c.commune_id
      WHERE p.id = $1
    `, [id]);

    if (!patRows.length) return res.status(404).json({ erreur: 'Patient introuvable' });
    const patient = patRows[0];

    let csi_id;
    if (req.user.role === 'agent') {
      if (patient.csi_inscription_id !== req.user.csi_id) {
        return res.status(403).json({ erreur: 'Vous ne pouvez enregistrer des visites que pour les patients de votre CSI' });
      }
      csi_id = req.user.csi_id;
    } else if (req.user.role === 'superviseur') {
      const isInRegion = (patient.region_id === req.user.region_id) || (patient.csi_region_id === req.user.region_id);
      if (!isInRegion) {
        return res.status(403).json({ erreur: 'Ce patient n\'appartient pas à votre région' });
      }
      csi_id = req.body.csi_id || patient.csi_inscription_id;
      const allowed = await checkCsiScope(csi_id, req.user);
      if (!allowed) return res.status(403).json({ erreur: 'Le CSI de la consultation doit appartenir à votre région' });
    } else {
      csi_id = req.body.csi_id || patient.csi_inscription_id;
    }

    if (!csi_id) return res.status(400).json({ erreur: 'CSI manquant' });

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
