-- Worldweave collaboration foundation. Apply to a dedicated Supabase project.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','editor','viewer')),
  display_name text not null check (char_length(display_name) between 1 and 40),
  cursor_color text not null check (cursor_color ~ '^#[0-9A-Fa-f]{6}$'),
  joined_at timestamptz not null default now(),
  primary key (workspace_id,user_id)
);

create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  token_hash bytea not null unique,
  role text not null check (role in ('editor','viewer')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  max_uses integer not null default 1 check (max_uses between 1 and 100),
  use_count integer not null default 0 check (use_count >= 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.maps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  width integer,
  height integer,
  grid integer not null default 24 check (grid between 4 and 256),
  snap boolean not null default true,
  revision bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((width is null and height is null) or (width > 0 and height > 0))
);

create table if not exists public.map_shapes (
  id uuid primary key,
  map_id uuid not null references public.maps(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  kind text not null check (kind in ('path','rectangle','ellipse','group','region')),
  geometry jsonb not null,
  style jsonb not null,
  collision text not null default 'none' check (collision in ('none','wall','solid')),
  collision_thickness numeric not null default 14 check (collision_thickness between 0 and 512),
  visible boolean not null default true,
  locked boolean not null default false,
  parent_id uuid references public.map_shapes(id) on delete cascade,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists map_shapes_map_id_idx on public.map_shapes(map_id);

create table if not exists public.command_events (
  id bigint generated always as identity primary key,
  command_id uuid not null unique,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  map_id uuid not null references public.maps(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  object_id uuid,
  object_revision bigint,
  operation text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists command_events_workspace_order_idx on public.command_events(workspace_id,id);

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.workspace_members m where m.workspace_id=target_workspace and m.user_id=(select auth.uid()))
$$;

create or replace function public.can_edit_workspace(target_workspace uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.workspace_members m where m.workspace_id=target_workspace and m.user_id=(select auth.uid()) and m.role in ('owner','editor'))
$$;

create or replace function public.create_workspace(p_name text, p_display_name text, p_cursor_color text default '#B6F36B')
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); wid uuid;
begin
  if actor is null then raise exception 'authentication_required'; end if;
  if char_length(trim(p_name)) not between 1 and 80 then raise exception 'invalid_workspace_name'; end if;
  if char_length(trim(p_display_name)) not between 1 and 40 then raise exception 'invalid_display_name'; end if;
  if p_cursor_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'invalid_cursor_color'; end if;
  insert into public.workspaces(name,owner_id) values(trim(p_name),actor) returning id into wid;
  insert into public.workspace_members(workspace_id,user_id,role,display_name,cursor_color) values(wid,actor,'owner',trim(p_display_name),p_cursor_color);
  return wid;
end $$;

create or replace function public.create_workspace_invite(p_workspace uuid, p_role text default 'editor', p_ttl_seconds integer default 604800, p_max_uses integer default 10)
returns table(invite_id uuid, token text, expires_at timestamptz) language plpgsql security definer set search_path = '' as $$
declare raw_token text; expiry timestamptz; iid uuid;
begin
  if not exists(select 1 from public.workspace_members where workspace_id=p_workspace and user_id=(select auth.uid()) and role='owner') then raise exception 'owner_required'; end if;
  if p_role not in ('editor','viewer') or p_ttl_seconds not between 300 and 2592000 or p_max_uses not between 1 and 100 then raise exception 'invalid_invite_settings'; end if;
  raw_token := encode(extensions.gen_random_bytes(32),'hex'); expiry := now()+make_interval(secs=>p_ttl_seconds);
  insert into public.workspace_invites(workspace_id,token_hash,role,expires_at,max_uses,created_by)
    values(p_workspace,extensions.digest(raw_token,'sha256'),p_role,expiry,p_max_uses,(select auth.uid())) returning id into iid;
  return query select iid,raw_token,expiry;
end $$;

create or replace function public.accept_workspace_invite(p_token text, p_display_name text, p_cursor_color text default '#B6F36B')
returns table(workspace_id uuid, role text) language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); invitation public.workspace_invites%rowtype; added integer; effective_role text; has_invite boolean;
begin
  if actor is null then raise exception 'authentication_required'; end if;
  if char_length(trim(p_display_name)) not between 1 and 40 or p_cursor_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'invalid_profile'; end if;
  select * into invitation from public.workspace_invites i where i.token_hash=extensions.digest(p_token,'sha256') for update;
  has_invite:=found;
  if has_invite then
    select m.role into effective_role from public.workspace_members m where m.workspace_id=invitation.workspace_id and m.user_id=actor;
    if effective_role is not null then
      update public.workspace_members set display_name=trim(p_display_name),cursor_color=p_cursor_color where workspace_id=invitation.workspace_id and user_id=actor;
      return query select invitation.workspace_id,effective_role;
      return;
    end if;
  end if;
  if not has_invite or invitation.revoked_at is not null or invitation.expires_at<=now() or invitation.use_count>=invitation.max_uses then raise exception 'invite_unavailable'; end if;
  insert into public.workspace_members(workspace_id,user_id,role,display_name,cursor_color)
    values(invitation.workspace_id,actor,invitation.role,trim(p_display_name),p_cursor_color)
    on conflict(workspace_id,user_id) do nothing;
  get diagnostics added=row_count;
  if added=1 then update public.workspace_invites set use_count=use_count+1 where id=invitation.id; end if;
  if added=0 then
    update public.workspace_members set display_name=trim(p_display_name),cursor_color=p_cursor_color where workspace_id=invitation.workspace_id and user_id=actor;
  end if;
  select m.role into effective_role from public.workspace_members m where m.workspace_id=invitation.workspace_id and m.user_id=actor;
  return query select invitation.workspace_id,effective_role;
end $$;

create or replace function public.revoke_workspace_invite(p_invite uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  update public.workspace_invites i set revoked_at=now()
   where i.id=p_invite and exists(select 1 from public.workspace_members m where m.workspace_id=i.workspace_id and m.user_id=(select auth.uid()) and m.role='owner');
  get diagnostics changed=row_count;
  return changed=1;
end $$;

create or replace function public.update_member_profile(p_workspace uuid, p_display_name text, p_cursor_color text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare changed integer;
begin
  if char_length(trim(p_display_name)) not between 1 and 40 or p_cursor_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'invalid_profile'; end if;
  update public.workspace_members set display_name=trim(p_display_name),cursor_color=p_cursor_color
   where workspace_id=p_workspace and user_id=(select auth.uid());
  get diagnostics changed=row_count;
  return changed=1;
end $$;

create or replace function public.apply_shape_command(
  p_command_id uuid, p_map_id uuid, p_shape_id uuid, p_expected_revision bigint, p_operation text, p_data jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); wid uuid; current_row public.map_shapes%rowtype; next_revision bigint;
begin
  if actor is null then raise exception 'authentication_required'; end if;
  if p_operation not in ('create','update','delete') then raise exception 'invalid_operation'; end if;
  select workspace_id into wid from public.maps where id=p_map_id;
  if wid is null or not public.can_edit_workspace(wid) then raise exception 'workspace_write_forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_command_id::text,0));
  if exists(select 1 from public.command_events where command_id=p_command_id) then
    return jsonb_build_object('ok',true,'duplicate',true);
  end if;
  if p_operation='create' then
    if p_expected_revision<>0 or p_data->>'id'<>p_shape_id::text then raise exception 'invalid_create'; end if;
    if nullif(p_data->>'parent_id','') is not null and not exists(select 1 from public.map_shapes parent where parent.id=(p_data->>'parent_id')::uuid and parent.map_id=p_map_id) then raise exception 'parent_must_be_in_same_map'; end if;
    insert into public.map_shapes(id,map_id,name,kind,geometry,style,collision,collision_thickness,visible,locked,parent_id)
      values(p_shape_id,p_map_id,p_data->>'name',p_data->>'kind',p_data->'geometry',p_data->'style',coalesce(p_data->>'collision','none'),coalesce((p_data->>'collision_thickness')::numeric,14),coalesce((p_data->>'visible')::boolean,true),coalesce((p_data->>'locked')::boolean,false),nullif(p_data->>'parent_id','')::uuid);
    next_revision:=1;
  elsif p_operation='update' then
    select * into current_row from public.map_shapes where id=p_shape_id and map_id=p_map_id for update;
    if not found then raise exception 'shape_missing'; end if;
    if current_row.revision<>p_expected_revision then return jsonb_build_object('ok',false,'conflict',true,'expected',p_expected_revision,'actual',current_row.revision); end if;
    update public.map_shapes set name=coalesce(p_data->>'name',name),kind=coalesce(p_data->>'kind',kind),geometry=coalesce(p_data->'geometry',geometry),style=coalesce(p_data->'style',style),collision=coalesce(p_data->>'collision',collision),collision_thickness=coalesce((p_data->>'collision_thickness')::numeric,collision_thickness),visible=coalesce((p_data->>'visible')::boolean,visible),locked=coalesce((p_data->>'locked')::boolean,locked),revision=revision+1,updated_at=now() where id=p_shape_id returning revision into next_revision;
  else
    select * into current_row from public.map_shapes where id=p_shape_id and map_id=p_map_id for update;
    if not found then raise exception 'shape_missing'; end if;
    if current_row.revision<>p_expected_revision then return jsonb_build_object('ok',false,'conflict',true,'expected',p_expected_revision,'actual',current_row.revision); end if;
    delete from public.map_shapes where id=p_shape_id;
    next_revision:=current_row.revision+1;
  end if;
  insert into public.command_events(command_id,workspace_id,map_id,actor_id,object_id,object_revision,operation,payload)
    values(p_command_id,wid,p_map_id,actor,p_shape_id,next_revision,p_operation,p_data);
  update public.maps set revision=revision+1,updated_at=now() where id=p_map_id;
  return jsonb_build_object('ok',true,'duplicate',false,'revision',next_revision,'event_order',currval(pg_get_serial_sequence('public.command_events','id')));
end $$;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.maps enable row level security;
alter table public.map_shapes enable row level security;
alter table public.command_events enable row level security;

drop policy if exists workspace_member_read on public.workspaces;
create policy workspace_member_read on public.workspaces for select to authenticated using (public.is_workspace_member(id));
drop policy if exists workspace_members_read on public.workspace_members;
create policy workspace_members_read on public.workspace_members for select to authenticated using (public.is_workspace_member(workspace_id));
drop policy if exists workspace_members_update_self on public.workspace_members;
drop policy if exists invites_owner_read on public.workspace_invites;
create policy invites_owner_read on public.workspace_invites for select to authenticated using (exists(select 1 from public.workspace_members m where m.workspace_id=workspace_invites.workspace_id and m.user_id=(select auth.uid()) and m.role='owner'));
drop policy if exists maps_member_read on public.maps;
create policy maps_member_read on public.maps for select to authenticated using (public.is_workspace_member(workspace_id));
drop policy if exists maps_editor_insert on public.maps;
create policy maps_editor_insert on public.maps for insert to authenticated with check (public.can_edit_workspace(workspace_id));
drop policy if exists maps_editor_update on public.maps;
create policy maps_editor_update on public.maps for update to authenticated using (public.can_edit_workspace(workspace_id)) with check (public.can_edit_workspace(workspace_id));
drop policy if exists maps_editor_delete on public.maps;
create policy maps_editor_delete on public.maps for delete to authenticated using (public.can_edit_workspace(workspace_id));
drop policy if exists shapes_member_read on public.map_shapes;
create policy shapes_member_read on public.map_shapes for select to authenticated using (exists(select 1 from public.maps m where m.id=map_id and public.is_workspace_member(m.workspace_id)));
drop policy if exists events_member_read on public.command_events;
create policy events_member_read on public.command_events for select to authenticated using (public.is_workspace_member(workspace_id));

grant usage on schema public to authenticated;
grant select on public.workspaces,public.workspace_members,public.workspace_invites,public.maps,public.map_shapes,public.command_events to authenticated;
grant insert,update,delete on public.maps to authenticated;
grant usage,select on sequence public.command_events_id_seq to authenticated;
revoke all on function public.is_workspace_member(uuid) from public,anon;
revoke all on function public.can_edit_workspace(uuid) from public,anon;
revoke all on function public.create_workspace(text,text,text) from public,anon;
revoke all on function public.create_workspace_invite(uuid,text,integer,integer) from public,anon;
revoke all on function public.accept_workspace_invite(text,text,text) from public,anon;
revoke all on function public.revoke_workspace_invite(uuid) from public,anon;
revoke all on function public.update_member_profile(uuid,text,text) from public,anon;
revoke all on function public.apply_shape_command(uuid,uuid,uuid,bigint,text,jsonb) from public,anon;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.can_edit_workspace(uuid) to authenticated;
grant execute on function public.create_workspace(text,text,text) to authenticated;
grant execute on function public.create_workspace_invite(uuid,text,integer,integer) to authenticated;
grant execute on function public.accept_workspace_invite(text,text,text) to authenticated;
grant execute on function public.revoke_workspace_invite(uuid) to authenticated;
grant execute on function public.update_member_profile(uuid,text,text) to authenticated;
grant execute on function public.apply_shape_command(uuid,uuid,uuid,bigint,text,jsonb) to authenticated;

alter table public.map_shapes replica identity full;
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='map_shapes') then alter publication supabase_realtime add table public.map_shapes; end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='maps') then alter publication supabase_realtime add table public.maps; end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='workspace_members') then alter publication supabase_realtime add table public.workspace_members; end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='command_events') then alter publication supabase_realtime add table public.command_events; end if;
  end if;
end $$;
