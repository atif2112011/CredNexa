# EMI Shield Backend

Firebase Functions repo for the EMI Shield backend. The existing Express API is exported as a single HTTP function, and each cron is exported as its own scheduled function.

## Functions Exposed

- `api`: wraps the Express app and exposes all existing `/api/*` routes plus `/`.
- `fcmDeliveryJob`: every minute.
- `tempUnlockExpiryJob`: every 10 minutes.
- `slaEscalationJob`: every 30 minutes.
- `emiPolicyJob`: every 30 minutes.
- `manualOverrideTokenRenewalJob`: daily at `00:00` in `FIREBASE_SCHEDULER_TIME_ZONE`.
- `tenantMetricsReconciliationJob`: daily at `01:00` in `FIREBASE_SCHEDULER_TIME_ZONE`.

The root Express middleware in `src/app.js` still connects to MongoDB before every request, so all HTTP-triggered Firebase API calls keep the same DB bootstrapping behavior.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create an environment file:

```bash
cp .env.example .env
```

Use `APP_PORT`, `APP_FIREBASE_*`, `ADMIN_FIREBASE_*`, `FUNCTIONS_REGION`, and `SCHEDULER_TIME_ZONE` variable names in `.env`. Firebase Functions rejects `.env` keys named `PORT` or starting with the reserved `FIREBASE_` prefix during deploy.

3. Select a Firebase project:

```bash
firebase use <project-id>
```

4. Run the local Functions emulator:

```bash
npm run serve
```

5. For standalone Express development, you can still run:

```bash
npm run dev
```

## Deploy

```bash
npm run deploy
```

## Current Structure

```text
index.js
firebase.json
src/
  app.js
  server.js
  config/
  constants/
  middleware/
  models/
  modules/
  routes/
  utils/
```

## Auth Token Flow

- Login returns only the JWT access token in the JSON response.
- The refresh token is set as an HTTP-only cookie.
- Expired access tokens return `401` from protected routes.
- Clients should call `POST /api/auth/refresh-token`, then retry the original request.
- If refresh also returns `401`, clear local auth state and redirect to login. The server clears the HTTP-only refresh cookie when it detects an invalid or expired refresh token.
