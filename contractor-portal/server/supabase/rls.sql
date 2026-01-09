-- Contractor Portal (cp_*) RLS hardening for Supabase
--
-- Why: Supabase auto-exposes tables in the `public` schema via the REST API.
-- The Security Advisor warnings you’re seeing are because RLS is disabled by default.
--
-- Our portal server uses the Service Role key, which BYPASSES RLS.
-- Enabling RLS + adding no client policies means:
-- - anon/authenticated clients cannot read/write these tables via Supabase API
-- - only server-side code using service role can access them

-- Enable RLS on all cp_* tables
alter table public.cp_contractors enable row level security;
alter table public.cp_sessions enable row level security;
alter table public.cp_homeowners enable row level security;
alter table public.cp_leads enable row level security;
alter table public.cp_lead_interests enable row level security;
alter table public.cp_lead_questions enable row level security;
alter table public.cp_credit_ledger enable row level security;
alter table public.cp_contractor_photos enable row level security;
alter table public.cp_audit_log enable row level security;

-- Optional: make sure no accidental grants exist for anon/authenticated
revoke all on table
  public.cp_contractors,
  public.cp_sessions,
  public.cp_homeowners,
  public.cp_leads,
  public.cp_lead_interests,
  public.cp_lead_questions,
  public.cp_credit_ledger,
  public.cp_contractor_photos,
  public.cp_audit_log
from anon, authenticated;

-- NOTE:
-- We intentionally do NOT add any RLS policies here.
-- With RLS enabled, lack of a policy = deny by default for anon/authenticated.

