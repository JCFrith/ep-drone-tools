-- Enhanced Patrol pricing catalog: editable hardware, software, kits and markups
alter table public.pricing_authorized_users add column if not exists is_admin boolean not null default false;
update public.pricing_authorized_users set is_admin = true where lower(email) in ('jcfrith@gmail.com','chase@enhancedpatrol.com');

create or replace function public.pricing_is_authorized() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pricing_authorized_users where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
create or replace function public.pricing_is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.pricing_authorized_users where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and is_admin);
$$;

create table if not exists public.pricing_settings (
  id smallint primary key default 1 check (id = 1),
  hardware_markup_pct numeric not null default 35,
  labor_markup_pct numeric not null default 75,
  markup_mode text not null default 'markup' check (markup_mode in ('markup','margin')),
  financing_uplift_pct numeric not null default 35,
  hours_per_year integer not null default 8750,
  default_pilot_rate numeric not null default 50,
  default_supv_rate numeric not null default 60,
  updated_at timestamptz not null default now(),
  updated_by text
);
comment on table public.pricing_settings is 'Single-row pricing settings. markup_mode: markup = cost x (1 + pct/100); margin = cost / (1 - pct/100).';
insert into public.pricing_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.pricing_catalog (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  sort integer not null default 1000,
  category text not null check (category in ('dock','aircraft','component','software','service')),
  name text not null,
  unit_cost numeric not null default 0,
  price_mode text not null default 'cost_plus' check (price_mode in ('cost_plus','fixed')),
  markup_override_pct numeric,
  basis text not null default 'one_time' check (basis in ('one_time','per_dock_one_time','per_program_year','per_dock_year','per_aircraft_year','per_tactical_kit_year')),
  trigger text not null default 'fleet' check (trigger in ('fleet','kit','auto','toggle')),
  default_on boolean not null default false,
  applies_to_tag text,
  attributes jsonb not null default '{}'::jsonb,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);
comment on table public.pricing_catalog is 'Every priced thing in the calculator. Docks and aircraft are chosen in the dock builder (trigger fleet); components are used inside kits; software and services are auto or toggle. attributes: capacity, bundled_aircraft (slug), tags, bundle_only.';

create table if not exists public.pricing_kits (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  sort integer not null default 1000,
  kit_type text not null check (kit_type in ('tactical','maintenance')),
  label text not null,
  components jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);
comment on table public.pricing_kits is 'Kit templates. components = [{item_slug, default_qty}]; prices come from pricing_catalog at quote time.';

alter table public.pricing_settings enable row level security;
alter table public.pricing_catalog enable row level security;
alter table public.pricing_kits enable row level security;
do $$ declare t text; begin
  foreach t in array array['pricing_settings','pricing_catalog','pricing_kits'] loop
    execute format('drop policy if exists "%1$s_read" on public.%1$s', t);
    execute format('drop policy if exists "%1$s_admin_write" on public.%1$s', t);
    execute format('create policy "%1$s_read" on public.%1$s for select to authenticated using (public.pricing_is_authorized())', t);
    execute format('create policy "%1$s_admin_write" on public.%1$s for all to authenticated using (public.pricing_is_admin()) with check (public.pricing_is_admin())', t);
  end loop;
end $$;

