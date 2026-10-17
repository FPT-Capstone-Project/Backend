# SmartMush IoT integration

The module follows the existing Express controller → service → SQL model architecture,
`{ data: ... }` responses, `AppError`, JWT middleware and numbered SQL migrations.
It communicates only with ESP32 masters over MQTT, never directly with STM32/SHT40.
Existing `iot_devices`/`sensor_data` tables are unchanged: they cannot represent
node/sensor addresses, failed polls, desired/reported SSR state or command history.

## Configure and provision

1. Run `npm ci` (Windows: `npm.cmd ci`).
2. Apply `migrations/004_add_iot_integration.sql` once using your PostgreSQL SQL editor
   or `psql -v ON_ERROR_STOP=1 -f migrations/004_add_iot_integration.sql` with your usual
   PostgreSQL connection settings. Existing `cultivation_rooms` and `users` must exist.
   Do not rerun `database.sql` against an existing database. No migrations run automatically.
3. The migration registers `master01` with no room assignment. Associate it with an
   existing room, for example (replace `1` with the actual room ID):

   ```sql
   UPDATE iot_masters SET cultivation_room_id = 1 WHERE master_identifier = 'master01';
   -- Provision additional masters explicitly; unknown MQTT masters are ignored.
   INSERT INTO iot_masters(master_identifier, cultivation_room_id) VALUES ('master02', 1);
   ```

