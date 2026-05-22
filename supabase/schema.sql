create table if not exists public.stylique_crm_state (
  bucket text primary key,
  data jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.stylique_crm_state enable row level security;

drop policy if exists "stylique_crm_state_service_role_all" on public.stylique_crm_state;

create policy "stylique_crm_state_service_role_all"
on public.stylique_crm_state
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
