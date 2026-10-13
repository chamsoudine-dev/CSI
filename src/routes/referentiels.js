const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { auth } = require('../middleware/auth');
const logger = require('../utils/logger');
const { logAudit } = require('../utils/audit');

const TABLES = {
  consultations: 'referentiel_consultations',
  vaccins: 'referentiel_vaccins',
  services: 'referentiel_services'
};

const CHAMP_NOM = {
  consultations: 'motif',
  vaccins: 'vaccin',
  services: 'nom'
};

// ─── GET /api/referentiels/:type ── Lecture des référentiels ───────────────────
router.get('/:type', async (req, res) => {
  const table = TABLES[req.params.type];
  if (!table) return res.status(404).json({ erreur: 'Type de référentiel inconnu' });

  try {
    const champ = CHAMP_NOM[req.params.type];
    const { rows } = await pool.query(`SELECT id, ${champ} AS libelle, actif, ordre FROM ${table} ORDER BY ordre, ${champ}`);
    res.json(rows);
  } catch (err) {
    logger.error({ err }, 'Erreur lecture référentiel');
    res.status(500).json({ erreur: 'Erreur serveur référentiel' });
  }
});

// ─── POST /api/referentiels/:type ── Ajout (Admin seul) ───────────────────────
router.post('/:type', auth(['admin']), async (req, res) => {
  const table = TABLES[req.params.type];
  if (!table) return res.status(404).json({ erreur: 'Type de référentiel inconnu' });
  const champ = CHAMP_NOM[req.params.type];

  const { libelle, ordre } = req.body;
  if (!libelle || !libelle.trim()) return res.status(400).json({ erreur: 'Libellé requis' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO ${table} (${champ}, ordre) VALUES ($1, $2) RETURNING id, ${champ} AS libelle, actif, ordre`,
      [libelle.trim(), parseInt(ordre, 10) || 0]
    );

    await logAudit({
      utilisateur_id: req.user.id,
      action: 'CREATE_REFERENTIEL',
      table_cible: table,
      enregistrement_id: rows[0].id,
      details: { type: req.params.type, libelle: rows[0].libelle },
      ip_adresse: req.ip
    });

    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ erreur: 'Cet élément existe déjà dans le référentiel' });
    logger.error({ err }, 'Erreur création référentiel');
    res.status(500).json({ erreur: 'Erreur serveur référentiel' });
  }
});

// ─── PUT /api/referentiels/:type/:id ── Modification (Admin seul) ─────────────
router.put('/:type/:id', auth(['admin']), async (req, res) => {
  const table = TABLES[req.params.type];
  if (!table) return res.status(404).json({ erreur: 'Type de référentiel inconnu' });
  const champ = CHAMP_NOM[req.params.type];
  const id = parseInt(req.params.id, 10);

  const { libelle, actif, ordre } = req.body;

  try {
    const updates = [];
    const params = [id];
    let idx = 2;

    if (libelle !== undefined) {
      updates.push(`${champ} = $${idx++}`);
      params.push(libelle.trim());
    }
    if (actif !== undefined) {
      updates.push(`actif = $${idx++}`);
      params.push(Boolean(actif));
    }
    if (ordre !== undefined) {
      updates.push(`ordre = $${idx++}`);
      params.push(parseInt(ordre, 10) || 0);
    }

    if (!updates.length) return res.status(400).json({ erreur: 'Aucune donnée à modifier' });

    const { rows } = await pool.query(
      `UPDATE ${table} SET ${updates.join(', ')} WHERE id = $1 RETURNING id, ${champ} AS libelle, actif, ordre`,
      params
    );

    if (!rows[0]) return res.status(404).json({ erreur: 'Élément introuvable' });

    await logAudit({
      utilisateur_id: req.user.id,
      action: 'UPDATE_REFERENTIEL',
      table_cible: table,
      enregistrement_id: id,
      details: { type: req.params.type, libelle, actif, ordre },
      ip_adresse: req.ip
    });

    res.json(rows[0]);
  } catch (err) {
    logger.error({ err }, 'Erreur modification référentiel');
    res.status(500).json({ erreur: 'Erreur serveur référentiel' });
  }
});

// ─── DELETE /api/referentiels/:type/:id ── Suppression ou désactivation (Admin seul) ─
router.delete('/:type/:id', auth(['admin']), async (req, res) => {
  const table = TABLES[req.params.type];
  if (!table) return res.status(404).json({ erreur: 'Type de référentiel inconnu' });
  const champ = CHAMP_NOM[req.params.type];
  const id = parseInt(req.params.id, 10);

  try {
    // Désactivation logique pour préserver l'intégrité historique
    const { rows } = await pool.query(
      `UPDATE ${table} SET actif = FALSE WHERE id = $1 RETURNING id, ${champ} AS libelle, actif`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ erreur: 'Élément introuvable' });

    await logAudit({
      utilisateur_id: req.user.id,
      action: 'DESACTIVER_REFERENTIEL',
      table_cible: table,
      enregistrement_id: id,
      details: { type: req.params.type, libelle: rows[0].libelle },
      ip_adresse: req.ip
    });

    res.json({ message: 'Élément désactivé avec succès' });
  } catch (err) {
    logger.error({ err }, 'Erreur suppression référentiel');
    res.status(500).json({ erreur: 'Erreur serveur référentiel' });
  }
});

module.exports = router;