4. In EMQX Cloud, copy the deployment hostname and create a dedicated backend
   username/password under Access Control / Client Authentication. Use TLS port 8883.
   Configure ACLs to allow backend subscription to `smartmush/+/node/+/sensor/+`,
   `smartmush/+/status`, `smartmush/+/ssr/+/state` and publication to
   `smartmush/+/ssr/+/set`. Each device should have credentials restricted to its own master.
   See [EMQX connection guide](https://docs.emqx.com/en/cloud/latest/connect_to_deployments/deploy_mqtt_broker.html).
5. Set these in your local `.env` (real credentials are never returned or logged):

   ```dotenv
   MQTT_HOST=your-deployment-hostname
   MQTT_PORT=8883
   MQTT_USERNAME=your-backend-username
   MQTT_PASSWORD=your-backend-password
   MQTT_CLIENT_ID=smartmush-backend
   ```

   All IoT endpoints, including SSR control, require a valid JWT for an active user.
   Any active authenticated account, including customers, may send SSR commands;
   no role or user allowlist is applied. MQTT credentials authenticate the backend
   connection to EMQX, not the person calling the REST API. The caller's user ID
   is still recorded on each command.

6. Run `npm start`; Swagger is at `/api-docs`, its specification at `/api-docs.json`.
   An empty `MQTT_HOST` disables MQTT without breaking other APIs. Control returns
   503 when MQTT is unavailable. A configured client starts automatically, appends a
   UUID to its client ID, reconnects and resubscribes. SIGINT/SIGTERM closes it and the DB pool.
   TLS hostname/certificate verification and SNI remain enabled. If your deployment
   requires an extra CA, set `NODE_EXTRA_CA_CERTS` to the downloaded PEM path **before
   starting Node**, rather than disabling certificate verification.

## Test sensor reception without hardware

Use MQTTX with TLS enabled, certificate verification on, the deployment hostname,
port 8883, a unique test client ID and appropriately scoped test credentials.
Publish without retention to `smartmush/master01/node/1/sensor/1`:

```json
{"node_id":1,"sensor_id":1,"ok":true,"temperature":27.5,"humidity":85.2}
```

Then publish a failed poll to the same topic:

```json
{"node_id":1,"sensor_id":1,"ok":false,"temperature":null,"humidity":null}
```

Authenticate through the existing login API; use Swagger's **Authorize** with the
JWT or Postman's Bearer Token authorization. Fetch:

- `GET /api/iot/masters`
- `GET /api/iot/masters/master01/sensors`
- `GET /api/iot/masters/master01/nodes/1/sensors/1`
- `GET /api/iot/masters/master01/nodes/1/sensors/1/history?limit=100&offset=0`

Latest state should show `ok: false` but retain 27.5/85.2 and the previous
`lastValidAt`. History includes both polls, with null measurements on failure.
Repeat with node 2/sensor 3 and matching payload IDs to verify independent addresses.
Node addresses are 1–247; sensor addresses 1–3; temperature −40–125 °C and humidity
0–100%. Topic/payload IDs must agree. Missing values, wrong types, malformed JSON
and oversized payloads are rejected. History accepts timezone-qualified ISO `from`
and `to`, descending arrival order, limit 1–1000, offset 0–1,000,000.

Publish plain `online` or `offline` to `smartmush/master01/status` to test status.
Retained status is flagged with `statusRetained`; it does not advance `lastSeenAt`.
`lastSeenAt` is the most recent non-retained arrival, not a proof of connectivity.
`receivedAt`/`lastReceivedAt` are backend arrival times, and `measuredAt` is null
because the firmware provides no measurement timestamps. All new timestamps use TIMESTAMPTZ.

## Test manual SSR control

Use a JWT for an active authenticated user.
With test hardware in a suitable state, subscribe in MQTTX to
`smartmush/master01/ssr/+/set`, then send through Swagger/Postman:

```http
POST /api/iot/masters/master01/ssr/1/commands
Authorization: Bearer <JWT>
Content-Type: application/json

{"action":"ON"}
```

Expect HTTP 202 and `data.commandId`, `masterId`, `channel`, `action`, `status`.
The MQTT command is exactly topic `smartmush/master01/ssr/1/set`, payload `ON`.
Repeat with `{"action":"OFF"}`. GPIO mapping is channels 1–8 → 4,5,6,7,15,16,17,18;
the backend addresses channels only and does not configure GPIOs.

`GET /api/iot/commands/{commandId}` returns persisted status/timestamps.
`GET /api/iot/masters/master01/ssr` always returns eight channels, initially null.
Publish plain `ON`/`OFF` to `smartmush/master01/ssr/1/state` to simulate firmware
feedback. `statesMatch` compares desired/reported values (null if unknown).
The command stays PUBLISHED regardless of matching feedback.

Commands start PENDING. Broker PUBACK produces PUBLISHED; errors produce FAILED;
publication expiry produces TIMED_OUT. `completedAt` means the publication attempt
finished, never physical actuation. Failed publication error responses include the
command ID for status lookup. Pending crash-left records expire periodically or
when command status is queried; they are never republished.

Backend-to-EMQX uses MQTT 5 QoS 1 with `retain: false` and a maximum five-second
message expiry. EMQX can deliver to an MQTT 3.1.1 ESP32 subscription at its negotiated
QoS; no topic/payload changes are required. Unacknowledged outgoing packets are removed
on disconnect, and timeout destroys buffered transport data. MQTT.js never restores
desired ON states. Do not automatically retry requests: delivery may be unknown after
a timeout or disconnect. [MQTT.js lifecycle/API reference](https://github.com/mqttjs/MQTT.js).

## Verification and limitations

Run `npm test`. Tests cover parser validation, multiple nodes, failed readings,
mocked MQTT reconnect/subscription lifecycle, ON/OFF publications, PUBACK rejection,
timeouts, no replay, JWT enforcement and inactive/missing-user rejection, API schemas and command handling.
An in-memory transport exercises the actual MQTT.js library. PGlite (development
dependency) runs the repository schema plus the new migration and model SQL in an
isolated PostgreSQL engine, including last-valid preservation and SSR state separation.
Tests never contact your configured PostgreSQL database or EMQX. There are no lint
or build scripts in this repository.

Implementation validation: all 45 tests passed; JavaScript syntax and `git diff
--check` passed. The actual server started with MQTT disabled, returned HTTP 200
for health and Swagger (all seven IoT paths), and shut down on SIGTERM. Online
`npm audit` reported eight findings (one moderate, six high, one critical) in the
existing dependency tree; neither MQTT nor PGlite was named in the report.
Unrelated dependency upgrades were not applied.

- Live EMQX TLS/ACLs, the deployed database migration and ESP32/RS485/physical SSRs
  still require deployment verification. The migration is not applied to your database.
- No heartbeat or broker presence integration exists: retained online can be stale.
  Firmware would need measurement timestamps and sequence IDs to identify stale or
  duplicate telemetry, plus command IDs/correlated acknowledgments for per-command confirmation.
- Firmware supplies reported SSR state only. Matching feedback does not prove valve
  activation; physical verification needs a separate sensor. Firmware disconnect shutdown
  cannot be assumed immediate. Expiry cannot recall a command already delivered to ESP32.
- No schedules or automatic irrigation are implemented. Broker QoS is not exactly-once
  storage; duplicates can appear in history. Incoming persistence uses separate serial
  SSR and telemetry lanes, each bounded to 1,000 pending messages; overload/database failures are logged and may drop
  telemetry. There is no durable ingestion queue or automatic data retention policy.
- Run one ingestion/backend process for this initial deployment. Multiple instances
  would each receive the wildcard subscriptions and duplicate history; channel request
  serialization is process-local. A future scaled deployment needs ingestion ownership
  and distributed command coordination.

## SSR latency diagnostics (2026-10-17)

Source audit: the MQTT `message` handler subscribes to `smartmush/+/ssr/+/state`
and captures arrival time immediately. There is no SSR polling/cron timer. The
five-second maintenance timer expires command publications only. GET SSR reads
PostgreSQL directly through the controller/service/model, with no application cache.

Previously, all MQTT writes shared one serial promise queue. A slow sensor write
held back every later SSR message. SSR now has its own serial lane and capacity,
so even a full telemetry queue cannot hold up or reject feedback. Each lane has
at most one active transaction. Per-master row locks remain to protect related
updates; an already-running transaction or exhausted shared connection pool can
still delay SSR. This is not a guarantee of a fixed real-time latency.

Read-only measurements against the configured database found a DB/backend clock
offset of about -15,782 ms on three consecutive samples (112–115 ms round trips).
The diagnostic snapshot had zero sessions waiting on locks and one idle transaction;
this snapshot cannot establish whether a previous request was blocked. The previous
`lastCommandAt` used DB time while `lastReportedAt` used backend arrival time, so
subtracting them did not reliably measure latency. Both SSR fields now use backend
time for new events. Command-history timestamps (`requestedAt`, `expiresAt`, etc.)
still use DB time, preserving expiry semantics. Existing rows are not rewritten.
System clocks should also be synchronized operationally. No live relay command was
sent during this investigation; the actual historical 17-second GET delay is not
proven by these measurements.

After restarting/deploying the backend, correlate JSON logs by master/channel,
`commandId`, `feedbackId`, and `readId`:

- `ssr.command.publish.start` / `ssr.command.publish.acked`: API publication and broker ACK.
- `ssr.mqtt.received`: callback arrival, state, retained flag and both queue depths.
- `ssr.db.start`: start of persistence and `queueWaitMs`.
- `ssr.db.pool.wait` / `ssr.db.pool.acquired`: pool counts and `poolWaitMs`.
- `ssr.db.query.start` / `ssr.db.query.done`: query phase and duration; `master_lock`
  includes PostgreSQL lock wait plus query/network time, not lock wait alone.
- `ssr.db.committed`: successful transaction completion and `receiveToCommitMs`.
  `ssr.db.ignored`, `ssr.db.failed`, and `ssr.feedback.dropped` distinguish other outcomes.
- `ssr.get.start` / `ssr.get.done`: fresh GET read duration and returned channel states.

Durations use the monotonic process clock. Log timestamps use backend UTC time.
Feedback has no command ID in the existing protocol, so logs cannot establish
per-command acknowledgement when commands overlap. Older feedback is guarded by
arrival timestamp in SQL; successful command publication never sets reported state.

Regression coverage includes real MQTT.js inbound packet dispatch, SSR progress
with 1,000 blocked telemetry writes, ordered ON/OFF feedback, error recovery and
shutdown draining, PostgreSQL visibility after commit, stale-write protection,
and a simulated skewed DB command timestamp. `npm test`: 50 passed, zero failed.

## Changed files

New: `migrations/004_add_iot_integration.sql`, `src/config/iot.js`,
`src/config/iot-swagger.js`, `src/controllers/iot.controller.js`,
`src/models/iot.model.js`, `src/routes/iot.routes.js`, `src/services/iot.service.js`,
`src/services/iotMqtt.service.js`, `src/utils/iot-protocol.js`,
`tests/iot.test.js`, `tests/iot.model.test.js`, `tests/iot.routes.test.js`,
`tests/iot.mqtt.transport.test.js`, and this guide.

Modified: `.env.example`, `package.json`, `package-lock.json`, `src/config/swagger.js`,
`src/routes/root.routes.js`, `src/server.js`. Your `.env` is unchanged.
