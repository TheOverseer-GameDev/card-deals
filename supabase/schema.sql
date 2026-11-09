-- Card Deals market. Run this once in the Supabase SQL editor.
-- The anon key can read only what these policies allow.

create or replace function public.market_vault_url(url text)
returns boolean language plpgsql immutable as $$
declare host text;
begin
  if url is null or url !~ '^https://' then return false; end if;
  if position('@' in split_part(url, '://', 2)) > 0 then return false; end if;
  host := lower(split_part(split_part(split_part(url, '://', 2), '/', 1), ':', 1));
  host := rtrim(host, '.');
  return host = 'psacard.com' or host like '%.psacard.com'
    or host = 'ebay.com' or host like '%.ebay.com'
    or host = 'ebay.ca' or host like '%.ebay.ca';
end $$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  blocked uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_insert_own on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles (id),
  seller_name text not null check (char_length(seller_name) between 1 and 40),
  game text not null check (game in ('ygo', 'mtg')),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  set_code text check (set_code is null or char_length(set_code) <= 24),
  edition text check (edition is null or char_length(edition) <= 80),
  rarity text check (rarity is null or char_length(rarity) <= 40),
  condition_notes text check (condition_notes is null or char_length(condition_notes) <= 500),
  centering text check (centering is null or char_length(centering) <= 160),
  estimate_note text check (estimate_note is null or char_length(estimate_note) <= 500),
  ask_cad numeric(12,2) not null check (ask_cad > 0 and ask_cad < 1000000),
  photo_path text check (photo_path is null or char_length(photo_path) <= 200),
  vaulted boolean not null default false,
  psa_cert text,
  vault_url text,
  status text not null default 'active' check (status in ('active', 'reserved', 'completed', 'withdrawn')),
  check (
    (vaulted = false and psa_cert is null and vault_url is null)
    or (vaulted = true and psa_cert ~ '^[0-9]{7,10}$' and public.market_vault_url(vault_url))
  ),
  reserved_offer_id uuid,
  created_at timestamptz not null default now()
);
alter table public.listings enable row level security;
create policy listings_read on public.listings for select to anon, authenticated
  using (
    status = 'active'
    or seller_id = auth.uid()
    or exists (
      select 1 from public.offers o
      where o.listing_id = listings.id and o.buyer_id = auth.uid()
        and o.status in ('accepted', 'paid', 'received')
    )
  );
create policy listings_insert on public.listings for insert to authenticated
  with check (seller_id = auth.uid() and status = 'active');
create policy listings_update on public.listings for update to authenticated
  using (seller_id = auth.uid()) with check (seller_id = auth.uid());

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id),
  buyer_id uuid not null references public.profiles (id),
  seller_id uuid not null references public.profiles (id),
  amount_cad numeric(12,2) not null check (amount_cad > 0 and amount_cad < 1000000),
  status text not null check (status in ('pending', 'countered', 'accepted', 'declined', 'expired', 'paid', 'received')),
  last_actor uuid not null,
  payment_due timestamptz,
  created_at timestamptz not null default now(),
  check (buyer_id <> seller_id)
);
alter table public.offers enable row level security;
create policy offers_read on public.offers for select to authenticated
  using (buyer_id = auth.uid() or seller_id = auth.uid());
create policy offers_insert on public.offers for insert to authenticated
  with check (buyer_id = auth.uid());
create policy offers_update on public.offers for update to authenticated
  using (buyer_id = auth.uid() or seller_id = auth.uid())
  with check (buyer_id = auth.uid() or seller_id = auth.uid());

create table public.payment_handles (
  user_id uuid primary key references public.profiles (id),
  interac_email text check (interac_email is null or char_length(interac_email) <= 120),
  paypal_me text check (paypal_me is null or char_length(paypal_me) <= 80),
  updated_at timestamptz not null default now(),
  check (interac_email is not null or paypal_me is not null)
);
alter table public.payment_handles enable row level security;
create policy handles_own on public.payment_handles for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy handles_buyer on public.payment_handles for select to authenticated
  using (
    exists (
      select 1 from public.offers o
      where o.buyer_id = auth.uid()
        and o.seller_id = payment_handles.user_id
        and (
          o.status = 'paid'
          or (o.status = 'accepted' and o.payment_due > now())
        )
    )
  );

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id),
  listing_id uuid references public.listings (id),
  reported_user uuid references public.profiles (id),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  created_at timestamptz not null default now()
);
alter table public.reports enable row level security;
create policy reports_insert on public.reports for insert to authenticated
  with check (reporter_id = auth.uid());

