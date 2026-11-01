-- 云端历史版本 + 写入限速 + 附件大小上限
-- 在 Supabase 控制台 → SQL Editor 里整段粘贴、点 Run。可以重复执行，不会改动或删除现有数据。

-- 1. 历史版本：每次覆盖前，按间隔留一份旧数据（每人最多 48 份），只有自己能读
create table if not exists public.docs_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  version bigint not null,
  doc jsonb not null,
  saved_at timestamptz not null default now(),
  bytes int generated always as (octet_length(doc::text)) stored,
  n_notes int generated always as (coalesce(jsonb_array_length(case when jsonb_typeof(doc->'notes') = 'array' then doc->'notes' end), 0)) stored,
  n_todos int generated always as (coalesce(jsonb_array_length(case when jsonb_typeof(doc->'todos') = 'array' then doc->'todos' end), 0)) stored
);
create index if not exists docs_history_user_time on public.docs_history (user_id, saved_at desc);
alter table public.docs_history enable row level security;
drop policy if exists "own history read" on public.docs_history;
create policy "own history read" on public.docs_history for select to authenticated using (user_id = (select auth.uid()));

-- 2. 写入频率计数
alter table public.docs add column if not exists w_start timestamptz;
alter table public.docs add column if not exists w_count int not null default 0;

create or replace function public.docs_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare last_snap timestamptz;
begin
  -- 限速：同一个帐号 1.5 秒内只收一次写入，一小时最多 360 次（正常编辑远到不了；同步死循环会被挡住）
  if old.updated_at is not null and now() - old.updated_at < interval '1.5 seconds' then
    raise exception 'rate_limited: too fast' using errcode = 'P0001';
  end if;
  if old.w_start is null or now() - old.w_start > interval '1 hour' then
    new.w_start := now(); new.w_count := 1;
  else
    new.w_count := old.w_count + 1;
    if new.w_count > 360 then raise exception 'rate_limited: hourly' using errcode = 'P0001'; end if;
  end if;
  -- 历史版本：内容变了，且距离上一份超过 10 分钟，或者这次一下子少了三成以上 → 把旧的留一份
  if new.doc is distinct from old.doc then
    select max(saved_at) into last_snap from docs_history where user_id = old.user_id;
    if last_snap is null or now() - last_snap > interval '10 minutes'
       or octet_length(new.doc::text) < 0.7 * octet_length(old.doc::text) then
      insert into docs_history (user_id, version, doc, saved_at) values (old.user_id, old.version, old.doc, now());
      delete from docs_history where user_id = old.user_id and id not in (
        select id from docs_history where user_id = old.user_id order by saved_at desc limit 48);
    end if;
  end if;
  return new;
end $$;
revoke all on function public.docs_guard() from public, anon, authenticated;

drop trigger if exists docs_guard on public.docs;
create trigger docs_guard before update on public.docs for each row execute function public.docs_guard();

-- 3. 现在这份先存一份，作为第一个历史版本
insert into public.docs_history (user_id, version, doc, saved_at)
select user_id, version, doc, now() from public.docs
where not exists (select 1 from public.docs_history h where h.user_id = docs.user_id);

-- 4. 附件单个最大 50 MB（和网页里的限制一致）
update storage.buckets set file_size_limit = 52428800 where id = 'attachments';
