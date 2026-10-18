# Automatic misting control

Automatic control is disabled until an operator explicitly starts a floor. Saving
configuration never creates a run. Start defaults to **dry run**. Real publication
also requires deployment-level enablement and an attested ESP32 watchdog.

## Installation and data migration

Apply `migrations/005_add_auto_misting_control.sql` once, after migration 004,
using the same PostgreSQL migration procedure used by this repository (SQL files
run explicitly; there is no automatic migration runner). Back up and review the
target schema first. Do not re-run `database.sql` on an existing database.

The migration was tested against `database.sql` plus migration 004 using isolated
PGlite PostgreSQL. The configured external database could not be inspected from
this environment because its hostname lookup failed (`ENOTFOUND`). No migration
or actuator command was sent to that deployment.

The migration adds:

| Table/change | Purpose |
|---|---|
| `cultivation_floors` | Room, floor number, master, Modbus node and SSR mapping |
| `cultivation_trays.floor_id` | Nullable explicit assignment; composite FK enforces same room |
| `iot_auto_control_configs` | One current validated configuration per floor |
| `iot_auto_control_runs` | Explicit Start/Stop audit, operator, immutable configuration snapshot, dry-run flag |
| `iot_auto_control_runtime` | Durable pulse deadline, cooldown, demand and control state |
| `iot_auto_control_logs` | Decisions, faults, command references and conservative hourly reservations |
| `iot_auto_control_worker` | Recent elected-worker heartbeat used by Start |

Existing trays stay unassigned. Do not infer their floors from tray codes or node
numbers. Provision a master's `cultivation_room_id` through reviewed database
administration, then create floor mappings using the authenticated floor API.
Assign known trays with `PUT /api/iot/floors/:floorId/trays/:trayId` while stopped.
Existing assignments cannot be moved through that endpoint; moving them requires
reviewed maintenance with both affected floors stopped and OFF resolved. A
database administrator can clear the old `floor_id`, then use the endpoint to
assign the verified destination. Existing tray room updates remain subject to
the same-room foreign key.

Master/node and master/channel mappings are unique, including inactive floors.
This deliberately reserves a physical resource to one floor even in MANUAL mode.
Floor number is unique within a room. Master reassignment to a different room is
blocked while mapped floors exist. Mapping edits require Stop and resolved OFF.
No floor, mushroom threshold, or node-to-floor relationship is seeded.

The migration creates `iot.automation.manage` and grants it to existing roles
whose names normalize to `Admin` or `Farm Operator` (spaces, `_` and `-` ignored).
Verify actual deployed role names and grants; roles created after migration need
an explicit grant. Numeric role IDs are not hardcoded. For a differently named
authorized role, resolve its ID by name and insert the permission association:

```sql
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.role_id, p.permission_id FROM roles r CROSS JOIN permissions p
WHERE r.role_name = 'YOUR VERIFIED OPERATOR ROLE'
  AND p.permission_name = 'iot.automation.manage'
ON CONFLICT DO NOTHING;
```

All floor reads use existing active-user JWT authentication. All floor mutations,
including dry-run evaluation, require that permission. Existing manual SSR access
for MANUAL/unmapped channels retains its current authorization behavior.

## Operator workflow and APIs

All responses use `{ "data": ... }`; errors use `{ "message": ... }`.
Swagger UI is at `/api-docs`, under **Automatic misting**. Bearer JWT is required.

| Method/path | Behavior |
|---|---|
| GET `/api/iot/floors` | List floor mappings |
| POST `/api/iot/floors` | Create mapping |
| PUT `/api/iot/floors/:floorId` | Replace mapping while stopped |
| PUT `/api/iot/floors/:floorId/trays/:trayId` | Assign a verified same-room tray |
| GET `/api/iot/floors/:floorId/environment` | Three readings, validity, age, means, spread, thresholds |
| GET `/api/iot/floors/:floorId/auto-control` | Saved config, mode, cultivation profiles/conflicts, suggestions |
| PUT `/api/iot/floors/:floorId/auto-control` | Save; always remains MANUAL |
| POST `/api/iot/floors/:floorId/auto-control/start` | Explicit Start; body `{ "dryRun": true }` by default |
| POST `/api/iot/floors/:floorId/auto-control/stop` | Stop and reconcile any owned pulse |
| GET `/api/iot/floors/:floorId/auto-control/status` | Mode, run, operator, runtime, sensors, SSR and last decision |
| GET `/api/iot/floors/:floorId/auto-control/logs` | History with `limit` (1–1000) and `offset` |
| POST `/api/iot/floors/:floorId/auto-control/evaluate` | Read-only preview; never publishes or changes runtime |

