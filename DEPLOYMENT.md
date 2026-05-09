# Stylique CRM Deployment

## What Ships

- `dist/` is the static CRM frontend.
- `server/index.mjs` is the production API gateway.
- Connector secrets live only on the API server.

## Frontend

Build:

```bash
npm run build
```

Deploy `dist/` to Vercel, Netlify, Cloudflare Pages, S3, or any static host.

Required frontend env:

```bash
VITE_STYLIQUE_API_BASE_URL=https://your-api-host
VITE_REQUIRE_BACKEND_AUTH=true
```

## Backend

Run:

```bash
npm run start:api
```

The backend also serves the built frontend from `dist/`, so the simplest production deployment is one Node service:

```bash
npm ci
npm run build
node server/index.mjs
```

Docker:

```bash
docker build -t stylique-crm .
docker run -p 8787:8787 --env-file .env stylique-crm
```

Render:

- Use the included `render.yaml` blueprint.
- It mounts persistent storage at `/var/data`.
- It sets `STYLIQUE_DATA_DIR=/var/data` so CRM state survives redeploys.

Required backend env:

```bash
PORT=8787
STYLIQUE_ALLOWED_ORIGIN=https://your-crm-host
STYLIQUE_JWT_SECRET=long-random-secret
STYLIQUE_ADMIN_PASSWORD=strong-password
STYLIQUE_DATA_DIR=./server/data
STYLIQUE_MAX_BODY_BYTES=1048576
STYLIQUE_CONNECTOR_TIMEOUT_MS=15000
```

Optional per-user auth:

```bash
STYLIQUE_USERS_JSON='{"abdullah":{"password":"strong-password","role":"ceo"},"hira":{"password":"strong-password","role":"coo"}}'
```

Connector env:

```bash
CONNECTOR_CLAUDE_URL=
CONNECTOR_CLAUDE_API_KEY=
CONNECTOR_CODEX_URL=
CONNECTOR_CODEX_API_KEY=
CONNECTOR_CLORT_URL=
CONNECTOR_CLORT_API_KEY=
CONNECTOR_BOTEX_URL=
CONNECTOR_BOTEX_API_KEY=
```

## Health Check

```bash
curl https://your-api-host/health
```

The response shows whether auth and connector envs are configured without exposing secrets.

## Production Check

Before release:

```bash
npm run deploy:check
npm run check:prod-env
```

`check:prod-env` must be run in the same environment where the backend will run, because it checks the actual secret variables.

## Security Defaults

- Connector keys are never stored in the browser.
- Backend auth tokens expire after 12 hours.
- Login attempts are rate-limited.
- Connector calls are rate-limited and timeout-capped.
- CORS should be locked to the production frontend origin.
- Request body size is capped by `STYLIQUE_MAX_BODY_BYTES`.

## Auth

Login endpoint:

```bash
POST /auth/login
{ "userId": "abdullah", "password": "..." }
```

Protected API calls use:

```bash
Authorization: Bearer <token>
```

## Connector Calls

Ping:

```bash
POST /api/connectors/claude/ping
```

Invoke:

```bash
POST /api/connectors/claude/invoke
```

Supported connector keys:

- `claude`
- `codex`
- `clort`
- `botex`
