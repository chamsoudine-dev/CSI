/**
 * routes/maternite.js
 * Module Santé Maternelle & Néonatale :
 * - Registre des Naissances / Nouveaux-nés
 * - Consultations Prénatales (CPN)
 * - Consultations Postnatales (CPON)
 * - Statistiques de santé maternelle & infantile
 *
 * PHASE 2 :
 * - Périmètre strict (agent = son csi, superviseur = sa région forcée, admin = libre)
 * - Validation Joi sur POST naissances, cpn, cpon
 * - Validation des paramètres :id (entiers)
 */

const express = require('express');
const router  = express.Router();
const { pool } = require('../config/database');
const { auth } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const { checkCsiScope, validateIdParam } = require('../middleware/scope');
const logger  = require('../utils/logger');
const { logAudit } = require('../utils/audit');

// ─── 1. Statistiques Globales Santé Maternelle & Néonatale ──────────────────────
router.get('/stats', auth(), async (req, res) => {
  try {
    const mois = (req.query.mois || new Date().toISOString().slice(0, 7)).trim();
    const regionId = req.query.region ? parseInt(req.query.region, 10) : null;
    const csiId = req.query.csi_id ? parseInt(req.query.csi_id, 10) : null;

    let filterCsi = '';
    const params = [mois];

    // Périmètre strict selon le rôle
    if (req.user.role === 'agent') {
      params.push(req.user.csi_id);
      filterCsi = `AND c.id = $${params.length}`;
    } else if (req.user.role === 'superviseur') {
      params.push(req.user.region_id);
      filterCsi = `AND co.region_id = $${params.length}`;
    } else {
      // Admin
      if (csiId) {
        params.push(csiId);
        filterCsi = `AND c.id = $${params.length}`;
      } else if (regionId) {
        params.push(regionId);
        filterCsi = `AND co.region_id = $${params.length}`;
      }
    }

    // Statistiques Naissances
    const naissRes = await pool.query(`
      SELECT
        COUNT(*) AS total_naissances,
        COUNT(*) FILTER (WHERE n.etat_naissance = 'VIVANT')                          AS naissances_vivantes,
        COUNT(*) FILTER (WHERE n.etat_naissance IN ('MORT_NE_FRAIS','MORT_NE_MACERE')) AS mort_nes,
        COUNT(*) FILTER (WHERE n.sexe = 'M')                                         AS garcons,
        COUNT(*) FILTER (WHERE n.sexe = 'F')                                         AS filles,
        COUNT(*) FILTER (WHERE n.poids_grammes < 2500)                               AS faible_poids_naissance,
        COUNT(*) FILTER (WHERE n.type_accouchement = 'CESARIENNE')                   AS cesariennes,
        COUNT(*) FILTER (WHERE n.bcg_fait = TRUE)                                    AS vaccins_bcg_naissance
      FROM registre_naissances n
      JOIN csi      c  ON c.id  = n.csi_id
      JOIN communes co ON co.id = c.commune_id
      WHERE to_char(n.date_naissance, 'YYYY-MM') = $1
      ${filterCsi}
    `, params);

    // Statistiques CPN
    const cpnRes = await pool.query(`
      SELECT
        COUNT(*) AS total_cpn,
        COUNT(*) FILTER (WHERE cpn.type_cpn = 'CPN1')     AS cpn1,
        COUNT(*) FILTER (WHERE cpn.type_cpn = 'CPN2')     AS cpn2,
        COUNT(*) FILTER (WHERE cpn.type_cpn = 'CPN3')     AS cpn3,
        COUNT(*) FILTER (WHERE cpn.type_cpn = 'CPN4_PLUS') AS cpn4_plus,
        COUNT(*) FILTER (WHERE cpn.tpi_paludisme = TRUE)   AS tpi_paludisme_donne,
        COUNT(*) FILTER (WHERE cpn.grossesse_a_risque = TRUE) AS grossesses_a_risque
      FROM consultations_prenatales cpn
      JOIN csi      c  ON c.id  = cpn.csi_id
      JOIN communes co ON co.id = c.commune_id
      WHERE to_char(cpn.date_consultation, 'YYYY-MM') = $1
      ${filterCsi}
    `, params);

    // Statistiques CPON
    const cponRes = await pool.query(`
      SELECT
        COUNT(*) AS total_cpon,
        COUNT(*) FILTER (WHERE cpon.type_cpon = 'CPON1_24H')    AS cpon1_24h,
        COUNT(*) FILTER (WHERE cpon.type_cpon = 'CPON2_J6_J14') AS cpon2_j6_j14,
        COUNT(*) FILTER (WHERE cpon.type_cpon = 'CPON3_J42')    AS cpon3_j42,
        COUNT(*) FILTER (WHERE cpon.allaitement_exclusif = TRUE) AS allaitement_exclusif
      FROM consultations_postnatales cpon
      JOIN csi      c  ON c.id  = cpon.csi_id
      JOIN communes co ON co.id = c.commune_id
      WHERE to_char(cpon.date_consultation, 'YYYY-MM') = $1
      ${filterCsi}
    `, params);

    res.json({
      mois,
      naissances: naissRes.rows[0] || {},
      cpn:        cpnRes.rows[0]   || {},
      cpon:       cponRes.rows[0]  || {}
    });

  } catch (err) {
    logger.error({ err }, 'Erreur stats maternité');
    res.status(500).json({ erreur: 'Erreur serveur statistiques maternité' });
  }
});

