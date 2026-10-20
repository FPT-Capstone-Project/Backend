-- ============================================================
-- SMART MUSH FARM DATABASE
-- PostgreSQL
-- Consolidated schema for a NEW, EMPTY database (migrations 001 through 008).
-- Includes both 005 migrations and both 007 migrations.
-- Existing databases: apply the relevant migrations instead of rerunning this file.
-- Paid-rental backfill in 007_backfill_paid_rentals.sql is for existing data;
-- its final rental schema is already defined below.
-- Seed roles separately, then grant iot.automation.manage to Admin/Farm Operator.
-- ============================================================

-- ============================================================
-- 1. ROLES
-- ============================================================

CREATE TABLE roles (
    role_id SERIAL PRIMARY KEY,
    role_name VARCHAR(50) NOT NULL UNIQUE,
    description TEXT
);


-- ============================================================
-- 2. PERMISSIONS
-- ============================================================

CREATE TABLE permissions (
    permission_id SERIAL PRIMARY KEY,
    permission_name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT
);


-- ============================================================
-- 3. ROLE_PERMISSIONS
-- ============================================================

CREATE TABLE role_permissions (
    role_id INT NOT NULL,
    permission_id INT NOT NULL,

    PRIMARY KEY (role_id, permission_id),

    CONSTRAINT fk_role_permissions_role
        FOREIGN KEY (role_id)
        REFERENCES roles(role_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_role_permissions_permission
        FOREIGN KEY (permission_id)
        REFERENCES permissions(permission_id)
        ON DELETE CASCADE
);


-- ============================================================
-- 4. USERS
-- ============================================================

CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,

    role_id INT NOT NULL,

    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    phone VARCHAR(30),
    address TEXT,

    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_users_role
        FOREIGN KEY (role_id)
        REFERENCES roles(role_id)
        ON DELETE RESTRICT,

    CONSTRAINT chk_users_status
        CHECK (
            status IN ('ACTIVE', 'INACTIVE', 'BLOCKED')
        )
);


-- ============================================================
-- 5. MUSHROOM_TYPES
-- ============================================================

CREATE TABLE mushroom_types (
    mushroom_type_id SERIAL PRIMARY KEY,

    name VARCHAR(150) NOT NULL UNIQUE,
    description TEXT,

    growing_days INT NOT NULL,

    price NUMERIC(12,2) NOT NULL DEFAULT 0,

    image_url TEXT,

    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_mushroom_growing_days
        CHECK (growing_days > 0),

    CONSTRAINT chk_mushroom_price
        CHECK (price >= 0),

    CONSTRAINT chk_mushroom_status
        CHECK (
            status IN ('ACTIVE', 'INACTIVE')
        )
);


-- ============================================================
-- 6. MUSHROOM_CONDITIONS
-- ============================================================

CREATE TABLE mushroom_conditions (
    condition_id SERIAL PRIMARY KEY,

    mushroom_type_id INT NOT NULL,

    temperature_min NUMERIC(6,2),
    temperature_max NUMERIC(6,2),

    humidity_min NUMERIC(6,2),
    humidity_max NUMERIC(6,2),

    co2_min NUMERIC(10,2),
    co2_max NUMERIC(10,2),

    substrate_moisture_min NUMERIC(6,2),
    substrate_moisture_max NUMERIC(6,2),

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_mushroom_conditions_type
        FOREIGN KEY (mushroom_type_id)
        REFERENCES mushroom_types(mushroom_type_id)
        ON DELETE CASCADE,

    CONSTRAINT chk_temperature_range
        CHECK (
            temperature_min IS NULL
            OR temperature_max IS NULL
            OR temperature_min <= temperature_max
        ),

    CONSTRAINT chk_humidity_range
        CHECK (
            humidity_min IS NULL
            OR humidity_max IS NULL
            OR humidity_min <= humidity_max
        ),

    CONSTRAINT chk_co2_range
        CHECK (
            co2_min IS NULL
            OR co2_max IS NULL
            OR co2_min <= co2_max
        ),

    CONSTRAINT chk_substrate_moisture_range
        CHECK (
            substrate_moisture_min IS NULL
            OR substrate_moisture_max IS NULL
            OR substrate_moisture_min <= substrate_moisture_max
        )
);


-- ============================================================
-- 7. RENTAL_PACKAGES
-- ============================================================

