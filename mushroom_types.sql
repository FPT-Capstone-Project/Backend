CREATE TABLE IF NOT EXISTS mushroom_types (
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

CREATE INDEX IF NOT EXISTS idx_mushroom_types_status
    ON mushroom_types (status);
