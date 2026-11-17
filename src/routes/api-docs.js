const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');

// Documentation centralisée de toutes les APIs
const API_DOCS = {
  auth: {
    nom: 'Authentification / Authentication / Aunin',
    base: '/api',
    endpoints: [
      { method: 'POST', path: '/login', desc: 'Connexion email/mot de passe', auth: 'Public' },
      { method: 'POST', path: '/login/verify-code', desc: 'Vérification code 2FA (MFA)', auth: 'Public' },
      { method: 'GET', path: '/me', desc: 'Profil utilisateur connecté', auth: 'Auth' },
      { method: 'PUT', path: '/me/profil', desc: 'Modifier son profil', auth: 'Auth' },
      { method: 'POST', path: '/me/mot-de-passe/demander-code', desc: 'Demander code changement mot de passe', auth: 'Auth' },
      { method: 'POST', path: '/me/mot-de-passe/valider', desc: 'Valider nouveau mot de passe', auth: 'Auth' },
      { method: 'POST', path: '/mot-de-passe-oublie', desc: 'Demander réinitialisation mot de passe', auth: 'Public' },
      { method: 'POST', path: '/mot-de-passe-oublie/valider', desc: 'Valider réinitialisation mot de passe', auth: 'Public' },
      { method: 'POST', path: '/me/2fa/demander-code', desc: 'Activer/Désactiver 2FA', auth: 'Auth' },
      { method: 'POST', path: '/me/2fa/verifier-code', desc: 'Confirmer activation 2FA', auth: 'Auth' },
      { method: 'GET', path: '/utilisateurs', desc: 'Liste utilisateurs (admin/superviseur)', auth: 'Admin/Superviseur' },
      { method: 'POST', path: '/utilisateurs', desc: 'Créer utilisateur', auth: 'Admin/Superviseur' },
      { method: 'PUT', path: '/utilisateurs/:id', desc: 'Modifier utilisateur', auth: 'Admin/Superviseur' },
      { method: 'DELETE', path: '/utilisateurs/:id', desc: 'Supprimer/Désactiver utilisateur', auth: 'Admin/Superviseur' },
    ]
  },
  csi: {
    nom: 'CSI & Régions / CSI & Regions / CSI da Al\'umma',
    base: '/api',
    endpoints: [
      { method: 'GET', path: '/regions', desc: 'Liste des 8 régions du Niger', auth: 'Public' },
      { method: 'GET', path: '/csi', desc: 'Liste CSI (pagination, filtre région, recherche)', auth: 'Public' },
      { method: 'GET', path: '/csi/:id', desc: 'Détail d\'un CSI', auth: 'Public' },
      { method: 'POST', path: '/csi', desc: 'Créer CSI (admin/superviseur)', auth: 'Admin/Superviseur' },
      { method: 'PUT', path: '/csi/:id', desc: 'Modifier CSI (admin)', auth: 'Admin' },
      { method: 'DELETE', path: '/csi/:id', desc: 'Désactiver CSI (admin)', auth: 'Admin' },
    ]
  },
  rapports: {
    nom: 'Rapports Mensuels / Monthly Reports / Adadin Kwanaki',
    base: '/api',
    endpoints: [
      { method: 'GET', path: '/rapport', desc: 'Voir un rapport (csi_id + mois)', auth: 'Auth (scope)' },
      { method: 'GET', path: '/rapports/liste', desc: 'Liste rapports avec statuts', auth: 'Admin/Superviseur' },
      { method: 'PUT', path: '/rapport', desc: 'Sauvegarder brouillon', auth: 'Auth (scope)' },
      { method: 'POST', path: '/rapport/:id/soumettre', desc: 'Soumettre rapport', auth: 'Auth (scope)' },
      { method: 'POST', path: '/rapport/:id/valider', desc: 'Valider rapport (superviseur)', auth: 'Superviseur/Admin' },
      { method: 'POST', path: '/rapport/:id/renvoyer', desc: 'Renvoyer pour correction', auth: 'Superviseur/Admin' },
      { method: 'POST', path: '/rapport/:id/rouvrir', desc: 'Rouvrir exceptionnellement', auth: 'Admin' },
    ]
  },
  ravitaillement: {
    nom: 'Ravitaillement & Stocks / Supply & Stocks / Aiki da Kayan',
    base: '/api/ravitaillement',
    endpoints: [
      { method: 'GET', path: '/', desc: 'Liste demandes (filtres statut, priorité)', auth: 'Auth (scope)' },
      { method: 'GET', path: '/stats', desc: 'Stats alertes & commandes', auth: 'Auth (scope)' },
      { method: 'GET', path: '/stock-courant', desc: 'Stock actuel du CSI', auth: 'Auth (scope)' },
      { method: 'GET', path: '/:id', desc: 'Détail demande avec lignes', auth: 'Auth (scope)' },
      { method: 'POST', path: '/', desc: 'Créer demande ravitaillement', auth: 'Auth (scope)' },
      { method: 'PUT', path: '/:id/statut', desc: 'Changer statut (machine à états)', auth: 'Auth (scope)' },
      { method: 'POST', path: '/rupture-rapide', desc: 'Signaler rupture critique', auth: 'Auth (scope)' },
    ]
  },
  maternite: {
    nom: 'Santé Maternelle / Maternal Health / Lafiya Uwar Mata',
    base: '/api/maternite',
    endpoints: [
      { method: 'GET', path: '/stats', desc: 'Stats globales (naissances, CPN, CPON)', auth: 'Auth (scope)' },
      { method: 'GET', path: '/naissances', desc: 'Liste naissances', auth: 'Auth (scope)' },
      { method: 'POST', path: '/naissances', desc: 'Enregistrer naissance', auth: 'Auth (scope)' },
      { method: 'GET', path: '/cpn', desc: 'Liste consultations prénatales', auth: 'Auth (scope)' },
      { method: 'POST', path: '/cpn', desc: 'Enregistrer CPN', auth: 'Auth (scope)' },
      { method: 'GET', path: '/cpon', desc: 'Liste consultations postnatales', auth: 'Auth (scope)' },
      { method: 'POST', path: '/cpon', desc: 'Enregistrer CPON', auth: 'Auth (scope)' },
    ]
  },
  patients: {
    nom: 'Dossiers Patients / Patient Records / Bayanan Masu Lafiya',
    base: '/api/patients',
    endpoints: [
      { method: 'GET', path: '/', desc: 'Liste patients (recherche, filtres)', auth: 'Auth (scope)' },
      { method: 'GET', path: '/stats', desc: 'Stats patients', auth: 'Auth (scope)' },
      { method: 'GET', path: '/:id', desc: 'Fiche patient complète + historique', auth: 'Auth (scope)' },
      { method: 'POST', path: '/', desc: 'Créer patient', auth: 'Auth (scope)' },
      { method: 'PUT', path: '/:id', desc: 'Modifier patient', auth: 'Auth (scope)' },
      { method: 'POST', path: '/:id/visites', desc: 'Ajouter consultation', auth: 'Auth (scope)' },
    ]
  },
  unfpa: {
    nom: 'Enquêtes UNFPA / UNFPA Surveys / Bincike UNFPA',
    base: '/api/unfpa',
    endpoints: [
      { method: 'GET', path: '/', desc: 'Voir/Lister enquêtes', auth: 'Auth (scope)' },
      { method: 'PUT', path: '/', desc: 'Sauvegarder brouillon enquête', auth: 'Auth (scope)' },
      { method: 'POST', path: '/:id/soumettre', desc: 'Soumettre enquête', auth: 'Auth (scope)' },
      { method: 'POST', path: '/:id/valider', desc: 'Valider enquête', auth: 'Superviseur/Admin' },
      { method: 'GET', path: '/synthese', desc: 'Synthèse régionale/nationale', auth: 'Auth (scope)' },
    ]
  },
  catalogue: {
    nom: 'Catalogue Médicaments / Drug Catalog / Lushe Kayan Magani',
    base: '/api/catalogue',
    endpoints: [
      { method: 'GET', path: '/', desc: 'Recherche catalogue (q, classe, forme, pagination)', auth: 'Public' },
      { method: 'GET', path: '/classes', desc: 'Liste classes thérapeutiques', auth: 'Public' },
      { method: 'GET', path: '/formes', desc: 'Liste formes galéniques', auth: 'Public' },
      { method: 'GET', path: '/stats', desc: 'Stats catalogue', auth: 'Public' },
      { method: 'GET', path: '/:id', desc: 'Fiche médicament + stats CSI', auth: 'Public' },
      { method: 'GET', path: '/patients-lookup', desc: 'Recherche patients pour dispensation', auth: 'Auth' },
      { method: 'GET', path: '/patients-csi', desc: 'Patients du CSI connecté', auth: 'Auth' },
      { method: 'GET', path: '/dispensations', desc: 'Historique dispensations', auth: 'Auth' },
      { method: 'POST', path: '/dispensations', desc: 'Enregistrer dispensation + MAJ stock', auth: 'Auth' },
      { method: 'DELETE', path: '/dispensations/:id', desc: 'Annuler dispensation', auth: 'Auth' },
    ]
  },
  missions: {
    nom: 'Missions & Enquêtes / Missions & Surveys / Ayyukan Bincike',
    base: '/api/missions',
    endpoints: [
      { method: 'GET', path: '/', desc: 'Liste missions (admin: toutes, agent: affectées)', auth: 'Admin/Agent' },
      { method: 'POST', path: '/generer-formulaire', desc: 'Générer formulaire par IA (admin)', auth: 'Admin' },
      { method: 'POST', path: '/', desc: 'Créer mission (admin)', auth: 'Admin' },
      { method: 'PUT', path: '/:id', desc: 'Modifier mission (admin)', auth: 'Admin' },
      { method: 'POST', path: '/:id/accepter', desc: 'Accepter mission (agent)', auth: 'Agent' },
      { method: 'PUT', path: '/:id/reponses', desc: 'Sauvegarder/Soumettre réponses', auth: 'Agent' },
    ]
  },
  dashboard: {
    nom: 'Tableaux de Bord / Dashboards / Daga Bayanan',
    base: '/api/dashboard',
    endpoints: [
      { method: 'GET', path: '/agent', desc: 'Dashboard agent (son CSI)', auth: 'Agent/Admin' },
      { method: 'GET', path: '/superviseur', desc: 'Dashboard superviseur (sa région)', auth: 'Superviseur/Admin' },
      { method: 'GET', path: '/admin', desc: 'Dashboard admin (national)', auth: 'Admin' },
    ]
  },
  export: {
    nom: 'Export Données / Data Export / Fitar da Bayanan',
    base: '/api/export',
    endpoints: [
      { method: 'GET', path: '/export/rapport', desc: 'Export CSV rapport mensuel', auth: 'Auth (scope)' },
      { method: 'GET', path: '/export/stats', desc: 'Export CSV/Excel stats (format=csv|xlsx)', auth: 'Superviseur/Admin' },
    ]
  },
  alertes: {
    nom: 'Alertes / Alerts / Gargadi',
    base: '/api/alertes',
    endpoints: [
      { method: 'GET', path: '/epidemiologiques', desc: 'Alertes épidémiologiques (hausse pathologies)', auth: 'Superviseur/Admin' },
      { method: 'GET', path: '/csi-en-retard', desc: 'CSI en retard de rapport', auth: 'Superviseur/Admin' },
    ]
  },
  referentiels: {
    nom: 'Référentiels / References / Shafaffuka',
    base: '/api/referentiels',
    endpoints: [
      { method: 'GET', path: '/:type', desc: 'Lire référentiel (consultations|vaccins|services)', auth: 'Public' },
      { method: 'POST', path: '/:type', desc: 'Ajouter élément (admin)', auth: 'Admin' },
      { method: 'PUT', path: '/:type/:id', desc: 'Modifier élément (admin)', auth: 'Admin' },
      { method: 'DELETE', path: '/:type/:id', desc: 'Désactiver élément (admin)', auth: 'Admin' },
    ]
  },
  admin: {
    nom: 'Administration / Administration / Mulki',
    base: '/api/admin',
    endpoints: [
      { method: 'GET', path: '/audit', desc: 'Journal audit (filtres, pagination, CSV)', auth: 'Admin' },
      { method: 'GET', path: '/parametres', desc: 'Lire paramètres système', auth: 'Admin/Superviseur' },
      { method: 'PUT', path: '/parametres', desc: 'Modifier paramètre', auth: 'Admin' },
    ]
  },
  stats: {
    nom: 'Statistiques / Statistics / Lambobi',
    base: '/api/stats',
    endpoints: [
      { method: 'GET', path: '/stats', desc: 'Stats globales (consultations, vaccins, ruptures, évolution)', auth: 'Auth (scope)' },
      { method: 'GET', path: '/health', desc: 'Health check (DB, migrations, version)', auth: 'Public' },
    ]
  },
  logs: {
    nom: 'Logs Système / System Logs / Bayanan Tekuniyya',
    base: '/api/logs',
    endpoints: [
      { method: 'GET', path: '/view', desc: 'Interface logs HTTP + Audit + Erreurs (temps réel)', auth: 'Admin' },
      { method: 'POST', path: '/clear', desc: 'Vider logs mémoire', auth: 'Admin' },
    ]
  },
  apiDocs: {
    nom: 'Documentation API / API Documentation / Bayanan API',
    base: '/api/api-docs',
    endpoints: [
      { method: 'GET', path: '/view', desc: 'Cette page - Liste complète des APIs', auth: 'Admin' },
    ]
  }
};

