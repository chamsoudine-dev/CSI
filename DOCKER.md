# 🐳 Guide de Déploiement Docker — CSI Niger v2.0

## Architecture

```
csi_niger_network (réseau Docker isolé)
├── csi_niger_db    → PostgreSQL 16-alpine  (port interne 5432, exposé uniquement avec profil 'dev')
├── csi_niger_app   → Node.js 20-slim       (port 3000 ou $APP_PORT)
└── csi_niger_adminer → Adminer             (optionnel, profil 'admin', port 8080)
```

---

## ⚡ Démarrage Rapide

### 1. Prérequis
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) ou Docker Engine + Docker Compose v2
- Minimum **2 Go de RAM** disponible pour Docker

### 2. Configurer les variables d'environnement
```bash
# Copier le template et éditer les valeurs
cp .env.docker .env   # ou sous Windows: copy .env.docker .env
```

Dans `.env`, les variables suivantes sont **strictement obligatoires** (le compose échouera si elles sont vides) :
- `POSTGRES_PASSWORD` : mot de passe fort pour PostgreSQL
- `JWT_SECRET` : clé secrète pour signer les jetons JWT (min. 32 caractères)
- `ADMIN_PASSWORD` : mot de passe initial du compte administrateur national

> **Générer une clé secrète aléatoire :**
> ```bash
> node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
> ```

### 3. Lancer l'application complète
```bash
# Construire et démarrer tous les services de production
docker compose up --build -d

# Vérifier l'état des conteneurs
docker compose ps
docker compose logs -f app
```

L'application est immédiatement accessible sur **http://localhost:3000** 🎉.

Au démarrage du conteneur `app`, l'entrypoint effectue automatiquement et de façon idempotente :
1. L'application des migrations de base de données (`migrations/run.js`)
2. L'initialisation du compte administrateur national (`migrations/seed_admin.js`)
3. Le chargement idempotent du catalogue national des médicaments (`catalogue_niger.csv`)
4. (Optionnel) Les comptes de démonstration régionaux/CSI si `SEED_DEMO=true`.

---

## 🔐 Variables d'environnement supportées

| Variable | Description | Défaut | Obligatoire |
|---|---|---|---|
| `POSTGRES_DB` | Nom de la base de données PostgreSQL | `csi_niger` | Non |
| `POSTGRES_USER` | Utilisateur PostgreSQL | `csi_user` | Non |
| `POSTGRES_PASSWORD` | Mot de passe de PostgreSQL | *(aucun)* | **Oui** |
| `JWT_SECRET` | Clé secrète de signature JWT | *(aucun)* | **Oui** |
| `ADMIN_PASSWORD` | Mot de passe du compte admin national | *(aucun)* | **Oui** |
| `ADMIN_EMAIL` | Email de l'administrateur national | `admin@csi-niger.ne` | Non |
| `APP_PORT` | Port exposé sur l'hôte | `3000` | Non |
| `JWT_EXPIRES` | Durée de validité du token JWT | `8h` | Non |
| `TRUST_PROXY` | Activation de la confiance proxy (derrière Nginx/Traefik) | `1` | Non |
| `SEED_DEMO` | Créer les comptes de démo (superviseur, agent) | `false` | Non |
| `ALLOWED_ORIGINS` | Origines CORS autorisées (séparées par virgules) | *(toutes)* | Non |
| `LOG_LEVEL` | Niveau de verbosité des logs (`info`, `debug`, `warn`, `error`) | `info` | Non |

---

## 🛠️ Profils Docker Compose

### Profil `dev` (accès direct à la base PostgreSQL)
Par défaut, le port 5432 de PostgreSQL **n'est pas exposé** sur l'hôte pour des raisons de sécurité. Pour l'exposer lors du développement local :
```bash
docker compose --profile dev up -d
```
PostgreSQL sera joignable sur `localhost:5432`.

### Profil `admin` (interface Adminer)
Pour administrer la base PostgreSQL via un navigateur web :
```bash
docker compose --profile admin up -d
```
Adminer sera disponible sur **http://localhost:8080** :
- **Système** : PostgreSQL
- **Serveur** : `db`
- **Utilisateur** : `csi_user` (ou `$POSTGRES_USER`)
- **Mot de passe** : valeur de `$POSTGRES_PASSWORD`
- **Base de données** : `csi_niger`

---

## 📦 Sauvegarde et Restauration

### Sauvegarde automatisée (`scripts/backup.sh`)
Un script de sauvegarde complet et configurable est disponible dans `scripts/backup.sh`.
Il génère des archives compressées `.sql.gz` horodatées et supprime automatiquement les sauvegardes de plus de 30 jours.

```bash
# Rendre exécutable et lancer manuellement
chmod +x scripts/backup.sh
./scripts/backup.sh
```

#### Planification quotidienne via Cron (ex: à 02h00 chaque nuit)
```cron
0 2 * * * /chemin/vers/csi-niger/scripts/backup.sh >> /var/log/csi-backup.log 2>&1
```

### Sauvegarde et restauration manuelles via Docker
```bash
# Sauvegarde manuelle
docker compose exec -T db pg_dump -U csi_user -d csi_niger | gzip -9 > backup_$(date +%Y%m%d).sql.gz

# Restauration manuelle
gunzip -c backup_20241012.sql.gz | docker compose exec -T db psql -U csi_user -d csi_niger
```

---

## 🩺 Santé et Monitoring (/api/health)

L'endpoint de monitoring `/api/health` est interrogé par le HEALTHCHECK de Docker et fournit un état détaillé :

```bash
curl http://localhost:3000/api/health
```

Réponse type (HTTP 200) :
```json
{
  "status": "ok",
  "db": "ok",
  "db_latency_ms": 2,
  "uptime_s": 3600,
  "timestamp": "2026-10-13T17:00:00.000Z",
  "version": "2.0.0",
  "migrations_appliquees": [
    "001_schema.sql",
    "002_utilisateurs.sql",
    "003_cree_par_utilisateurs.sql",
    "004_catalogue_medicaments.sql",
    "005_ravitaillement_maternite.sql",
    "006_patients.sql"
  ]
}
```
Si la base de données est injoignable, l'endpoint renvoie un code HTTP 503 :
```json
{
  "status": "error",
  "db": "down",
  "timestamp": "2026-10-13T17:00:00.000Z"
}
```
