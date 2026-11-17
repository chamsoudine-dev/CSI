const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { auth } = require('../middleware/auth');
const logger = require('../utils/logger');

const wrap = f => (req, res) => f(req, res).catch(e => {
  logger.error({ err: e, route: req.path, user: req.user?.id }, 'Erreur route alertes');
  res.status(500).json({ erreur: 'Erreur serveur alertes' });
});

const moisDate = m => /^\d{4}-\d{2}$/.test(m) ? m + '-01' : null;

// ── Vue HTMX : Alertes ──
router.get('/view', auth(['admin', 'superviseur', 'superviseur_national']), async (req, res) => {
  try {
    const moisQuery = req.query.mois || new Date().toISOString().slice(0, 7);
    const m = moisDate(moisQuery);
    if (!m) return res.status(400).send('<div class="error">Format mois invalide</div>');

    const { role, region_id: userRegion } = req.user;
    let regionFilter = null;
    if (role === 'superviseur') regionFilter = userRegion;
    else if (req.query.region_id) regionFilter = parseInt(req.query.region_id, 10);

    let seuilPct = 50;
    try {
      const { rows: pRows } = await pool.query("SELECT valeur FROM parametres WHERE cle = 'seuil_alerte_epidemie_pct'");
      if (pRows[0] && !isNaN(parseInt(pRows[0].valeur, 10))) seuilPct = parseInt(pRows[0].valeur, 10);
    } catch {}

    const baseParams = [m];
    let regClause = '';
    if (regionFilter) { baseParams.push(regionFilter); regClause = `AND g.id = $${baseParams.length}`; }

    const [actuelRes, historiqueRes, csiRetardRes] = await Promise.all([
      pool.query(`SELECT c.motif, sum(c.nombre)::int AS total_mois
                  FROM consultations c JOIN rapports r ON r.id = c.rapport_id
                  JOIN csi s ON s.id = r.csi_id JOIN communes co ON co.id = s.commune_id
                  JOIN regions g ON g.id = co.region_id
                  WHERE r.mois = $1 ${regClause} GROUP BY c.motif`, baseParams),
      pool.query(`SELECT c.motif, (sum(c.nombre) / 3.0)::numeric(10,1) AS moyenne_3mois
                  FROM consultations c JOIN rapports r ON r.id = c.rapport_id
                  JOIN csi s ON s.id = r.csi_id JOIN communes co ON co.id = s.commune_id
                  JOIN regions g ON g.id = co.region_id
                  WHERE r.mois >= (date_trunc('month', $1::date) - interval '3 months')
                    AND r.mois < date_trunc('month', $1::date) ${regClause}
                  GROUP BY c.motif`, baseParams),
      pool.query(`SELECT s.id AS csi_id, s.nom AS csi_nom, co.nom AS commune_nom, g.nom AS region_nom,
                         r.id AS rapport_id, r.statut, r.maj
                  FROM csi s
                  JOIN communes co ON co.id = s.commune_id
                  JOIN regions g ON g.id = co.region_id
                  LEFT JOIN rapports r ON r.csi_id = s.id AND r.mois = $1
                  WHERE s.actif AND (r.id IS NULL OR r.statut IN ('BROUILLON', 'RENVOYE')) ${regClause}
                  ORDER BY g.nom, co.nom, s.nom`, baseParams)
    ]);

    const histoMap = {};
    for (const h of historiqueRes.rows) histoMap[h.motif] = parseFloat(h.moyenne_3mois) || 0;

    const alertesEpi = [];
    for (const act of actuelRes.rows) {
      const moyennePrec = histoMap[act.motif] || 0;
      const haussePct = moyennePrec > 0 ? Math.round(((act.total_mois - moyennePrec) / moyennePrec) * 100) : (act.total_mois > 10 ? 100 : 0);
      if (haussePct >= seuilPct) {
        alertesEpi.push({ motif: act.motif, total_mois: act.total_mois, moyenne_precedente: moyennePrec, hausse_pct: haussePct, gravite: haussePct >= seuilPct * 2 ? 'CRITIQUE' : 'ÉLEVÉE' });
      }
    }

    const html = `
      <div class="alertes-view">
        <h3>🚨 Alertes / Gargadi / Al'arma</h3>
        <div class="filters" style="margin-bottom:16px; display:flex; gap:12px; flex-wrap:wrap;">
          <input type="month" name="mois" value="${moisQuery}" hx-get="/api/alertes/view" hx-target="#alertes" hx-trigger="change" class="form-input">
          <span class="stat-badge">Seuil: ${seuilPct}%</span>
          <span class="stat-badge">${alertesEpi.length} alertes épidémio</span>
          <span class="stat-badge">${csiRetardRes.rows.length} CSI en retard</span>
        </div>

        <div class="tabs" style="display:flex; gap:8px; margin:16px 0; border-bottom:1px solid var(--border);">
          <button class="tab-btn active" onclick="showAlertTab('epidemiologiques')">📈 Épidémiologiques</button>
          <button class="tab-btn" onclick="showAlertTab('csi-retard')">📋 CSI en retard</button>
        </div>

        <div id="tab-epidemiologiques" class="tab-content active">
          <div class="table-responsive"><table class="data-table"><thead><tr><th>Pathologie</th><th>Total mois</th><th>Moyenne 3 mois</th><th>Hausse %</th><th>Gravité</th></tr></thead><tbody>
            ${alertesEpi.map(a => `<tr class="${a.gravite==='CRITIQUE'?'critical-row':''}"><td><strong>${a.motif}</strong></td><td>${a.total_mois}</td><td>${a.moyenne_precedente}</td><td><span class="badge">${a.hausse_pct}%</span></td><td><span class="badge ${a.gravite==='CRITIQUE'?'badge-danger':'badge-warning'}">${a.gravite}</span></td></tr>`).join('') || '<tr><td colspan="5" class="text-center">Aucune alerte épidémiologique</td></tr>'}
          </tbody></table></div>
        </div>

        <div id="tab-csi-retard" class="tab-content">
          <div class="table-responsive"><table class="data-table"><thead><tr><th>CSI</th><th>Commune</th><th>Région</th><th>Statut rapport</th><th>Dernière maj</th></tr></thead><tbody>
            ${csiRetardRes.rows.map(c => `<tr><td><strong>${c.csi_nom}</strong></td><td>${c.commune_nom}</td><td>${c.region_nom}</td><td><span class="badge status-${(c.statut||'BROUILLON').toLowerCase()}">${c.statut||'BROUILLON'}</span></td><td>${c.maj ? new Date(c.maj).toLocaleString() : 'Jamais'}</td></tr>`).join('') || '<tr><td colspan="5" class="text-center">Tous les CSI sont à jour</td></tr>'}
          </tbody></table></div>
        </div>
      </div>
      <style>.tabs{display:flex;gap:8px;border-bottom:1px solid var(--border);}.tab-btn{padding:8px 16px;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;font-weight:500;color:var(--text-muted);}.tab-btn.active{border-bottom-color:var(--primary);color:var(--primary);}.tab-content{display:none;padding:16px 0;}.tab-content.active{display:block;animation:fadeIn .2s}.critical-row{background:#fff0f0;}</style>
      <script>function showAlertTab(id){document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));event.target.classList.add('active');document.getElementById('tab-'+id).classList.add('active');}</script>
    `;
    res.send(html);
  } catch (err) {
    logger.error({ err }, 'Erreur vue alertes');
    res.status(500).send('<div class="error">Erreur chargement alertes</div>');
  }
});

