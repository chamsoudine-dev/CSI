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

// ── Vue HTMX : Ravitaillement ──
router.get('/view', auth(), async (req, res) => {
  try {
    const { statut, priorite } = req.query;
    const conditions = [];
    const params = [];

    if (req.user.role === 'agent') {
      params.push(req.user.csi_id);
      conditions.push(`d.csi_id = $${params.length}`);
    } else if (req.user.role === 'superviseur') {
      params.push(req.user.region_id);
      conditions.push(`co.region_id = $${params.length}`);
    }

    if (statut) { params.push(statut); conditions.push(`d.statut = $${params.length}`); }
    if (priorite) { params.push(priorite); conditions.push(`d.priorite = $${params.length}`); }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const { rows } = await pool.query(`
      SELECT d.id, d.numero_commande, d.csi_id, c.nom AS csi_nom, co.nom AS csi_commune, r.nom AS region_nom,
             d.statut, d.priorite, d.motif, d.reponse_notes, d.date_demande,
             COUNT(l.id) AS nb_produits, SUM(l.quantite_demandee) AS total_demande, SUM(l.quantite_accordee) AS total_accorde
      FROM demandes_ravitaillement d
      JOIN csi c ON c.id = d.csi_id
      JOIN communes co ON co.id = c.commune_id
      JOIN regions r ON r.id = co.region_id
      LEFT JOIN demande_lignes l ON l.demande_id = d.id
      ${where}
      GROUP BY d.id, c.nom, co.nom, r.nom
      ORDER BY d.date_demande DESC
      LIMIT 50
    `, params);

    const html = `
      <div class="ravitaillement-view">
        <h3>🚚 Ravitaillement & Stocks / Aiki da Kayan</h3>
        <div class="filters" style="margin-bottom:16px; display:flex; gap:12px; flex-wrap:wrap;">
          <select name="statut" hx-get="/api/ravitaillement/view" hx-target="#ravitaillement" hx-trigger="change" class="form-select">
            <option value="">Tous statuts</option>
            <option value="DEMANDE" ${statut==='DEMANDE'?'selected':''}>📝 Demande</option>
            <option value="EN_REVUE" ${statut==='EN_REVUE'?'selected':''}>👁️ En revue</option>
            <option value="APPROUVE" ${statut==='APPROUVE'?'selected':''}>✅ Approuvé</option>
            <option value="EXPEDIE" ${statut==='EXPEDIE'?'selected':''}>🚚 Expédié</option>
            <option value="LIVRE" ${statut==='LIVRE'?'selected':''}>📦 Livré</option>
            <option value="REJETE" ${statut==='REJETE'?'selected':''}>❌ Rejeté</option>
          </select>
          <select name="priorite" hx-get="/api/ravitaillement/view" hx-target="#ravitaillement" hx-trigger="change" class="form-select">
            <option value="">Toutes priorités</option>
            <option value="NORMALE" ${priorite==='NORMALE'?'selected':''}>🟢 Normale</option>
            <option value="URGENTE" ${priorite==='URGENTE'?'selected':''}>🟠 Urgente</option>
            <option value="CRITIQUE_RUPTURE" ${priorite==='CRITIQUE_RUPTURE'?'selected':''}>🔴 Rupture critique</option>
          </select>
          <button class="btn btn-primary" hx-get="/api/ravitaillement/create-view" hx-target="#ravitaillement-create">➕ Nouvelle demande</button>
        </div>
        <div id="ravitaillement-create"></div>

        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr><th>N° Commande</th><th>CSI</th><th>Région</th><th>Statut</th><th>Priorité</th><th>Produits</th><th>Demandé</th><th>Accordé</th><th>Date</th><th>Actions</th></tr>
            </thead>
            <tbody>
              ${rows.map(d => `
                <tr>
                  <td><strong>${d.numero_commande}</strong></td>
                  <td>${d.csi_nom}</td>
                  <td>${d.region_nom}</td>
                  <td><span class="badge status-${d.statut.toLowerCase()}">${d.statut}</span></td>
                  <td><span class="badge prio-${d.priorite.toLowerCase()}">${d.priorite}</span></td>
                  <td>${d.nb_produits}</td>
                  <td>${d.total_demande || 0}</td>
                  <td>${d.total_accorde || 0}</td>
                  <td>${new Date(d.date_demande).toLocaleDateString()}</td>
                  <td>
                    <button class="btn btn-sm btn-secondary" hx-get="/api/ravitaillement/${d.id}/view" hx-target="#rav-detail-${d.id}">Voir</button>
                    <div id="rav-detail-${d.id}"></div>
                  </td>
                </tr>
              `).join('') || '<tr><td colspan="10" class="text-center">Aucune demande</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
      <style>
        .filters { display:flex; gap:12px; flex-wrap:wrap; align-items:center; margin-bottom:16px; }
        .form-select { padding:8px 12px; border:1px solid var(--border); border-radius:6px; background:var(--bg); color:var(--text); }
        .badge.status-demande { background:#e3f2fd; color:#1565c0; }
        .badge.status-en_revue { background:#fff3e0; color:#ef6c00; }
        .badge.status-approuve { background:#e8f5e9; color:#2e7d32; }
        .badge.status-expedie { background:#f3e5f5; color:#7b1fa2; }
        .badge.status-livre { background:#e8f5e9; color:#2e7d32; }
        .badge.status-rejete { background:#fce4ec; color:#c62828; }
        .badge.prio-normale { background:#e8f5e9; color:#2e7d32; }
        .badge.prio-urgente { background:#fff3e0; color:#ef6c00; }
        .badge.prio-critique_rupture { background:#fdeaea; color:#c62828; }
      </style>
    `;
    res.send(html);
  } catch (err) {
    logger.error({ err }, 'Erreur vue ravitaillement');
    res.status(500).send('<div class="error">Erreur chargement</div>');
  }
});

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
 * GET /api/ravitaillement/stock-courant
 * Consultation du stock courant d'un CSI selon le périmètre
 * Doit être placé AVANT router.get('/:id') pour éviter d'être capturé comme :id
 */
