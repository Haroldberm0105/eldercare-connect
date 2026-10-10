-- Clinic Risk Queue Service - owns: patient risk scores, clinic follow-up actions, triage status.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS risk_queue (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id         TEXT        NOT NULL,
  patient_name       TEXT        NOT NULL,
  zip_code           TEXT,
  assigned_clinic    TEXT,
  conditions         TEXT[]      NOT NULL DEFAULT '{}',
  mobility_restricted BOOLEAN    NOT NULL DEFAULT FALSE,
  health_score       SMALLINT    NOT NULL DEFAULT 0,   -- internal severity (vitals / missed check-in)
  environment_score  SMALLINT    NOT NULL DEFAULT 0,   -- external exposure (heat / storm)
  emr_score          SMALLINT    NOT NULL DEFAULT 0,   -- legacy EMR history enrichment
  total_score        SMALLINT    NOT NULL DEFAULT 0,
  priority           TEXT        NOT NULL DEFAULT 'P4', -- P1 critical .. P4 routine
  status             TEXT        NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','in_review','scheduled','resolved','dismissed')),
  reasons            JSONB       NOT NULL DEFAULT '[]',
  assigned_to        TEXT,
  last_event_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- At most one active triage item per patient; new signals update it instead of duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS uq_risk_queue_active_patient
  ON risk_queue (patient_id) WHERE status IN ('open','in_review','scheduled');
CREATE INDEX IF NOT EXISTS idx_risk_queue_rank ON risk_queue (status, total_score DESC, last_event_at DESC);

CREATE TABLE IF NOT EXISTS followup_actions (
  id             BIGSERIAL PRIMARY KEY,
  queue_item_id  UUID        NOT NULL REFERENCES risk_queue(id),
  action         TEXT        NOT NULL,
  from_status    TEXT,
  to_status      TEXT,
  notes          TEXT,
  performed_by   TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_followup_item ON followup_actions (queue_item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS processed_events (
  event_id     UUID PRIMARY KEY,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
