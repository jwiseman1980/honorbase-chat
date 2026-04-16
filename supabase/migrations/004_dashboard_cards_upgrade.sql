-- Upgrade hb_dashboard_cards with structured columns for AI-generated cards.
-- Run in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/esoogmdwzcarvlodwbue/sql
--
-- Must be applied before deploying the dashboard generation cron.

ALTER TABLE public.hb_dashboard_cards
  ADD COLUMN IF NOT EXISTS card_type     TEXT,
  ADD COLUMN IF NOT EXISTS priority      INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS action_type   TEXT,
  ADD COLUMN IF NOT EXISTS action_target TEXT,
  ADD COLUMN IF NOT EXISTS generated_at  TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS generated_by  TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS expires_at    TIMESTAMPTZ;

-- Fast lookup for the dashboard GET (priority-ordered cards per org)
CREATE INDEX IF NOT EXISTS idx_hb_dashboard_cards_org_priority
  ON public.hb_dashboard_cards(org_id, priority DESC);

-- Fast deletion of cron-generated cards during daily regeneration
CREATE INDEX IF NOT EXISTS idx_hb_dashboard_cards_generated_by
  ON public.hb_dashboard_cards(org_id, generated_by);