1. Select the physical floor and verify its master, node and SSR channel.
2. Select a mushroom type; use the existing mushroom-conditions API to inspect
   suggestions before saving. After saving, configuration GET includes the
   selected type's stored condition record. No growing thresholds are invented.
3. Review parameters and **Save Configuration**. A `mode` field is rejected;
   Start/Stop are the only mode-changing operations. Changes during AUTO or
   unresolved OFF are rejected with 409.
4. Review the environment and cultivation profile report. Planned/active sessions
   are joined through assigned trays. Mixed types, mismatched selected types,
   incompatible temperature/humidity/CO2 ranges, or unassigned trays require a
   named `profile_name` and explicit `profile_approved: true`. This is an operator
   approval of a floor-level profile, not an automatically selected mushroom.
   Stop and review configuration when the cultivation plan changes.
5. **Start Automatic Control**. The elected worker must be ready. Sensors must be
   healthy even for dry runs. Real starts additionally require MQTT readiness,
   master not reported offline, fresh live SSR OFF, correct mapping and verified
   firmware safety settings. Start records the user and a configuration snapshot.
6. **Stop Automatic Control**. The run is ended before any further ON can pass the
   shared channel lock. If a pulse might exist, runtime stays `OFF_PENDING` until
   live OFF feedback arrives. Stop returns current state; it does not pretend an
   unavailable MQTT broker or unconfirmed valve has been resolved.

Example mapping for a physically verified Floor 1 (IDs below are illustrative):

```json
{
  "room_id": 1, "floor_number": 1, "floor_name": "Floor 1",
  "master_id": 1, "node_address": 7, "misting_ssr_channel": 1
}
```

Node 7 is only an example, not a default. Floor 1's existing hardware uses SSR1
(GPIO4), Floor 2 SSR2 (GPIO5). The backend sends SSR channel numbers, never GPIOs.
Other channels, including 3–8, remain available through the existing manual APIs
unless deliberately assigned to a floor.

Simulation-only configuration; **not cultivation guidance**:

```json
{
  "mushroom_type_id": 1,
  "humidity_min": 85,
  "humidity_max": 95,
  "humidity_start_threshold": 83,
  "humidity_stop_threshold": 87,
  "misting_pulse_ms": 5000,
  "cooldown_ms": 60000,
  "evaluation_interval_ms": 5000,
  "sensor_max_age_ms": 20000,
  "required_valid_sensors": 3,
  "max_sensor_spread_percent": 10,
  "max_activations_per_hour": 20,
  "max_cumulative_on_ms_per_hour": 100000
}
```

All humidity values are 0–100. Min must be below max, start below stop, start at
or below min, and stop at or below max. Pulse is 1–60 seconds; cooldown is 1 second
to 24 hours; evaluation is 1–60 seconds; sensor age is 1–300 seconds. These are
software bounds, not recommended growing settings. All safety budgets and spread
limits must be supplied. Only sensor count (3) and maximum age (20 seconds) default.
Validate freshness against actual publication intervals (currently about 5 seconds).

## Aggregation and control algorithm

The service queries only the mapped master/node and sensor addresses 1–3. A valid
sample requires `is_valid=true`, finite 0–100 humidity, `retained=false`, and a
nonnegative age within the configured limit. Failed polls cannot contribute old
humidity values retained by the telemetry table. Retained MQTT delivery is
excluded even if its arrival time is recent; the firmware payload has no trusted
measurement timestamp. Source-side stale measurements cannot be identified from
this protocol alone.

