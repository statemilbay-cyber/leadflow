-- Runs once, on the first start of an empty Postgres volume.
-- n8n keeps its own state in a separate database; leads live in "leadflow".
CREATE DATABASE n8n;

\connect leadflow

CREATE TABLE IF NOT EXISTS leads (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    received_at  timestamptz NOT NULL DEFAULT now(),
    source       text        NOT NULL,
    name         text,
    email        text,
    company      text,
    message      text        NOT NULL,
    category     text        NOT NULL CHECK (category IN
                   ('sales_inquiry', 'support', 'partnership', 'job_application', 'spam', 'other')),
    urgency      text        NOT NULL CHECK (urgency IN ('high', 'medium', 'low')),
    budget_usd   integer,
    language     text,
    summary      text        NOT NULL,
    route        text        NOT NULL CHECK (route IN ('alert', 'reply', 'archive')),
    draft_reply  text,
    classifier   text        NOT NULL,   -- model id, or 'rules' in mock mode
    raw          jsonb       NOT NULL    -- the full classification, for audits and re-training
);
CREATE INDEX IF NOT EXISTS leads_received_at ON leads (received_at DESC);
CREATE INDEX IF NOT EXISTS leads_route ON leads (route);

CREATE TABLE IF NOT EXISTS workflow_errors (
    id            bigserial   PRIMARY KEY,
    occurred_at   timestamptz NOT NULL DEFAULT now(),
    workflow      text,
    execution_id  text,
    node          text,
    message       text,
    details       jsonb
);
