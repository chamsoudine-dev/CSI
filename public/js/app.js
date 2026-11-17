/**
 * CSI Niger v2.0 — Script Frontend Léger
 * Navigation gérée par HTMX + Alpine.js
 */

// État global simple pour la navigation (remplace l'ancien state)
window.appState = {
  user: {
    id: 1,
    nom: 'Admin Test',
    role: 'admin',
    csi_id: 1,
    region_id: 1
  },
  currentView: 'tb'
};

// Navigation entre vues (appelée par onclick dans le HTML)
window.navigateView = function(viewId) {
  // Mettre à jour l'onglet actif visuellement
  document.querySelectorAll('#nav button').forEach(btn => btn.classList.remove('on'));
  const activeBtn = document.querySelector(`#nav button[hx-target="#${viewId}"]`) ||
                    document.querySelector(`#nav button[data-v="${viewId}"]`);
  if (activeBtn) activeBtn.classList.add('on');

  window.appState.currentView = viewId;
};

// Initialisation Alpine.js
document.addEventListener('alpine:init', () => {
  console.log('Alpine.js prêt');
});

// Gestion du chargement HTMX
document.body.addEventListener('htmx:afterOnLoad', (e) => {
  console.log('HTMX chargé:', e.detail.elt.id || e.detail.elt);
});

// Gestion des onglets dans les paramètres (compatibilité)
window.switchParamTab = function(tabId, btn) {
  document.querySelectorAll('.param-tab').forEach(t => t.classList.add('hid'));
  document.querySelectorAll('#param-tabs button').forEach(b => b.classList.remove('on'));
  const tab = document.getElementById(tabId);
  if (tab) tab.classList.remove('hid');
  if (btn) btn.classList.add('on');
};

// Toggle mot de passe
document.body.addEventListener('click', (e) => {
  if (e.target.closest('[data-password-toggle]')) {
    const btn = e.target.closest('[data-password-toggle]');
    const inputId = btn.dataset.passwordToggle;
    const input = document.getElementById(inputId);
    if (input) {
      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      btn.setAttribute('aria-pressed', !visible);
      btn.querySelector('svg').style.opacity = visible ? '0.5' : '1';
    }
  }
});

// Afficher/masquer sidebar mobile
const sidebarToggle = document.getElementById('sidebar-toggle');
const nav = document.getElementById('nav');
if (sidebarToggle && nav) {
  sidebarToggle.addEventListener('click', () => {
    nav.classList.toggle('open');
  });
}

// Plein écran
const fullscreenToggle = document.getElementById('fullscreen-toggle');
if (fullscreenToggle) {
  fullscreenToggle.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  });
}

// Thème
const themeToggle = document.getElementById('theme-toggle');
if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    document.documentElement.dataset.theme =
      document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  });
}

// Déconnexion (simulation en MODE_DEV)
const authBtn = document.getElementById('auth-btn');
if (authBtn) {
  authBtn.addEventListener('click', () => {
    if (confirm('Déconnexion ?')) {
      window.location.reload();
    }
  });
}
