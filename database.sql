-- =====================================================
-- PostgreSQL schema: Mushroom cultivation & IoT control
-- Thứ tự tạo bảng đã được sắp xếp theo phụ thuộc FK
-- =====================================================

BEGIN;

-- ---------- RBAC ----------
CREATE TABLE public.roles (
  role_id     SERIAL PRIMARY KEY,
  role_name   VARCHAR NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE public.permissions (
  permission_id   SERIAL PRIMARY KEY,
  permission_name VARCHAR NOT NULL UNIQUE,
  description     TEXT
);

CREATE TABLE public.role_permissions (
  role_id       INTEGER NOT NULL,
  permission_id INTEGER NOT NULL,
  CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_role_permissions_role
    FOREIGN KEY (role_id) REFERENCES public.roles(role_id),
  CONSTRAINT fk_role_permissions_permission
    FOREIGN KEY (permission_id) REFERENCES public.permissions(permission_id)
);

-- ---------- USERS ----------
CREATE TABLE public.users (
  user_id           SERIAL PRIMARY KEY,
  role_id           INTEGER NOT NULL,
  email             VARCHAR NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  full_name         VARCHAR NOT NULL,
  phone             VARCHAR,
  address           TEXT,
  status            VARCHAR NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'BLOCKED')),
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  otp_code          VARCHAR,
  otp_type          VARCHAR
    CHECK (otp_type IS NULL OR otp_type IN ('REGISTRATION', 'FORGOT_PASSWORD', 'CHANGE_PASSWORD')),
  otp_expires_at    TIMESTAMP,
  otp_attempts      INTEGER NOT NULL DEFAULT 0 CHECK (otp_attempts >= 0),
  otp_last_sent_at  TIMESTAMP,
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES public.roles(role_id)
);

