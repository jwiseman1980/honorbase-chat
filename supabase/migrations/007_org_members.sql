-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/esoogmdwzcarvlodwbue/sql
-- org_members: email-to-org access control for multi-tenant auth.
-- Pairs with Google OAuth via next-auth — the authenticated email is looked
-- up here to determine whether the user can access a given org's chat.

CREATE TABLE IF NOT EXISTS public.org_members (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     TEXT        NOT NULL REFERENCES public.honorbase_orgs(id),
  email      TEXT        NOT NULL,
  role       TEXT        NOT NULL DEFAULT 'member',
  name       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, email)
);

ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_org_members"
  ON public.org_members FOR ALL
  USING (true) WITH CHECK (true);

-- ── Seed: existing whitelisted users ─────────────────────────────────────────
-- Keep this in sync with WHITELIST in auth.ts when adding new users.

INSERT INTO public.org_members (org_id, email, role, name) VALUES
  ('drmf',        'sarah@drewross.org',              'executive-director', 'Sarah Ross Geisen'),
  ('steel-hearts', 'kristin.hughes@steel-hearts.org', 'member',            'Kristin Hughes')
ON CONFLICT (org_id, email) DO NOTHING;
