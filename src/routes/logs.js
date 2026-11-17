const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { auth } = require('../middleware/auth');
const logger = require('../utils/logger');

// Middleware pour logger toutes les requêtes (si pas déjà fait)
router.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    // Stocker en mémoire pour la vue temps réel (en production: Redis/DB)
    if (!global.requestLogs) global.requestLogs = [];
    global.requestLogs.unshift({
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      user: req.user ? { id: req.user.id, role: req.user.role, nom: req.user.nom } : null
    });
    // Garder seulement les 500 dernières
    if (global.requestLogs.length > 500) global.requestLogs = global.requestLogs.slice(0, 500);
  });
  next();
});

// ── Vue HTMX : Logs système en temps réel ──
router.get('/view', auth(['admin']), async (req, res) => {
  const logs = global.requestLogs || [];
  const auditLogs = await pool.query(`
    SELECT a.*, u.nom AS utilisateur_nom, u.email, u.role
    FROM audit_logs a
    LEFT JOIN utilisateurs u ON u.id = a.utilisateur_id
    ORDER BY a.cree_le DESC
    LIMIT 100
  `).catch(() => ({ rows: [] }));

  const html = `
    <div class="logs-view">
      <div class="logs-header">
        <h3>📋 Journaux Système / System Logs / Bayanan Tekuniyya</h3>
        <div class="logs-controls">
          <button class="btn btn-secondary" hx-get="/api/logs/view" hx-target=".logs-view">🔄 Actualiser</button>
          <button class="btn btn-warning" hx-post="/api/logs/clear" hx-target=".logs-view">🗑️ Vider logs mémoire</button>
          <label>
            <input type="checkbox" id="auto-refresh" ${logs.length > 0 ? 'checked' : ''} onchange="this.checked ? window.logInterval=setInterval(()=>document.querySelector('[hx-target=.logs-view]').click(),3000) : clearInterval(window.logInterval)">
            Auto-refresh (3s)
          </label>
        </div>
      </div>

      <div class="logs-tabs">
        <button class="tab-btn active" data-tab="http-logs" onclick="switchLogTab('http-logs')">Requêtes HTTP / HTTP Requests</button>
        <button class="tab-btn" data-tab="audit-logs" onclick="switchLogTab('audit-logs')">Audit Trail / Audit</button>
        <button class="tab-btn" data-tab="errors" onclick="switchLogTab('errors')">Erreurs / Errors</button>
      </div>

      <div id="http-logs" class="tab-content active">
        <div class="table-responsive">
          <table class="data-table logs-table">
            <thead>
              <tr>
                <th>Heure</th>
                <th>Méthode</th>
                <th>Chemin</th>
                <th>Status</th>
                <th>Durée</th>
                <th>IP</th>
                <th>Utilisateur</th>
              </tr>
            </thead>
            <tbody>
              ${logs.slice(0, 100).map(l => `
                <tr class="${l.status >= 400 ? 'error-row' : ''} ${l.status >= 500 ? 'critical-row' : ''}">
                  <td>${new Date(l.timestamp).toLocaleTimeString()}</td>
                  <td><span class="badge method-${l.method.toLowerCase()}">${l.method}</span></td>
                  <td><code>${l.path}</code></td>
                  <td><span class="badge status-${l.status}">${l.status}</span></td>
                  <td>${l.duration}</td>
                  <td>${l.ip}</td>
                  <td>${l.user ? `${l.user.nom} (${l.user.role})` : 'Anonyme'}</td>
                </tr>
              `).join('') || '<tr><td colspan="7" class="text-center">Aucune requête enregistrée</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div id="audit-logs" class="tab-content">
        <div class="table-responsive">
          <table class="data-table logs-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Action</th>
                <th>Table</th>
                <th>Enregistrement</th>
                <th>Utilisateur</th>
                <th>IP</th>
                <th>Détails</th>
              </tr>
            </thead>
            <tbody>
              ${auditLogs.rows.map(a => `
                <tr>
                  <td>${new Date(a.cree_le).toLocaleString()}</td>
                  <td><span class="badge">${a.action}</span></td>
                  <td>${a.table_cible || '-'}</td>
                  <td>${a.enregistrement_id || '-'}</td>
                  <td>${a.utilisateur_nom || 'Système'} (${a.utilisateur_role || '-'})</td>
                  <td>${a.ip_adresse || '-'}</td>
                  <td><code>${JSON.stringify(a.details || {}).substring(0, 100)}</code></td>
                </tr>
              `).join('') || '<tr><td colspan="7" class="text-center">Aucun audit</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <div id="errors" class="tab-content">
        <div class="table-responsive">
          <table class="data-table logs-table">
            <thead>
              <tr>
                <th>Heure</th>
                <th>Méthode</th>
                <th>Chemin</th>
                <th>Status</th>
                <th>Durée</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              ${logs.filter(l => l.status >= 400).slice(0, 50).map(l => `
                <tr class="critical-row">
                  <td>${new Date(l.timestamp).toLocaleTimeString()}</td>
                  <td><span class="badge method-${l.method.toLowerCase()}">${l.method}</span></td>
                  <td><code>${l.path}</code></td>
                  <td><span class="badge status-${l.status}">${l.status}</span></td>
                  <td>${l.duration}</td>
                  <td>${l.ip}</td>
                </tr>
              `).join('') || '<tr><td colspan="6" class="text-center">Aucune erreur</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <style>
      .logs-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 12px; }
      .logs-controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      .logs-controls label { font-size: 0.85rem; color: var(--text-muted); cursor: pointer; }
      .logs-tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid var(--border); }
      .tab-btn { padding: 8px 16px; background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; font-weight: 500; color: var(--text-muted); }
      .tab-btn.active { border-bottom-color: var(--primary); color: var(--primary); }
      .tab-content { display: none; }
      .tab-content.active { display: block; animation: fadeIn 0.2s; }
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      .logs-table { font-size: 0.8rem; }
      .logs-table code { background: var(--bg-tertiary); padding: 2px 4px; border-radius: 3px; font-size: 0.75rem; }
      .error-row { background: #fff5f5; }
      .critical-row { background: #fff0f0; }
      .badge.method-get { background: #e3f2fd; color: #1565c0; }
      .badge.method-post { background: #e8f5e9; color: #2e7d32; }
      .badge.method-put { background: #fff3e0; color: #ef6c00; }
      .badge.method-delete { background: #fce4ec; color: #c62828; }
      .badge.status-200 { background: #e8f5e9; color: #2e7d32; }
      .badge.status-201 { background: #e8f5e9; color: #2e7d32; }
      .badge.status-400 { background: #fff3e0; color: #ef6c00; }
      .badge.status-401 { background: #fce4ec; color: #c62828; }
      .badge.status-403 { background: #fce4ec; color: #c62828; }
      .badge.status-404 { background: #f5f5f5; color: #616161; }
      .badge.status-500 { background: #fdeaea; color: #c62828; }
      .table-responsive { overflow-x: auto; }
    </style>

    <script>
      function switchLogTab(tabId) {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.querySelector('[data-tab="' + tabId + '"]').classList.add('active');
        document.getElementById(tabId).classList.add('active');
      }
    </script>
  `;
  res.send(html);
});

// Vider les logs en mémoire
router.post('/clear', auth(['admin']), (req, res) => {
  global.requestLogs = [];
  res.send('<div class="success">✅ Logs mémoire vidés</div>');
});

module.exports = router;