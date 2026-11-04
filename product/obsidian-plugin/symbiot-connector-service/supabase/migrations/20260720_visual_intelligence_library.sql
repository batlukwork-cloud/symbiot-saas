-- SYM-CORE Visual Intelligence Library v0.3
-- Private visual corpus for Dmitry and Symbiot design roles.

create extension if not exists pgcrypto;

create table if not exists public.visual_library_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  vault_id uuid references public.vaults(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  owner_user_id uuid not null,
  source_key text not null,
  item_type text not null default 'reference',
  title text not null,
  description text,
  media_kind text not null default 'image',
  storage_bucket text,
  storage_path text,
  source_url text,
  rights_status text not null default 'internal_reference_unverified',
  visibility text not null default 'private',
  content_hash text,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, source_key),
  check (item_type in ('reference','content','visual_element','motion','component','carrier','case')),
  check (visibility in ('private','team','public')),
  check (rights_status in ('internal_reference_unverified','owned','licensed','open_license','permission_required','do_not_publish'))
);

create table if not exists public.visual_library_relations (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  from_item_id uuid not null references public.visual_library_items(id) on delete cascade,
  to_item_id uuid not null references public.visual_library_items(id) on delete cascade,
  relation_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (owner_user_id, from_item_id, to_item_id, relation_type)
);

create table if not exists public.visual_library_collections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  owner_user_id uuid not null,
  title text not null,
  purpose text,
  project_code text,
  status text not null default 'working',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.visual_library_collection_items (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  collection_id uuid not null references public.visual_library_collections(id) on delete cascade,
  item_id uuid not null references public.visual_library_items(id) on delete cascade,
  sort_order integer not null default 0,
  note text,
  created_at timestamptz not null default now(),
  unique (owner_user_id, collection_id, item_id)
);

create table if not exists public.visual_library_annotations (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.visual_library_items(id) on delete cascade,
  owner_user_id uuid not null,
  author_role text not null default 'Dmitry / AI Art Director',
  status text not null default 'draft',
  taxonomy jsonb not null default '{}'::jsonb,
  techniques jsonb not null default '[]'::jsonb,
  what_works text,
  pattern text,
  effect text,
  apply_to text,
  avoid text,
  decision text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, item_id)
);

alter table public.visual_library_items drop constraint if exists visual_library_items_owner_user_id_fkey;
alter table public.visual_library_relations drop constraint if exists visual_library_relations_owner_user_id_fkey;
alter table public.visual_library_collections drop constraint if exists visual_library_collections_owner_user_id_fkey;
alter table public.visual_library_collection_items drop constraint if exists visual_library_collection_items_owner_user_id_fkey;
alter table public.visual_library_annotations drop constraint if exists visual_library_annotations_owner_user_id_fkey;
create index if not exists idx_visual_library_items_owner_type on public.visual_library_items(owner_user_id, item_type);
create index if not exists idx_visual_library_items_project on public.visual_library_items(project_id);
create index if not exists idx_visual_library_items_hash on public.visual_library_items(content_hash);
create index if not exists idx_visual_library_annotations_item on public.visual_library_annotations(item_id);
create index if not exists idx_visual_library_collections_owner on public.visual_library_collections(owner_user_id);
create index if not exists idx_visual_library_relations_from on public.visual_library_relations(from_item_id);

alter table public.visual_library_items enable row level security;
alter table public.visual_library_relations enable row level security;
alter table public.visual_library_collections enable row level security;
alter table public.visual_library_collection_items enable row level security;
alter table public.visual_library_annotations enable row level security;

drop policy if exists "visual_library_items owner access" on public.visual_library_items;
drop policy if exists "visual_library_relations owner access" on public.visual_library_relations;
drop policy if exists "visual_library_collections owner access" on public.visual_library_collections;
drop policy if exists "visual_library_collection_items owner access" on public.visual_library_collection_items;
drop policy if exists "visual_library_annotations owner access" on public.visual_library_annotations;

create policy "visual_library_items owner access"
  on public.visual_library_items for all
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

create policy "visual_library_relations owner access"
  on public.visual_library_relations for all
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

create policy "visual_library_collections owner access"
  on public.visual_library_collections for all
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

create policy "visual_library_collection_items owner access"
  on public.visual_library_collection_items for all
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

create policy "visual_library_annotations owner access"
  on public.visual_library_annotations for all
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

insert into storage.buckets (id, name, "public", file_size_limit, allowed_mime_types)
values (
  'visual-intelligence-private',
  'visual-intelligence-private',
  false,
  104857600,
  array[
    'image/png','image/jpeg','image/webp','image/gif','image/svg+xml',
    'video/mp4','video/webm','video/quicktime','application/pdf',
    'font/ttf','font/otf','font/woff','font/woff2','application/octet-stream'
  ]
)
on conflict (id) do update set
  "public" = excluded."public",
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "visual intelligence owner read" on storage.objects;
drop policy if exists "visual intelligence owner insert" on storage.objects;
drop policy if exists "visual intelligence owner update" on storage.objects;
drop policy if exists "visual intelligence owner delete" on storage.objects;

create policy "visual intelligence owner read"
  on storage.objects for select to authenticated
  using (bucket_id = 'visual-intelligence-private' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "visual intelligence owner insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'visual-intelligence-private' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "visual intelligence owner update"
  on storage.objects for update to authenticated
  using (bucket_id = 'visual-intelligence-private' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'visual-intelligence-private' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "visual intelligence owner delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'visual-intelligence-private' and (storage.foldername(name))[1] = auth.uid()::text);




