-- Run this in the Supabase SQL Editor: https://supabase.com/dashboard/project/esoogmdwzcarvlodwbue/sql
-- Phase 1: org_stream table — unified activity/event log for all HonorBase orgs

-- ── Enum ──────────────────────────────────────────────────────────────────────

CREATE TYPE IF NOT EXISTS public.stream_type AS ENUM (
  'chat_turn',       -- every assistant response turn
  'friction',        -- detected user confusion / frustration
  'task_completed',  -- a discrete task or action was completed
  'milestone',       -- a significant org milestone
  'alert',           -- system or operator-generated alert
  'note'             -- manual annotation by operator
);

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.org_stream (
  id            BIGSERIAL PRIMARY KEY,
  org_id        TEXT NOT NULL,
  stream_type   public.stream_type NOT NULL,
  actor         TEXT NOT NULL DEFAULT 'system',   -- 'user', 'system', or a user name
  title         TEXT NOT NULL,                    -- one-line summary, always present
  body          TEXT,                             -- optional longer detail
  metadata      JSONB NOT NULL DEFAULT '{}',      -- arbitrary structured data
  related_table TEXT,                             -- e.g. 'hb_messages', 'event_tasks'
  related_id    TEXT,                             -- PK of the related row
  tags          TEXT[] NOT NULL DEFAULT '{}',     -- free-form labels for filtering
  importance    TEXT NOT NULL DEFAULT 'medium'    -- 'low' | 'medium' | 'high' | 'critical'
                  CHECK (importance IN ('low', 'medium', 'high', 'critical')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- 1. Primary query pattern: org timeline
CREATE INDEX IF NOT EXISTS idx_org_stream_org_created
  ON public.org_stream(org_id, created_at DESC);

-- 2. Filter by stream type within an org
CREATE INDEX IF NOT EXISTS idx_org_stream_org_type
  ON public.org_stream(org_id, stream_type);

-- 3. Filter by importance within an org
CREATE INDEX IF NOT EXISTS idx_org_stream_org_importance
  ON public.org_stream(org_id, importance);

-- 4. Join / lookup by related entity
CREATE INDEX IF NOT EXISTS idx_org_stream_related
  ON public.org_stream(related_table, related_id)
  WHERE related_table IS NOT NULL;

-- 5. Tag-based filtering (GIN for array containment queries)
CREATE INDEX IF NOT EXISTS idx_org_stream_tags
  ON public.org_stream USING GIN (tags);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.org_stream ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_org_stream"
  ON public.org_stream FOR ALL
  USING (true) WITH CHECK (true);
