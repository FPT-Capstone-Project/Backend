BEGIN;

CREATE TABLE cultivation_floors (
 floor_id SERIAL PRIMARY KEY,
 room_id INT NOT NULL REFERENCES cultivation_rooms(room_id),
 floor_number INT NOT NULL CHECK (floor_number > 0),
 floor_name TEXT NOT NULL,
 master_id INT NOT NULL REFERENCES iot_masters(id),
 node_address INT NOT NULL CHECK (node_address BETWEEN 1 AND 247),
 misting_ssr_channel INT NOT NULL CHECK (misting_ssr_channel BETWEEN 1 AND 8),
 status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(room_id,floor_number), UNIQUE(master_id,misting_ssr_channel), UNIQUE(master_id,node_address),
 UNIQUE(floor_id,room_id)
);
ALTER TABLE cultivation_trays ADD COLUMN floor_id INT;
ALTER TABLE cultivation_trays ADD CONSTRAINT trays_floor_room_fk
 FOREIGN KEY(floor_id,room_id) REFERENCES cultivation_floors(floor_id,room_id);
CREATE INDEX idx_trays_floor ON cultivation_trays(floor_id);

CREATE TABLE iot_auto_control_configs (
 id SERIAL PRIMARY KEY, floor_id INT NOT NULL UNIQUE REFERENCES cultivation_floors(floor_id),
 mushroom_type_id INT NOT NULL REFERENCES mushroom_types(mushroom_type_id),
 profile_name TEXT, profile_approved BOOLEAN NOT NULL DEFAULT false,
 humidity_min DOUBLE PRECISION NOT NULL CHECK (humidity_min BETWEEN 0 AND 100),
 humidity_max DOUBLE PRECISION NOT NULL CHECK (humidity_max BETWEEN 0 AND 100),
 humidity_start_threshold DOUBLE PRECISION NOT NULL CHECK (humidity_start_threshold BETWEEN 0 AND 100),
 humidity_stop_threshold DOUBLE PRECISION NOT NULL CHECK (humidity_stop_threshold BETWEEN 0 AND 100),
 misting_pulse_ms INT NOT NULL CHECK (misting_pulse_ms BETWEEN 1000 AND 60000),
 cooldown_ms INT NOT NULL CHECK (cooldown_ms BETWEEN 1000 AND 86400000),
 evaluation_interval_ms INT NOT NULL CHECK (evaluation_interval_ms BETWEEN 1000 AND 60000),
 sensor_max_age_ms INT NOT NULL DEFAULT 20000 CHECK (sensor_max_age_ms BETWEEN 1000 AND 300000),
 required_valid_sensors INT NOT NULL DEFAULT 3 CHECK (required_valid_sensors BETWEEN 1 AND 3),
 max_sensor_spread_percent DOUBLE PRECISION NOT NULL CHECK (max_sensor_spread_percent BETWEEN 0 AND 100),
 max_activations_per_hour INT NOT NULL CHECK (max_activations_per_hour BETWEEN 1 AND 3600),
 max_cumulative_on_ms_per_hour INT NOT NULL CHECK (max_cumulative_on_ms_per_hour BETWEEN 1000 AND 3600000),
 configured_by INT REFERENCES users(user_id), configured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK (humidity_min < humidity_max AND humidity_start_threshold < humidity_stop_threshold
 AND humidity_start_threshold <= humidity_min AND humidity_stop_threshold <= humidity_max),
 CHECK (max_cumulative_on_ms_per_hour >= misting_pulse_ms)
);
CREATE TABLE iot_auto_control_runs (
 id SERIAL PRIMARY KEY, floor_id INT NOT NULL REFERENCES cultivation_floors(floor_id),
 config_id INT NOT NULL REFERENCES iot_auto_control_configs(id), config_snapshot JSONB NOT NULL,
 dry_run BOOLEAN NOT NULL DEFAULT true,
 status TEXT NOT NULL CHECK (status IN ('RUNNING','STOPPED','FAULT')),
 started_by INT REFERENCES users(user_id), started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 stopped_by INT REFERENCES users(user_id), stopped_at TIMESTAMPTZ, stop_reason TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_auto_one_run ON iot_auto_control_runs(floor_id) WHERE status='RUNNING';
CREATE INDEX idx_auto_runs_floor ON iot_auto_control_runs(floor_id,id DESC);
CREATE TABLE iot_auto_control_runtime (
 floor_id INT PRIMARY KEY REFERENCES cultivation_floors(floor_id), run_id INT REFERENCES iot_auto_control_runs(id),
 control_state TEXT NOT NULL DEFAULT 'DISABLED' CHECK (control_state IN
 ('DISABLED','IDLE','ON_REQUESTED','MISTING','OFF_PENDING','COOLDOWN','SENSOR_FAULT','DEVICE_OFFLINE','FAULT')),
 cycle_id UUID, demand BOOLEAN NOT NULL DEFAULT false,
 pulse_started_at TIMESTAMPTZ, pulse_deadline_at TIMESTAMPTZ, cooldown_until TIMESTAMPTZ,
 off_requested_at TIMESTAMPTZ, last_evaluated_at TIMESTAMPTZ, last_average_humidity DOUBLE PRECISION,
 last_error TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE iot_auto_control_logs (
 id BIGSERIAL PRIMARY KEY, floor_id INT NOT NULL REFERENCES cultivation_floors(floor_id),
 run_id INT REFERENCES iot_auto_control_runs(id), event_type TEXT NOT NULL,
 average_humidity DOUBLE PRECISION, sensor_values_json JSONB, thresholds_snapshot_json JSONB,
 command_id UUID REFERENCES iot_device_commands(id), reason TEXT,
 reserved_on_ms INT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_auto_logs_floor_time ON iot_auto_control_logs(floor_id,created_at DESC,id DESC);
CREATE TABLE iot_auto_control_worker (
 id INT PRIMARY KEY CHECK(id=1), heartbeat_at TIMESTAMPTZ NOT NULL
);

-- Exact role names are deliberately resolved in data, never by numeric IDs.
INSERT INTO permissions(permission_name,description) VALUES
 ('iot.automation.manage','Configure, start, stop and map floor automation') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
 SELECT r.role_id,p.permission_id FROM roles r CROSS JOIN permissions p
 WHERE lower(regexp_replace(r.role_name,'[ _-]','','g')) IN ('admin','farmoperator')
 AND p.permission_name='iot.automation.manage' ON CONFLICT DO NOTHING;

CREATE FUNCTION check_floor_master_room() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM iot_masters WHERE id=NEW.master_id AND cultivation_room_id=NEW.room_id) THEN
  RAISE EXCEPTION 'Master must belong to the floor room' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER floor_master_room BEFORE INSERT OR UPDATE ON cultivation_floors
 FOR EACH ROW EXECUTE FUNCTION check_floor_master_room();
CREATE FUNCTION protect_master_floor_room() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM cultivation_floors WHERE master_id=NEW.id AND room_id IS DISTINCT FROM NEW.cultivation_room_id) THEN
  RAISE EXCEPTION 'Master is assigned to floors in another room' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER master_floor_room BEFORE UPDATE OF cultivation_room_id ON iot_masters
 FOR EACH ROW EXECUTE FUNCTION protect_master_floor_room();
COMMIT;