// ── Vue HTMX : Documentation API complète ──
router.get('/view', auth(['admin']), (req, res) => {
  const categories = Object.keys(API_DOCS);
  const totalEndpoints = Object.values(API_DOCS).reduce((sum, cat) => sum + cat.endpoints.length, 0);

  const html = `
    <div class="api-docs-view">
      <div class="docs-header">
        <h3>📚 Documentation API Complète / Complete API Docs / Bayanan API Dayawa</h3>
        <div class="docs-stats">
          <span class="stat-badge">${categories.length} Modules</span>
          <span class="stat-badge">${totalEndpoints} Endpoints</span>
          <span class="stat-badge">Base: <code>/api</code></span>
        </div>
      </div>

      <div class="docs-search">
        <input type="text" id="api-search" placeholder="🔍 Rechercher endpoint, méthode, chemin..."
               oninput="filterApiDocs(this.value)" style="width:100%; padding:10px; font-size:1rem;">
      </div>

      <div class="docs-sidebar">
        <ul class="category-list">
          ${categories.map((cat, i) => `
            <li>
              <button class="cat-btn ${i === 0 ? 'active' : ''}" onclick="showCategory('${cat}')">
                ${API_DOCS[cat].nom.split(' / ')[0]}
              </button>
            </li>
          `).join('')}
        </ul>
      </div>

      <div class="docs-content">
        ${categories.map((cat, i) => `
          <div id="cat-${cat}" class="category-panel ${i === 0 ? 'active' : ''}" data-category="${cat}">
            <h4>${API_DOCS[cat].nom}</h4>
            <p class="text-muted">Base URL: <code>${API_DOCS[cat].base}</code></p>
            <div class="table-responsive">
              <table class="data-table api-table">
                <thead>
                  <tr><th>Méthode</th><th>Chemin</th><th>Description</th><th>Auth</th></tr>
                </thead>
                <tbody>
                  ${API_DOCS[cat].endpoints.map(ep => `
                    <tr>
                      <td><span class="badge method-${ep.method.toLowerCase()}">${ep.method}</span></td>
                      <td><code>${API_DOCS[cat].base}${ep.path}</code></td>
                      <td>${ep.desc}</td>
                      <td><span class="badge auth-${ep.auth.toLowerCase().replace(/[/\\s]/g, '-')}">${ep.auth}</span></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <style>
      .docs-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 12px; }
      .docs-stats { display: flex; gap: 8px; flex-wrap: wrap; }
      .stat-badge { background: var(--bg-tertiary); padding: 4px 10px; border-radius: 4px; font-size: 0.8rem; }
      .docs-search { margin-bottom: 16px; }
      .docs-search input { border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); }
      .docs-content { display: flex; gap: 24px; }
      .docs-sidebar { width: 220px; flex-shrink: 0; }
      .category-list { list-style: none; padding: 0; margin: 0; }
      .cat-btn { width: 100%; text-align: left; padding: 10px 12px; border: none; background: var(--bg-tertiary); border-radius: 6px; margin-bottom: 6px; cursor: pointer; font-weight: 500; color: var(--text); }
      .cat-btn:hover { background: var(--border); }
      .cat-btn.active { background: var(--primary); color: white; }
      .category-panel { display: none; flex: 1; }
      .category-panel.active { display: block; animation: fadeIn 0.2s; }
      @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
      .api-table { font-size: 0.85rem; }
      .api-table code { background: var(--bg-tertiary); padding: 2px 6px; border-radius: 3px; font-size: 0.8rem; }
      .badge.method-get { background: #e3f2fd; color: #1565c0; }
      .badge.method-post { background: #e8f5e9; color: #2e7d32; }
      .badge.method-put { background: #fff3e0; color: #ef6c00; }
      .badge.method-delete { background: #fce4ec; color: #c62828; }
      .badge.auth-public { background: #e8f5e9; color: #2e7d32; }
      .badge.auth-auth { background: #e3f2fd; color: #1565c0; }
      .badge.auth-admin { background: #fce4ec; color: #c62828; }
      .badge.auth-superviseur { background: #fff3e0; color: #ef6c00; }
      .badge.auth-admin-superviseur { background: #f3e5f5; color: #7b1fa2; }
      .table-responsive { overflow-x: auto; }
    </style>

    <script>
      function showCategory(cat) {
        document.querySelectorAll('.category-panel').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('cat-' + cat).classList.add('active');
        event.target.classList.add('active');
      }
      function filterApiDocs(query) {
        query = query.toLowerCase();
        document.querySelectorAll('.api-table tbody tr').forEach(row => {
          const text = row.innerText.toLowerCase();
          row.style.display = text.includes(query) ? '' : 'none';
        });
      }
    </script>
  `;
  res.send(html);
});

module.exports = router;