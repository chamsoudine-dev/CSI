# ─────────────────────────────────────────────────────────────────
# CSI NIGER — Dockerfile de Production Ultra-Rapide (Debian Slim)
# Utilise node:20-slim pour bénéficier des binaires précompilés bcrypt
# sans nécessiter de compilation C++ lente ou instable.
# ─────────────────────────────────────────────────────────────────

# ÉTAPE 1 : Dépendances
FROM node:20-slim AS deps
WORKDIR /app

# Copie des manifestes de dépendances
COPY package.json package-lock.json ./

# Installation propre des dépendances de production
RUN npm install --omit=dev

# ─────────────────────────────────────────────────────────────────
# ÉTAPE 2 : Image d'Exécution Finale
# ─────────────────────────────────────────────────────────────────
FROM node:20-slim AS runner

LABEL maintainer="MS/HP Niger — Direction Informatique"
LABEL description="CSI Niger — Système National de Surveillance Sanitaire"
LABEL version="2.0.0"

WORKDIR /app

# Copie des dépendances précompilées depuis l'étape 1
COPY --from=deps --chown=node:node /app/node_modules ./node_modules

# Copie des fichiers applicatifs
COPY --chown=node:node package.json         ./
COPY --chown=node:node server.js            ./
COPY --chown=node:node src/                 ./src/
COPY --chown=node:node public/              ./public/
COPY --chown=node:node migrations/          ./migrations/
COPY --chown=node:node catalogue_niger.csv ./catalogue_niger.csv
COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh

# Nettoyage des retours chariot Windows CRLF et permissions
RUN sed -i 's/\r$//' ./docker-entrypoint.sh && chmod +x ./docker-entrypoint.sh

# Configuration de l'environnement
ENV NODE_ENV=production \
    PORT=3000 \
    LOG_LEVEL=info

EXPOSE 3000

# Utilisation du compte non-root intégré à l'image officielle Node
USER node

# Healthcheck 100% natif Node 20 (pas besoin d'outil externe)
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
