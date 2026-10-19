-- ============================================================
-- SMART MUSH FARM DATABASE
-- PostgreSQL
-- DATABASE SCHEMA - NEW VERSION
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
                AND mushroom_type_id IS NULL
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

    user_id INT NOT NULL,

    order_item_id INT NOT NULL,

    package_id INT NOT NULL,

    tray_id INT,

    start_date DATE NOT NULL,
    end_date DATE NOT NULL,

    total_price NUMERIC(12,2) NOT NULL DEFAULT 0,

    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_rentals_user
        FOREIGN KEY (user_id)
        REFERENCES users(user_id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_rentals_order_item
        FOREIGN KEY (order_item_id)
        REFERENCES order_items(order_item_id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_rentals_package
        FOREIGN KEY (package_id)
        REFERENCES rental_packages(package_id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_rentals_tray
        FOREIGN KEY (tray_id)
        REFERENCES cultivation_trays(tray_id)
        ON DELETE SET NULL,

    CONSTRAINT chk_rental_dates
        CHECK (end_date >= start_date),

    CONSTRAINT chk_rental_price
        CHECK (total_price >= 0),

    CONSTRAINT chk_rental_status
        CHECK (
            status IN (
                'PENDING',
                'ACTIVE',
                'COMPLETED',
                'CANCELLED'
            )
        )
);


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


-- RENTALS
CREATE INDEX idx_rentals_user_id
    ON rentals(user_id);

CREATE INDEX idx_rentals_order_item_id
    ON rentals(order_item_id);

CREATE INDEX idx_rentals_package_id
    ON rentals(package_id);

CREATE INDEX idx_rentals_tray_id
    ON rentals(tray_id);

CREATE INDEX idx_rentals_status
    ON rentals(status);


-- PAYMENTS
CREATE INDEX idx_payments_order_id
    ON payments(order_id);

CREATE INDEX idx_payments_payos_payment_link_id
    ON payments(payos_payment_link_id)
    WHERE payos_payment_link_id IS NOT NULL;

CREATE UNIQUE INDEX uq_payments_transaction_code
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
-- UNIQUE BUSINESS RULES
-- ============================================================

-- Một ORDER_ITEM rental chỉ tạo tối đa một RENTAL
CREATE UNIQUE INDEX uq_rentals_order_item
    ON rentals(order_item_id);


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


CREATE TRIGGER trg_cultivation_progress_updated_at
BEFORE UPDATE ON cultivation_progress
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
