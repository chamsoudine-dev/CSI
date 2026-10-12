/**
 * routes/ravitaillement.js
 * Gestion des demandes de ravitaillement, alertes ruptures et approbation hiérarchique
 *
 * PHASE 2 :
 * - Périmètre strict & validation Joi
 * - Machine d'états stricte des commandes (409 sur transition invalide)
 * - Rôle agent (LIVRE uniquement sur EXPEDIE de son CSI)
 * - Rôle superviseur (EN_REVUE, APPROUVE, EXPEDIE, REJETE de sa région)
 * - Génération du numéro de commande sans doublon via séquence PostgreSQL
 * - Validation des paramètres :id (entiers positifs)
 */

const express = require('express');
const router  = express.Router();
const { pool, withTransaction } = require('../config/database');
const { auth } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const { checkCsiScope, validateIdParam } = require('../middleware/scope');
const logger  = require('../utils/logger');
const { logAudit } = require('../utils/audit');

// Matrice des transitions valides
const TRANSITIONS_VALIDES = {
  'DEMANDE': ['EN_REVUE', 'APPROUVE', 'REJETE'],
  'EN_REVUE': ['APPROUVE', 'REJETE'],
  'APPROUVE': ['EXPEDIE'],
  'EXPEDIE': ['LIVRE'],
  'LIVRE': [],
  'REJETE': []
};

/**
 * GET /api/ravitaillement
 * Liste des demandes de ravitaillement filtrée selon le périmètre strict
 */
