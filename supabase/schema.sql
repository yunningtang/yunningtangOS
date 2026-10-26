-- sealonote 云端：在 Supabase 的 SQL Editor 里整段运行一次（重复运行也安全）
-- 设计：每个人的数据是一行 docs（整份 JSON + 版本号）；行级权限保证只能读写自己的那一行。
-- members / invites 只有服务端（service role）能碰；浏览器从不直接连 Supabase。

-- 成员：谁注册过（邀请制用）
create table if not exists public.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  invited_by text,
  created_at timestamptz not null default now()
);
alter table public.members enable row level security;  -- 不建任何策略 = 只有 service role 能读写

-- 邀请码：一码一人；max_uses 可以放宽
create table if not exists public.invites (
  code text primary key,
  note text,
  max_uses int not null default 1,
  uses int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.invites enable row level security;

-- 每个人的整份数据
create table if not exists public.docs (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  doc jsonb not null,
  version bigint not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.docs enable row level security;
drop policy if exists "own doc read" on public.docs;
drop policy if exists "own doc insert" on public.docs;
drop policy if exists "own doc update" on public.docs;
drop policy if exists "own doc delete" on public.docs;
create policy "own doc read"   on public.docs for select using (user_id = auth.uid());
create policy "own doc insert" on public.docs for insert with check (user_id = auth.uid());
create policy "own doc update" on public.docs for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own doc delete" on public.docs for delete using (user_id = auth.uid());

-- 汤圆 AI 用量：每人每月计数（服务端用 bump_ai 原子加一并返回新值）
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null,
  calls int not null default 0,
  primary key (user_id, month)
);
alter table public.ai_usage enable row level security;
drop policy if exists "own usage read" on public.ai_usage;
create policy "own usage read" on public.ai_usage for select using (user_id = auth.uid());
create or replace function public.bump_ai(p_month text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into ai_usage(user_id, month, calls) values (auth.uid(), p_month, 1)
  on conflict (user_id, month) do update set calls = ai_usage.calls + 1
  returning calls into n;
  return n;
end $$;
revoke all on function public.bump_ai(text) from public, anon;
grant execute on function public.bump_ai(text) to authenticated;

-- 附件：私有存储桶，路径必须以自己的 user id 开头
insert into storage.buckets (id, name, public) values ('attachments', 'attachments', false) on conflict (id) do nothing;
drop policy if exists "own files read" on storage.objects;
drop policy if exists "own files write" on storage.objects;
drop policy if exists "own files update" on storage.objects;
drop policy if exists "own files delete" on storage.objects;
create policy "own files read"   on storage.objects for select using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own files write"  on storage.objects for insert with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own files update" on storage.objects for update using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own files delete" on storage.objects for delete using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

-- 第一个邀请码（上线后在 Table Editor → invites 里加别的、或改这一行）
insert into public.invites(code, note, max_uses) values ('SEAL-' || substr(md5(random()::text), 1, 8), '第一个邀请码', 5) on conflict do nothing;