create table public.ratings (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.offers (id),
  rater_id uuid not null references public.profiles (id),
  ratee_id uuid not null references public.profiles (id),
  stars integer not null check (stars between 1 and 5),
  created_at timestamptz not null default now(),
  unique (offer_id, rater_id)
);
alter table public.ratings enable row level security;
create policy ratings_read on public.ratings for select to authenticated using (true);
create policy ratings_insert on public.ratings for insert to authenticated
  with check (
    rater_id = auth.uid()
    and exists (
      select 1 from public.offers o
      where o.id = offer_id and o.status = 'received'
        and ((o.buyer_id = auth.uid() and ratee_id = o.seller_id) or (o.seller_id = auth.uid() and ratee_id = o.buyer_id))
    )
  );

create or replace function public.market_guard_offer()
returns trigger language plpgsql security definer set search_path = public as $$
declare listing public.listings;
begin
  select * into listing from public.listings where id = new.listing_id;
  if listing.id is null then raise exception 'Listing is missing'; end if;
  if new.buyer_id = new.seller_id then raise exception 'Buyer and seller must differ'; end if;
  if tg_op = 'INSERT' then
    if new.id is null then new.id = gen_random_uuid(); end if;
    if new.buyer_id <> auth.uid() then raise exception 'Only the buyer can open an offer'; end if;
    if listing.status <> 'active' then raise exception 'Listing is not available'; end if;
    if (select count(*) from public.offers where buyer_id = new.buyer_id and status in ('pending', 'countered', 'accepted', 'paid')) >= 10 then
      raise exception 'Too many open offers';
    end if;
    if new.status = 'accepted' and new.amount_cad = listing.ask_cad then
      update public.listings set status = 'reserved', reserved_offer_id = new.id where id = listing.id;
      update public.offers set status = 'declined'
        where listing_id = listing.id and id <> new.id and status in ('pending', 'countered');
    elsif new.status <> 'pending' then
      raise exception 'A new offer starts as pending, or as accepted at the asking price';
    end if;
    return new;
  end if;
  if new.status = old.status and new.amount_cad = old.amount_cad then return new; end if;
  if auth.uid() is distinct from new.buyer_id and auth.uid() is distinct from new.seller_id then
    raise exception 'Not a party to this offer';
  end if;
  if new.status = 'countered' then
    if old.last_actor = auth.uid() then raise exception 'Wait for the other person'; end if;
    if old.status not in ('pending', 'countered') then raise exception 'This offer cannot be countered'; end if;
    new.last_actor = auth.uid();
  elsif new.status = 'accepted' then
    if old.last_actor = auth.uid() then raise exception 'Wait for the other person'; end if;
    if old.status not in ('pending', 'countered') or listing.status <> 'active' then raise exception 'This offer cannot be accepted'; end if;
    new.payment_due = now() + interval '2 hours';
    update public.listings set status = 'reserved', reserved_offer_id = new.id where id = listing.id;
    update public.offers set status = 'declined'
      where listing_id = listing.id and id <> new.id and status in ('pending', 'countered');
  elsif new.status = 'declined' then
    if old.last_actor = auth.uid() then raise exception 'Wait for the other person'; end if;
  elsif new.status = 'paid' then
    if auth.uid() <> old.buyer_id or old.status <> 'accepted' or old.payment_due <= now() then
      raise exception 'Payment is not open';
    end if;
  elsif new.status = 'received' then
    if auth.uid() <> old.seller_id or old.status <> 'paid' then raise exception 'Receipt is not open'; end if;
    update public.listings set status = 'completed' where id = listing.id;
  elsif new.status = 'expired' then
    if old.status <> 'accepted' or old.payment_due > now() then raise exception 'This offer has not expired'; end if;
    update public.listings set status = 'active', reserved_offer_id = null
      where id = listing.id and reserved_offer_id = old.id;
  else
    raise exception 'That status change is not allowed';
  end if;
  return new;
end $$;

create trigger market_guard_offer
  before insert or update on public.offers
  for each row execute function public.market_guard_offer();

create or replace function public.market_listing_cap()
returns trigger language plpgsql as $$
begin
  if (select count(*) from public.listings where seller_id = new.seller_id and status in ('active', 'reserved') and id <> new.id) >= 20 then
    raise exception 'You already have 20 open listings';
  end if;
  return new;
end $$;

create trigger market_listing_cap
  before insert on public.listings
  for each row execute function public.market_listing_cap();

insert into storage.buckets (id, name, public)
values ('listing-photos', 'listing-photos', true)
on conflict (id) do nothing;

create policy listing_photos_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text);
grant select on public.listings to anon, authenticated;
grant select, insert, update on public.listings to authenticated;
grant select, insert, update on public.offers to authenticated;
grant select, insert, update, delete on public.payment_handles to authenticated;
grant insert on public.reports to authenticated;
grant select, insert on public.ratings to authenticated;
grant select, insert, update on public.profiles to authenticated;

create policy listing_photos_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text);