-- ---------- MUSHROOM ----------
CREATE TABLE public.mushroom_types (
  mushroom_type_id SERIAL PRIMARY KEY,
  name             VARCHAR NOT NULL UNIQUE,
  description      TEXT,
  growing_days     INTEGER NOT NULL CHECK (growing_days > 0),
  price            NUMERIC NOT NULL DEFAULT 0 CHECK (price >= 0),
  image_url        TEXT,
  status           VARCHAR NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.mushroom_conditions (
  condition_id     SERIAL PRIMARY KEY,
  mushroom_type_id INTEGER NOT NULL,
  temperature_min  NUMERIC,
  temperature_max  NUMERIC,
  humidity_min     NUMERIC,
  humidity_max     NUMERIC,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_mushroom_conditions_type
    FOREIGN KEY (mushroom_type_id) REFERENCES public.mushroom_types(mushroom_type_id)
);

CREATE TABLE public.rental_packages (
  package_id    SERIAL PRIMARY KEY,
  package_name  VARCHAR NOT NULL,
  description   TEXT,
  duration_days INTEGER NOT NULL CHECK (duration_days > 0),
  price         NUMERIC NOT NULL CHECK (price >= 0),
  status        VARCHAR NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

-- ---------- ROOMS ----------
CREATE TABLE public.cultivation_rooms (
  room_id     SERIAL PRIMARY KEY,
  room_code   VARCHAR NOT NULL UNIQUE,
  room_name   VARCHAR NOT NULL,
  description TEXT,
  capacity    INTEGER NOT NULL DEFAULT 0 CHECK (capacity >= 0),
  status      VARCHAR NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'MAINTENANCE')),
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------- IOT MASTERS (cần trước cultivation_floors) ----------
CREATE TABLE public.iot_masters (
  id                  SERIAL PRIMARY KEY,
  master_identifier   VARCHAR NOT NULL UNIQUE
    CHECK (master_identifier ~ '^[A-Za-z0-9_-]{1,64}$'),
  cultivation_room_id INTEGER,
  reported_status     VARCHAR CHECK (reported_status IN ('online', 'offline')),
  status_received_at  TIMESTAMPTZ,
  status_retained     BOOLEAN,
  last_seen_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  light_ssr_channel   INTEGER CHECK (light_ssr_channel BETWEEN 1 AND 8),
  CONSTRAINT iot_masters_cultivation_room_id_fkey
    FOREIGN KEY (cultivation_room_id) REFERENCES public.cultivation_rooms(room_id)
);

CREATE TABLE public.cultivation_floors (
  floor_id            SERIAL PRIMARY KEY,
  room_id             INTEGER NOT NULL,
  floor_number        INTEGER NOT NULL CHECK (floor_number > 0),
  floor_name          TEXT NOT NULL,
  master_id           INTEGER NOT NULL,
  node_address        INTEGER NOT NULL CHECK (node_address BETWEEN 1 AND 247),
  misting_ssr_channel INTEGER NOT NULL CHECK (misting_ssr_channel BETWEEN 1 AND 8),
  status              TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cultivation_floors_room_id_fkey
    FOREIGN KEY (room_id) REFERENCES public.cultivation_rooms(room_id),
  CONSTRAINT cultivation_floors_master_id_fkey
    FOREIGN KEY (master_id) REFERENCES public.iot_masters(id),
  -- Cần UNIQUE này để cultivation_trays tham chiếu FK kép (floor_id, room_id)
  CONSTRAINT cultivation_floors_floor_room_uk UNIQUE (floor_id, room_id)
);

CREATE TABLE public.cultivation_trays (
  tray_id    SERIAL PRIMARY KEY,
  room_id    INTEGER NOT NULL,
  tray_code  VARCHAR NOT NULL UNIQUE,
  tray_name  VARCHAR,
  status     VARCHAR NOT NULL DEFAULT 'AVAILABLE'
    CHECK (status IN ('AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'INACTIVE')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  floor_id   INTEGER,
  CONSTRAINT fk_trays_room
    FOREIGN KEY (room_id) REFERENCES public.cultivation_rooms(room_id),
  -- Gộp 2 FK trùng tên trong bản gốc thành 1 FK kép:
  -- đảm bảo tầng (floor) thuộc đúng phòng (room) của khay
  CONSTRAINT trays_floor_room_fk
    FOREIGN KEY (floor_id, room_id)
    REFERENCES public.cultivation_floors (floor_id, room_id)
);

-- ---------- ORDERS ----------
CREATE TABLE public.orders (
  order_id       SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL,
  subtotal       NUMERIC NOT NULL DEFAULT 0,
  discount       NUMERIC NOT NULL DEFAULT 0,
  shipping_fee   NUMERIC NOT NULL DEFAULT 0,
  total_amount   NUMERIC NOT NULL DEFAULT 0,
  status         VARCHAR NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'CONFIRMED', 'PROCESSING', 'COMPLETED', 'CANCELLED')),
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  payment_status VARCHAR NOT NULL DEFAULT 'UNPAID'
    CHECK (payment_status IN ('UNPAID', 'PENDING', 'PAID', 'FAILED', 'REFUND_PENDING', 'REFUNDED')),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES public.users(user_id)
);

CREATE TABLE public.order_items (
  order_item_id     SERIAL PRIMARY KEY,
  order_id          INTEGER NOT NULL,
  item_type         VARCHAR NOT NULL,
  rental_package_id INTEGER,
  mushroom_type_id  INTEGER,
  quantity          INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price        NUMERIC NOT NULL,
  total_price       NUMERIC NOT NULL,
  CONSTRAINT fk_order_items_order
    FOREIGN KEY (order_id) REFERENCES public.orders(order_id),
  CONSTRAINT fk_order_items_package
    FOREIGN KEY (rental_package_id) REFERENCES public.rental_packages(package_id),
  CONSTRAINT fk_order_items_mushroom
    FOREIGN KEY (mushroom_type_id) REFERENCES public.mushroom_types(mushroom_type_id)
);

CREATE TABLE public.payments (
  payment_id          SERIAL PRIMARY KEY,
  order_id            INTEGER NOT NULL,
  amount              NUMERIC NOT NULL CHECK (amount >= 0),
  payment_method      VARCHAR NOT NULL,
  transaction_code    VARCHAR,
  status              VARCHAR NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'CANCELLED')),
  paid_at             TIMESTAMP,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  payos_payment_link_id TEXT,
  payos_checkout_url  TEXT,
  payos_qr_code       TEXT,
  CONSTRAINT fk_payments_order FOREIGN KEY (order_id) REFERENCES public.orders(order_id)
);

