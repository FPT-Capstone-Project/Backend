BEGIN;
-- Room light mapping; NULL means unconfigured. No GPIO or relay command is sent.
ALTER TABLE iot_masters ADD COLUMN light_ssr_channel INT
 CONSTRAINT chk_master_light_channel CHECK (light_ssr_channel BETWEEN 1 AND 8);

CREATE FUNCTION check_master_light_channel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.light_ssr_channel IS NOT NULL THEN
  IF NEW.cultivation_room_id IS NULL THEN
   RAISE EXCEPTION 'Assign the master to a room before configuring its light'
    USING ERRCODE='23514', CONSTRAINT='light_mapping_conflict';
  END IF;
  IF EXISTS(SELECT 1 FROM cultivation_floors WHERE master_id=NEW.id
    AND misting_ssr_channel=NEW.light_ssr_channel) THEN
   RAISE EXCEPTION 'Light channel is already assigned to a floor valve'
    USING ERRCODE='23514', CONSTRAINT='light_mapping_conflict';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER master_light_channel_guard BEFORE INSERT OR UPDATE ON iot_masters
 FOR EACH ROW EXECUTE FUNCTION check_master_light_channel();

CREATE FUNCTION check_floor_light_channel() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE light_channel INT;
BEGIN
 -- Serialize light and valve mapping writes on the same master row.
 SELECT light_ssr_channel INTO light_channel FROM iot_masters WHERE id=NEW.master_id FOR UPDATE;
 IF light_channel=NEW.misting_ssr_channel THEN
  RAISE EXCEPTION 'Valve channel is already assigned to the room light'
   USING ERRCODE='23514', CONSTRAINT='light_mapping_conflict';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER floor_light_channel_guard BEFORE INSERT OR UPDATE ON cultivation_floors
 FOR EACH ROW EXECUTE FUNCTION check_floor_light_channel();
COMMIT;
