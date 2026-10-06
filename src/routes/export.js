const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { auth } = require('../middleware/auth');
const logger = require('../utils/logger');

const wrap = f => (req, res) => f(req, res).catch(e => {
  logger.error({ err: e, route: req.path }, 'Erreur export');
  res.status(500).json({ erreur: 'Erreur lors de l\'export' });
});

const moisDate = m => /^\d{4}-\d{2}$/.test(m) ? m + '-01' : null;

/**
 * Convertit un tableau d'objets en CSV
 */
function toCSV(rows, headers) {
  if (!rows.length) return headers.map(h => `"${h.label}"`).join(';') + '\n';
  const head = headers.map(h => `"${h.label}"`).join(';');
  const body = rows.map(r =>
    headers.map(h => {
      const v = r[h.key] ?? '';
      return typeof v === 'string' ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(';')
  ).join('\n');
  return head + '\n' + body;
}

// ─── GET /api/export/rapport ── Export CSV d'un rapport mensuel ───────────────
router.get('/export/rapport', auth(), wrap(async (req, res) => {
  const { csi_id, mois } = req.query;
  const m = moisDate(mois);
  if (!csi_id || !m) return res.status(400).json({ erreur: 'csi_id et mois requis' });

  // Contrôle d'accès agent
  if (req.user.role === 'agent' && req.user.csi_id && req.user.csi_id !== parseInt(csi_id)) {
    return res.status(403).json({ erreur: 'Accès non autorisé' });
  }

  const { rows: csiInfo } = await pool.query(
    `SELECT s.nom, c.nom AS commune, g.nom AS region
     FROM csi s JOIN communes c ON c.id = s.commune_id JOIN regions g ON g.id = c.region_id
     WHERE s.id = $1`, [csi_id]
  );
  if (!csiInfo[0]) return res.status(404).json({ erreur: 'CSI introuvable' });

  const { rows: rapport } = await pool.query(
    'SELECT id FROM rapports WHERE csi_id = $1 AND mois = $2', [csi_id, m]
  );
  if (!rapport[0]) return res.status(404).json({ erreur: 'Aucun rapport pour ce mois' });

  const id = rapport[0].id;
  const [consultations, vaccinations, medicaments] = await Promise.all([
    pool.query('SELECT * FROM consultations WHERE rapport_id = $1', [id]).then(r => r.rows),
    pool.query('SELECT * FROM vaccinations WHERE rapport_id = $1', [id]).then(r => r.rows),
    pool.query('SELECT * FROM medicaments WHERE rapport_id = $1', [id]).then(r => r.rows)
  ]);

  const info = csiInfo[0];
  const filename = `rapport_${info.nom.replace(/\s+/g, '_')}_${mois}.csv`;

  let csv = `"CSI";"${info.nom}"\n"Commune";"${info.commune}"\n"Région";"${info.region}"\n"Mois";"${mois}"\n\n`;

  csv += '"CONSULTATIONS"\n';
  csv += toCSV(consultations, [
    { key: 'motif', label: 'Motif' },
    { key: 'tranche', label: 'Tranche d\'âge' },
    { key: 'sexe', label: 'Sexe' },
    { key: 'nombre', label: 'Nombre' }
  ]);

  csv += '\n"VACCINATIONS"\n';
  csv += toCSV(vaccinations, [
    { key: 'vaccin', label: 'Vaccin' },
    { key: 'doses', label: 'Doses' }
  ]);

  csv += '\n"MÉDICAMENTS"\n';
  csv += toCSV(medicaments, [
    { key: 'produit', label: 'Produit' },
    { key: 'stock_debut', label: 'Stock début' },
    { key: 'entrees', label: 'Entrées' },
    { key: 'sorties', label: 'Sorties' },
    { key: 'stock_fin', label: 'Stock fin' },
    { key: 'jours_rupture', label: 'Jours de rupture' }
  ]);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('BOM', '\uFEFF'); // BOM pour Excel
  res.send('\uFEFF' + csv); // BOM UTF-8 pour Excel
}));

// ─── GET /api/export/stats ── Export CSV des stats globales ──────────────────
router.get('/export/stats', auth(['admin', 'superviseur']), wrap(async (req, res) => {
  const { mois } = req.query;
  const m = moisDate(mois) || new Date().toISOString().slice(0, 7) + '-01';
  const moisLabel = mois || new Date().toISOString().slice(0, 7);

  const { rows } = await pool.query(
    `SELECT g.nom AS region, s.nom AS csi, c.nom AS commune, c.type,
            r.mois, r.maj AS derniere_modification,
            (SELECT sum(nombre) FROM consultations WHERE rapport_id = r.id)::int AS total_consultations,
            (SELECT sum(doses) FROM vaccinations WHERE rapport_id = r.id)::int AS total_vaccinations,
            (SELECT sum(jours_rupture) FROM medicaments WHERE rapport_id = r.id)::int AS jours_rupture_total
     FROM csi s
     JOIN communes c ON c.id = s.commune_id
     JOIN regions g ON g.id = c.region_id
     LEFT JOIN rapports r ON r.csi_id = s.id AND r.mois = $1
     WHERE s.actif
     ORDER BY g.nom, c.nom, s.nom`, [m]
  );

  const filename = `stats_nationale_${moisLabel}.csv`;
  const csv = toCSV(rows, [
    { key: 'region', label: 'Région' },
    { key: 'commune', label: 'Commune' },
    { key: 'type', label: 'Type' },
    { key: 'csi', label: 'CSI' },
    { key: 'mois', label: 'Rapport reçu' },
    { key: 'total_consultations', label: 'Total consultations' },
    { key: 'total_vaccinations', label: 'Total vaccinations' },
    { key: 'jours_rupture_total', label: 'Jours de rupture' },
    { key: 'derniere_modification', label: 'Dernière modification' }
  ]);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + csv);
}));

module.exports = router;