router.get('/', auth(), async (req, res) => {
  try {
    const { statut, csi_id, region_id, priorite } = req.query;
    const conditions = [];
    const params     = [];

    // Périmètre strict selon le rôle
    if (req.user.role === 'agent') {
      params.push(req.user.csi_id);
      conditions.push(`d.csi_id = $${params.length}`);
    } else if (req.user.role === 'superviseur') {
      params.push(req.user.region_id);
      conditions.push(`co.region_id = $${params.length}`);
      if (csi_id) {
        params.push(parseInt(csi_id, 10));
        conditions.push(`d.csi_id = $${params.length}`);
      }
    } else {
      // Admin national
      if (csi_id) {
        params.push(parseInt(csi_id, 10));
        conditions.push(`d.csi_id = $${params.length}`);
      }
      if (region_id) {
        params.push(parseInt(region_id, 10));
        conditions.push(`co.region_id = $${params.length}`);
      }
    }

    if (statut) {
      params.push(statut);
      conditions.push(`d.statut = $${params.length}`);
    }

    if (priorite) {
      params.push(priorite);
      conditions.push(`d.priorite = $${params.length}`);
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const query = `
      SELECT
        d.id,
        d.numero_commande,
        d.csi_id,
        c.nom      AS csi_nom,
        co.nom     AS csi_commune,
        r.nom      AS region_nom,
        d.demandeur_id,
        u_dem.nom  AS demandeur_nom,
        d.statut,
        d.priorite,
        d.motif,
        d.reponse_notes,
        d.traite_par,
        u_traite.nom AS traite_par_nom,
        d.date_demande,
        d.date_traitement,
        d.date_livraison,
        COUNT(l.id)                    AS nb_produits,
        SUM(l.quantite_demandee)       AS total_quantite_demandee,
        SUM(l.quantite_accordee)       AS total_quantite_accordee
      FROM demandes_ravitaillement d
      JOIN csi       c  ON c.id  = d.csi_id
      JOIN communes  co ON co.id = c.commune_id
      JOIN regions   r  ON r.id  = co.region_id
      LEFT JOIN utilisateurs u_dem    ON u_dem.id    = d.demandeur_id
      LEFT JOIN utilisateurs u_traite ON u_traite.id = d.traite_par
      LEFT JOIN demande_lignes l ON l.demande_id = d.id
      ${where}
      GROUP BY
        d.id, c.nom, co.nom, r.nom,
        u_dem.nom, u_traite.nom
      ORDER BY d.date_demande DESC
    `;

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    logger.error({ err }, 'Erreur liste ravitaillement');
    res.status(500).json({ erreur: 'Erreur serveur ravitaillement' });
  }
});

/**
 * GET /api/ravitaillement/stats
 * Indicateurs des alertes et commandes selon le périmètre strict
 */
router.get('/stats', auth(), async (req, res) => {
  try {
    const params = [];
    let filterRegion = '';

    if (req.user.role === 'agent') {
      params.push(req.user.csi_id);
      filterRegion = `AND d.csi_id = $${params.length}`;
    } else if (req.user.role === 'superviseur') {
      params.push(parseInt(req.user.region_id, 10));
      filterRegion = `AND co.region_id = $${params.length}`;
    }

    const { rows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE d.statut = 'DEMANDE')                                          AS en_attente,
        COUNT(*) FILTER (WHERE d.statut = 'APPROUVE')                                         AS approuvees,
        COUNT(*) FILTER (WHERE d.statut = 'EXPEDIE')                                          AS en_transit,
        COUNT(*) FILTER (WHERE d.priorite = 'CRITIQUE_RUPTURE'
                           AND d.statut IN ('DEMANDE', 'EN_REVUE'))                           AS ruptures_critiques,
        COUNT(*) FILTER (WHERE d.statut = 'LIVRE')                                            AS livrees
      FROM demandes_ravitaillement d
      JOIN csi      c  ON c.id  = d.csi_id
      JOIN communes co ON co.id = c.commune_id
      WHERE 1=1 ${filterRegion}
    `, params);

    res.json(rows[0] || {});
  } catch (err) {
    logger.error({ err }, 'Erreur stats ravitaillement');
    res.status(500).json({ erreur: 'Erreur serveur stats' });
  }
});

/**
 * GET /api/ravitaillement/:id
 * Détail d'une demande avec contrôle strict du périmètre
 */
router.get('/:id', auth(), validateIdParam('id'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const enteteRes = await pool.query(`
      SELECT
        d.*,
        c.nom      AS csi_nom,
        co.nom     AS csi_commune,
        co.region_id AS csi_region_id,
        r.nom      AS region_nom,
        u_dem.nom   AS demandeur_nom,
        u_traite.nom AS traite_par_nom
      FROM demandes_ravitaillement d
      JOIN csi      c  ON c.id  = d.csi_id
      JOIN communes co ON co.id = c.commune_id
      JOIN regions  r  ON r.id  = co.region_id
      LEFT JOIN utilisateurs u_dem    ON u_dem.id    = d.demandeur_id
      LEFT JOIN utilisateurs u_traite ON u_traite.id = d.traite_par
      WHERE d.id = $1
    `, [id]);

    if (!enteteRes.rows.length) {
      return res.status(404).json({ erreur: 'Demande non trouvée' });
    }

    const demande = enteteRes.rows[0];

    // Vérification de périmètre
    if (req.user.role === 'agent' && demande.csi_id !== req.user.csi_id) {
      return res.status(403).json({ erreur: 'Accès non autorisé à cette commande' });
    }
    if (req.user.role === 'superviseur' && demande.csi_region_id !== req.user.region_id) {
      return res.status(403).json({ erreur: 'Cette commande n\'appartient pas à votre région' });
    }

    const lignesRes = await pool.query(`
      SELECT
        l.id AS ligne_id,
        l.medicament_id,
        l.quantite_demandee,
        l.stock_actuel_csi,
        l.quantite_accordee,
        l.notes,
        m.nom_commercial,
        m.forme,
        m.dosage,
        m.classe,
        s.dci,
        s.code_atc
      FROM demande_lignes l
      JOIN catalogue_medicaments m ON m.id = l.medicament_id
      JOIN catalogue_substances  s ON s.id = m.substance_id
      WHERE l.demande_id = $1
      ORDER BY s.dci, m.dosage
    `, [id]);

    demande.lignes = lignesRes.rows;
    res.json(demande);

  } catch (err) {
    logger.error({ err }, 'Erreur détail ravitaillement');
    res.status(500).json({ erreur: 'Erreur serveur ravitaillement' });
  }
});

/**
 * POST /api/ravitaillement
 * Créer une nouvelle demande de ravitaillement avec validation Joi et séquence PostgreSQL
 */
router.post('/', auth(), validate(schemas.ravitaillementSchema), async (req, res) => {
  try {
    const { csi_id, priorite, motif, lignes } = req.body;

    // Déterminer et valider le CSI cible
    let targetCsiId;
    if (req.user.role === 'agent') {
      targetCsiId = req.user.csi_id;
    } else {
      targetCsiId = csi_id;
      const allowed = await checkCsiScope(targetCsiId, req.user);
      if (!allowed) {
        return res.status(403).json({ erreur: 'Accès non autorisé à ce CSI' });
      }
    }

    if (!targetCsiId) {
      return res.status(400).json({ erreur: 'CSI obligatoire' });
    }

    const result = await withTransaction(async (client) => {
      // 2.7 Séquence PostgreSQL pour numéro de commande sans doublon
      const year = new Date().getFullYear();
      await client.query(`CREATE SEQUENCE IF NOT EXISTS commande_numero_seq START 1`);
      const seqRes = await client.query(`SELECT nextval('commande_numero_seq') AS n`);
      const numCmd = `CMD-${year}-${String(seqRes.rows[0].n).padStart(4, '0')}`;

      const pVal = ['NORMALE', 'URGENTE', 'CRITIQUE_RUPTURE'].includes(priorite) ? priorite : 'NORMALE';

      const demRes = await client.query(`
        INSERT INTO demandes_ravitaillement
          (numero_commande, csi_id, demandeur_id, statut, priorite, motif)
        VALUES ($1, $2, $3, 'DEMANDE', $4, $5)
        RETURNING id, numero_commande
      `, [numCmd, targetCsiId, req.user.id, pVal, motif || 'Réapprovisionnement périodique']);

      const demId = demRes.rows[0].id;

      for (const item of lignes) {
        if (!item.medicament_id || !item.quantite_demandee) continue;
        await client.query(`
          INSERT INTO demande_lignes
            (demande_id, medicament_id, quantite_demandee, stock_actuel_csi, quantite_accordee, notes)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          demId,
          item.medicament_id,
          Math.max(1, parseInt(item.quantite_demandee, 10)),
          Math.max(0, parseInt(item.stock_actuel_csi || '0', 10)),
          0,
          item.notes || null
        ]);
      }

      await logAudit({
        utilisateur_id: req.user.id,
        action: 'CREATE_COMMANDE_RAVITAILLEMENT',
        table_cible: 'demandes_ravitaillement',
        enregistrement_id: demId,
        details: { numero_commande: numCmd, csi_id: targetCsiId, nb_lignes: lignes.length, priorite: pVal },
        ip_adresse: req.ip,
        client
      });

      return demRes.rows[0];
    });

    res.status(201).json({ message: 'Demande de ravitaillement transmise avec succès', commande: result });

  } catch (err) {
    logger.error({ err }, 'Erreur création ravitaillement');
    res.status(500).json({ erreur: err.message || 'Erreur serveur ravitaillement' });
  }
});

