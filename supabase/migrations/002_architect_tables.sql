-- Run this in the Supabase SQL Editor: https://supabase.com/dashboard/project/esoogmdwzcarvlodwbue/sql
-- HonorBase Architect: build queue table

CREATE TABLE IF NOT EXISTS public.build_queue (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  description TEXT NOT NULL,
  requested_by_org TEXT,
  priority    TEXT NOT NULL DEFAULT 'medium'
                CHECK (priority IN ('high', 'medium', 'low')),
  status      TEXT NOT NULL DEFAULT 'backlog'
                CHECK (status IN ('backlog', 'in-progress', 'done')),
  source      TEXT NOT NULL DEFAULT 'manual'
                CHECK (source IN ('chat', 'manual')),
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_build_queue_status
  ON public.build_queue(status, priority);

ALTER TABLE public.build_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_build_queue"
  ON public.build_queue FOR ALL
  USING (true) WITH CHECK (true);
