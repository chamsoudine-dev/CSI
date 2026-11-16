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

test('Frontend - la connexion identifie l’espace à partir du compte et impose une connexion à chaque ouverture', () => {
  const appJs = fs.readFileSync(path.join(publicDir, 'js', 'app.js'), 'utf8');

  assert.match(html, /Connectez-vous avec votre adresse e-mail et votre mot de passe/);
  assert.doesNotMatch(html, /localStorage\.persist\('csi_session'\)/, 'La session ne doit pas être persistée sans authentification');
  assert.match(appJs, /alpine:init/, 'Alpine.js doit être initialisé pour gérer l\'état local');
});

test('Frontend - les onglets profil utilisent des gestionnaires compatibles CSP et la navigation Missions est présente', () => {
  const appJs = fs.readFileSync(path.join(publicDir, 'js', 'app.js'), 'utf8');

  assert.match(appJs, /htmx:afterOnLoad/, 'Les gestionnaires doivent être compatibles avec le chargement HTMX');
  assert.match(html, /id="nav-enquete">🧭 <span class="nav-label">Missions<\/span>/);
});

test('Frontend - le drapeau du Niger et les commandes afficher/masquer sont présents', () => {
  const css = fs.readFileSync(path.join(publicDir, 'css', 'app.css'), 'utf8');

  assert.match(html, /aria-label="Drapeau du Niger"/);
  assert.match(css, /\.auth-flag-strip span:nth-child\(2\)::after/);
  assert.equal((html.match(/data-password-toggle=/g) || []).length, 3);
  assert.equal((html.match(/<svg viewBox="0 0 24 24" aria-hidden="true">/g) || []).length, 3);
  // HTMX et Alpine.js sont chargés via CDN, aria-pressed est géré par la structure HTML existante
  assert.ok(html.includes('aria-pressed'), 'Les boutons doivent gérer l\'état focus/aria-pressed');
});