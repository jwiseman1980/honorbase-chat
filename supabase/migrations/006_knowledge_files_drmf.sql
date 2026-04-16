-- Run in Supabase SQL Editor: https://supabase.com/dashboard/project/esoogmdwzcarvlodwbue/sql
-- Creates knowledge_files table (if not exists in honorbase-chat project)
-- and seeds DRMF's initial knowledge base from the honorbase-drmf data/ JSON files.
--
-- NOTE: If knowledge_files already exists in Project A from SHOS, this is idempotent.

CREATE TABLE IF NOT EXISTS public.knowledge_files (
  id          BIGSERIAL PRIMARY KEY,
  org_id      TEXT NOT NULL,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  category    TEXT,                    -- 'org_context', 'event', 'sponsors', 'tasks', 'social', etc.
  source      TEXT DEFAULT 'manual',  -- 'manual', 'import', 'chat'
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_files_org
  ON public.knowledge_files(org_id, category);

ALTER TABLE public.knowledge_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_knowledge_files"
  ON public.knowledge_files FOR ALL
  USING (true) WITH CHECK (true);

-- ── DRMF seed entries ─────────────────────────────────────────────────────────
-- Sourced from honorbase-drmf/data/ JSON files — April 2026 snapshot.

INSERT INTO public.knowledge_files (org_id, title, content, category, source, metadata)
VALUES

-- 1. Org context
(
  'drmf',
  'DRMF Overview',
  'Drew Ross Memorial Foundation (DRMF) is a 501(c)(3) based in Sneads Ferry, NC. Founded by Sarah Ross Geisen to honor her brother, Captain Andrew "Drew" Patrick Ross (West Point 2011, Green Beret, KIA Afghanistan November 27, 2018). Website: drewross.org. Email: sarah@drewross.org. Mailing: P.O. Box 441, Sneads Ferry, NC 28460. Instagram: @drew_ross_memorial_foundation (643 followers). Financials: ~$67K raised last year. Sarah salary: $1,500/month. Programs: Recreational Therapy (monthly flag-building in Richmond), CPT Drew Ross Leadership Award, RCHS Leadership Award, Community Service Projects. Steel Hearts Foundation is a key partner — donating ~200 memorial bracelets for the Ruck & Roll event.',
  'org_context',
  'import',
  '{"source_file": "honorbase-drmf README + system config"}'
),

-- 2. Flagship event
(
  'drmf',
  'Legacy Ruck & Roll 2026 — Event Details',
  '3rd Annual Legacy Ruck & Roll. Date: June 6, 2026, 9:30 AM – 12:30 PM. Start: VA War Memorial, Richmond, VA. Finish: The Foundry at Tredegar Iron Works. Routes: 2-mile (gentle) OR 3.5-mile (rugged). Beneficiaries: DRMF + Global War on Terrorism Memorial Foundation (GWOTMF). Venue contract signed with American Civil War Museum / Tredegar. Registration via RunSignUp: $45 early bird (through May 1), $55 after. Steel Hearts donating ~200 Drew Ross memorial bracelets for the event. Sarah wants a repeatable city playbook for expansion (Clarksville, TN on radar).',
  'event',
  'import',
  '{"event_id": "drmf-2026", "event_date": "2026-06-06", "source_file": "data/milestones.json + drmf.js system prompt"}'
),

-- 3. Sponsor pipeline
(
  'drmf',
  'Sponsor Pipeline — April 2026',
  'COMMITTED (2): Dominion Energy (Gold, $10,000 — Mike Thompson, community affairs, wants water station naming rights; contract pending); Mission BBQ (Bronze, $1,500 cash + in-kind post-event meal — Sarah Kowalski, regional). RESPONDED (1): Atlantic Union Bank (Silver, $5,000 — Jennifer Walsh; needs VP approval; budget cycle ends April 15). CONTACTED (1): Booz Allen Hamilton (Gold, $10,000 — Col. Ret. James Hartley; email sent April 1 via Drew West Point network; no response yet). IDENTIFIED (2): Virginia Tourism Corporation (Bronze, $2,500 — Heather to find POC by April 12); USAA (Gold, $10,000 — apply via Community Giving portal opening April 15). Committed cash total: $11,500. Pipeline potential: ~$38,500 additional.',
  'sponsors',
  'import',
  '{"committed_cash": 11500, "pipeline_potential": 38500, "source_file": "data/sponsors.json", "as_of": "2026-04-16"}'
),

-- 4. Task board
(
  'drmf',
  'Open Task Board — April 2026',
  'HIGH PRIORITY: (1) File permit with City of Richmond — Sarah, due Apr 10, in-progress (needs insurance cert; call 804-646-5000). (2) Confirm venue layout with Tredegar — Sarah, due Apr 8, NOT STARTED. (3) Launch RunSignUp registration page — Carly, due Apr 11, NOT STARTED. (4) Follow up Booz Allen Hamilton — Sarah, due Apr 8, NOT STARTED (try LinkedIn + phone). (5) Send 2025 sponsor thank-you packages — Sarah, due Apr 5, OVERDUE. MEDIUM: (6) T-shirt design + vendor (Carly, Apr 15, $12/shirt, 300 units, order by Apr 20). (7) Recruit volunteers to 20 (Heather, May 1 — 7/20 confirmed). (8) Order 200 memorial bracelets via Steel Hearts (Sarah, Apr 20). (9) Social content calendar Apr–Jun (Carly, Apr 9, in-progress). (10) Press release for RTD/WWBT/WTVR (Heather, Apr 14). LOW: (11) AV/sound system booking (Heather, Apr 25). (12) Medical support / first aid station (Heather, May 10).',
  'tasks',
  'import',
  '{"total_tasks": 12, "overdue": 1, "not_started_high": 4, "source_file": "data/tasks.json", "as_of": "2026-04-16"}'
),

-- 5. Social content calendar
(
  'drmf',
  'Social Content Queue — April–May 2026',
  'All posts are DRAFTS, none published yet. Apr 9: 59-day countdown (Instagram, Countdown — "59 days. That is how many days until we ruck for Drew."). Apr 11: Registration LIVE announcement (Instagram, Registration Launch). Apr 12: Dominion Energy Gold Sponsor spotlight ("We are HUMBLED to announce @DominionEnergy as our 2026 Gold Sponsor"). Apr 16: Training tip — ruck prep for 10K. Apr 17: 50-day countdown (Instagram, Countdown). Apr 20: 2025 event retrospective / social proof ("June 6, 2025 — 1 year ago, 200+ people came together..."). Post idea from Carly: short reel of Drew crew photo with mission overlay text (high engagement potential).',
  'social',
  'import',
  '{"posts_drafted": 6, "posts_published": 0, "source_file": "data/social.json", "as_of": "2026-04-16"}'
),

-- 6. Open ideas / notes
(
  'drmf',
  'Operational Notes — April 2026',
  'Kids ruck category idea (Sarah, Apr 7): Consider adding under-18 1-mile loop for families — would be very popular. Mission BBQ confirmed bringing food truck for post-ruck volunteer meal (Apr 5). Carly note (Apr 6): short video reel of Drew crew photo has high engagement potential. Volunteer count: 7/20 confirmed; Heather posting to VetCorps and local veteran orgs; volunteer roles need to be defined by April 15.',
  'notes',
  'import',
  '{"source_file": "data/notes.json + data/tasks.json", "as_of": "2026-04-16"}'
)

ON CONFLICT DO NOTHING;