// ─── 2. Naissances & Nouveaux-nés ─────────────────────────────────────────────
router.get('/naissances', auth(), async (req, res) => {
  try {
    const { csi_id, mois } = req.query;
    const limit = Math.min(100, parseInt(req.query.limit, 10) || 50);
    const conditions = [];
    const params = [];

    // Périmètre strict
    if (req.user.role === 'agent') {
      params.push(req.user.csi_id);
      conditions.push(`n.csi_id = $${params.length}`);
    } else if (req.user.role === 'superviseur') {
      params.push(req.user.region_id);
      conditions.push(`co.region_id = $${params.length}`);
      if (csi_id) {
        params.push(parseInt(csi_id, 10));
        conditions.push(`n.csi_id = $${params.length}`);
      }
    } else {
      if (csi_id) {
        params.push(parseInt(csi_id, 10));
        conditions.push(`n.csi_id = $${params.length}`);
      }
    }

    if (mois) {
      params.push(mois);
      conditions.push(`to_char(n.date_naissance, 'YYYY-MM') = $${params.length}`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    params.push(limit);
    const { rows } = await pool.query(`
      SELECT
        n.*,
        c.nom  AS csi_nom,
        co.nom AS csi_commune,
        r.nom  AS region_nom,
        u.nom  AS enregistre_par_nom
      FROM registre_naissances n
      JOIN csi      c  ON c.id  = n.csi_id
      JOIN communes co ON co.id = c.commune_id
      JOIN regions  r  ON r.id  = co.region_id
      LEFT JOIN utilisateurs u ON u.id = n.enregistre_par
      ${where}
      ORDER BY n.date_naissance DESC, n.heure_naissance DESC
      LIMIT $${params.length}
    `, params);

    res.json(rows);
  } catch (err) {
    logger.error({ err }, 'Erreur liste naissances');
    res.status(500).json({ erreur: 'Erreur serveur naissances' });
  }
});

router.post('/naissances', auth(), validate(schemas.naissanceSchema), async (req, res) => {
  try {
    const {
      nom_nouveau_ne, nom_mere, age_mere, sexe,
      date_naissance, heure_naissance, poids_grammes, taille_cm,
      etat_naissance, type_accouchement, bcg_fait, vpo0_fait, observations
    } = req.body;

    // 2.5 : csi_id forcé au csi_id de l'agent ; superviseur/admin seulement dans leur périmètre
    let targetCsiId;
    if (req.user.role === 'agent') {
      targetCsiId = req.user.csi_id;
    } else {
      targetCsiId = req.body.csi_id;
      const allowed = await checkCsiScope(targetCsiId, req.user);
      if (!allowed) {
        return res.status(403).json({ erreur: 'Accès non autorisé à ce CSI' });
      }
    }

    if (!targetCsiId) {
      return res.status(400).json({ erreur: 'CSI obligatoire' });
    }

    const { rows } = await pool.query(`
      INSERT INTO registre_naissances
        (csi_id, enregistre_par, nom_nouveau_ne, nom_mere, age_mere, sexe,
         date_naissance, heure_naissance, poids_grammes, taille_cm,
         etat_naissance, type_accouchement, bcg_fait, vpo0_fait, observations)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *
    `, [
      targetCsiId, req.user.id, nom_nouveau_ne || null, nom_mere, age_mere || null, sexe,
      date_naissance, heure_naissance || null, parseInt(poids_grammes, 10), taille_cm || null,
      etat_naissance || 'VIVANT', type_accouchement || 'EUTOCIQUE',
      bcg_fait !== false, vpo0_fait !== false, observations || null
    ]);

    await logAudit({
      utilisateur_id: req.user.id,
      action: 'ENREGISTREMENT_NAISSANCE',
      table_cible: 'registre_naissances',
      enregistrement_id: rows[0].id,
      details: { csi_id: targetCsiId, sexe, poids: poids_grammes, etat: etat_naissance },
      ip_adresse: req.ip
    });

    res.status(201).json({ message: 'Naissance enregistrée avec succès', naissance: rows[0] });

  } catch (err) {
    logger.error({ err }, 'Erreur création naissance');
    res.status(500).json({ erreur: err.message || 'Erreur serveur' });
  }
});

// ─── 3. Consultations Prénatales (CPN) ─────────────────────────────────────────
router.get('/cpn', auth(), async (req, res) => {
  try {
    const { csi_id, mois } = req.query;
    const limit = Math.min(100, parseInt(req.query.limit, 10) || 50);
    const conditions = [];
    const params = [];

    // Périmètre strict
    if (req.user.role === 'agent') {
      params.push(req.user.csi_id);
      conditions.push(`cpn.csi_id = $${params.length}`);
    } else if (req.user.role === 'superviseur') {
      params.push(req.user.region_id);
      conditions.push(`co.region_id = $${params.length}`);
      if (csi_id) {
        params.push(parseInt(csi_id, 10));
        conditions.push(`cpn.csi_id = $${params.length}`);
      }
    } else {
      if (csi_id) {
        params.push(parseInt(csi_id, 10));
        conditions.push(`cpn.csi_id = $${params.length}`);
      }
    }

    if (mois) {
      params.push(mois);
      conditions.push(`to_char(cpn.date_consultation, 'YYYY-MM') = $${params.length}`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    params.push(limit);
    const { rows } = await pool.query(`
      SELECT
        cpn.*,
        c.nom  AS csi_nom,
        co.nom AS csi_commune,
        r.nom  AS region_nom,
        u.nom  AS enregistre_par_nom
      FROM consultations_prenatales cpn
      JOIN csi      c  ON c.id  = cpn.csi_id
      JOIN communes co ON co.id = c.commune_id
      JOIN regions  r  ON r.id  = co.region_id
      LEFT JOIN utilisateurs u ON u.id = cpn.enregistre_par
      ${where}
      ORDER BY cpn.date_consultation DESC
      LIMIT $${params.length}
    `, params);

    res.json(rows);
  } catch (err) {
    logger.error({ err }, 'Erreur liste CPN');
    res.status(500).json({ erreur: 'Erreur serveur CPN' });
  }
});

router.post('/cpn', auth(), validate(schemas.cpnSchema), async (req, res) => {
  try {
    const {
      nom_femme, age, date_consultation, type_cpn, terme_semaines,
      tpi_paludisme, vat_tetanos, fer_acide_folique, tension_arterielle,
      grossesse_a_risque, motif_risque, observations
    } = req.body;

    // 2.5 : csi_id forcé au csi_id de l'agent ; superviseur/admin selon périmètre
    let targetCsiId;
    if (req.user.role === 'agent') {
      targetCsiId = req.user.csi_id;
    } else {
      targetCsiId = req.body.csi_id;
      const allowed = await checkCsiScope(targetCsiId, req.user);
      if (!allowed) {
        return res.status(403).json({ erreur: 'Accès non autorisé à ce CSI' });
      }
    }

    if (!targetCsiId) {
      return res.status(400).json({ erreur: 'CSI requis' });
    }

    const { rows } = await pool.query(`
      INSERT INTO consultations_prenatales
        (csi_id, enregistre_par, nom_femme, age, date_consultation, type_cpn, terme_semaines,
         tpi_paludisme, vat_tetanos, fer_acide_folique, tension_arterielle,
         grossesse_a_risque, motif_risque, observations)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *
    `, [
      targetCsiId, req.user.id, nom_femme, age || null, date_consultation, type_cpn,
      terme_semaines || null, tpi_paludisme === true, vat_tetanos === true,
      fer_acide_folique !== false, tension_arterielle || null,
      grossesse_a_risque === true, motif_risque || null, observations || null
    ]);

    await logAudit({
      utilisateur_id: req.user.id,
      action: 'CREATE_CPN',
      table_cible: 'consultations_prenatales',
      enregistrement_id: rows[0].id,
      details: { csi_id: targetCsiId, type_cpn },
      ip_adresse: req.ip
    });

    res.status(201).json({ message: 'Consultation prénatale enregistrée avec succès', cpn: rows[0] });

  } catch (err) {
    logger.error({ err }, 'Erreur enregistrement CPN');
    res.status(500).json({ erreur: err.message || 'Erreur serveur' });
  }
});

// ─── 4. Consultations Postnatales (CPON) ────────────────────────────────────────
router.get('/cpon', auth(), async (req, res) => {
  try {
    const { csi_id, mois } = req.query;
    const limit = Math.min(100, parseInt(req.query.limit, 10) || 50);
    const conditions = [];
    const params = [];

    // Périmètre strict
    if (req.user.role === 'agent') {
      params.push(req.user.csi_id);
      conditions.push(`cpon.csi_id = $${params.length}`);
    } else if (req.user.role === 'superviseur') {
      params.push(req.user.region_id);
      conditions.push(`co.region_id = $${params.length}`);
      if (csi_id) {
        params.push(parseInt(csi_id, 10));
        conditions.push(`cpon.csi_id = $${params.length}`);
      }
    } else {
      if (csi_id) {
        params.push(parseInt(csi_id, 10));
        conditions.push(`cpon.csi_id = $${params.length}`);
      }
    }

    if (mois) {
      params.push(mois);
      conditions.push(`to_char(cpon.date_consultation, 'YYYY-MM') = $${params.length}`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    params.push(limit);
    const { rows } = await pool.query(`
      SELECT
        cpon.*,
        c.nom  AS csi_nom,
        co.nom AS csi_commune,
        r.nom  AS region_nom,
        u.nom  AS enregistre_par_nom
      FROM consultations_postnatales cpon
      JOIN csi      c  ON c.id  = cpon.csi_id
      JOIN communes co ON co.id = c.commune_id
      JOIN regions  r  ON r.id  = co.region_id
      LEFT JOIN utilisateurs u ON u.id = cpon.enregistre_par
      ${where}
      ORDER BY cpon.date_consultation DESC
      LIMIT $${params.length}
    `, params);

    res.json(rows);
  } catch (err) {
    logger.error({ err }, 'Erreur liste CPON');
    res.status(500).json({ erreur: 'Erreur serveur CPON' });
  }
});

router.post('/cpon', auth(), validate(schemas.cponSchema), async (req, res) => {
  try {
    const {
      nom_femme, date_consultation, type_cpon,
      etat_mere, etat_bebe, allaitement_exclusif, contraception_postpartum,
      complications, observations
    } = req.body;

    // 2.5 : csi_id forcé au csi_id de l'agent ; superviseur/admin selon périmètre
    let targetCsiId;
    if (req.user.role === 'agent') {
      targetCsiId = req.user.csi_id;
    } else {
      targetCsiId = req.body.csi_id;
      const allowed = await checkCsiScope(targetCsiId, req.user);
      if (!allowed) {
        return res.status(403).json({ erreur: 'Accès non autorisé à ce CSI' });
      }
    }

    if (!targetCsiId) {
      return res.status(400).json({ erreur: 'CSI requis' });
    }

    const { rows } = await pool.query(`
      INSERT INTO consultations_postnatales
        (csi_id, enregistre_par, nom_femme, date_consultation, type_cpon,
         etat_mere, etat_bebe, allaitement_exclusif, contraception_postpartum,
         complications, observations)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `, [
      targetCsiId, req.user.id, nom_femme, date_consultation, type_cpon,
      etat_mere || 'BON', etat_bebe || 'BON', allaitement_exclusif !== false,
      contraception_postpartum === true, complications || null, observations || null
    ]);

    await logAudit({
      utilisateur_id: req.user.id,
      action: 'CREATE_CPON',
      table_cible: 'consultations_postnatales',
      enregistrement_id: rows[0].id,
      details: { csi_id: targetCsiId, type_cpon },
      ip_adresse: req.ip
    });

    res.status(201).json({ message: 'Consultation postnatale enregistrée avec succès', cpon: rows[0] });

  } catch (err) {
    logger.error({ err }, 'Erreur enregistrement CPON');
    res.status(500).json({ erreur: err.message || 'Erreur serveur' });
  }
});

module.exports = router;
