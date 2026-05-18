-- Add shared_goals_mode app setting option
INSERT INTO public.app_settings (key, value, description) VALUES
  ('shared_goals_mode', 'unified', 'Shared goals weightage integration mode: unified (must sum to 100% with personal goals) or special (layered on top without constraints)')
ON CONFLICT (key) DO NOTHING;
