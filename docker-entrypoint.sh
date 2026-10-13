#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# docker-entrypoint.sh — CSI Niger v2.0
# Point d'entrée du conteneur : exécute les migrations, seeds puis démarre le serveur
# ─────────────────────────────────────────────────────────────────────────────
set -e

echo "═══════════════════════════════════════════════════"
echo "  🏥  CSI NIGER — Démarrage du conteneur"
echo "═══════════════════════════════════════════════════"

# Attendre que PostgreSQL soit vraiment prêt
echo "⏳ Vérification de la connexion à PostgreSQL..."
until node -e "
  const { Pool } = require('pg');
  const p = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
  p.query('SELECT 1').then(() => { console.log('OK'); p.end(); process.exit(0); })
    .catch(e => { p.end(); process.exit(1); });
" 2>/dev/null; do
  echo "   → PostgreSQL non prêt, nouvelle tentative dans 3s..."
  sleep 3
done
echo "✅ PostgreSQL prêt."

# 1. Exécuter les migrations SQL
echo ""
echo "🔄 Exécution des migrations..."
node migrations/run.js
echo "✅ Migrations terminées."

# 2. Seed du catalogue national des médicaments (idempotent)
echo ""
echo "📦 Initialisation / Mise à jour du catalogue des médicaments..."
node migrations/seed_catalogue.js || echo "  ℹ️  Catalogue déjà initialisé ou fichier CSV absent."

# 3. Initialiser le compte administrateur national si ADMIN_EMAIL est défini
if [ -n "$ADMIN_EMAIL" ]; then
  echo ""
  echo "👤 Initialisation du compte administrateur..."
  node migrations/seed_admin.js || echo "  ℹ️  Compte admin déjà existant."
fi

# 4. Profils de démo (uniquement si SEED_DEMO=true)
if [ "$SEED_DEMO" = "true" ]; then
  echo ""
  echo "🧪 Initialisation des profils de démonstration (SEED_DEMO=true)..."
  node migrations/seed_profiles.js || echo "  ℹ️  Profils de démonstration déjà configurés."
fi

# 5. Démarrer le serveur principal
echo ""
echo "🚀 Lancement du serveur Node.js sur le port ${PORT:-3000}..."
echo "═══════════════════════════════════════════════════"
exec node server.js
