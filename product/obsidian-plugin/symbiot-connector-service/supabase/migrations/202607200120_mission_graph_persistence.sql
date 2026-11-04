alter table public.missions
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.mission_canvas_nodes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  vault_id uuid references public.vaults(id) on delete cascade,
  mission_id uuid not null references public.missions(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  node_key text not null,
  node_type text not null default 'text',
  title text,
  text_content text,
  obsidian_path text,
  x integer,
  y integer,
  width integer,
  height integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mission_id, node_key)
);

create table if not exists public.mission_canvas_edges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  vault_id uuid references public.vaults(id) on delete cascade,
  mission_id uuid not null references public.missions(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  edge_key text not null,
  from_node_key text not null,
  to_node_key text not null,
  label text,
  edge_type text not null default 'canvas_link',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mission_id, edge_key)
);

create table if not exists public.mission_methodology_patterns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  vault_id uuid references public.vaults(id) on delete cascade,
  mission_id uuid references public.missions(id) on delete set null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  pattern_key text not null,
  title text not null,
  pattern_type text not null default 'client_mission_route',
  route_summary text,
  evidence_status text not null default 'yellow',
  source_count integer not null default 0,
  node_count integer not null default 0,
  edge_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, vault_id, pattern_key)
);

create index if not exists idx_mission_canvas_nodes_mission on public.mission_canvas_nodes(mission_id);
create index if not exists idx_mission_canvas_nodes_owner on public.mission_canvas_nodes(owner_user_id);
create index if not exists idx_mission_canvas_edges_mission on public.mission_canvas_edges(mission_id);
create index if not exists idx_mission_canvas_edges_owner on public.mission_canvas_edges(owner_user_id);
create index if not exists idx_mission_methodology_patterns_owner on public.mission_methodology_patterns(owner_user_id, vault_id);

alter table public.mission_canvas_nodes enable row level security;
alter table public.mission_canvas_edges enable row level security;
alter table public.mission_methodology_patterns enable row level security;

drop policy if exists "mission_canvas_nodes owner access" on public.mission_canvas_nodes;
drop policy if exists "mission_canvas_edges owner access" on public.mission_canvas_edges;
drop policy if exists "mission_methodology_patterns owner access" on public.mission_methodology_patterns;

create policy "mission_canvas_nodes owner access" on public.mission_canvas_nodes for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "mission_canvas_edges owner access" on public.mission_canvas_edges for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy "mission_methodology_patterns owner access" on public.mission_methodology_patterns for all using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

