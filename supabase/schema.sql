begin;
create table if not exists public.dapur_sore_state (
  id integer primary key check (id = 1),
  revision bigint not null default 0,
  data jsonb not null default '{"sessions":{},"soldOut":[],"payments":[]}'::jsonb
);
alter table public.dapur_sore_state enable row level security;
revoke all on public.dapur_sore_state from public, anon, authenticated;
grant select, update on public.dapur_sore_state to service_role;
insert into public.dapur_sore_state(id) values (1) on conflict do nothing;
commit;