The mean is the sum of valid readings divided by their count; with the default
three required sensors, 82, 84 and 86 yield 84%. Reduced quorum is an explicit
operator configuration. Excessive max-minus-min spread rejects the aggregate.
Temperature is averaged from valid finite readings for display.

The demand latch is set when humidity is strictly below start. It stays set
through the hysteresis band and clears at or above stop. While demand remains
set, each cooldown may be followed by another bounded pulse. Equality at start
does not set a cleared latch. Humidity at/above the hard maximum never starts a
pulse and ends an active one early.

`DISABLED → IDLE → ON_REQUESTED → MISTING → OFF_PENDING → COOLDOWN → IDLE` is the
normal progression. SENSOR_FAULT, DEVICE_OFFLINE and FAULT stop the run and require
an explicit new Start after resolution. OFF reconciliation remains eligible for
the worker even after a run is STOPPED/FAULT. MANUAL floors do not run misting
decisions or send automatic commands, except completing an already-owned OFF.

Before publishing ON, the service commits the pulse deadline and a budget
reservation. The worker checks active deadlines every 250ms scheduling tick,
independently of the configured idle evaluation interval. OFF never waits for ON
reported-state feedback. Cooldown begins after OFF confirmation (immediately in
simulation). No new pulse is allowed while OFF is pending.

Hourly budgets count reservations, including failed/uncertain ON attempts, across
run restarts. Dry runs reserve pulse duration. Real runs conservatively reserve
the full attested local watchdog maximum, not merely the requested pulse length.
Reservations are retained in the calculation for one hour plus 60 seconds so
pulses overlapping the rolling-hour boundary are not undercounted. This may block
earlier than an exact physical-flow budget. Physical flow cannot be measured by
these SSR messages.

## MQTT, concurrency and recovery

The existing shared MQTT client and command service are reused. Commands remain
`smartmush/{masterId}/ssr/{channel}/set` with plain `ON`/`OFF`, QoS 1, retain=false.
Existing sensor and SSR state subscriptions are unchanged. Actual publications
are recorded in `iot_device_commands`; simulations only create automation logs.

PostgreSQL session advisory locks serialize floor mutations and channel commands
across backend instances. Nested operations reuse the lock connection. The
existing manual command service takes the same channel lock. A manual ON against
AUTO or pending OFF is rejected. An operator-authorized manual OFF ends the run
under that lock before publishing, preventing a racing worker from turning it
back on. An ON publication has at most a 1-second publication budget; OFF uses the
existing bounded command timeout. OFF remains pending and is retried on reconnect.

One dedicated database session elects the worker. Other instances stay on standby.
Every new leader first stops all prior runs and reconciles incomplete cycles;
none are automatically resumed, including previously idle runs. Per-floor locks,
rechecking run state before ON, a leadership gate before publication, and durable
reservations prevent normal duplicate-worker ON decisions. The worker processes
at most two floors concurrently, ordered by pulse deadline, and never overlaps
its own sweeps. Database sessions must be stable: use a direct connection or
session-mode pooler, **not transaction-mode pooling**, for advisory locks.

Shutdown stops runs while MQTT is still available, then closes MQTT/database
connections. A crash leaves durable state for the next leader. If OFF cannot be
confirmed, mapping/configuration changes and new Start remain blocked. Pending
OFF is a visible unresolved condition, not silently reset to MANUAL-safe.

Errors: 400 invalid input, 401 missing/invalid JWT, 403 missing permission, 404
unknown floor, 409 incompatible state/mapping/sensors/safety gate, 503 unavailable
worker/MQTT. Worker publication errors are also persisted in runtime and logs.
Desired SSR state and reported SSR state are always separate from run state.

## Hardware enablement and limitations

Keep the defaults in `.env.example` until the firmware work is verified:

```dotenv
AUTO_MISTING_REAL_ENABLED=false
AUTO_MISTING_VERIFIED_WATCHDOGS={}
```

Before unattended real operation, implement and test an ESP32 **local maximum-ON
watchdog**, safe boot/output defaults, loss-of-connectivity behavior, an emergency
stop and appropriate electrical/valve safeguards. Verify that repeat/duplicate ON
messages cannot extend the watchdog indefinitely. Test backend death, broker
failure, Wi-Fi loss and device restart using the actual installation.

