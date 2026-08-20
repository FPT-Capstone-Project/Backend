# Capstone Backend Auth

## Setup

1. Copy `.env.example` to `.env` and set the PostgreSQL and JWT values.
2. Ensure the `roles` table exists and insert the role IDs used by clients before registering users.
3. Ensure the provided `users` table exists.
4. Install dependencies with `npm install`.

## Run commands

```bash
npm start       # Start the server normally
npm run dev     # Start with nodemon
npm run rundev  # Alias of npm run dev
```

Swagger UI is available at `http://localhost:3000/api-docs`.
The raw OpenAPI document is available at `http://localhost:3000/api-docs.json`.

## Endpoints

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me` with `Authorization: Bearer <token>`
- `GET /api/users/me` with `Authorization: Bearer <token>`
- `GET /health`
- `GET /api-docs`

Register body:

```json
{
  "roleId": 2,
  "email": "user@example.com",
  "password": "at-least-8-characters",
  "fullName": "Nguyen Van A",
  "phone": "0900000000",
  "address": "Ho Chi Minh City"
}
```

`authorizeRoles(...roleIds)` is available in `src/middlewares/auth.middleware.js` for protected role-specific routes. The middleware compares numeric `role_id` values from the database.
