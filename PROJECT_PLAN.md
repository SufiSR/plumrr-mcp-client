# PluMRR MCP Client Plan

## Goal
Build a standalone HTTP/SSE MCP server for LibreChat that authenticates users with email/password against PluMRR and exposes only approved read endpoints.

## Project Boundaries
- Keep this as an independent project under `mcp-client`.
- Include its own runtime, dependencies, config, tests, and `Dockerfile`.
- Do not couple implementation to frontend/backend app bootstraps.

## Required Auth Model (Stateless)
- No server-side session persistence (memory/files/DB/globals).
- No cookie jar in MCP.
- Client provides auth context each request (cookies and/or credentials).
- MCP forwards client cookies unchanged for protected API calls.
- If login is used, MCP returns `Set-Cookie` data to client for client-side storage.
- Never convert login JWT to `Authorization: Bearer` for normal user endpoints.

## API Surface to Expose
- Auth:
  - `POST /api/v1/auth/login`
  - `POST /api/v1/auth/refresh`
  - `POST /api/v1/auth/logout`
  - `GET /api/v1/auth/me`
- Read-only domain calls:
  - All GET routes for contracts
  - `GET /api/v1/mrr/customer/{customer_id}`
  - All GET routes for customers
  - All GET routes for reports
  - All GET routes for customer losses (including relevant public/embed reads)

## Implementation Steps
1. Scaffold MCP server (HTTP/SSE transport) in `mcp-client/src`.
2. Add typed tool schemas and strict endpoint/method allowlist.
3. Implement stateless auth forwarding behavior.
4. Add upstream API client with deterministic error mapping and timeout handling.
5. Add tests for auth flow, allowlist enforcement, and cookie forwarding.
6. Add containerization with a dedicated `mcp-client/Dockerfile`.
7. Add run instructions and LibreChat configuration example in `mcp-client/README.md`.

## Docker Requirements
- Create `mcp-client/Dockerfile` for this project only.
- Keep image minimal and production-ready.
- Configure with env vars (example): `PLUMRR_API_BASE_URL`, `MCP_PORT`, `LOG_LEVEL`.
- Expose MCP HTTP/SSE endpoint (example: `/mcp`).

## Acceptance Criteria
- LibreChat can connect to this MCP over HTTP/SSE.
- Users can authenticate via email/password through MCP.
- Protected calls succeed when client sends valid cookies.
- No server-side session storage exists in MCP.
- Only approved endpoint groups are reachable via tools.