Only after that verification, the deployment administrator can attest the
measured maximum ON time per master and enable real runs, for example:

```dotenv
AUTO_MISTING_REAL_ENABLED=true
AUTO_MISTING_VERIFIED_WATCHDOGS={"master01":10000}
```

This is a deployment attestation, not a backend firmware capability probe. The
attested limit must be at least the requested pulse and at most 60 seconds. Then
restart, wait for live sensors and OFF feedback, and explicitly Start with
`{"dryRun":false}`. Existing runs remain stopped after restart.

Backend deadlines are **not a guarantee of physical valve safety**. Event-loop,
database, network, sweep backlog, broker and device delays can delay OFF. The
current protocol has no command IDs/acknowledgements or flow sensor. Reported
state has previously lagged about 17 seconds; a live OFF newer than an OFF request
is only protocol-level evidence, not correlated acknowledgement or proof of no
flow. MISTING means an ON request was published/simulated, not verified water
delivery. QoS duplication and messages already delivered cannot be recalled.
These limitations are why real operation is gated on device-side safeguards.

## Testing

Run `npm test`. Tests use isolated PostgreSQL and mocked MQTT, database locking
adapters and clocks. The existing configuration loader reads `.env`, but these
tests replace database/transport dependencies and never start the server's MQTT
connection or send actuator commands. Coverage includes migrations/constraints, configuration,
quorum/freshness/retention/spread, hysteresis, pulse deadlines, cooldown, budgets,
separate floors, Save/Start/Stop, recovery, delayed feedback, JWT/permission guards,
manual conflicts, leadership and existing IoT behavior. Multi-instance lifecycle
tests model election/session loss; they do not replace a staging test with real
PostgreSQL sessions and the verified hardware firmware.

For an API simulation, populate valid telemetry from a development publisher,
save a simulation configuration, Start with `dryRun:true`, inspect status/logs,
and Stop. Preview (`/evaluate`) is side-effect free and returns NONE while MANUAL;
it does not bypass the explicit Start workflow.

## Change inventory and verification

Final local verification: `npm test` passed **85 tests, 0 failures**.
`git diff --check` found no whitespace errors. No physical-device test was run.

| File | Change |
|---|---|
| `migrations/005_add_auto_misting_control.sql` | New additive migration, constraints, permission grants and worker heartbeat |
| `src/models/autoMisting.model.js` | Floor/config/run/runtime/log persistence and session locks |
| `src/services/autoMisting.algorithm.js` | Validation, aggregation and pure state-machine decisions |
| `src/services/autoMisting.service.js` | Operator workflow, safety gates, pulse handling and manual coordination |
| `src/services/autoMisting.worker.js` | Election, bounded evaluation, recovery and shutdown |
| `src/controllers/autoMisting.controller.js` | REST handlers and database error translation |
| `src/middlewares/autoMisting.middleware.js` | Data-driven automation permission checks |
| `src/config/autoMisting-swagger.js` | New API schemas, examples and operation documentation |
| `src/config/swagger.js` | Register automation documentation |
| `src/routes/iot.routes.js` | Register authenticated floor APIs |
| `src/models/iot.model.js` | Reuse the channel-lock database connection during commands |
| `src/services/iot.service.js` | Shared channel locks, manual override coordination and bounded automatic publication |
| `src/services/iotMqtt.service.js` | Expose existing connection readiness |
| `src/server.js` | Start worker and stop it before MQTT shutdown |
| `.env.example` | Disabled-by-default hardware gate and watchdog attestation |
| `tests/autoMisting.algorithm.test.js` | Configuration, sensor and decision tests |
| `tests/autoMisting.integration.test.js` | Isolated migration and service integration tests |
| `tests/autoMisting.routes.test.js` | JWT, permission and Swagger tests |
| `tests/autoMisting.worker.test.js` | Election, recovery and session-lock lifecycle tests |
| `tests/iot.routes.test.js` | Scope existing seven-endpoint assertion to original IoT APIs |
| `AUTO_MISTING_CONTROL.md` | Deployment, operator workflow, safety, tests and this inventory |
