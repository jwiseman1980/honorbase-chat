-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/esoogmdwzcarvlodwbue/sql
-- HonorBase org registry — maps org slugs to metadata for multi-tenant routing.
-- Phase 1: simple table. Auth and per-org billing live here later.

CREATE TABLE IF NOT EXISTS public.honorbase_orgs (
  id          TEXT PRIMARY KEY,              -- slug: 'drmf', 'steel-hearts', 'blue-skies'
  name        TEXT NOT NULL,
  description TEXT,
  ed_name     TEXT,                          -- Executive Director
  ed_email    TEXT,
  website     TEXT,
  phone       TEXT,
  onboarded_at TIMESTAMPTZ DEFAULT NOW(),
  metadata    JSONB NOT NULL DEFAULT '{}'
);

ALTER TABLE public.honorbase_orgs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_honorbase_orgs"
  ON public.honorbase_orgs FOR ALL
  USING (true) WITH CHECK (true);

-- ── Seed data ─────────────────────────────────────────────────────────────────

INSERT INTO public.honorbase_orgs (id, name, description, ed_name, ed_email, website, onboarded_at, metadata)
VALUES
  (
    'steel-hearts',
    'Steel Hearts Foundation',
    '501(c)(3) honoring fallen soldiers through custom memorial bracelets distributed to families, partners, and supporters.',
    'Joseph Wiseman',
    'joseph.wiseman@steel-hearts.org',
    'https://steel-hearts.org',
    '2024-01-01T00:00:00Z',
    '{"focus": "Memorial bracelets", "heroes_on_site": 450, "founding_year": 2022, "is_internal": true}'
  ),
  (
    'drmf',
    'Drew Ross Memorial Foundation',
    '501(c)(3) honoring Captain Andrew "Drew" Patrick Ross (West Point 2011, KIA Afghanistan 2018) through community engagement, recreational therapy, and the Annual Legacy Ruck & Roll.',
    'Sarah Ross Geisen',
    'sarah@drewross.org',
    'https://drewross.org',
    '2026-04-16T00:00:00Z',
    '{"focus": "Army veteran memorial and recreational therapy", "flagship_event": "Legacy Ruck & Roll (June 6, 2026, Richmond VA)", "instagram": "@drew_ross_memorial_foundation", "is_external_customer": true}'
  )
ON CONFLICT (id) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  ed_name     = EXCLUDED.ed_name,
  ed_email    = EXCLUDED.ed_email,
  website     = EXCLUDED.website,
  metadata    = EXCLUDED.metadata;
