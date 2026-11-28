# Frontend Socket.IO Guide

This backend serves Socket.IO from the same HTTP server as the REST API. Connect to the API origin; the Socket.IO client uses `/socket.io` by default.

## Install

Add the Socket.IO client to the frontend project:

```sh
npm install socket.io-client
```

## Connect with the current access token

Pass the access token in the Socket.IO handshake `auth` object. Do not put it in the URL or log it.

```js
import { io } from 'socket.io-client';

const socket = io(API_URL, {
  autoConnect: false,
  auth: { token: accessToken },
});

socket.on('connect', () => {
  console.info('Socket connected', socket.id);
});

socket.on('connect_error', (error) => {
  // Refresh/login through the existing REST authentication flow as needed.
  console.error('Socket connection failed:', error.message);
});

socket.connect();
```

The backend validates the JWT and then checks that the account still exists and is `ACTIVE`. The user ID and role are taken from the verified token and database; frontend-supplied user IDs are not trusted.

When an access token is refreshed, update the handshake credentials before reconnecting:

```js
socket.disconnect();
socket.auth = { token: newAccessToken };
socket.connect();
```

## Subscribe to a resource room

The client sends a resource type and ID. Never send a room name such as `session:12`; the backend constructs the room name after authorizing access.

```js
socket.emit('room:join', { type: 'session', id: 12 }, (result) => {
  if (!result.ok) {
    console.error('Room subscription rejected:', result.code);
    return;
  }
  console.info('Joined resource room:', result.type, result.id);
});
```

Supported `type` values are `room`, `session`, `issue`, and `consultation`. `id` must be a positive integer (number or numeric string). A successful acknowledgment is:

```json
{ "ok": true, "type": "session", "id": 12 }
```

If no acknowledgment callback is supplied, a rejected request is emitted as `room:subscription:error`. With a callback, handle the error through the callback result instead.

Leave a resource room when it is no longer needed, such as when navigating away from a detail screen:

```js
socket.emit('room:leave', { type: 'session', id: 12 }, (result) => {
  if (!result.ok) console.error('Could not leave room:', result.code);
});
```

Leaving does not require the resource to still be accessible. The client can leave only a supported resource room; it cannot leave or join another user's private room.

## Room access rules

| Account | Resource access |
| --- | --- |
| Admin (role ID `1`) and Farm Operator (role ID `2`) | Existing `room`, `session`, `issue`, or `consultation` resources |
| Customer (role ID `3`) | Own sessions, issues, and consultations; a physical room only while the customer's order has an active tray in it |
| Expert | Only assigned issues and consultations |

On successful connection, the backend automatically adds the socket to `user:{userId}`. Admins also join `admin`; Experts also join `expert`. These room names are backend-controlled and are not valid `room:join` types.

## Handle application events

Use events as signals to refresh the relevant REST resource. REST remains the source of truth and provides initial data and recovery after reconnects.

```js
socket.on('notification:new', () => refreshNotifications());

socket.on('payment:status.updated', ({ orderId }) => {
  refreshOrderPaymentStatus(orderId);
});

socket.on('cultivation:session.updated', (event) => {
  refreshCultivationSession(event.sessionId);

  if (event.changeType.includes('INSPECTION') || event.changeType === 'SPAWN_REPLACEMENT_ISSUED') {
    refreshInspectionHistory(event.sessionId);
  }
});
```

The same session event covers daily tray inspections, automatic camera inspections, spawn inspections, and inspection images/replacements. `inspectionId` is included when available, and `inspectionSource` is `MANUAL` or `AUTO` for tray inspections. Use `changeType` to decide whether to refresh inspection history; inspection content and image URLs are fetched through REST.

Register each handler once and remove it when the component or application service is disposed:

```js
socket.off('cultivation:session.updated', onSessionUpdated);
```

`notification:new` currently covers notifications sent through the cultivation-session notification API. Notifications inserted directly by other backend workflows do not currently emit this Socket.IO event.

## Connection errors

The server may reject a connection with messages including:

- `Authentication required`
- `Invalid or expired token`
- `Invalid or inactive user`
- `Socket authentication unavailable`

Do not treat a Socket.IO connection as proof that an order was paid or a cultivation update was persisted. Confirm state with the corresponding REST API.
