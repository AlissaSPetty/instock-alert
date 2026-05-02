with contacts as (
  select
    user_id,
    max(nullif(email, '')) as email,
    max(nullif(phone, '')) as phone
  from public.tracked_items
  group by user_id
)
insert into public.profiles (id, email, phone, notification_preference)
select
  user_id,
  email,
  phone,
  case when email is not null then 'email' when phone is not null then 'sms' else 'email' end
from contacts
where email is not null or phone is not null
on conflict (id) do update
set
  email = coalesce(public.profiles.email, excluded.email),
  phone = coalesce(public.profiles.phone, excluded.phone),
  notification_preference = case
    when public.profiles.email is null and excluded.email is null and coalesce(public.profiles.phone, excluded.phone) is not null
      then 'sms'
    else public.profiles.notification_preference
  end,
  updated_at = now();

update public.profiles
set notification_preference = 'email'
where notification_preference not in ('email', 'sms');

alter table public.profiles
  add constraint profiles_notification_preference_check
  check (notification_preference in ('email', 'sms'));

alter table public.tracked_items
  drop column if exists email,
  drop column if exists phone;
