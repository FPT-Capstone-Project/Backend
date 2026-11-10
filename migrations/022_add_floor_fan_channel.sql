-- One optional manual fan per floor. Existing floors remain unconfigured.
BEGIN;
ALTER TABLE public.cultivation_floors
 ADD COLUMN IF NOT EXISTS fan_ssr_channel INTEGER
 CHECK (fan_ssr_channel BETWEEN 1 AND 8);

CREATE OR REPLACE FUNCTION public.check_floor_fan_channel() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE light_channel INTEGER;
BEGIN
 -- Serialize mapping changes for floors sharing the same master.
 SELECT light_ssr_channel INTO light_channel FROM public.iot_masters WHERE id=NEW.master_id FOR UPDATE;
 IF NEW.fan_ssr_channel=NEW.misting_ssr_channel OR NEW.fan_ssr_channel=light_channel
 OR EXISTS (
  SELECT 1 FROM public.cultivation_floors f
  WHERE f.master_id=NEW.master_id AND f.floor_id<>NEW.floor_id
  AND (f.fan_ssr_channel=NEW.fan_ssr_channel
   OR f.misting_ssr_channel=NEW.fan_ssr_channel
   OR f.fan_ssr_channel=NEW.misting_ssr_channel)
 ) THEN
  RAISE EXCEPTION 'SSR channel is already assigned to a fan, valve or room light'
   USING ERRCODE='23514', CONSTRAINT='fan_mapping_conflict';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS floor_fan_channel_guard ON public.cultivation_floors;
CREATE TRIGGER floor_fan_channel_guard BEFORE INSERT OR UPDATE ON public.cultivation_floors
 FOR EACH ROW EXECUTE FUNCTION public.check_floor_fan_channel();

CREATE OR REPLACE FUNCTION public.check_light_fan_channel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.cultivation_floors
  WHERE master_id=NEW.id AND fan_ssr_channel=NEW.light_ssr_channel) THEN
  RAISE EXCEPTION 'Light channel is already assigned to a floor fan'
   USING ERRCODE='23514', CONSTRAINT='light_mapping_conflict';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS light_fan_channel_guard ON public.iot_masters;
CREATE TRIGGER light_fan_channel_guard BEFORE UPDATE ON public.iot_masters
 FOR EACH ROW EXECUTE FUNCTION public.check_light_fan_channel();
COMMIT;
