-- Enhanced Patrol drone tools, CoW 107W-2026-01762
-- Run in the Supabase SQL editor for project enhanced-patrol (oaztzgvxxloiesorfjlf).
-- 1. Denormalised pathway column for the admin listing (optional; payload already carries it).
alter table public.site_assessments add column if not exists overflight_pathway text;
comment on column public.site_assessments.overflight_pathway is 'SP 13, SP 14, SP 15 or None. Computed from weight, PRS and overflight inputs.';

-- 2. Table for saved classification wizard runs. Only needed if the wizard gets a save feature.
create table if not exists public.site_classifications (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  site_label text,
  governing_provision text,
  max_agl integer,
  overflight_pathway text,
  vo_required boolean,
  daa_relied_on boolean,
  block_count integer not null default 0,
  cow_ref text,
  tool_version text,
  answers jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb
);
alter table public.site_classifications enable row level security;
create policy "site_classifications_insert_own" on public.site_classifications for insert to authenticated with check (created_by = auth.uid());
create policy "site_classifications_select_own" on public.site_classifications for select to authenticated using (created_by = auth.uid());
create policy "site_classifications_delete_own" on public.site_classifications for delete to authenticated using (created_by = auth.uid());
create index if not exists site_classifications_created_by_idx on public.site_classifications (created_by, created_at desc);