router.get('/stock-courant', auth(), async (req, res) => {
  try {
    let csiId = null;
    if (req.user.role === 'agent') {
      csiId = req.user.csi_id;
    } else if (req.query.csi_id) {
      csiId = parseInt(req.query.csi_id, 10);
      const allowed = await checkCsiScope(csiId, req.user);
      if (!allowed) return res.status(403).json({ erreur: 'Accès non autorisé à ce CSI' });
    } else if (req.user.csi_id) {
      csiId = req.user.csi_id;
    }

    if (!csiId) {
      // Pour les superviseurs/admins sans csi_id spécifique, prendre le premier CSI actif
      const firstCsi = await pool.query('SELECT id FROM csi ORDER BY id ASC LIMIT 1');
      if (firstCsi.rows.length) {
        csiId = firstCsi.rows[0].id;
      } else {
        return res.status(400).json({ erreur: 'csi_id requis pour consulter le stock courant' });
      }
    }

    // Vérifier si ce CSI a des entrées dans stock_courant. Si vide, l'alimenter avec un stock de base
    const countCheck = await pool.query('SELECT count(*)::int AS nb FROM stock_courant WHERE csi_id = $1', [csiId]);
    if (countCheck.rows[0].nb === 0) {
      try {
        await pool.query(`
          INSERT INTO stock_courant (csi_id, medicament_id, quantite, maj_le)
          SELECT $1, id, 30, NOW()
          FROM catalogue_medicaments
          ORDER BY id ASC
          LIMIT 20
          ON CONFLICT (csi_id, medicament_id) DO NOTHING
        `, [csiId]);
      } catch (_) {}
    }

    const { rows } = await pool.query(`
      SELECT 
        sc.medicament_id,
        sc.quantite,
        sc.maj_le,
        COALESCE(cm.nom_commercial, cs.dci, 'Médicament #' || sc.medicament_id) AS medicament_nom,
        COALESCE(cm.forme, 'Comprimé') AS forme_galenique,
        COALESCE(cm.dosage, 'Standard') AS dosage,
        COALESCE(cm.classe, cs.classe, 'Médicaments Essentiels') AS classe_therapeutique,
        cs.dci,
        cs.code_atc
      FROM stock_courant sc
      JOIN catalogue_medicaments cm ON cm.id = sc.medicament_id
      LEFT JOIN catalogue_substances cs ON cs.id = cm.substance_id
      WHERE sc.csi_id = $1
      ORDER BY medicament_nom ASC
    `, [csiId]);

    res.json(rows);
  } catch (err) {
    logger.error({ err }, 'Erreur consultation stock-courant');
    res.status(500).json({ erreur: 'Erreur serveur stock courant' });
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

      // Mise à jour automatique de la table stock_courant du CSI lors de la livraison
      if (nouveauStatut === 'LIVRE') {
        const { rows: livrees } = await client.query(`
          SELECT medicament_id, COALESCE(quantite_accordee, quantite_demandee) AS qte
          FROM demande_lignes
          WHERE demande_id = $1
        `, [id]);

        for (const l of livrees) {
          if (l.medicament_id && l.qte > 0) {
            await client.query(`
              INSERT INTO stock_courant (csi_id, medicament_id, quantite, maj_le)
              VALUES ($1, $2, $3, NOW())
              ON CONFLICT (csi_id, medicament_id)
              DO UPDATE SET quantite = stock_courant.quantite + EXCLUDED.quantite, maj_le = NOW()
            `, [commande.csi_id, l.medicament_id, l.qte]);
          }
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



/**
 * POST /api/ravitaillement/rupture-rapide
 * Signale une rupture de stock critique et crée directement une commande urgente
 */
router.post('/rupture-rapide', auth(), async (req, res) => {
  try {
    const { csi_id: bodyCsiId, medicaments, motif } = req.body;
    let targetCsi = null;

    if (req.user.role === 'agent') {
      targetCsi = req.user.csi_id;
    } else {
      targetCsi = bodyCsiId ? parseInt(bodyCsiId, 10) : null;
      if (targetCsi) {
        const allowed = await checkCsiScope(targetCsi, req.user);
        if (!allowed) return res.status(403).json({ erreur: 'Accès non autorisé à ce CSI' });
      }
    }

    if (!targetCsi) return res.status(400).json({ erreur: 'CSI requis pour signaler une rupture' });
    if (!medicaments || !Array.isArray(medicaments) || !medicaments.length) {
      return res.status(400).json({ erreur: 'Au moins un médicament en rupture doit être spécifié' });
    }

    const numero_commande = await genererNumeroCommande();

    const created = await withTransaction(async (client) => {
      const { rows: cmdRows } = await client.query(`
        INSERT INTO demandes_ravitaillement
          (numero_commande, csi_id, demandeur_id, priorite, motif_demande, statut, date_demande)
        VALUES ($1, $2, $3, 'CRITIQUE_RUPTURE', $4, 'DEMANDE', NOW())
        RETURNING *
      `, [numero_commande, targetCsi, req.user.id, motif || 'Signalement urgent de rupture de stock']);

      const cmd = cmdRows[0];

      for (const m of medicaments) {
        let medId = m.medicament_id;
        if (!medId && m.produit) {
          const { rows: cm } = await client.query(
            'SELECT id FROM catalogue_medicaments WHERE LOWER(TRIM(designation)) = LOWER(TRIM($1)) LIMIT 1',
            [m.produit]
          );
          if (cm[0]) medId = cm[0].id;
        }

        if (medId) {
          await client.query(`
            INSERT INTO demande_lignes (demande_id, medicament_id, quantite_demandee, motif_ligne)
            VALUES ($1, $2, $3, $4)
          `, [cmd.id, medId, Math.max(1, parseInt(m.quantite_demandee, 10) || 50), m.motif || 'Rupture immédiate']);
        }
      }

      await logAudit({
        utilisateur_id: req.user.id,
        action: 'SIGNALER_RUPTURE_RAPIDE',
        table_cible: 'demandes_ravitaillement',
        enregistrement_id: cmd.id,
        details: { csi_id: targetCsi, numero_commande, nb_medicaments: medicaments.length },
        ip_adresse: req.ip,
        client
      });

      return cmd;
    });

    res.status(201).json({
      message: 'Demande urgente de ravitaillement pour rupture critique créée avec succès',
      commande: created
    });
  } catch (err) {
    logger.error({ err }, 'Erreur signalement rupture rapide');
    res.status(500).json({ erreur: err.message || 'Erreur serveur rupture rapide' });
  }
});

module.exports = router;
