# 🏥 Registre des CSI du Niger — v2.0

Système national de gestion et de suivi des **Centres de Santé Intégrés (CSI)** du Niger.
Conçu pour être déployé dans plusieurs CSI à travers le pays, avec une gestion centralisée des données de santé.

---

## 🏗️ Architecture

```
csi-niger/
├── server.js                   # Point d'entrée (sécurité, rate limiting, logging)
├── src/
│   ├── config/database.js      # Pool PostgreSQL configuré
│   ├── middleware/
│   │   ├── auth.js             # JWT + contrôle de rôles
│   │   └── validate.js         # Validation Joi des entrées
│   └── routes/
│       ├── auth.js             # Login, gestion utilisateurs
│       ├── csi.js              # CRUD des CSI avec pagination
│       ├── rapports.js         # Saisie et consultation des rapports
│       ├── stats.js            # Statistiques + health check
│       └── export.js           # Export CSV
├── migrations/
│   ├── 001_schema.sql          # Schéma renforcé avec index et contraintes
│   ├── 002_utilisateurs.sql    # Table utilisateurs, audit, triggers
│   ├── run.js                  # Exécuteur de migrations
│   └── seed_admin.js           # Création du premier admin
└── public/index.html           # Interface utilisateur (SPA)
```

---

## 🚀 Installation & Démarrage

### 1. Prérequis
- Node.js 18+
- PostgreSQL 14+

### 2. Installation
```bash
npm install
```

### 3. Configuration
Copier `.env.example` en `.env` et remplir les valeurs :
```bash
cp .env.example .env
```

Variables obligatoires :
| Variable | Description |
|---|---|
| `DATABASE_URL` | URL de connexion PostgreSQL |
| `JWT_SECRET` | Clé secrète JWT (min. 32 caractères) |

### 4. Base de données
```bash
# Créer la base de données
createdb csi_niger

# Appliquer les migrations
npm run migrate

# Créer le premier administrateur
npm run seed
```

### 5. Démarrage
```bash
# Production
npm start

# Développement (rechargement automatique)
npm run dev
```

---

## 👥 Gestion des utilisateurs

| Rôle | Droits |
|---|---|
| **admin** | Accès complet — gestion utilisateurs, tous les CSI |
| **superviseur** | Voit et gère les CSI de sa région |
| **agent** | Saisit uniquement les données de son propre CSI |

### Créer un utilisateur (via l'interface)
1. Connectez-vous en tant qu'administrateur
2. Allez dans l'onglet **👥 Utilisateurs**
3. Cliquez **+ Ajouter un utilisateur**

---

## 🔒 Sécurité

- **JWT** avec expiration configurable (défaut : 7 jours)
- **Rate limiting** : 15 tentatives/15min sur le login, 300 req/min sur l'API
- **Helmet** : en-têtes HTTP de sécurité (CSP, HSTS, etc.)
- **Bcrypt** (coût 12) pour les mots de passe
- **Validation Joi** de toutes les entrées
- **Contrôle d'accès** : les agents ne peuvent accéder qu'à leur propre CSI

---

## 📡 API

| Endpoint | Méthode | Auth | Description |
|---|---|---|---|
| `/api/login` | POST | — | Connexion |
| `/api/me` | GET | ✅ | Infos utilisateur courant |
| `/api/utilisateurs` | GET/POST | Admin | Gestion utilisateurs |
| `/api/utilisateurs/:id` | PUT/DELETE | Admin | Modifier/désactiver |
| `/api/regions` | GET | — | Liste des 8 régions |
| `/api/csi` | GET | — | Liste CSI (paginée) |
| `/api/csi/:id` | GET | — | Détail d'un CSI |
| `/api/csi` | POST | Superviseur+ | Ajouter un CSI |
| `/api/csi/:id` | PUT/DELETE | Admin | Modifier/désactiver |
| `/api/rapport` | GET | Agent+ | Lire un rapport |
| `/api/rapport` | PUT | Agent+ | Sauvegarder un rapport |
| `/api/rapports/liste` | GET | Superviseur+ | Liste avec statut |
| `/api/stats` | GET | — | Statistiques du tableau de bord |
| `/api/export/rapport` | GET | Agent+ | Export CSV d'un rapport |
| `/api/export/stats` | GET | Superviseur+ | Export CSV national |
| `/api/health` | GET | — | État du serveur (monitoring) |

---

## 🩺 Monitoring

Endpoint de santé disponible à `/api/health` :
```json
{
  "status": "ok",
  "db": "ok",
  "db_latency_ms": 3,
  "uptime_s": 1234,
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

## 📦 Déploiement national multi-CSI

**Architecture recommandée** : une seule instance centrale hébergée sur un serveur, tous les CSI se connectent via HTTPS.

### Variables d'environnement supplémentaires pour la production :
```env
NODE_ENV=production
DATABASE_SSL=true
ALLOWED_ORIGINS=https://votre-domaine.ne
LOG_LEVEL=warn
JWT_EXPIRES=8h
```

---

## 🔄 Ajouter des migrations futures

Créer un nouveau fichier `migrations/003_nom.sql` et exécuter `npm run migrate`.
Les migrations déjà appliquées ne sont jamais rejouées.