/**
 * PUT /api/ravitaillement/:id/statut
 * Machine d'états stricte des commandes (Phase 2.7)
 * DEMANDE → EN_REVUE → APPROUVE → EXPEDIE → LIVRE ; REJETE depuis DEMANDE/EN_REVUE
 */
router.put('/:id/statut', auth(), validateIdParam('id'), validate(schemas.ravitaillementStatutSchema), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { statut: nouveauStatut, reponse_notes, lignes_accorde } = req.body;

    const { rows: cmdRows } = await pool.query(`
      SELECT d.*, co.region_id AS csi_region_id
      FROM demandes_ravitaillement d
      JOIN csi c ON c.id = d.csi_id
      JOIN communes co ON co.id = c.commune_id
      WHERE d.id = $1
    `, [id]);

    if (!cmdRows.length) {
      return res.status(404).json({ erreur: 'Commande non trouvée' });
    }

    const commande = cmdRows[0];
    const statutActuel = commande.statut;

    // 1. Contrôle de validité de la transition dans la machine d'états
    const transitionsPermises = TRANSITIONS_VALIDES[statutActuel] || [];
    if (!transitionsPermises.includes(nouveauStatut)) {
      return res.status(409).json({
        erreur: `Transition de statut invalide : impossible de passer de '${statutActuel}' à '${nouveauStatut}'`
      });
    }

    // 2. Contrôle des droits selon les rôles
    if (req.user.role === 'agent') {
      // Un agent ne peut passer QUE 'LIVRE' sur une commande 'EXPEDIE' de son propre CSI
      if (nouveauStatut !== 'LIVRE') {
        return res.status(403).json({
          erreur: 'Un agent peut seulement confirmer la réception (statut LIVRE) d\'une commande.'
        });
      }
      if (commande.csi_id !== req.user.csi_id) {
        return res.status(403).json({
          erreur: 'Vous ne pouvez réceptionner que les commandes destinées à votre propre CSI.'
        });
      }
    } else if (req.user.role === 'superviseur') {
      // Un superviseur ne gère que les commandes de sa région
      if (commande.csi_region_id !== req.user.region_id) {
        return res.status(403).json({
          erreur: 'Cette commande n\'appartient pas à votre région d\'affectation.'
        });
      }
      if (!['EN_REVUE', 'APPROUVE', 'EXPEDIE', 'REJETE'].includes(nouveauStatut)) {
        return res.status(403).json({
          erreur: 'Action non autorisée pour votre rôle sur cette commande.'
        });
      }
    }

    await withTransaction(async (client) => {
      let dateField = '';
      if (nouveauStatut === 'APPROUVE' || nouveauStatut === 'EXPEDIE') dateField = ', date_traitement = NOW()';
      if (nouveauStatut === 'LIVRE') dateField = ', date_livraison = NOW()';

      await client.query(`
        UPDATE demandes_ravitaillement
        SET statut        = $1,
            reponse_notes = COALESCE($2, reponse_notes),
            traite_par    = $3,
            modifie_le    = NOW()
            ${dateField}
        WHERE id = $4
      `, [nouveauStatut, reponse_notes || null, req.user.id, id]);

      if (lignes_accorde && Array.isArray(lignes_accorde)) {
        for (const l of lignes_accorde) {
          if (!l.ligne_id) continue;
          await client.query(`
            UPDATE demande_lignes
            SET quantite_accordee = $1
            WHERE id = $2 AND demande_id = $3
          `, [Math.max(0, parseInt(l.quantite_accordee, 10)), l.ligne_id, id]);
        }
      }

      await logAudit({
        utilisateur_id: req.user.id,
        action: 'UPDATE_STATUT_RAVITAILLEMENT',
        table_cible: 'demandes_ravitaillement',
        enregistrement_id: id,
        details: { ancien_statut: statutActuel, nouveau_statut: nouveauStatut, reponse_notes },
        ip_adresse: req.ip,
        client
      });
    });

    res.json({ message: `Commande mise à jour avec succès avec le statut : ${nouveauStatut}` });

  } catch (err) {
    logger.error({ err }, 'Erreur mise à jour statut ravitaillement');
    res.status(500).json({ erreur: err.message || 'Erreur serveur' });
  }
});

module.exports = router;