// ─── GET /api/alertes/epidemiologiques ────────────────────────────────────────
router.get('/epidemiologiques', auth(['admin', 'superviseur', 'superviseur_national']), wrap(async (req, res) => {
  const moisQuery = req.query.mois || new Date().toISOString().slice(0, 7);
  const m = moisDate(moisQuery);
  if (!m) return res.status(400).json({ erreur: 'Format mois invalide (YYYY-MM)' });

  const { role, region_id: userRegion } = req.user;
  let regionFilter = null;
  if (role === 'superviseur') {
    regionFilter = userRegion;
  } else if (req.query.region_id) {
    regionFilter = parseInt(req.query.region_id, 10);
  }

  // Récupérer le seuil d'alerte configuré (défaut: 50%)
  let seuilPct = 50;
  try {
    const { rows: pRows } = await pool.query("SELECT valeur FROM parametres WHERE cle = 'seuil_alerte_epidemie_pct'");
    if (pRows[0] && !isNaN(parseInt(pRows[0].valeur, 10))) {
      seuilPct = parseInt(pRows[0].valeur, 10);
    }
  } catch {}

  const baseParams = [m];
  let regClause = '';
  if (regionFilter) {
    baseParams.push(regionFilter);
    regClause = `AND g.id = $${baseParams.length}`;
  }

  // 1. Total consultations du mois par motif
  const moisActuelSql = `
    SELECT c.motif, sum(c.nombre)::int AS total_mois
    FROM consultations c
    JOIN rapports r ON r.id = c.rapport_id
    JOIN csi s ON s.id = r.csi_id
    JOIN communes co ON co.id = s.commune_id
    JOIN regions g ON g.id = co.region_id
    WHERE r.mois = $1 ${regClause}
    GROUP BY c.motif
  `;

  // 2. Moyenne des 3 mois précédents par motif
  const troisMoisSql = `
    SELECT c.motif, (sum(c.nombre) / 3.0)::numeric(10,1) AS moyenne_3mois
    FROM consultations c
    JOIN rapports r ON r.id = c.rapport_id
    JOIN csi s ON s.id = r.csi_id
    JOIN communes co ON co.id = s.commune_id
    JOIN regions g ON g.id = co.region_id
    WHERE r.mois >= (date_trunc('month', $1::date) - interval '3 months')
      AND r.mois < date_trunc('month', $1::date)
      ${regClause}
    GROUP BY c.motif
  `;

  const [actuelRes, historiqueRes] = await Promise.all([
    pool.query(moisActuelSql, baseParams),
    pool.query(troisMoisSql, baseParams)
  ]);

  const histoMap = {};
  for (const h of historiqueRes.rows) {
    histoMap[h.motif] = parseFloat(h.moyenne_3mois) || 0;
  }

  const alertes = [];
  for (const act of actuelRes.rows) {
    const moyennePrec = histoMap[act.motif] || 0;
    const haussePct = moyennePrec > 0 
      ? Math.round(((act.total_mois - moyennePrec) / moyennePrec) * 100)
      : (act.total_mois > 10 ? 100 : 0);

    const estAlerte = haussePct >= seuilPct;

    if (estAlerte) {
      alertes.push({
        motif: act.motif,
        total_mois: act.total_mois,
        moyenne_precedente: moyennePrec,
        hausse_pct: haussePct,
        seuil_pct: seuilPct,
        gravite: haussePct >= seuilPct * 2 ? 'CRITIQUE' : 'ELEVEE'
      });
    }
  }

  res.json({
    mois: moisQuery,
    region_id: regionFilter,
    seuil_applique_pct: seuilPct,
    nb_alertes: alertes.length,
    alertes
  });
}));

