# Socket.IO Environment Configuration

## Backend configuration

Socket.IO is attached to the same HTTP server as Express. It uses the API host, `PORT`, and the default Socket.IO path `/socket.io`; there is no separate socket port or Socket.IO-specific environment variable.

Inspection realtime uses the existing cultivation Socket.IO event and requires no additional environment variables.

| Variable | Required | Use |
| --- | --- | --- |
| `PORT` | No | Shared HTTP/Socket.IO port; defaults to `3000` |
| `NODE_ENV` | No | Controls the default CORS origin |
| `CORS_ORIGINS` | Production: yes | Comma-separated browser origins allowed by Socket.IO |
| `JWT_SECRET` | Production: yes | Verifies the access token sent during the Socket.IO handshake |
| `DATABASE_URL` | Or individual `DB_*` values | Database connection used to validate the account and authorize rooms |
| `DB_HOST` | If no `DATABASE_URL` | PostgreSQL host; defaults to `localhost` |
| `DB_PORT` | If no `DATABASE_URL` | PostgreSQL port; defaults to `5432` |
| `DB_NAME` | If no `DATABASE_URL` | PostgreSQL database; defaults to `capstone` |
| `DB_USER` | If no `DATABASE_URL` | PostgreSQL username; defaults to `postgres` |
| `DB_PASSWORD` | If no `DATABASE_URL` | PostgreSQL password |

Example production configuration:

```dotenv
NODE_ENV=production
PORT=3000
CORS_ORIGINS=https://app.example.com,https://admin.example.com
JWT_SECRET=replace-with-a-long-random-secret
DATABASE_URL=postgresql://user:password@db.example.com:5432/capstone
```

`CORS_ORIGINS` entries must be origins (scheme, host, and optional port), not full page URLs with paths. The backend splits the value on commas and trims whitespace. In development, an unset value defaults to `*`; outside development, it defaults to no allowed origins, so configure it explicitly.

`JWT_SECRET` must match the secret used to sign API access tokens. Production startup rejects the development fallback secret. Keep this secret and database credentials on the server; never expose them in frontend configuration.

The Socket.IO handshake uses the existing HTTP server and checks the account status against PostgreSQL. The database must be reachable for a new socket to authenticate and for protected room subscriptions to be authorized.

## Frontend configuration

Configure the frontend with the public API origin only, for example:

```dotenv
VITE_API_URL=https://api.example.com
```

`VITE_API_URL` is an example frontend variable, not a backend setting in this repository. Pass it to `io(VITE_API_URL, { auth: { token } })`. Do not append `/socket.io` unless the backend is explicitly configured with a custom path; this backend uses the default path.

In production, use HTTPS for the API origin so the browser uses a secure Socket.IO connection, and list that exact frontend origin in `CORS_ORIGINS`. If a reverse proxy is used, it must allow WebSocket upgrades and keep the Socket.IO endpoint reachable.

## Deployment notes

- The current server uses Socket.IO's in-memory room adapter. Multiple backend instances do not share room membership or cross-instance emits; use a compatible shared adapter and deployment configuration before scaling horizontally.
- CORS is not authorization. The backend still authenticates the JWT and checks resource ownership/assignment before joining protected rooms.
- REST endpoints remain the source of truth. Reconnect and refresh application state over REST if an event may have been missed.
