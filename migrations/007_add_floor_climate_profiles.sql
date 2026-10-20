BEGIN;
ALTER TABLE iot_auto_control_configs
 ALTER COLUMN mushroom_type_id DROP NOT NULL,
 ADD COLUMN config_source TEXT NOT NULL DEFAULT 'LEGACY' CHECK (config_source IN ('LEGACY','FLOOR')),
 ADD COLUMN source_profiles JSONB,
 ADD COLUMN cooling_enabled BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN temperature_min DOUBLE PRECISION,
 ADD COLUMN temperature_max DOUBLE PRECISION,
 ADD COLUMN temperature_start_threshold DOUBLE PRECISION,
 ADD COLUMN temperature_stop_threshold DOUBLE PRECISION,
 ADD COLUMN cooling_humidity_limit DOUBLE PRECISION,
 ADD COLUMN max_temperature_spread_c DOUBLE PRECISION,
 ADD CONSTRAINT auto_profile_source CHECK (
  (config_source='LEGACY' AND mushroom_type_id IS NOT NULL) OR
  (config_source='FLOOR' AND source_profiles IS NOT NULL AND jsonb_typeof(source_profiles)='array')),
 ADD CONSTRAINT auto_cooling_bounds CHECK (NOT cooling_enabled OR (
  temperature_min IS NOT NULL AND temperature_max IS NOT NULL
  AND temperature_start_threshold IS NOT NULL AND temperature_stop_threshold IS NOT NULL
  AND cooling_humidity_limit IS NOT NULL AND max_temperature_spread_c IS NOT NULL
  AND temperature_min >= -40 AND temperature_max <= 80
  AND temperature_min < temperature_max
  AND temperature_stop_threshold >= temperature_min
  AND temperature_stop_threshold < temperature_start_threshold
  AND temperature_start_threshold <= temperature_max
  AND cooling_humidity_limit > humidity_stop_threshold AND cooling_humidity_limit <= humidity_max
  AND max_temperature_spread_c BETWEEN 0 AND 20));
ALTER TABLE iot_auto_control_runtime
 ADD COLUMN cooling_demand BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN last_average_temperature DOUBLE PRECISION,
 ADD COLUMN last_reason TEXT;
ALTER TABLE iot_auto_control_logs ADD COLUMN average_temperature DOUBLE PRECISION;
COMMIT;
