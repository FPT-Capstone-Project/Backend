BEGIN;

CREATE TABLE iot_masters (
    id SERIAL PRIMARY KEY,
    master_identifier VARCHAR(64) NOT NULL UNIQUE CHECK (master_identifier ~ '^[A-Za-z0-9_-]{1,64}$'),
    cultivation_room_id INT REFERENCES cultivation_rooms(room_id) ON DELETE RESTRICT,
    reported_status VARCHAR(7) CHECK (reported_status IN ('online', 'offline')),
    status_received_at TIMESTAMPTZ,
    status_retained BOOLEAN,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_iot_masters_room ON iot_masters(cultivation_room_id);

CREATE TABLE iot_sensor_readings (
    id BIGSERIAL PRIMARY KEY,
    master_id INT NOT NULL REFERENCES iot_masters(id) ON DELETE RESTRICT,
    node_address INT NOT NULL CHECK (node_address BETWEEN 1 AND 247),
    sensor_address INT NOT NULL CHECK (sensor_address BETWEEN 1 AND 3),
    temperature DOUBLE PRECISION,
    humidity DOUBLE PRECISION,
    is_valid BOOLEAN NOT NULL,
    received_at TIMESTAMPTZ NOT NULL,
    measured_at TIMESTAMPTZ,
    retained BOOLEAN NOT NULL DEFAULT false,
    CHECK ((is_valid AND temperature IS NOT NULL AND humidity IS NOT NULL
        AND temperature BETWEEN -40 AND 125 AND humidity BETWEEN 0 AND 100)
        OR (NOT is_valid AND temperature IS NULL AND humidity IS NULL))
);
CREATE INDEX idx_iot_readings_sensor_time ON iot_sensor_readings(master_id, node_address, sensor_address, received_at DESC, id DESC);

CREATE TABLE iot_sensor_latest (
    master_id INT NOT NULL REFERENCES iot_masters(id) ON DELETE RESTRICT,
    node_address INT NOT NULL CHECK (node_address BETWEEN 1 AND 247),
    sensor_address INT NOT NULL CHECK (sensor_address BETWEEN 1 AND 3),
    temperature DOUBLE PRECISION CHECK (temperature BETWEEN -40 AND 125),
    humidity DOUBLE PRECISION CHECK (humidity BETWEEN 0 AND 100),
    is_valid BOOLEAN NOT NULL,
    last_received_at TIMESTAMPTZ NOT NULL,
    last_valid_at TIMESTAMPTZ,
    retained BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (master_id, node_address, sensor_address)
);

CREATE TABLE iot_ssr_states (
    id BIGSERIAL PRIMARY KEY,
    master_id INT NOT NULL REFERENCES iot_masters(id) ON DELETE RESTRICT,
    channel INT NOT NULL CHECK (channel BETWEEN 1 AND 8),
    desired_state VARCHAR(3) CHECK (desired_state IN ('ON', 'OFF')),
    reported_state VARCHAR(3) CHECK (reported_state IN ('ON', 'OFF')),
    command_requested_at TIMESTAMPTZ,
    state_reported_at TIMESTAMPTZ,
    reported_retained BOOLEAN,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (master_id, channel)
);

CREATE TABLE iot_device_commands (
    id UUID PRIMARY KEY,
    master_id INT NOT NULL REFERENCES iot_masters(id) ON DELETE RESTRICT,
    channel INT NOT NULL CHECK (channel BETWEEN 1 AND 8),
    action VARCHAR(3) NOT NULL CHECK (action IN ('ON', 'OFF')),
    status VARCHAR(12) NOT NULL CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED', 'TIMED_OUT')),
    requested_by INT REFERENCES users(user_id) ON DELETE SET NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_message TEXT
);
CREATE INDEX idx_iot_commands_master_time ON iot_device_commands(master_id, requested_at DESC);
CREATE INDEX idx_iot_commands_pending_expiry ON iot_device_commands(expires_at) WHERE status = 'PENDING';

INSERT INTO iot_masters(master_identifier) VALUES ('master01');
COMMIT;
