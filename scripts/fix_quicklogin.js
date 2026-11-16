const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

// 1. Injecter le script quickLogin AVANT l'auth-screen
const quickLoginScript = `
<!-- ── quickLogin : doit etre defini AVANT les boutons du DOM ── -->
<script>
function quickLogin(email) {
  var errDiv = document.getElementById('login-err');
  var allBtns = document.querySelectorAll('[data-qemail]');
  if (errDiv) {
    errDiv.removeAttribute('class');
    errDiv.style.cssText = 'margin-top:14px;padding:10px 14px;border-radius:8px;background:rgba(16,185,129,0.15);color:var(--text-primary);font-size:0.85rem;display:block';
    errDiv.textContent = 'Connexion en cours pour ' + email + '...';
  }
  allBtns.forEach(function(b){ b.disabled = true; b.style.opacity = '0.5'; });
  fetch('/api/quick-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email })
  })
  .then(function(r) { return r.json(); })
  .then(function(d) {
    if (!d.token) {
      allBtns.forEach(function(b){ b.disabled = false; b.style.opacity = '1'; });
      if (errDiv) {
        errDiv.style.background = 'rgba(239,68,68,0.15)';
        errDiv.style.color = '#ef4444';
        errDiv.textContent = 'Erreur : ' + (d.erreur || 'Inconnue');
      }
      return;
    }
    try { localStorage.setItem('csi_session', JSON.stringify({ token: d.token, user: d.utilisateur })); } catch(e) {}
    window.location.reload();
  })
  .catch(function(e) {
    allBtns.forEach(function(b){ b.disabled = false; b.style.opacity = '1'; });
    if (errDiv) {
      errDiv.style.background = 'rgba(239,68,68,0.15)';
      errDiv.style.color = '#ef4444';
      errDiv.textContent = 'Serveur inaccessible : ' + e.message;
    }
  });
}
<\/script>

`;

const authScreenMarker = '<!-- ======================================================================= -->\n<!-- ÉCRAN 1 : PAGE DE CONNEXION PLEIN ÉCRAN DÉDIÉE';
const idx = html.indexOf(authScreenMarker);
if (idx === -1) {
  console.error('Cannot find auth-screen marker!');
  process.exit(1);
}
html = html.slice(0, idx) + quickLoginScript + html.slice(idx);

// 2. Reconstruire les 4 boutons de profil avec data-qemail ET onclick
const profiles = [
  { email: 'chamsou@gmail.com', icon: '👑', nom: 'Chamsou Admin', role: 'Super Admin', desc: 'Accès national complet', roleColor: '#7c3aed' },
  { email: 'admin@csi-niger.ne', icon: '🏛️', nom: 'Administrateur National', role: 'Admin', desc: 'Ministère de la Santé', roleColor: '#7c3aed' },
  { email: 'superviseur.dosso@csi-niger.ne', icon: '🌐', nom: 'Superviseur Dosso', role: 'Régional', desc: 'Vue régionale Dosso', roleColor: '#0ea5e9' },
  { email: 'agent.centre@csi-niger.ne', icon: '🏥', nom: 'Agent de Santé CSI', role: 'Agent CSI', desc: 'Registre & Consultations', roleColor: '#10b981' },
];

const listStart = html.indexOf('<div style="display:flex;flex-direction:column;gap:9px" id="quick-profiles-list">');
const listEnd   = html.indexOf('</div>', listStart) + 6;

if (listStart === -1) {
  console.error('Cannot find quick-profiles-list!');
  process.exit(1);
}

const newButtons = profiles.map(p => {
  const qs = `display:flex;align-items:center;text-align:left;padding:12px 14px;` +
    `border:1px solid #374151;border-radius:10px;background:#1f2937;` +
    `width:100%;cursor:pointer;gap:10px`;
  return `<button type="button" data-qemail="${p.email}" onclick="quickLogin('${p.email}')" style="${qs}">` +
    `<span style="font-size:1.4rem">${p.icon}</span>` +
    `<div style="flex:1">` +
    `<div style="font-weight:700;font-size:0.9rem">${p.nom} <span style="margin-left:6px;font-size:0.68rem;background:${p.roleColor};color:#fff;border-radius:20px;padding:1px 7px">${p.role}</span></div>` +
    `<div style="font-size:0.75rem;opacity:0.7">${p.email} · ${p.desc}</div>` +
    `</div>` +
    `<span style="color:#10b981;font-weight:700">Entrer →</span>` +
    `</button>`;
}).join('\n          ');

html = html.slice(0, listStart) +
  `<div style="display:flex;flex-direction:column;gap:9px" id="quick-profiles-list">\n          ` +
  newButtons +
  `\n        </div>` +
  html.slice(listEnd);

fs.writeFileSync('public/index.html', html);
console.log('SUCCESS! quickLogin script injecté AVANT le DOM. Boutons reconstruits.');
