BEGIN;
ALTER TABLE iot_auto_control_configs
 ADD COLUMN IF NOT EXISTS fan_enabled BOOLEAN NOT NULL DEFAULT FALSE,
 ADD COLUMN IF NOT EXISTS fan_run_minutes INTEGER CHECK(fan_run_minutes BETWEEN 1 AND 1440),
 ADD COLUMN IF NOT EXISTS fan_rest_minutes INTEGER CHECK(fan_rest_minutes BETWEEN 1 AND 1440);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='auto_fan_durations') THEN
 ALTER TABLE iot_auto_control_configs ADD CONSTRAINT auto_fan_durations CHECK(NOT fan_enabled OR (fan_run_minutes IS NOT NULL AND fan_rest_minutes IS NOT NULL));
 END IF;
END $$;
ALTER TABLE iot_auto_control_runtime
 ADD COLUMN IF NOT EXISTS fan_state TEXT NOT NULL DEFAULT 'STOPPED' CHECK(fan_state IN ('STOPPED','OFF_PENDING','READY','ON_PENDING','RUNNING','RESTING')),
 ADD COLUMN IF NOT EXISTS fan_after_off TEXT DEFAULT 'REST' CHECK(fan_after_off IN ('RUN','REST','STOP')),
 ADD COLUMN IF NOT EXISTS fan_master_id INTEGER REFERENCES iot_masters(id),
 ADD COLUMN IF NOT EXISTS fan_channel INTEGER CHECK(fan_channel BETWEEN 1 AND 8),
 ADD COLUMN IF NOT EXISTS fan_deadline_at TIMESTAMPTZ,
 ADD COLUMN IF NOT EXISTS fan_requested_at TIMESTAMPTZ,
 ADD COLUMN IF NOT EXISTS fan_retry_at TIMESTAMPTZ,
 ADD COLUMN IF NOT EXISTS fan_last_error TEXT;
DO $$ BEGIN
 IF to_regclass('iot_fan_auto_control') IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM iot_fan_auto_control WHERE enabled OR state<>'STOPPED') THEN
   RAISE EXCEPTION 'Stop legacy fan AUTO and confirm OFF before migration';
  END IF;
  INSERT INTO iot_auto_control_logs(floor_id,event_type,thresholds_snapshot_json)
   SELECT floor_id,'FAN_LEGACY_CONFIG',to_jsonb(c) FROM iot_fan_auto_control c;
  UPDATE iot_auto_control_configs c SET fan_run_minutes=f.run_minutes,fan_rest_minutes=f.rest_minutes
   FROM iot_fan_auto_control f WHERE c.floor_id=f.floor_id;
  DROP TABLE iot_fan_auto_control;
 END IF;
 IF to_regclass('iot_fan_auto_logs') IS NOT NULL THEN
  INSERT INTO iot_auto_control_logs(floor_id,event_type,thresholds_snapshot_json,created_at)
   SELECT floor_id,'FAN_LEGACY_'||event_type,details,created_at FROM iot_fan_auto_logs;
  DROP TABLE iot_fan_auto_logs;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION protect_running_fan_mapping() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.master_id IS DISTINCT FROM OLD.master_id OR NEW.fan_ssr_channel IS DISTINCT FROM OLD.fan_ssr_channel OR NEW.status IS DISTINCT FROM OLD.status)
 AND (EXISTS(SELECT 1 FROM iot_auto_control_runtime WHERE floor_id=OLD.floor_id AND fan_state<>'STOPPED')
 OR EXISTS(SELECT 1 FROM iot_auto_control_runs WHERE floor_id=OLD.floor_id AND status='RUNNING' AND config_snapshot->>'fan_enabled'='true')) THEN
 RAISE EXCEPTION 'Stop AUTO and confirm fan OFF before changing mapping' USING ERRCODE='23514',CONSTRAINT='fan_mapping_conflict';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS running_fan_mapping_guard ON cultivation_floors;
CREATE TRIGGER running_fan_mapping_guard BEFORE UPDATE ON cultivation_floors FOR EACH ROW EXECUTE FUNCTION protect_running_fan_mapping();
COMMIT;
