# EMI Shield Backend

Node.js, Express, and Mongoose API server scaffold.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create an environment file:

```bash
cp .env.example .env
```

3. Start the development server:

```bash
npm run dev
```

The API mounts routes under `/api/v1`.

## Current Structure

```text
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

Controllers use the response shape from `instructions.md`:

```js
{ success: true, message: "", data }
{ success: false, error: "" }
```

Module controllers contain endpoint logic directly. Keep shared cross-cutting behavior in middleware, utilities, or models.

## Auth Token Flow

- Login returns only the JWT access token in the JSON response.
- The refresh token is set as an HTTP-only cookie.
- Expired access tokens return `401` from protected routes.
- Clients should call `POST /api/v1/auth/refresh-token`, then retry the original request.
- If refresh also returns `401`, clear local auth state and redirect to login. The server clears the HTTP-only refresh cookie when it detects an invalid or expired refresh token.
