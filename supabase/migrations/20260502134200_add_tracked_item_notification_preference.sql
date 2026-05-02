alter table public.tracked_items
  add column notification_preference text,
  add constraint tracked_items_notification_preference_check
    check (notification_preference is null or notification_preference in ('email', 'sms'));