CREATE TABLE public.shipments (
  shipment_id     SERIAL PRIMARY KEY,
  order_id        INTEGER NOT NULL,
  address         TEXT NOT NULL,
  recipient_name  VARCHAR NOT NULL,
  recipient_phone VARCHAR NOT NULL,
  shipping_fee    NUMERIC NOT NULL DEFAULT 0 CHECK (shipping_fee >= 0),
  carrier         VARCHAR,
  tracking_code   VARCHAR,
  status          VARCHAR NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED')),
  shipped_at      TIMESTAMP,
  delivered_at    TIMESTAMP,
  CONSTRAINT fk_shipments_order FOREIGN KEY (order_id) REFERENCES public.orders(order_id)
);

-- ---------- CULTIVATION ----------
CREATE TABLE public.cultivation_protocols (
  protocol_id      SERIAL PRIMARY KEY,
  mushroom_type_id INTEGER NOT NULL REFERENCES public.mushroom_types(mushroom_type_id),
  protocol_name    VARCHAR NOT NULL,
  version          VARCHAR NOT NULL DEFAULT '1.0',
  status           VARCHAR NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.spawn_inventory (
  inventory_id     SERIAL PRIMARY KEY,
  mushroom_type_id INTEGER NOT NULL UNIQUE
    REFERENCES public.mushroom_types(mushroom_type_id),
  quantity         NUMERIC NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at       TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE public.cultivation_protocol_steps (
  step_id             SERIAL PRIMARY KEY,
  protocol_id         INTEGER NOT NULL REFERENCES public.cultivation_protocols(protocol_id),
  step_order          INTEGER NOT NULL,
  stage_name          VARCHAR NOT NULL,
  duration_days       INTEGER NOT NULL CHECK (duration_days > 0),
  instructions        TEXT,
  target_temperature  NUMERIC,
  target_humidity     NUMERIC
);

CREATE TABLE public.cultivation_sessions (
  session_id       SERIAL PRIMARY KEY,
  mushroom_type_id INTEGER NOT NULL,
  start_at         TIMESTAMP NOT NULL,
  end_at           TIMESTAMP,
  duration_days    INTEGER CHECK (duration_days IS NULL OR duration_days > 0),
  status           VARCHAR NOT NULL DEFAULT 'PLANNED'
    CHECK (status IN ('PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
  harvest_date     DATE,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  order_item_id    INTEGER NOT NULL REFERENCES public.order_items(order_item_id),
  protocol_id      INTEGER REFERENCES public.cultivation_protocols(protocol_id),
  CONSTRAINT fk_sessions_mushroom
    FOREIGN KEY (mushroom_type_id) REFERENCES public.mushroom_types(mushroom_type_id)
);

CREATE TABLE public.inventory_transactions (
  transaction_id   SERIAL PRIMARY KEY,
  inventory_id     INTEGER NOT NULL REFERENCES public.spawn_inventory(inventory_id),
  session_id       INTEGER REFERENCES public.cultivation_sessions(session_id),
  transaction_type VARCHAR NOT NULL
    CHECK (transaction_type IN ('IN', 'OUT', 'ADJUST')),
  quantity         NUMERIC NOT NULL,
  quantity_before  NUMERIC NOT NULL,
  quantity_after   NUMERIC NOT NULL,
  notes            TEXT,
  created_at       TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE public.cultivation_progress (
  progress_id           SERIAL PRIMARY KEY,
  session_id            INTEGER NOT NULL,
  current_stage         VARCHAR NOT NULL,
  progress_percent      NUMERIC NOT NULL DEFAULT 0
    CHECK (progress_percent >= 0 AND progress_percent <= 100),
  start_date            DATE,
  expected_harvest_date DATE,
  description           TEXT,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_progress_session
    FOREIGN KEY (session_id) REFERENCES public.cultivation_sessions(session_id)
);

CREATE TABLE public.cultivation_session_trays (
  session_tray_id SERIAL PRIMARY KEY,
  session_id      INTEGER NOT NULL REFERENCES public.cultivation_sessions(session_id),
  tray_id         INTEGER NOT NULL REFERENCES public.cultivation_trays(tray_id),
  assigned_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status          VARCHAR NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RELEASED')),
  notes           TEXT
);

CREATE TABLE public.tray_reservations (
  reservation_id SERIAL PRIMARY KEY,
  order_item_id  INTEGER NOT NULL REFERENCES public.order_items(order_item_id),
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  status         VARCHAR NOT NULL DEFAULT 'HELD'
    CHECK (status IN ('HELD', 'CONSUMED', 'RELEASED', 'EXPIRED')),
  expires_at     TIMESTAMP NOT NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at    TIMESTAMP
);

CREATE TABLE public.harvest_requests (
  harvest_request_id SERIAL PRIMARY KEY,
  session_id         INTEGER NOT NULL UNIQUE REFERENCES public.cultivation_sessions(session_id),
  harvest_method     VARCHAR NOT NULL CHECK (harvest_method IN ('PICKUP', 'DELIVERY')),
  scheduled_at       TIMESTAMP,
  status             VARCHAR NOT NULL DEFAULT 'PENDING',
  customer_note      TEXT,
  confirmed_at       TIMESTAMP,
  completed_at       TIMESTAMP
);

CREATE TABLE public.cultivation_inspections (
  inspection_id      SERIAL PRIMARY KEY,
  session_tray_id    INTEGER NOT NULL REFERENCES public.cultivation_session_trays(session_tray_id),
  inspected_by       INTEGER NOT NULL REFERENCES public.users(user_id),
  inspection_date    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  growth_stage       VARCHAR,
  tray_condition     VARCHAR,
  mushroom_condition VARCHAR,
  growth_progress    NUMERIC CHECK (growth_progress >= 0 AND growth_progress <= 100),
  notes              TEXT
);

CREATE TABLE public.cultivation_inspection_images (
  image_id      SERIAL PRIMARY KEY,
  inspection_id INTEGER NOT NULL REFERENCES public.cultivation_inspections(inspection_id),
  image_url     TEXT NOT NULL,
  caption       VARCHAR,
  uploaded_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public.harvests (
  harvest_id         SERIAL PRIMARY KEY,
  harvest_date       DATE NOT NULL,
  quality_grade      VARCHAR,
  notes              TEXT,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  harvest_request_id INTEGER REFERENCES public.harvest_requests(harvest_request_id),
  session_tray_id    INTEGER REFERENCES public.cultivation_session_trays(session_tray_id),
  harvested_by       INTEGER REFERENCES public.users(user_id),
  total_weight_kg    NUMERIC,
  usable_weight_kg   NUMERIC,
  rejected_weight_kg NUMERIC DEFAULT 0
);

CREATE TABLE public.cameras (
  camera_id   SERIAL PRIMARY KEY,
  room_id     INTEGER NOT NULL,
  camera_code VARCHAR NOT NULL UNIQUE,
  camera_name VARCHAR NOT NULL,
  stream_url  TEXT,
  status      VARCHAR NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'OFFLINE')),
  CONSTRAINT fk_cameras_room FOREIGN KEY (room_id) REFERENCES public.cultivation_rooms(room_id)
);

CREATE TABLE public.notifications (
  notification_id   SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL,
  notification_type VARCHAR NOT NULL,
  title             VARCHAR NOT NULL,
  message           TEXT NOT NULL,
  is_read           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at           TIMESTAMP,
  created_by        INTEGER,
  reference_type    VARCHAR,
  reference_id      INTEGER,
  CONSTRAINT fk_notifications_user
    FOREIGN KEY (user_id) REFERENCES public.users(user_id),
  CONSTRAINT notifications_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(user_id)
);

CREATE TABLE public.cultivation_issues (
  issue_id       SERIAL PRIMARY KEY,
  session_tray_id INTEGER NOT NULL
    REFERENCES public.cultivation_session_trays(session_tray_id),
  inspection_id  INTEGER REFERENCES public.cultivation_inspections(inspection_id),
  reported_by    INTEGER NOT NULL REFERENCES public.users(user_id),
  issue_type     VARCHAR NOT NULL,
  title          VARCHAR NOT NULL,
  description    TEXT,
  severity       VARCHAR CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
  status         VARCHAR NOT NULL DEFAULT 'OPEN',
  action_taken   TEXT,
  next_action    TEXT,
  reported_at    TIMESTAMP NOT NULL DEFAULT now(),
  resolved_at    TIMESTAMP
);

CREATE TABLE public.expert_consultations (
  consultation_id SERIAL PRIMARY KEY,
  issue_id        INTEGER NOT NULL REFERENCES public.cultivation_issues(issue_id),
  expert_id       INTEGER REFERENCES public.users(user_id),
  question        TEXT NOT NULL,
  diagnosis       TEXT,
  solution        TEXT,
  status          VARCHAR NOT NULL DEFAULT 'PENDING',
  created_at      TIMESTAMP NOT NULL DEFAULT now(),
  responded_at    TIMESTAMP
);

-- ---------- IOT ----------
CREATE TABLE public.iot_sensor_readings (
  id             BIGSERIAL PRIMARY KEY,
  master_id      INTEGER NOT NULL,
  node_address   INTEGER NOT NULL CHECK (node_address BETWEEN 1 AND 247),
  sensor_address INTEGER NOT NULL CHECK (sensor_address BETWEEN 1 AND 3),
  temperature    DOUBLE PRECISION,
  humidity       DOUBLE PRECISION,
  is_valid       BOOLEAN NOT NULL,
  received_at    TIMESTAMPTZ NOT NULL,
  measured_at    TIMESTAMPTZ,
  retained       BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT iot_sensor_readings_master_id_fkey
    FOREIGN KEY (master_id) REFERENCES public.iot_masters(id)
);

CREATE TABLE public.iot_sensor_latest (
  master_id        INTEGER NOT NULL,
  node_address     INTEGER NOT NULL CHECK (node_address BETWEEN 1 AND 247),
  sensor_address   INTEGER NOT NULL CHECK (sensor_address BETWEEN 1 AND 3),
  temperature      DOUBLE PRECISION CHECK (temperature >= -40 AND temperature <= 125),
  humidity         DOUBLE PRECISION CHECK (humidity >= 0 AND humidity <= 100),
  is_valid         BOOLEAN NOT NULL,
  last_received_at TIMESTAMPTZ NOT NULL,
  last_valid_at    TIMESTAMPTZ,
  retained         BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT iot_sensor_latest_pkey PRIMARY KEY (master_id, node_address, sensor_address),
  CONSTRAINT iot_sensor_latest_master_id_fkey
    FOREIGN KEY (master_id) REFERENCES public.iot_masters(id)
);

CREATE TABLE public.iot_ssr_states (
  id                   BIGSERIAL PRIMARY KEY,
  master_id            INTEGER NOT NULL,
  channel              INTEGER NOT NULL CHECK (channel BETWEEN 1 AND 8),
  desired_state        VARCHAR CHECK (desired_state IN ('ON', 'OFF')),
  reported_state       VARCHAR CHECK (reported_state IN ('ON', 'OFF')),
  command_requested_at TIMESTAMPTZ,
  state_reported_at    TIMESTAMPTZ,
  reported_retained    BOOLEAN,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT iot_ssr_states_master_id_fkey
    FOREIGN KEY (master_id) REFERENCES public.iot_masters(id)
);

CREATE TABLE public.iot_device_commands (
  id            UUID PRIMARY KEY,
  master_id     INTEGER NOT NULL,
  channel       INTEGER NOT NULL CHECK (channel BETWEEN 1 AND 8),
  action        VARCHAR NOT NULL CHECK (action IN ('ON', 'OFF')),
  status        VARCHAR NOT NULL
    CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED', 'TIMED_OUT')),
  requested_by  INTEGER,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  published_at  TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  error_message TEXT,
  CONSTRAINT iot_device_commands_master_id_fkey
    FOREIGN KEY (master_id) REFERENCES public.iot_masters(id),
  CONSTRAINT iot_device_commands_requested_by_fkey
    FOREIGN KEY (requested_by) REFERENCES public.users(user_id)
);

-- ---------- AUTO CONTROL ----------
CREATE TABLE public.iot_auto_control_configs (
  id                           SERIAL PRIMARY KEY,
  floor_id                     INTEGER NOT NULL UNIQUE,
  mushroom_type_id             INTEGER,
  profile_name                 TEXT,
  profile_approved             BOOLEAN NOT NULL DEFAULT FALSE,
  humidity_min                 DOUBLE PRECISION NOT NULL CHECK (humidity_min BETWEEN 0 AND 100),
  humidity_max                 DOUBLE PRECISION NOT NULL CHECK (humidity_max BETWEEN 0 AND 100),
  humidity_start_threshold     DOUBLE PRECISION NOT NULL CHECK (humidity_start_threshold BETWEEN 0 AND 100),
  humidity_stop_threshold      DOUBLE PRECISION NOT NULL CHECK (humidity_stop_threshold BETWEEN 0 AND 100),
  misting_pulse_ms             INTEGER NOT NULL CHECK (misting_pulse_ms BETWEEN 1000 AND 60000),
  cooldown_ms                  INTEGER NOT NULL CHECK (cooldown_ms BETWEEN 1000 AND 86400000),
  evaluation_interval_ms       INTEGER NOT NULL CHECK (evaluation_interval_ms BETWEEN 1000 AND 60000),
  sensor_max_age_ms            INTEGER NOT NULL DEFAULT 20000 CHECK (sensor_max_age_ms BETWEEN 1000 AND 300000),
  required_valid_sensors       INTEGER NOT NULL DEFAULT 3 CHECK (required_valid_sensors BETWEEN 1 AND 3),
  max_sensor_spread_percent    DOUBLE PRECISION NOT NULL CHECK (max_sensor_spread_percent BETWEEN 0 AND 100),
  max_activations_per_hour     INTEGER NOT NULL CHECK (max_activations_per_hour BETWEEN 1 AND 3600),
  max_cumulative_on_ms_per_hour INTEGER NOT NULL CHECK (max_cumulative_on_ms_per_hour BETWEEN 1000 AND 3600000),
  configured_by                INTEGER,
  configured_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  config_source                TEXT NOT NULL DEFAULT 'LEGACY'
    CHECK (config_source IN ('LEGACY', 'FLOOR')),
  source_profiles              JSONB,
  cooling_enabled              BOOLEAN NOT NULL DEFAULT FALSE,
  temperature_min              DOUBLE PRECISION,
  temperature_max              DOUBLE PRECISION,
  temperature_start_threshold  DOUBLE PRECISION,
  temperature_stop_threshold   DOUBLE PRECISION,
  cooling_humidity_limit       DOUBLE PRECISION,
  max_temperature_spread_c     DOUBLE PRECISION,
  CONSTRAINT iot_auto_control_configs_floor_id_fkey
    FOREIGN KEY (floor_id) REFERENCES public.cultivation_floors(floor_id),
  CONSTRAINT iot_auto_control_configs_mushroom_type_id_fkey
    FOREIGN KEY (mushroom_type_id) REFERENCES public.mushroom_types(mushroom_type_id),
  CONSTRAINT iot_auto_control_configs_configured_by_fkey
    FOREIGN KEY (configured_by) REFERENCES public.users(user_id)
);

CREATE TABLE public.iot_auto_control_runs (
  id              SERIAL PRIMARY KEY,
  floor_id        INTEGER NOT NULL,
  config_id       INTEGER NOT NULL,
  config_snapshot JSONB NOT NULL,
  dry_run         BOOLEAN NOT NULL DEFAULT TRUE,
  status          TEXT NOT NULL CHECK (status IN ('RUNNING', 'STOPPED', 'FAULT')),
  started_by      INTEGER,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  stopped_by      INTEGER,
  stopped_at      TIMESTAMPTZ,
  stop_reason     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT iot_auto_control_runs_floor_id_fkey
    FOREIGN KEY (floor_id) REFERENCES public.cultivation_floors(floor_id),
  CONSTRAINT iot_auto_control_runs_config_id_fkey
    FOREIGN KEY (config_id) REFERENCES public.iot_auto_control_configs(id),
  CONSTRAINT iot_auto_control_runs_started_by_fkey
    FOREIGN KEY (started_by) REFERENCES public.users(user_id),
  CONSTRAINT iot_auto_control_runs_stopped_by_fkey
    FOREIGN KEY (stopped_by) REFERENCES public.users(user_id)
);

CREATE TABLE public.iot_auto_control_runtime (
  floor_id               INTEGER PRIMARY KEY,
  run_id                 INTEGER,
  control_state          TEXT NOT NULL DEFAULT 'DISABLED'
    CHECK (control_state IN ('DISABLED', 'IDLE', 'ON_REQUESTED', 'MISTING', 'OFF_PENDING',
                             'COOLDOWN', 'SENSOR_FAULT', 'DEVICE_OFFLINE', 'FAULT')),
  cycle_id               UUID,
  demand                 BOOLEAN NOT NULL DEFAULT FALSE,
  pulse_started_at       TIMESTAMPTZ,
  pulse_deadline_at      TIMESTAMPTZ,
  cooldown_until         TIMESTAMPTZ,
  off_requested_at       TIMESTAMPTZ,
  last_evaluated_at      TIMESTAMPTZ,
  last_average_humidity  DOUBLE PRECISION,
  last_error             TEXT,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  cooling_demand         BOOLEAN NOT NULL DEFAULT FALSE,
  last_average_temperature DOUBLE PRECISION,
  last_reason            TEXT,
  CONSTRAINT iot_auto_control_runtime_floor_id_fkey
    FOREIGN KEY (floor_id) REFERENCES public.cultivation_floors(floor_id),
  CONSTRAINT iot_auto_control_runtime_run_id_fkey
    FOREIGN KEY (run_id) REFERENCES public.iot_auto_control_runs(id)
);

CREATE TABLE public.iot_auto_control_logs (
  id                       BIGSERIAL PRIMARY KEY,
  floor_id                 INTEGER NOT NULL,
  run_id                   INTEGER,
  event_type               TEXT NOT NULL,
  average_humidity         DOUBLE PRECISION,
  sensor_values_json       JSONB,
  thresholds_snapshot_json JSONB,
  command_id               UUID,
  reason                   TEXT,
  reserved_on_ms           INTEGER NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  average_temperature      DOUBLE PRECISION,
  CONSTRAINT iot_auto_control_logs_floor_id_fkey
    FOREIGN KEY (floor_id) REFERENCES public.cultivation_floors(floor_id),
  CONSTRAINT iot_auto_control_logs_run_id_fkey
    FOREIGN KEY (run_id) REFERENCES public.iot_auto_control_runs(id),
  CONSTRAINT iot_auto_control_logs_command_id_fkey
    FOREIGN KEY (command_id) REFERENCES public.iot_device_commands(id)
);

CREATE TABLE public.iot_auto_control_worker (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  heartbeat_at TIMESTAMPTZ NOT NULL
);

-- ---------- INDEXES (gợi ý, không có trong bản gốc) ----------
CREATE INDEX idx_users_role_id               ON public.users(role_id);
CREATE INDEX idx_orders_user_id              ON public.orders(user_id);
CREATE INDEX idx_order_items_order_id        ON public.order_items(order_id);
CREATE INDEX idx_payments_order_id           ON public.payments(order_id);
CREATE INDEX idx_shipments_order_id          ON public.shipments(order_id);
CREATE INDEX idx_sessions_order_item_id      ON public.cultivation_sessions(order_item_id);
CREATE INDEX idx_sessions_status             ON public.cultivation_sessions(status);
CREATE INDEX idx_inventory_transactions_inventory_id
  ON public.inventory_transactions(inventory_id);
CREATE INDEX idx_inventory_transactions_session_id
  ON public.inventory_transactions(session_id);
CREATE INDEX idx_session_trays_session_id    ON public.cultivation_session_trays(session_id);
CREATE INDEX idx_session_trays_tray_id       ON public.cultivation_session_trays(tray_id);
CREATE INDEX idx_tray_reservations_item_status
  ON public.tray_reservations(order_item_id, status);
CREATE INDEX idx_inspections_session_tray_date
  ON public.cultivation_inspections(session_tray_id, inspection_date DESC);
CREATE INDEX idx_cultivation_issues_session_tray_id
  ON public.cultivation_issues(session_tray_id);
CREATE INDEX idx_expert_consultations_issue_id
  ON public.expert_consultations(issue_id);
CREATE INDEX idx_trays_room_id               ON public.cultivation_trays(room_id);
CREATE INDEX idx_notifications_user_unread   ON public.notifications(user_id, is_read);
CREATE INDEX idx_sensor_readings_master_time ON public.iot_sensor_readings(master_id, received_at DESC);
CREATE INDEX idx_ssr_states_master_channel   ON public.iot_ssr_states(master_id, channel);
CREATE INDEX idx_device_commands_master      ON public.iot_device_commands(master_id, requested_at DESC);
CREATE INDEX idx_auto_logs_floor_time        ON public.iot_auto_control_logs(floor_id, created_at DESC);

COMMIT;