insert into public.pricing_catalog (slug,sort,category,name,unit_cost,price_mode,markup_override_pct,basis,trigger,default_on,applies_to_tag,attributes,note,active) values
('omnidock-standard',10,'dock','OmniDock Standard',18600,'cost_plus',null,'one_time','fleet',false,null,'{"capacity": 2}'::jsonb,null,true),
('omnidock-mini',20,'dock','OmniDock Mini',16600,'cost_plus',null,'one_time','fleet',false,null,'{"capacity": 1}'::jsonb,null,true),
('dji-dock-3',30,'dock','DJI Dock 3',15890,'cost_plus',null,'one_time','fleet',false,null,'{"capacity": 1, "bundled_aircraft": "dji-matrice-4td"}'::jsonb,'Bundled with Matrice 4TD; aircraft price is added to the dock line.',true),
('parrot-ukr',40,'aircraft','Parrot ANAFI UKR',20600,'cost_plus',null,'one_time','fleet',false,null,'{"tags": ["cellular"]}'::jsonb,null,true),
('dji-mavic-3t',50,'aircraft','DJI Mavic 3T',7165,'cost_plus',null,'one_time','fleet',false,null,'{}'::jsonb,null,true),
('dji-matrice-4td',60,'aircraft','DJI Matrice 4TD',7640,'cost_plus',null,'one_time','fleet',false,null,'{"bundle_only": true}'::jsonb,null,true),
('mavic-props',100,'component','Mavic 3T Props (pair)',19,'cost_plus',null,'one_time','kit',false,null,'{}'::jsonb,null,true),
('mavic-battery',101,'component','Mavic 3T Battery',159,'cost_plus',null,'one_time','kit',false,null,'{}'::jsonb,null,true),
('charger-mavic',102,'component','Colorado Drone Charger (Mavic)',895,'cost_plus',null,'one_time','kit',false,null,'{}'::jsonb,null,true),
('mavic-speaker-spotlight',103,'component','Speaker/Spotlight Combo',1199,'cost_plus',null,'one_time','kit',false,null,'{}'::jsonb,null,true),
('parrot-ukr-xlr',110,'component','Parrot UKR w/ XLR',20600,'cost_plus',null,'one_time','kit',false,null,'{}'::jsonb,null,true),
('parrot-props',111,'component','Parrot UKR Props (pair)',200,'cost_plus',null,'one_time','kit',false,null,'{}'::jsonb,null,true),
('parrot-xlr-battery',112,'component','Parrot XLR Battery',1160,'cost_plus',null,'one_time','kit',false,null,'{}'::jsonb,null,true),
('charger-parrot',113,'component','Colorado Drone Charger (Parrot)',1500,'cost_plus',null,'one_time','kit',false,null,'{}'::jsonb,null,true),
('parrot-light',114,'component','Parrot Light',400,'cost_plus',null,'one_time','kit',false,null,'{}'::jsonb,null,true),
('parachute-mavic',120,'component','Parachute (Mavic)',2800,'cost_plus',null,'one_time','kit',false,null,'{}'::jsonb,null,true),
('drtk3-relay',121,'component','D-RTK 3 Relay',3500,'cost_plus',null,'one_time','kit',false,null,'{}'::jsonb,null,true),
('matrice-props',130,'component','Matrice 4TD Props (pair)',48,'cost_plus',null,'one_time','kit',false,null,'{}'::jsonb,null,true),
('matrice-battery',131,'component','Matrice 4TD Battery',495,'cost_plus',null,'one_time','kit',false,null,'{}'::jsonb,null,true),
('matrice-spotlight',132,'component','Matrice Spotlight',450,'cost_plus',null,'one_time','kit',false,null,'{}'::jsonb,null,true),
('matrice-speaker',133,'component','Matrice Speaker',300,'cost_plus',null,'one_time','kit',false,null,'{}'::jsonb,null,true),
('parachute-matrice',134,'component','Parachute (Matrice)',2700,'cost_plus',null,'one_time','kit',false,null,'{}'::jsonb,null,true),
('dfr-setup-fee',200,'service','DFR Setup Fee',10000,'fixed',null,'per_dock_one_time','toggle',true,null,'{}'::jsonb,null,true),
('c2-software',210,'software','C2 Software',7500,'fixed',null,'per_aircraft_year','auto',false,null,'{}'::jsonb,null,true),
('data-storage',220,'software','Data Storage & Mgmt (AWS S3, 30-day)',2000,'fixed',null,'per_dock_year','toggle',false,null,'{}'::jsonb,null,true),
('cellular-5g-dock',230,'service','Cellular 5G, Dock',1500,'fixed',null,'per_dock_year','toggle',false,null,'{}'::jsonb,null,true),
('cellular-5g-drone',240,'service','Cellular 5G, Aircraft',1500,'fixed',null,'per_aircraft_year','auto',false,'cellular','{}'::jsonb,'Applies only to aircraft tagged cellular.',true),
('regulatory-compliance',250,'service','Regulatory & Compliance Management (Large Contract)',150000,'fixed',null,'per_program_year','toggle',false,null,'{}'::jsonb,null,true),
('tactical-support',260,'service','Tactical Program Support',50000,'fixed',null,'per_program_year','toggle',false,null,'{}'::jsonb,null,true),
('tactical-software',270,'software','Tactical Flight Control Software',1500,'fixed',null,'per_tactical_kit_year','auto',false,null,'{}'::jsonb,null,true)
on conflict (slug) do nothing;

insert into public.pricing_kits (slug,sort,kit_type,label,components,active) values
('tactical-mavic-3t',10,'tactical','Mavic 3T Tactical Kit','[{"item_slug": "dji-mavic-3t", "default_qty": 1}, {"item_slug": "mavic-props", "default_qty": 2}, {"item_slug": "mavic-battery", "default_qty": 3}, {"item_slug": "charger-mavic", "default_qty": 1}, {"item_slug": "mavic-speaker-spotlight", "default_qty": 1}]'::jsonb,true),
('tactical-parrot-ukr',20,'tactical','Parrot UKR Tactical Kit','[{"item_slug": "parrot-ukr-xlr", "default_qty": 1}, {"item_slug": "parrot-props", "default_qty": 2}, {"item_slug": "parrot-xlr-battery", "default_qty": 3}, {"item_slug": "charger-parrot", "default_qty": 1}, {"item_slug": "parrot-light", "default_qty": 1}]'::jsonb,true),
('maint-mavic-3t',30,'maintenance','Mavic 3T Maintenance Supply Kit','[{"item_slug": "dji-mavic-3t", "default_qty": 2}, {"item_slug": "mavic-props", "default_qty": 10}, {"item_slug": "mavic-battery", "default_qty": 10}, {"item_slug": "charger-mavic", "default_qty": 0}, {"item_slug": "parachute-mavic", "default_qty": 1}, {"item_slug": "drtk3-relay", "default_qty": 1}]'::jsonb,true),
('maint-parrot-ukr',40,'maintenance','Parrot UKR Maintenance Supply Kit','[{"item_slug": "parrot-ukr-xlr", "default_qty": 2}, {"item_slug": "parrot-props", "default_qty": 10}, {"item_slug": "parrot-xlr-battery", "default_qty": 10}, {"item_slug": "charger-parrot", "default_qty": 0}, {"item_slug": "drtk3-relay", "default_qty": 1}]'::jsonb,true),
('maint-matrice-4td',50,'maintenance','Matrice 4TD Maintenance Supply Kit','[{"item_slug": "dji-matrice-4td", "default_qty": 2}, {"item_slug": "matrice-props", "default_qty": 10}, {"item_slug": "matrice-battery", "default_qty": 10}, {"item_slug": "matrice-spotlight", "default_qty": 1}, {"item_slug": "matrice-speaker", "default_qty": 1}, {"item_slug": "parachute-matrice", "default_qty": 1}, {"item_slug": "drtk3-relay", "default_qty": 1}]'::jsonb,true)
on conflict (slug) do nothing;