// ─── GET /api/alertes/csi-en-retard ───────────────────────────────────────────
router.get('/csi-en-retard', auth(['admin', 'superviseur', 'superviseur_national']), wrap(async (req, res) => {
  const moisQuery = req.query.mois || new Date().toISOString().slice(0, 7);
  const m = moisDate(moisQuery);
  if (!m) return res.status(400).json({ erreur: 'Format mois invalide (YYYY-MM)' });

  const { role, region_id: userRegion } = req.user;
  let regionFilter = null;
  if (role === 'superviseur') {
    regionFilter = userRegion;
  } else if (req.query.region_id) {
    regionFilter = parseInt(req.query.region_id, 10);
  }

  const params = [m];
  let regClause = '';
  if (regionFilter) {
    params.push(regionFilter);
    regClause = `AND g.id = $${params.length}`;
  }

  const { rows } = await pool.query(`
    SELECT s.id AS csi_id, s.nom AS csi_nom, co.nom AS commune_nom, g.nom AS region_nom,
           r.id AS rapport_id, r.statut, r.maj,
           (SELECT MAX(r2.mois) FROM rapports r2 WHERE r2.csi_id = s.id AND r2.statut = 'VALIDE') AS dernier_rapport_valide_mois,
           (SELECT MAX(r3.maj) FROM rapports r3 WHERE r3.csi_id = s.id) AS derniere_activite
    FROM csi s
    JOIN communes co ON co.id = s.commune_id
    JOIN regions g ON g.id = co.region_id
    LEFT JOIN rapports r ON r.csi_id = s.id AND r.mois = $1
    WHERE s.actif
      AND (r.id IS NULL OR r.statut IN ('BROUILLON', 'RENVOYE'))
      ${regClause}
    ORDER BY g.nom, co.nom, s.nom
  `, params);

  res.json({
    mois: moisQuery,
    total_en_retard: rows.length,
    csi_en_retard: rows
  });
}));

module.exports = router;
