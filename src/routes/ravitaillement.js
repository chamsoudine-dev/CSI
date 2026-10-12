/**
 * routes/ravitaillement.js
 * Gestion des demandes de ravitaillement, alertes ruptures et approbation hiérarchique
 *
 * PHASE 1 (bugs bloquants) :
 *  - Corrigé : jointures SQL — csi n'a pas region_id ni commune ;
 *    on passe désormais par JOIN communes co ON co.id = c.commune_id
 *  - Corrigé : ip: req.ip → ip_adresse: req.ip dans logAudit
 *  - Corrigé : injection SQL dans /stats → paramètre $n
 */

const express = require('express');
const router  = express.Router();
const { pool, withTransaction } = require('../config/database');
const { auth, checkCsiAccess } = require('../middleware/auth');
const logger  = require('../utils/logger');
const { logAudit } = require('../utils/audit');

/**
 * GET /api/ravitaillement
 * Liste des demandes de ravitaillement (filtrable par statut, CSI, région)
 */
router.get('/', auth(), async (req, res) => {
  try {
    const { statut, csi_id, region_id, priorite } = req.query;
    const conditions = [];
    const params     = [];

    // Si agent : seulement les demandes de son CSI
    if (req.user.role === 'agent' && req.user.csi_id) {
      params.push(req.user.csi_id);
      conditions.push(`d.csi_id = $${params.length}`);
    } else if (csi_id) {
      params.push(csi_id);
      conditions.push(`d.csi_id = $${params.length}`);
    }

    // Si superviseur lié à une région — utilise co.region_id via la jointure communes
    if (req.user.role === 'superviseur' && req.user.region_id) {
      params.push(req.user.region_id);
      conditions.push(`co.region_id = $${params.length}`);
    } else if (region_id) {
      params.push(region_id);
      conditions.push(`co.region_id = $${params.length}`);
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
 * Indicateurs des alertes de rupture et commandes
 * PHASE 1 : injection SQL corrigée → paramètre $n
 */
router.get('/stats', auth(), async (req, res) => {
  try {
    const params = [];
    let filterRegion = '';

    if (req.user.role === 'superviseur' && req.user.region_id) {
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
 * Détail d'une demande avec la liste des médicaments commandés
 * PHASE 1 : jointures corrigées (commune, region via communes)
 */
router.get('/:id', auth(), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const enteteRes = await pool.query(`
      SELECT
        d.*,
        c.nom      AS csi_nom,
        co.nom     AS csi_commune,
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
 * Créer une nouvelle demande de ravitaillement (Agent ou Responsable)
 * PHASE 1 : ip_adresse corrigé dans logAudit
 */
router.post('/', auth(), async (req, res) => {
  try {
    const { csi_id, priorite, motif, lignes } = req.body;

    if (!csi_id || !lignes || !Array.isArray(lignes) || !lignes.length) {
      return res.status(400).json({ erreur: 'CSI et liste de médicaments obligatoires' });
    }

    // Vérifier l'accès CSI
    if (req.user.role === 'agent' && req.user.csi_id && req.user.csi_id !== parseInt(csi_id, 10)) {
      return res.status(403).json({ erreur: 'Vous ne pouvez commander que pour votre propre CSI.' });
    }

    const result = await withTransaction(async (client) => {
      // Générer le numéro de commande (count-based, Phase 2.7 utilisera une séquence)
      const year = new Date().getFullYear();
      const countRes = await client.query(
        `SELECT count(*) FROM demandes_ravitaillement WHERE date_demande >= date_trunc('year', now())`
      );
      const nextNum = parseInt(countRes.rows[0].count, 10) + 1;
      const numCmd = `CMD-${year}-${String(nextNum).padStart(4, '0')}`;

      const pVal = ['NORMALE', 'URGENTE', 'CRITIQUE_RUPTURE'].includes(priorite) ? priorite : 'NORMALE';

      const demRes = await client.query(`
        INSERT INTO demandes_ravitaillement
          (numero_commande, csi_id, demandeur_id, statut, priorite, motif)
        VALUES ($1, $2, $3, 'DEMANDE', $4, $5)
        RETURNING id, numero_commande
      `, [numCmd, csi_id, req.user.id, pVal, motif || 'Réapprovisionnement périodique']);

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

      // PHASE 1 : ip: → ip_adresse:
      await logAudit({
        utilisateur_id: req.user.id,
        action: 'CREATE_COMMANDE_RAVITAILLEMENT',
        table_cible: 'demandes_ravitaillement',
        enregistrement_id: demId,
        details: { numero_commande: numCmd, csi_id, nb_lignes: lignes.length, priorite: pVal },
        ip_adresse: req.ip
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
 * Traiter / Approuver / Expédier / Réceptionner la commande
 * PHASE 1 : ip_adresse corrigé dans logAudit
 */
router.put('/:id/statut', auth(['admin', 'superviseur', 'agent']), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { statut, reponse_notes, lignes_accorde } = req.body;

    const validStatuts = ['DEMANDE', 'EN_REVUE', 'APPROUVE', 'EXPEDIE', 'LIVRE', 'REJETE'];
    if (!validStatuts.includes(statut)) {
      return res.status(400).json({ erreur: 'Statut de commande invalide' });
    }

    // Seuls admins et superviseurs peuvent approuver ou rejeter
    if (['APPROUVE', 'EXPEDIE', 'REJETE'].includes(statut) && req.user.role === 'agent') {
      return res.status(403).json({ erreur: 'Seuls les superviseurs et administrateurs peuvent valider ou expédier les commandes.' });
    }

    await withTransaction(async (client) => {
      let dateField = '';
      if (statut === 'APPROUVE' || statut === 'EXPEDIE') dateField = ', date_traitement = NOW()';
      if (statut === 'LIVRE') dateField = ', date_livraison = NOW()';

      await client.query(`
        UPDATE demandes_ravitaillement
        SET statut        = $1,
            reponse_notes = COALESCE($2, reponse_notes),
            traite_par    = $3,
            modifie_le    = NOW()
            ${dateField}
        WHERE id = $4
      `, [statut, reponse_notes || null, req.user.id, id]);

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

      // PHASE 1 : ip: → ip_adresse:
      await logAudit({
        utilisateur_id: req.user.id,
        action: 'UPDATE_STATUT_RAVITAILLEMENT',
        table_cible: 'demandes_ravitaillement',
        enregistrement_id: id,
        details: { nouveau_statut: statut, reponse_notes },
        ip_adresse: req.ip
      });
    });

    res.json({ message: `Commande mise à jour avec le statut : ${statut}` });

  } catch (err) {
    logger.error({ err }, 'Erreur mise à jour statut ravitaillement');
    res.status(500).json({ erreur: err.message || 'Erreur serveur' });
  }
});

module.exports = router;
