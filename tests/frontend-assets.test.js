const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');

test('Frontend - les styles et scripts sont servis comme fichiers statiques', () => {
  assert.match(html, /<link rel="stylesheet" href="\/css\/app\.css">/);
  assert.deepEqual(
    [...html.matchAll(/<script src="(\/js\/[^"]+)"><\/script>/g)].map(match => match[1]),
    ['/js/app.js']
  );
  assert.equal((html.match(/<style\b/gi) || []).length, 0);
  assert.equal((html.match(/<script>([\s\S]*?)<\/script>/gi) || []).length, 0);

  for (const asset of ['css/app.css', 'js/app.js']) {
    assert.ok(fs.existsSync(path.join(publicDir, asset)), `${asset} doit exister`);
  }
  assert.doesNotMatch(html, /quick-login|Accéder sans mot de passe|Mode Découverte/i);
});

test('Frontend - HTMX et Alpine.js sont chargés pour la navigation fluide', () => {
  assert.match(html, /<script src="https:\/\/unpkg.com\/htmx\.org/);
  assert.match(html, /<script defer src="https:\/\/unpkg.com\/alpinejs/);
  assert.match(html, /hx-get="/, 'Les boutons de navigation doivent utiliser hx-get');
});

test('Frontend - la navigation principale est présente sans page de login', () => {
  // L'application s'affiche directement (pas de auth-screen)
  assert.doesNotMatch(html, /id="auth-screen"/, 'L\'écran de connexion a été supprimé');
  assert.match(html, /id="app-screen"(?! class="hid")/, 'L\'application s\'affiche directement');
});

test('Frontend - le menu latéral contient tous les modules', () => {
  const modules = [
    'Tableau de bord', 'Dossier & Patients', 'Registre des CSI', 'Catalogue',
    'Missions', 'Ravitaillement', 'Maternité', 'UNFPA', 'Alertes',
    'Utilisateurs', 'Logs Système', 'Doc API', 'Paramètres'
  ];
  for (const module of modules) {
    assert.match(html, new RegExp(module), `Module "${module}" doit être dans le menu`);
  }
});

test('Frontend - les sections principales existent', () => {
  const sections = ['tb', 'patients', 'liste', 'catalogue', 'enquete', 'ravitaillement',
                    'maternite', 'alertes', 'utilisateurs', 'parametres', 'unfpa', 'logs', 'api-docs'];
  for (const section of sections) {
    assert.match(html, new RegExp(`id="${section}"`), `Section #${section} doit exister`);
  }
});

test('Frontend - le drapeau du Niger et les icônes sont présents', () => {
  // Le drapeau est dans le header de l'app (brand)
  assert.match(html, /CSI NIGER/);
  assert.match(html, /Ministère de la Santé/);
});

test('Frontend - Alpine.js initialisé pour l\'état local', () => {
  const appJs = fs.readFileSync(path.join(publicDir, 'js', 'app.js'), 'utf8');
  assert.match(appJs, /alpine:init/, 'Alpine.js doit être initialisé');
  assert.match(appJs, /navigateView/, 'Navigation HTMX doit être gérée');
  assert.match(appJs, /switchParamTab/, 'Onglets paramètres doivent être gérés');
});