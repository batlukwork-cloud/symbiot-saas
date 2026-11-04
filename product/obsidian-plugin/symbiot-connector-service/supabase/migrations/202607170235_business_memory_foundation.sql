-- OBP-035A Business Memory Foundation
-- Purpose: Supabase schema foundation for Symbiot business memory.
-- Status: YELLOW until applied to a live Supabase project and proved with RLS tests.

create extension if not exists pgcrypto;
create extension if not exists vector with schema extensions;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  locale text not null default 'ru',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists public.vaults (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  vault_fingerprint text not null,
  vault_name text not null,
  local_path_hash text,
  plugin_version text,
  connector_id text,
  sync_status text not null default 'local_only',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, vault_fingerprint)
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  vault_id uuid references public.vaults(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  obsidian_path text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  vault_id uuid references public.vaults(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  obsidian_path text,
  purpose text,
  responsibilities jsonb not null default '[]'::jsonb,
  result_contract jsonb not null default '{}'::jsonb,
  quality_criteria jsonb not null default '[]'::jsonb,
  forbidden_actions jsonb not null default '[]'::jsonb,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.role_training_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  vault_id uuid references public.vaults(id) on delete cascade,
  role_id uuid references public.business_roles(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  item_type text not null default 'instruction',
  obsidian_path text,
  source_hash text,
  training_summary text,
  quality_label text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.missions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  vault_id uuid references public.vaults(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  obsidian_path text,
  mission_type text not null default 'business_mission',
  status text not null default 'draft',
  input_contract jsonb not null default '{}'::jsonb,
  expected_result_contract jsonb not null default '{}'::jsonb,
  assigned_role_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  vault_id uuid references public.vaults(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  role_id uuid references public.business_roles(id) on delete set null,
  mission_id uuid references public.missions(id) on delete set null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  source_type text not null default 'obsidian_note',
  obsidian_path text,
  local_path_hash text,
  content_hash text,
  permission_status text not null default 'not_indexed',
  indexed_status text not null default 'not_indexed',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  vault_id uuid references public.vaults(id) on delete cascade,
  source_id uuid not null references public.knowledge_sources(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  chunk_index integer not null default 0,
  chunk_text text not null,
  citation text,
  embedding vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_id, chunk_index)
);

create table if not exists public.artifacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  vault_id uuid references public.vaults(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  mission_id uuid references public.missions(id) on delete set null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  artifact_type text not null default 'result',
  title text not null,
  obsidian_path text,
  content_hash text,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  vault_id uuid references public.vaults(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  mission_id uuid references public.missions(id) on delete set null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'queued',
  runtime_level text not null default 'local_connector_mvp',
  requested_by text not null default 'plugin',
  provider_summary jsonb not null default '{}'::jsonb,
  result_artifact_id uuid references public.artifacts(id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.run_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  run_id uuid not null references public.runs(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  step_index integer not null default 0,
  step_type text not null,
  status text not null default 'pending',
  summary text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, step_index)
);

create table if not exists public.evidence_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  vault_id uuid references public.vaults(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  mission_id uuid references public.missions(id) on delete set null,
  run_id uuid references public.runs(id) on delete set null,
  artifact_id uuid references public.artifacts(id) on delete set null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  evidence_type text not null default 'proof',
  status text not null default 'yellow',
  obsidian_path text,
  evidence_hash text,
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.providers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  vault_id uuid references public.vaults(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  provider_id text not null,
  display_name text not null,
  protocol text not null,
  model text,
  slot integer,
  key_fingerprint text,
  key_source text not null default 'local_connector',
  status text not null default 'configured_yellow',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, vault_id, provider_id, slot)
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  vault_id uuid references public.vaults(id) on delete set null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  actor_type text not null default 'plugin',
  actor_id text,
  action text not null,
  target_type text,
  target_id uuid,
  approval_status text not null default 'not_required',
  result text not null default 'ok',
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.sync_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  vault_id uuid references public.vaults(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  sync_type text not null,
  status text not null default 'pending',
  direction text not null default 'local_to_cloud',
  payload_hash text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_vaults_owner on public.vaults(owner_user_id);
create index if not exists idx_projects_vault on public.projects(vault_id);
create index if not exists idx_business_roles_vault on public.business_roles(vault_id);
create index if not exists idx_role_training_role on public.role_training_items(role_id);
create index if not exists idx_missions_vault on public.missions(vault_id);
create index if not exists idx_knowledge_sources_vault on public.knowledge_sources(vault_id);
create index if not exists idx_knowledge_chunks_source on public.knowledge_chunks(source_id);
create index if not exists idx_runs_mission on public.runs(mission_id);
create index if not exists idx_evidence_run on public.evidence_items(run_id);
create index if not exists idx_audit_vault_created on public.audit_events(vault_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.vaults enable row level security;
alter table public.projects enable row level security;
alter table public.business_roles enable row level security;
alter table public.role_training_items enable row level security;
alter table public.missions enable row level security;
alter table public.knowledge_sources enable row level security;
alter table public.knowledge_chunks enable row level security;
alter table public.artifacts enable row level security;
alter table public.runs enable row level security;
alter table public.run_steps enable row level security;
alter table public.evidence_items enable row level security;
alter table public.providers enable row level security;
alter table public.audit_events enable row level security;
alter table public.sync_events enable row level security;

drop policy if exists "profiles owner access" on public.profiles;
drop policy if exists "organizations owner access" on public.organizations;
drop policy if exists "organization_members owner access" on public.organization_members;
drop policy if exists "vaults owner access" on public.vaults;
drop policy if exists "projects owner access" on public.projects;
drop policy if exists "business_roles owner access" on public.business_roles;
drop policy if exists "role_training_items owner access" on public.role_training_items;
drop policy if exists "missions owner access" on public.missions;
drop policy if exists "knowledge_sources owner access" on public.knowledge_sources;
drop policy if exists "knowledge_chunks owner access" on public.knowledge_chunks;
drop policy if exists "artifacts owner access" on public.artifacts;
drop policy if exists "runs owner access" on public.runs;
drop policy if exists "run_steps owner access" on public.run_steps;
drop policy if exists "evidence_items owner access" on public.evidence_items;
drop policy if exists "providers owner access" on public.providers;
drop policy if exists "audit_events owner access" on public.audit_events;
drop policy if exists "sync_events owner access" on public.sync_events;

create policy "profiles owner access" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "organizations owner access" on public.organizations for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "organization_members owner access" on public.organization_members for all using (owner_user_id = auth.uid() or user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "vaults owner access" on public.vaults for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "projects owner access" on public.projects for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "business_roles owner access" on public.business_roles for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "role_training_items owner access" on public.role_training_items for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "missions owner access" on public.missions for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "knowledge_sources owner access" on public.knowledge_sources for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "knowledge_chunks owner access" on public.knowledge_chunks for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "artifacts owner access" on public.artifacts for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "runs owner access" on public.runs for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "run_steps owner access" on public.run_steps for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "evidence_items owner access" on public.evidence_items for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "providers owner access" on public.providers for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "audit_events owner access" on public.audit_events for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "sync_events owner access" on public.sync_events for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