CREATE TABLE rental_packages (
    package_id SERIAL PRIMARY KEY,

    package_name VARCHAR(100) NOT NULL,
    description TEXT,

    duration_days INT NOT NULL,
    price NUMERIC(12,2) NOT NULL,

    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT chk_package_duration
        CHECK (duration_days > 0),

    CONSTRAINT chk_package_price
        CHECK (price >= 0),

    CONSTRAINT chk_package_status
        CHECK (
            status IN ('ACTIVE', 'INACTIVE')
        )
);


-- ============================================================
-- 8. CULTIVATION_ROOMS
-- ============================================================

CREATE TABLE cultivation_rooms (
    room_id SERIAL PRIMARY KEY,

    room_code VARCHAR(50) NOT NULL UNIQUE,
    room_name VARCHAR(100) NOT NULL,
    description TEXT,

    capacity INT NOT NULL DEFAULT 0,

    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_room_capacity
        CHECK (capacity >= 0),

    CONSTRAINT chk_room_status
        CHECK (
            status IN (
                'ACTIVE',
                'INACTIVE',
                'MAINTENANCE'
            )
        )
);


-- ============================================================
-- 9. CULTIVATION_TRAYS
-- ============================================================

CREATE TABLE cultivation_trays (
    tray_id SERIAL PRIMARY KEY,

    room_id INT NOT NULL,

    tray_code VARCHAR(50) NOT NULL UNIQUE,
    tray_name VARCHAR(100),

    status VARCHAR(30) NOT NULL DEFAULT 'AVAILABLE',

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_trays_room
        FOREIGN KEY (room_id)
        REFERENCES cultivation_rooms(room_id)
        ON DELETE RESTRICT,

    CONSTRAINT chk_tray_status
        CHECK (
            status IN (
                'AVAILABLE',
                'OCCUPIED',
                'MAINTENANCE',
                'INACTIVE'
            )
        )
);


-- ============================================================
-- 10. ORDERS
-- ============================================================

CREATE TABLE orders (
    order_id SERIAL PRIMARY KEY,

    user_id INT NOT NULL,

    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount NUMERIC(12,2) NOT NULL DEFAULT 0,
    shipping_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,

    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    payment_status VARCHAR(30) NOT NULL DEFAULT 'UNPAID',

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_orders_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE RESTRICT,

    CONSTRAINT chk_order_amounts
        CHECK (
            subtotal >= 0
            AND discount >= 0
            AND shipping_fee >= 0
            AND total_amount >= 0
        ),

    CONSTRAINT chk_order_status
        CHECK (
            status IN (
                'PENDING',
                'PAID',
                'CONFIRMED',
                'PROCESSING',
                'COMPLETED',
                'CANCELLED'
            )
        ),

    CONSTRAINT chk_orders_payment_status
        CHECK (
            payment_status IN (
                'UNPAID',
                'PENDING',
                'PAID',
                'FAILED',
                'REFUND_PENDING',
                'REFUNDED'
            )
        )
);


-- ============================================================
-- 11. ORDER_ITEMS
-- ============================================================

