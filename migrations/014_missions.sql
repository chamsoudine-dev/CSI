CREATE TABLE IF NOT EXISTS missions (
  id            SERIAL PRIMARY KEY,
  titre         TEXT NOT NULL CHECK (length(trim(titre)) BETWEEN 2 AND 160),
  description   TEXT NOT NULL DEFAULT '',
  formulaire    JSONB NOT NULL DEFAULT '{"fields":[]}'::jsonb,
  date_limite   DATE,
  statut        TEXT NOT NULL DEFAULT 'BROUILLON'
                CHECK (statut IN ('BROUILLON', 'PUBLIEE', 'CLOTUREE')),
  cree_par      INT REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le       TIMESTAMPTZ NOT NULL DEFAULT now(),
  modifie_le    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mission_affectations (
  id            SERIAL PRIMARY KEY,
  mission_id    INT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  agent_id      INT NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  csi_id        INT NOT NULL REFERENCES csi(id) ON DELETE CASCADE,
  statut        TEXT NOT NULL DEFAULT 'AFFECTEE'
                CHECK (statut IN ('AFFECTEE', 'EN_COURS', 'SOUMISE')),
  reponses      JSONB NOT NULL DEFAULT '{}'::jsonb,
  affectee_le   TIMESTAMPTZ NOT NULL DEFAULT now(),
  modifiee_le   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (mission_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_missions_statut_date
  ON missions(statut, date_limite);
CREATE INDEX IF NOT EXISTS idx_mission_affectations_agent
  ON mission_affectations(agent_id, statut);
CREATE INDEX IF NOT EXISTS idx_mission_affectations_mission
  ON mission_affectations(mission_id);