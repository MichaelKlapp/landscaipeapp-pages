-- Contractor Portal (cp_*) schema for Supabase Postgres
-- Run this in Supabase SQL editor (Project → SQL Editor).

create extension if not exists "pgcrypto";

-- ---------- Contractors (includes admin via role column) ----------
create table if not exists cp_contractors (
  id text primary key,
  role text not null check (role in ('admin', 'contractor')) default 'contractor',
  status text not null check (status in ('active', 'disabled')) default 'active',

  email text not null unique,
  password_hash text not null,

  company_name text,
  owner_name text,
  phone text,
  years_in_business int check (years_in_business >= 0 and years_in_business <= 100),

  rating_avg numeric,
  rating_count int,

  tagline text,
  logo_url text,
  plan text default 'payg',
  auto_reload jsonb not null default '{}'::jsonb,

  service_zips text[] not null default '{}'::text[],
  major_categories text[] not null default '{}'::text[],
  sub_categories text[] not null default '{}'::text[],

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cp_contractors_service_zips_gin on cp_contractors using gin (service_zips);

-- ---------- Sessions ----------
create table if not exists cp_sessions (
  token text primary key,
  user_id text not null references cp_contractors(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists cp_sessions_user_idx on cp_sessions(user_id);
create index if not exists cp_sessions_expires_idx on cp_sessions(expires_at);

-- ---------- Homeowners (portal-side minimal record) ----------
create table if not exists cp_homeowners (
  id text primary key,
  display_name text,
  email text,
  phone text,
  zip text,
  phone_verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists cp_homeowners_email_idx on cp_homeowners(lower(email));

-- ---------- Leads ----------
create table if not exists cp_leads (
  id text primary key,
  homeowner_id text not null references cp_homeowners(id) on delete restrict,

  zip text not null,
  budget_min int,
  budget_max int,
  vibe text,
  change_level text,

  major_categories text[] not null default '{}'::text[],
  required_tags text[] not null default '{}'::text[],

  -- Supabase Storage paths (not URLs)
  before_image_path text not null,
  after_image_path text not null,

  status text not null check (status in ('open', 'assigned', 'spam')) default 'open',
  assigned_contractor_id text references cp_contractors(id) on delete set null,

  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create index if not exists cp_leads_zip_idx on cp_leads(zip);
create index if not exists cp_leads_status_idx on cp_leads(status);
create index if not exists cp_leads_created_idx on cp_leads(created_at);

-- ---------- Lead Interests ----------
create table if not exists cp_lead_interests (
  id text primary key,
  lead_id text not null references cp_leads(id) on delete cascade,
  contractor_id text not null references cp_contractors(id) on delete cascade,

  status text not null check (status in ('held', 'withdrawn', 'expired', 'released', 'captured')),
  held_at timestamptz,
  expires_at timestamptz,
  captured_at timestamptz,
  released_at timestamptz,
  expired_at timestamptz,
  withdrawn_at timestamptz,
  release_reason text,

  created_at timestamptz not null default now(),

  unique (lead_id, contractor_id)
);

create index if not exists cp_lead_interests_contractor_idx on cp_lead_interests(contractor_id);
create index if not exists cp_lead_interests_lead_idx on cp_lead_interests(lead_id);
create index if not exists cp_lead_interests_status_idx on cp_lead_interests(status);
create index if not exists cp_lead_interests_expires_idx on cp_lead_interests(expires_at);

-- ---------- Lead Questions ----------
create table if not exists cp_lead_questions (
  id text primary key,
  lead_id text not null references cp_leads(id) on delete cascade,
  contractor_id text not null references cp_contractors(id) on delete cascade,
  template_id text not null,
  extra text,
  created_at timestamptz not null default now()
);

create index if not exists cp_lead_questions_lead_idx on cp_lead_questions(lead_id);
create index if not exists cp_lead_questions_contractor_idx on cp_lead_questions(contractor_id);

-- ---------- Credit Ledger ----------
create table if not exists cp_credit_ledger (
  id text primary key,
  contractor_id text not null references cp_contractors(id) on delete cascade,
  delta int not null,
  type text not null,
  lead_id text references cp_leads(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists cp_credit_ledger_contractor_idx on cp_credit_ledger(contractor_id);
create index if not exists cp_credit_ledger_created_idx on cp_credit_ledger(created_at);

-- ---------- Contractor Photos ----------
create table if not exists cp_contractor_photos (
  id text primary key,
  contractor_id text not null references cp_contractors(id) on delete cascade,
  storage_path text not null,
  is_featured boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists cp_contractor_photos_contractor_idx on cp_contractor_photos(contractor_id);

-- ---------- Audit log ----------
create table if not exists cp_audit_log (
  id text primary key,
  type text not null,
  actor_id text references cp_contractors(id) on delete set null,
  lead_id text references cp_leads(id) on delete set null,
  target_contractor_id text references cp_contractors(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists cp_audit_log_created_idx on cp_audit_log(created_at);

