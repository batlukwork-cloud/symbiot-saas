-- Symbiot Runtime MVP: pgvector-ready schema
-- Gate: G3 Core Integration / ENG-SaaS-0009

create extension if not exists vector;

create table if not exists runtime_documents (
    id text primary key,
    tenant_scope text not null,
    name text not null,
    document_type text not null,
    index_status text not null,
    created_at timestamptz not null default now()
);

create table if not exists runtime_source_chunks (
    id text primary key,
    document_id text not null references runtime_documents(id) on delete cascade,
    tenant_scope text not null,
    title text not null,
    chunk_text text not null,
    source_uri text,
    chunk_index integer not null,
    created_at timestamptz not null default now()
);

create table if not exists runtime_chunk_embeddings (
    chunk_id text primary key references runtime_source_chunks(id) on delete cascade,
    embedding vector(16) not null,
    embedding_provider text not null,
    embedding_model text not null,
    created_at timestamptz not null default now()
);

create index if not exists idx_runtime_source_chunks_tenant
    on runtime_source_chunks(tenant_scope);

create index if not exists idx_runtime_chunk_embeddings_vector
    on runtime_chunk_embeddings
    using ivfflat (embedding vector_cosine_ops)
    with (lists = 100);
