BEGIN;
-- One shared incident table for sensors, nodes and masters.
CREATE TABLE IF NOT EXISTS device_incidents (
  incident_id SERIAL PRIMARY KEY,
  floor_id INTEGER REFERENCES cultivation_floors(floor_id),
  master_id INTEGER NOT NULL REFERENCES iot_masters(id),
  node_address INTEGER,
  sensor_address INTEGER CHECK (sensor_address BETWEEN 1 AND 3),
  device_type TEXT NOT NULL DEFAULT 'SENSOR',
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by INTEGER REFERENCES users(user_id),
  repair_note TEXT,
  CHECK ((status = 'OPEN' AND resolved_at IS NULL AND resolved_by IS NULL)
    OR (status = 'RESOLVED' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL)),
  CONSTRAINT device_incidents_target_check CHECK (
  (device_type='MASTER' AND floor_id IS NULL AND node_address IS NULL AND sensor_address IS NULL)
  OR (device_type='NODE' AND floor_id IS NOT NULL AND node_address BETWEEN 1 AND 247
    AND node_address IS NOT NULL AND sensor_address IS NULL)
  OR (device_type='SENSOR' AND floor_id IS NOT NULL AND node_address BETWEEN 1 AND 247
    AND node_address IS NOT NULL AND sensor_address BETWEEN 1 AND 3 AND sensor_address IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS device_incidents_open_sensor
  ON device_incidents(master_id,node_address,sensor_address) WHERE status='OPEN' AND device_type='SENSOR';
CREATE UNIQUE INDEX IF NOT EXISTS device_incidents_open_node
  ON device_incidents(master_id,node_address) WHERE status='OPEN' AND device_type='NODE';
CREATE UNIQUE INDEX IF NOT EXISTS device_incidents_open_master
  ON device_incidents(master_id) WHERE status='OPEN' AND device_type='MASTER';
CREATE INDEX IF NOT EXISTS notifications_device_reference
  ON notifications(reference_id) WHERE reference_type='DEVICE_INCIDENT';
COMMIT;
