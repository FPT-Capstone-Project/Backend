-- Apply to the revised database.sql schema (or an installation with IoT 004-009).
-- No device provisioning, automatic run creation, or deletion of conflicting data.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_iot_ssr_master_channel
 ON public.iot_ssr_states(master_id, channel);
CREATE UNIQUE INDEX IF NOT EXISTS uq_floor_room_number
 ON public.cultivation_floors(room_id, floor_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_floor_master_channel
 ON public.cultivation_floors(master_id, misting_ssr_channel);
CREATE UNIQUE INDEX IF NOT EXISTS uq_floor_master_node
 ON public.cultivation_floors(master_id, node_address);
CREATE UNIQUE INDEX IF NOT EXISTS idx_auto_one_run
 ON public.iot_auto_control_runs(floor_id) WHERE status='RUNNING';
CREATE INDEX IF NOT EXISTS idx_auto_runs_floor
 ON public.iot_auto_control_runs(floor_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_trays_floor ON public.cultivation_trays(floor_id);

-- Reintroduce the cross-column checks omitted by the table-only export.
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.mushroom_conditions'::regclass AND conname='chk_humidity_range') THEN
  ALTER TABLE public.mushroom_conditions ADD CONSTRAINT chk_humidity_range CHECK (humidity_min <= humidity_max);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.mushroom_conditions'::regclass AND conname='chk_temperature_range') THEN
  ALTER TABLE public.mushroom_conditions ADD CONSTRAINT chk_temperature_range CHECK (temperature_min <= temperature_max);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.iot_auto_control_configs'::regclass AND conname='auto_humidity_bounds') THEN
  ALTER TABLE public.iot_auto_control_configs ADD CONSTRAINT auto_humidity_bounds CHECK (
   humidity_min < humidity_max AND humidity_start_threshold < humidity_stop_threshold
   AND humidity_start_threshold <= humidity_min AND humidity_stop_threshold <= humidity_max
   AND max_cumulative_on_ms_per_hour >= misting_pulse_ms);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.iot_auto_control_configs'::regclass AND conname='auto_profile_source') THEN
  ALTER TABLE public.iot_auto_control_configs ADD CONSTRAINT auto_profile_source CHECK (
   (config_source='LEGACY' AND mushroom_type_id IS NOT NULL) OR
   (config_source='FLOOR' AND source_profiles IS NOT NULL AND jsonb_typeof(source_profiles)='array'));
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.iot_auto_control_configs'::regclass AND conname='auto_cooling_bounds') THEN
  ALTER TABLE public.iot_auto_control_configs ADD CONSTRAINT auto_cooling_bounds CHECK (NOT cooling_enabled OR (
   temperature_min IS NOT NULL AND temperature_max IS NOT NULL
   AND temperature_start_threshold IS NOT NULL AND temperature_stop_threshold IS NOT NULL
   AND cooling_humidity_limit IS NOT NULL AND max_temperature_spread_c IS NOT NULL
   AND temperature_min >= -40 AND temperature_max <= 80 AND temperature_min < temperature_max
   AND temperature_stop_threshold >= temperature_min AND temperature_stop_threshold < temperature_start_threshold
   AND temperature_start_threshold <= temperature_max
   AND cooling_humidity_limit > humidity_stop_threshold AND cooling_humidity_limit <= humidity_max
   AND max_temperature_spread_c BETWEEN 0 AND 20));
 END IF;
END $$;

INSERT INTO public.permissions(permission_name, description)
 VALUES ('iot.automation.manage', 'Configure, start, stop and map floor automation')
 ON CONFLICT (permission_name) DO NOTHING;
INSERT INTO public.role_permissions(role_id, permission_id)
 SELECT r.role_id, p.permission_id FROM public.roles r CROSS JOIN public.permissions p
 WHERE lower(regexp_replace(r.role_name, '[ _-]', '', 'g')) IN ('admin', 'farmoperator')
 AND p.permission_name='iot.automation.manage'
 ON CONFLICT DO NOTHING;

-- Refuse inconsistent existing mappings; let the operator resolve them explicitly.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.cultivation_floors f JOIN public.iot_masters m ON m.id=f.master_id
  WHERE f.room_id IS DISTINCT FROM m.cultivation_room_id) THEN
  RAISE EXCEPTION 'Master must belong to the floor room' USING ERRCODE='23514';
 END IF;
 IF EXISTS (SELECT 1 FROM public.iot_masters m WHERE m.light_ssr_channel IS NOT NULL
  AND (m.cultivation_room_id IS NULL OR EXISTS (SELECT 1 FROM public.cultivation_floors f
   WHERE f.master_id=m.id AND f.misting_ssr_channel=m.light_ssr_channel))) THEN
  RAISE EXCEPTION 'Light mapping conflicts with room or floor valve' USING ERRCODE='23514';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.check_floor_master_room() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE master_room INTEGER;
BEGIN
 SELECT cultivation_room_id INTO master_room FROM public.iot_masters WHERE id=NEW.master_id FOR UPDATE;
 IF master_room IS DISTINCT FROM NEW.room_id THEN
  RAISE EXCEPTION 'Master must belong to the floor room' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS floor_master_room ON public.cultivation_floors;
CREATE TRIGGER floor_master_room BEFORE INSERT OR UPDATE ON public.cultivation_floors
 FOR EACH ROW EXECUTE FUNCTION public.check_floor_master_room();

CREATE OR REPLACE FUNCTION public.protect_master_floor_room() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.cultivation_floors WHERE master_id=NEW.id
  AND room_id IS DISTINCT FROM NEW.cultivation_room_id) THEN
  RAISE EXCEPTION 'Master is assigned to floors in another room' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS master_floor_room ON public.iot_masters;
CREATE TRIGGER master_floor_room BEFORE UPDATE OF cultivation_room_id ON public.iot_masters
 FOR EACH ROW EXECUTE FUNCTION public.protect_master_floor_room();

CREATE OR REPLACE FUNCTION public.check_master_light_channel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.light_ssr_channel IS NOT NULL THEN
  IF NEW.cultivation_room_id IS NULL THEN
   RAISE EXCEPTION 'Assign the master to a room before configuring its light'
    USING ERRCODE='23514', CONSTRAINT='light_mapping_conflict';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cultivation_floors WHERE master_id=NEW.id
   AND misting_ssr_channel=NEW.light_ssr_channel) THEN
   RAISE EXCEPTION 'Light channel is already assigned to a floor valve'
    USING ERRCODE='23514', CONSTRAINT='light_mapping_conflict';
  END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS master_light_channel_guard ON public.iot_masters;
CREATE TRIGGER master_light_channel_guard BEFORE INSERT OR UPDATE ON public.iot_masters
 FOR EACH ROW EXECUTE FUNCTION public.check_master_light_channel();

CREATE OR REPLACE FUNCTION public.check_floor_light_channel() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE light_channel INTEGER;
BEGIN
 SELECT light_ssr_channel INTO light_channel FROM public.iot_masters WHERE id=NEW.master_id FOR UPDATE;
 IF light_channel=NEW.misting_ssr_channel THEN
  RAISE EXCEPTION 'Valve channel is already assigned to the room light'
   USING ERRCODE='23514', CONSTRAINT='light_mapping_conflict';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS floor_light_channel_guard ON public.cultivation_floors;
CREATE TRIGGER floor_light_channel_guard BEFORE INSERT OR UPDATE ON public.cultivation_floors
 FOR EACH ROW EXECUTE FUNCTION public.check_floor_light_channel();

COMMIT;
