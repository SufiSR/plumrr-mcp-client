# PluMRR MCP Client

Standalone HTTP/SSE MCP server for LibreChat. Isolated in `mcp-client` with its own Dockerfile.

## Architecture

- **Stateless**: no server-side session/cookie persistence, no cookie jar, no globals.
- **LibreChat credentials (recommended)**: configure MCP `headers` in LibreChat (e.g. `X-Plumrr-Email` / `X-Plumrr-Password`). The server reads these on **each incoming HTTP request** to `/mcp`, performs a single upstream login for that request (cached only in memory for the duration of that request), and uses the resulting cookies for tool calls. The LLM does **not** receive your password and does not need to call `auth_login` first.
- **Manual cookie mode**: alternatively, call `auth_login` with email/password and pass `cookieHeader` on later tools (or rely on LibreChat headers instead).
- **Allowlisted**: only approved GET endpoints and auth actions are exposed. Path parameters are sanitized against traversal injection.
- **Session-aware**: MCP protocol sessions are tracked per `mcp-session-id` header (required by the MCP Streamable HTTP spec), but no PluMRR user auth is stored server-side between HTTP requests.

## Available Tools

### Auth
| Tool | Description |
|------|-------------|
| `auth_login` | Authenticate with email/password. Returns Set-Cookie values to store. |
| `auth_refresh` | Refresh access token cookie. Call when a 401 is received. |
| `auth_logout` | End user session. Discard stored cookies after. |
| `auth_me` | Get current authenticated user profile. |

### Contracts
| Tool | Description |
|------|-------------|
| `contracts_get_all` | List all contracts across customers. |
| `contracts_list` | List contracts from the index endpoint. |
| `contracts_get_current_for_customer` | Get active contract for one customer (by ID or name). |
| `contracts_get_customer_losses` | Get loss records for a customer's contracts. |
| `contracts_get_customer_sanity_check` | Run sanity checks on a customer's contracts. |
| `contracts_get_customer_order_items` | Get order items for a customer's contracts. |
| `contracts_get_customer_recurring_orders` | Get recurring orders for a customer. |
| `contracts_get_customer_item_overrides` | Get item overrides for a customer. |
| `contracts_check_order_timeframes` | Validate timeframes for a specific order. |

### Customers
| Tool | Description |
|------|-------------|
| `customers_list` | List or search customers (`searchTerm`, `limit`). Fuzzy ranking when searching. |
| `customers_get_by_id` | Fetch one customer by numeric ID. |

### MRR
| Tool | Description |
|------|-------------|
| `mrr_get_customer_data` | Get MRR data for one customer. |

### Reports
| Tool | Description |
|------|-------------|
| `reports_get_filter_options` | Get available report filters. |
| `reports_get_customer_world_map` | Get geographic customer data. |
| `reports_get_lorenz_curve_filter_options` | Get Lorenz curve report filters. |
| `reports_get_lost_won_customers` | Get lost/won customer analytics. |
| `reports_get_lost_won_customers_status` | Get lost/won report generation status. |
| `reports_get_expansion_waterfall` | Get MRR waterfall data. |
| `reports_get_ltv` | Get customer lifetime value data. |

### Customer Losses
| Tool | Description |
|------|-------------|
| `customer_losses_list` | List all loss entries (admin/editor). |
| `customer_losses_get_by_id` | Get one loss record by ID (admin/editor). |

### Embed Reports
| Tool | Description |
|------|-------------|
| `reports_embed_get` | Fetch a public/embed report by slug. |

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `PLUMRR_API_BASE_URL` | `http://host.docker.internal:8000` | Upstream PluMRR API |
| `MCP_PORT` | `8001` | Port for MCP HTTP server |
| `LOG_LEVEL` | `info` | Log verbosity |
| `PLUMRR_CREDENTIAL_HEADER_EMAIL` | `X-Plumrr-Email` | Must match LibreChat MCP header name for email |
| `PLUMRR_CREDENTIAL_HEADER_PASSWORD` | `X-Plumrr-Password` | Must match LibreChat MCP header name for password |
| `MCP_BASE_URL` | `http://localhost:${MCP_PORT}` | Test-only override for integration script target |

## Run locally

```bash
npm install
npm run dev
```

Server endpoints:
- Health: `GET /health`
- MCP: `POST /mcp` (initialize + tool calls), `GET /mcp` (SSE stream), `DELETE /mcp` (close session)

## Docker

```bash
docker build -t plumrr-mcp-client .
docker run --rm -p 8001:8001 \
  -e PLUMRR_API_BASE_URL=http://host.docker.internal:8000 \
  plumrr-mcp-client
```

## Docker Compose (project-local)

This project includes its own compose file at `mcp-client/docker-compose.yml`.

1. Copy environment defaults:
```bash
cp .env.example .env
```
2. Edit `.env` (`MCP_PORT`, `PLUMRR_API_BASE_URL`, `LOG_LEVEL`)
3. Start:
```bash
docker compose up --build -d
```
4. Stop:
```bash
docker compose down
```

## LibreChat configuration

```yaml
plumrr-mcp:
  title: "PluMRR API"
  description: "Read-only PluMRR MCP with stateless cookie auth forwarding"
  type: streamable-http
  url: "http://host.docker.internal:8001/mcp"
  headers:
    X-Plumrr-Email: "{{PLUMRR_EMAIL}}"
    X-Plumrr-Password: "{{PLUMRR_PASSWORD}}"
  customUserVars:
    PLUMRR_EMAIL:
      title: "PluMRR Email"
      description: "Your PluMRR email address"
    PLUMRR_PASSWORD:
      title: "PluMRR Password"
      description: "Your PluMRR password"
```

Headers are for credential delivery into MCP tools. MCP does not persist sessions; callers supply cookies per tool call.

## Integration testing

`test/integration-manual.mjs` now uses environment-driven targets:

- `MCP_PORT` (default `8001`)
- `MCP_BASE_URL` (optional, overrides `http://localhost:${MCP_PORT}`)
- `PLUMRR_EMAIL` (required)
- `PLUMRR_PASSWORD` (required)

Example:
```bash
PLUMRR_EMAIL="user@example.com" \
PLUMRR_PASSWORD="secret" \
MCP_PORT=8010 \
node test/integration-manual.mjs
```
