-- Run this in the Supabase SQL Editor: https://supabase.com/dashboard/project/esoogmdwzcarvlodwbue/sql
-- One-time setup for HonorBase Chat persistence

CREATE TABLE IF NOT EXISTS public.hb_messages (
  id BIGSERIAL PRIMARY KEY,
  org_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hb_messages_org_created
  ON public.hb_messages(org_id, created_at);

ALTER TABLE public.hb_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_hb_messages"
  ON public.hb_messages FOR ALL
  USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.hb_dashboard_cards (
  org_id   TEXT NOT NULL,
  card_id  TEXT NOT NULL,
  data     JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (org_id, card_id)
);

ALTER TABLE public.hb_dashboard_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_hb_dashboard"
  ON public.hb_dashboard_cards FOR ALL
  USING (true) WITH CHECK (true);
