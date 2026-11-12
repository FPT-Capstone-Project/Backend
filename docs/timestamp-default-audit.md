# Timestamp default audit — 2026-11-12

Read-only inspection of the database configured by `.env` found 26 additional
NOT NULL timestamp columns without defaults across 20 tables. Each default is
defined in `database.sql`, except `harvests.updated_at`, which is defined by
migration 017. Migration 027 is prepared but **has not been applied**.

The table below identifies INSERT paths that omit these columns. These paths can
fail with PostgreSQL 23502 if no database trigger supplies the missing value.
This is a schema/code audit, not an end-to-end test of every API.

| Function | Table and missing defaults | Code evidence |
| --- | --- | --- |
| Registration / admin creates account | users.created_at, updated_at | src/models/user.model.js |
| Create mushroom type | mushroom_types.created_at | src/models/mushroomType.model.js |
| Create growing conditions | mushroom_conditions.created_at, updated_at | src/models/mushroomCondition.model.js |
| Create room | cultivation_rooms.created_at, updated_at | src/models/cultivationRoom.model.js |
| Create trays / generate floor layout | cultivation_trays.created_at, updated_at; tray_positions.created_at, updated_at | src/models/cultivationTray.model.js; src/services/autoMisting.service.js |
| Create cultivation order / reserve trays | orders.updated_at; tray_reservations.created_at | src/models/order.model.js; src/models/cultivationReservation.model.js |
| Create payment | payments.created_at | src/models/payment.model.js |
| Fulfill paid order | cultivation_sessions.created_at; inventory_transactions.created_at; cultivation_progress.updated_at | src/models/payment.model.js |
| Replace abnormal spawn | inventory_transactions.created_at | src/models/spawnInspection.model.js |
| Change spawn stage / record cultivation progress | cultivation_progress.updated_at | src/models/spawnInspection.model.js; src/models/cultivationSession.model.js |
| Assign trays / activate cultivation | cultivation_session_trays.assigned_at; cultivation_progress.updated_at | src/models/cultivationSession.model.js |
| Upload cultivation inspection / disease evidence image | cultivation_inspection_images.uploaded_at | src/models/cultivationSession.model.js; src/models/diseaseManagement.model.js |
| Request expert consultation | expert_consultations.created_at | src/models/diseaseManagement.model.js |
| Upload treatment media | treatment_media.uploaded_at | src/models/diseaseManagement.model.js |
| Create harvest | harvests.created_at, updated_at | src/models/harvest.model.js |

Three further defaults are restored for consistency with the original schema,
but are not confirmed failures in current API insert paths:

- `disease_treatment_logs.performed_at`: current INSERT already supplies
  `COALESCE($5::timestamptz, now())`, so it does not rely on the missing default.
- `cultivation_protocols.created_at`: no creation INSERT found in current src.
- `spawn_inventory.updated_at`: current stock updates explicitly set this value;
  no stock-row creation INSERT found in current src.

Missing defaults on explicit business times are intentional and left unchanged:
`cultivation_sessions.start_at`, environment-history period bounds, IoT receive
times and worker heartbeat, command/token/reservation expiry times. Existing
INSERT paths supply these values. Nullable completion, resolution, read and
schedule times must not be filled with the creation time.

Migration 027 changes only defaults for future INSERTs. It preserves timestamp
types and existing values; `updated_at` defaults do not automatically update a
row on subsequent UPDATEs. It uses a transaction and a five-second lock timeout.
Applying it needs brief table locks and changes future writes to 20 tables.

Validation: a PGlite regression test reproduces missing-default 23502 errors for
all 20 table fixtures, applies the migration twice, verifies subsequent inserts,
preservation of historical timestamps and unchanged nullable business dates.
The test does not perform real payments, send notifications or upload media.

The full `npm test` run is not green. A focused rerun confirms five failures in
existing auth, environment-history and cultivation-session tests: login returns
401, a fixture violates the floor/master-room constraint, the worker promise
identity assertion fails, `customerToken` is undefined, and a service test expects
a rejection that is not thrown. These tests do not run migration 027; they were
not changed as part of this timestamp audit.

The earlier spawn-inspection fix (migration 026) has already been applied and
verified separately. Automatic approval review rejected applying migration 027
because the user's request was an audit and this broader database mutation needs
explicit approval.