CREATE TABLE order_items (
    order_item_id SERIAL PRIMARY KEY,

    order_id INT NOT NULL,

    item_type VARCHAR(30) NOT NULL,

    rental_package_id INT,
    mushroom_type_id INT,

    quantity INT NOT NULL DEFAULT 1,

    unit_price NUMERIC(12,2) NOT NULL,
    total_price NUMERIC(12,2) NOT NULL,

    CONSTRAINT fk_order_items_order
        FOREIGN KEY (order_id)
        REFERENCES orders(order_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_order_items_package
        FOREIGN KEY (rental_package_id)
        REFERENCES rental_packages(package_id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_order_items_mushroom
        FOREIGN KEY (mushroom_type_id)
        REFERENCES mushroom_types(mushroom_type_id)
        ON DELETE RESTRICT,

    CONSTRAINT chk_order_item_type
        CHECK (
            (
                item_type = 'MUSHROOM'
                AND mushroom_type_id IS NOT NULL
                AND rental_package_id IS NULL
            )
            OR
            (
                item_type = 'RENTAL'
                AND rental_package_id IS NOT NULL
            )
        ),

    CONSTRAINT chk_order_item_quantity
        CHECK (quantity > 0),

    CONSTRAINT chk_order_item_price
        CHECK (
            unit_price >= 0
            AND total_price >= 0
        )
);


-- ============================================================
-- 12. RENTALS
-- ============================================================

CREATE TABLE rentals (
    rental_id SERIAL PRIMARY KEY,

    -- Rental order
    order_id INT NOT NULL,

    -- Customer renting
    user_id INT NOT NULL,

    tray_id INT,

    duration_days INT NOT NULL
        CHECK (duration_days > 0),

    start_date TIMESTAMP,
    end_date TIMESTAMP,

    status VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED'
        CHECK (status IN ('CONFIRMED', 'PREPARING', 'ACTIVE', 'COMPLETED', 'CANCELLED')),

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_rentals_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id),

    CONSTRAINT uq_rentals_order_id UNIQUE (order_id),

    CONSTRAINT fk_rentals_order
        FOREIGN KEY (order_id)
        REFERENCES orders(order_id),

    CONSTRAINT fk_rentals_tray
        FOREIGN KEY (tray_id)
        REFERENCES cultivation_trays(tray_id),

    CONSTRAINT rentals_date_check
        CHECK (start_date IS NULL OR end_date IS NULL OR end_date > start_date)
);

CREATE INDEX idx_rentals_user_id ON rentals(user_id);
CREATE INDEX idx_rentals_status ON rentals(status);
CREATE INDEX idx_rentals_tray_id ON rentals(tray_id);

-- ============================================================
-- 13. PAYMENTS
-- ============================================================

CREATE TABLE payments (
    payment_id SERIAL PRIMARY KEY,

    order_id INT NOT NULL,

    amount NUMERIC(12,2) NOT NULL,

    payment_method VARCHAR(50) NOT NULL,

    transaction_code VARCHAR(150),

    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',

    paid_at TIMESTAMP,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    payos_payment_link_id TEXT,
    payos_checkout_url TEXT,
    payos_qr_code TEXT,

    CONSTRAINT fk_payments_order
        FOREIGN KEY (order_id)
        REFERENCES orders(order_id)
        ON DELETE RESTRICT,

    CONSTRAINT chk_payment_amount
        CHECK (amount >= 0),

    CONSTRAINT chk_payment_status
        CHECK (
            status IN (
                'PENDING',
                'PAID',
                'FAILED',
                'REFUNDED',
                'CANCELLED'
            )
        )
);


-- ============================================================
-- 14. SHIPMENTS
-- ============================================================

CREATE TABLE shipments (
    shipment_id SERIAL PRIMARY KEY,

    order_id INT NOT NULL,

    address TEXT NOT NULL,

    recipient_name VARCHAR(150) NOT NULL,
    recipient_phone VARCHAR(30) NOT NULL,

    shipping_fee NUMERIC(12,2) NOT NULL DEFAULT 0,

    carrier VARCHAR(100),
    tracking_code VARCHAR(150),

    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',

    shipped_at TIMESTAMP,
    delivered_at TIMESTAMP,

    CONSTRAINT fk_shipments_order
        FOREIGN KEY (order_id)
        REFERENCES orders(order_id)
        ON DELETE RESTRICT,

    CONSTRAINT chk_shipping_fee
        CHECK (shipping_fee >= 0),

    CONSTRAINT chk_shipment_dates
        CHECK (
            delivered_at IS NULL
            OR shipped_at IS NULL
            OR delivered_at >= shipped_at
        ),

    CONSTRAINT chk_shipment_status
        CHECK (
            status IN (
                'PENDING',
                'SHIPPED',
                'IN_TRANSIT',
                'DELIVERED',
                'CANCELLED'
            )
        )
);


-- ============================================================
-- 15. CULTIVATION_SESSIONS
-- ============================================================

CREATE TABLE cultivation_sessions (
    session_id SERIAL PRIMARY KEY,

    rental_id INT NOT NULL,

    tray_id INT NOT NULL,

    mushroom_type_id INT NOT NULL,

    start_at TIMESTAMP NOT NULL,
    end_at TIMESTAMP,

    duration_days INT,

    status VARCHAR(30) NOT NULL DEFAULT 'PLANNED',

    harvest_date DATE,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_sessions_rental
        FOREIGN KEY (rental_id)
        REFERENCES rentals(rental_id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_sessions_tray
        FOREIGN KEY (tray_id)
        REFERENCES cultivation_trays(tray_id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_sessions_mushroom
        FOREIGN KEY (mushroom_type_id)
        REFERENCES mushroom_types(mushroom_type_id)
        ON DELETE RESTRICT,

    CONSTRAINT chk_session_dates
        CHECK (
            end_at IS NULL
            OR end_at >= start_at
        ),

    CONSTRAINT chk_session_duration
        CHECK (
            duration_days IS NULL
            OR duration_days > 0
        ),

    CONSTRAINT chk_session_status
        CHECK (
            status IN (
                'PLANNED',
                'ACTIVE',
                'COMPLETED',
                'CANCELLED'
            )
        )
);


-- ============================================================
-- 16. CULTIVATION_PROGRESS
-- ============================================================

CREATE TABLE cultivation_progress (
    progress_id SERIAL PRIMARY KEY,

    session_id INT NOT NULL,

    current_stage VARCHAR(100) NOT NULL,

    progress_percent NUMERIC(5,2) NOT NULL DEFAULT 0,

    start_date DATE,

    expected_harvest_date DATE,

    description TEXT,

    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_progress_session
        FOREIGN KEY (session_id)
        REFERENCES cultivation_sessions(session_id)
        ON DELETE CASCADE,

    CONSTRAINT chk_progress_percent
        CHECK (
            progress_percent >= 0
            AND progress_percent <= 100
        )
);


-- ============================================================
-- 17. HARVESTS
-- ============================================================

CREATE TABLE harvests (
    harvest_id SERIAL PRIMARY KEY,

    session_id INT NOT NULL,

    harvest_date DATE NOT NULL,

    quantity NUMERIC(12,3) NOT NULL,

    unit VARCHAR(30) NOT NULL,

    quality_grade VARCHAR(50),

    notes TEXT,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_harvests_session
        FOREIGN KEY (session_id)
        REFERENCES cultivation_sessions(session_id)
        ON DELETE CASCADE,

    CONSTRAINT chk_harvest_quantity
        CHECK (quantity > 0)
);


-- ============================================================
-- 18. IOT_DEVICES
-- ============================================================

CREATE TABLE iot_devices (
    device_id SERIAL PRIMARY KEY,

    room_id INT NOT NULL,

    device_code VARCHAR(100) NOT NULL UNIQUE,

    device_name VARCHAR(150) NOT NULL,

    device_type VARCHAR(100) NOT NULL,

    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',

    last_seen_at TIMESTAMP,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_iot_devices_room
        FOREIGN KEY (room_id)
        REFERENCES cultivation_rooms(room_id)
        ON DELETE RESTRICT,

    CONSTRAINT chk_iot_device_status
        CHECK (
            status IN (
                'ACTIVE',
                'INACTIVE',
                'MAINTENANCE',
                'OFFLINE'
            )
        )
);


-- ============================================================
-- 19. CAMERAS
-- ============================================================

CREATE TABLE cameras (
    camera_id SERIAL PRIMARY KEY,

    room_id INT NOT NULL,

    camera_code VARCHAR(100) NOT NULL UNIQUE,

    camera_name VARCHAR(150) NOT NULL,

    stream_url TEXT,

    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT fk_cameras_room
        FOREIGN KEY (room_id)
        REFERENCES cultivation_rooms(room_id)
        ON DELETE RESTRICT,

    CONSTRAINT chk_camera_status
        CHECK (
            status IN (
                'ACTIVE',
                'INACTIVE',
                'OFFLINE'
            )
        )
);


-- ============================================================
-- 20. SENSOR_DATA
-- ============================================================

CREATE TABLE sensor_data (
    sensor_data_id BIGSERIAL PRIMARY KEY,

    device_id INT NOT NULL,

    sensor_type VARCHAR(100) NOT NULL,

    value NUMERIC(14,4) NOT NULL,

    unit VARCHAR(30) NOT NULL,

    recorded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_sensor_data_device
        FOREIGN KEY (device_id)
        REFERENCES iot_devices(device_id)
        ON DELETE CASCADE
);


-- ============================================================
-- 21. NOTIFICATIONS
-- ============================================================

CREATE TABLE notifications (
    notification_id SERIAL PRIMARY KEY,

    user_id INT NOT NULL,

    notification_type VARCHAR(100) NOT NULL,

    title VARCHAR(255) NOT NULL,

    message TEXT NOT NULL,

    is_read BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    read_at TIMESTAMP,

    CONSTRAINT fk_notifications_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE CASCADE,

    CONSTRAINT chk_notification_read
        CHECK (
            (is_read = FALSE AND read_at IS NULL)
            OR
            (is_read = TRUE)
        )
);


-- ============================================================
-- INDEXES
-- ============================================================

-- USERS
CREATE INDEX idx_users_role_id
    ON users(role_id);


-- ROLE PERMISSIONS
CREATE INDEX idx_role_permissions_permission_id
    ON role_permissions(permission_id);


-- MUSHROOM
CREATE INDEX idx_mushroom_conditions_type
    ON mushroom_conditions(mushroom_type_id);


-- ROOMS / TRAYS
CREATE INDEX idx_trays_room_id
    ON cultivation_trays(room_id);


-- ORDERS
CREATE INDEX idx_orders_user_id
    ON orders(user_id);

CREATE INDEX idx_orders_status
    ON orders(status);

CREATE INDEX idx_orders_created_at
    ON orders(created_at);


-- ORDER ITEMS
CREATE INDEX idx_order_items_order_id
    ON order_items(order_id);

CREATE INDEX idx_order_items_package_id
    ON order_items(rental_package_id);

CREATE INDEX idx_order_items_mushroom_type_id
    ON order_items(mushroom_type_id);


-- PAYMENTS
CREATE INDEX idx_payments_order_id
    ON payments(order_id);

CREATE INDEX idx_payments_payos_payment_link_id
    ON payments(payos_payment_link_id)
    WHERE payos_payment_link_id IS NOT NULL;

CREATE UNIQUE INDEX ux_payments_transaction_code
    ON payments(transaction_code)
    WHERE transaction_code IS NOT NULL;


-- SHIPMENTS
CREATE INDEX idx_shipments_order_id
    ON shipments(order_id);

CREATE INDEX idx_shipments_tracking_code
    ON shipments(tracking_code);


-- CULTIVATION
CREATE INDEX idx_sessions_rental_id
    ON cultivation_sessions(rental_id);

CREATE INDEX idx_sessions_tray_id
    ON cultivation_sessions(tray_id);

CREATE INDEX idx_sessions_mushroom_type_id
    ON cultivation_sessions(mushroom_type_id);

CREATE INDEX idx_sessions_status
    ON cultivation_sessions(status);


CREATE INDEX idx_progress_session_id
    ON cultivation_progress(session_id);


CREATE INDEX idx_harvests_session_id
    ON harvests(session_id);


-- IOT
CREATE INDEX idx_iot_devices_room_id
    ON iot_devices(room_id);


CREATE INDEX idx_sensor_data_device_recorded
    ON sensor_data(device_id, recorded_at);


CREATE INDEX idx_sensor_data_type_recorded
    ON sensor_data(sensor_type, recorded_at);


-- CAMERAS
CREATE INDEX idx_cameras_room_id
    ON cameras(room_id);


-- NOTIFICATIONS
CREATE INDEX idx_notifications_user_id
    ON notifications(user_id);

CREATE INDEX idx_notifications_unread
    ON notifications(user_id, is_read);


-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


CREATE TRIGGER trg_mushroom_conditions_updated_at
BEFORE UPDATE ON mushroom_conditions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


CREATE TRIGGER trg_cultivation_rooms_updated_at
BEFORE UPDATE ON cultivation_rooms
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


CREATE TRIGGER trg_cultivation_trays_updated_at
BEFORE UPDATE ON cultivation_trays
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


CREATE TRIGGER trg_orders_updated_at
BEFORE UPDATE ON orders
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_rentals_updated_at
BEFORE UPDATE ON rentals
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


CREATE TRIGGER trg_cultivation_progress_updated_at
BEFORE UPDATE ON cultivation_progress
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- 22. MQTT IOT INTEGRATION (migration 004)
-- ============================================================

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


-- ============================================================
-- 23. FLOOR AUTOMATION (migration 005_add_auto_misting_control)
-- ============================================================

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


-- ============================================================
-- 24. SHARED FLOOR CLIMATE PROFILES (migration 007_add_floor_climate_profiles)
-- ============================================================

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
