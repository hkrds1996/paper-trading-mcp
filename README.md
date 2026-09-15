# Paper Trading MCP

Connect a local AI agent to your KH paper trading account with a standard MCP `stdio` server. Your client launches a local Node.js process; configure a command and a paper token, without entering a hosted endpoint URL.

The package supports stock orders, standard stock/ETF options, custom spreads, account history, and competition standings. It connects to the hosted paper brokerage, which remains responsible for balances, internal pricing, execution, collateral, and scores. Account tools return stored cash, holdings, cost basis and fills; contract search returns metadata. They do not offer quotes or price previews. The competition tool returns stored standings, including scores. Internet access is required; this is not an offline trading simulator or a real-money brokerage.

```text
Local agent → local MCP process (stdio) → hosted paper brokerage (HTTPS)
                                           ├─ paper account and ledger
                                           ├─ market data and order execution
                                           └─ competition rules and standings
```

## Sign in and manage paper accounts

Requires Node.js **20.19 or newer** and npm. Version **0.3.0** adds browser-approved onboarding for an **existing KH account**. Use the pinned version below, or use source installation for development.

Configure your local MCP client:

```json
{
  "mcpServers": {
    "paper-trading": {
      "command": "npx",
      "args": ["-y", "@hkrds1996/paper-trading-mcp@0.3.0"]
    }
  }
}
```

1. Ask the agent to call `paper_sign_in`.
2. Open the returned KH link yourself, sign in to your existing website account, compare the confirmation code, and approve the request. If you sign in in another tab, return to the approval tab and click **Check sign-in again**. Never approve a request you did not start.
3. Ask the agent to call `paper_complete_sign_in`. Poll no more than once every five seconds; approval requests expire after ten minutes.
4. The agent can list competitions, create practice accounts, join competitions and trade on your owned paper accounts. Token management is available only if separately approved on the consent screen.

The approved management session lasts for the duration selected during browser approval (default **24 hours**, up to the backend-configured maximum), is held only in the local process memory, and needs new sign-in after a process restart. `paper_sign_out` revokes it. You can also revoke sessions from **Paper Trading → MCP access → Signed-in MCP sessions**. Revocation and expiry disable any child account tokens that session created. They do not cancel orders already accepted by the brokerage.

This browser approval protocol is specific to the local stdio bridge. It is not an advertised OAuth authorization server for arbitrary remote MCP clients. No login password, browser cookie, device secret, or management bearer token is exposed in tool results. The local bridge generates the management secret, sends only its hash during approval, and authenticates to the backend after approval.

## Tools for onboarding

| Tool | Access |
| --- | --- |
| `paper_sign_in`, `paper_complete_sign_in` | Local bridge, no initial account token needed |
| `paper_list_competitions` | Authenticated discovery using existing visibility rules |
| `paper_create_account` | Management session; practice account only; stable `requestId` required |
| `paper_join_competition` | Management session; one fixed-funded entry per user |
| `paper_create_token` | Separate token-management consent; owned account and read/trade scopes only |
| `paper_list_tokens`, `paper_revoke_token` | Separate token-management consent; own tokens only |
| `paper_sign_out` | Revoke the current management session and its delegated tokens |

Account creation reuses an existing result for the same `requestId` and rejects changed details. Repeated competition joins return the existing entry. Token creation never reissues an old secret: a repeated `requestId` returns metadata only. If a token response or local write was lost, revoke that token and create another with a new request ID.

`paper_create_token` saves the one-time child token in a private file under `~/.config/kh-paper-trading/tokens/` (or `PAPER_TRADING_CREDENTIAL_DIR`). Its tool result contains metadata and the file path, not the secret. Configure another local agent with `PAPER_TRADING_TOKEN_FILE`. Those child credentials expire with the approving session and cannot grant management permissions or issue other tokens. File-based handoff currently targets agents on the same machine.

Public competition creation remains restricted to admin website sessions; this MCP management grant does not delegate admin privileges or expose a competition-creation tool. New KH website registration is not included.

## Use an existing account token instead

For a permanently configured agent restricted to one account, add an `env` object to the server configuration:

```json
"env": { "PAPER_TRADING_TOKEN": "YOUR_PAPER_TRADING_TOKEN" }
```

Or set `PAPER_TRADING_TOKEN_FILE` to an absolute private token-file path. Set only one token source. POSIX token files must be owner-only (`chmod 600`); Windows uses account ACLs. Prefer your client's secret settings when available. A literal token in JSON is stored in that configuration file. Do not commit it. Existing account tokens keep their original restrictions and do not receive the onboarding tools.

Client templates: [Claude Desktop](examples/claude-desktop.json), [Cursor](examples/cursor.json), [VS Code](examples/vscode.json). Merge the entry into your existing configuration. GUI clients need `npx` on their PATH; Windows clients may require `npx.cmd`. No backend checkout, Theta Terminal installation, or market-data key is needed on an agent's computer.

## Configuration and checks

| Variable | Purpose |
| --- | --- |
| `PAPER_TRADING_TOKEN` | Optional existing account token; disables interactive onboarding |
| `PAPER_TRADING_TOKEN_FILE` | Optional absolute path to an existing account token; mutually exclusive with the above |
| `PAPER_TRADING_CREDENTIAL_DIR` | Optional absolute private directory for issued child token files |
| `PAPER_TRADING_MCP_URL` | Backend override; HTTPS or exact loopback HTTP only |
| `PAPER_TRADING_WEB_URL` | Browser UI origin for a self-hosted deployment; HTTPS or exact loopback HTTP only |
| `PAPER_TRADING_TIMEOUT_MS` | Request timeout, 1000–120000 ms; default 30000 |

With an account token already in the environment, `npx -y @hkrds1996/paper-trading-mcp@0.3.0 --check` checks read-only tool discovery. It does not verify provider entitlement or execute a trade. Without an account token, start normal MCP mode and use the sign-in tools.

See the [tool reference](docs/TOOLS.md) for existing stock, option, spread and account-record operations. This release adds onboarding; it does not add live quote or price-preview tools.

## What remains controlled by the brokerage

Every participant in a competition receives the same competition-defined starting deposit once. MCP cannot fund or reset an account, transfer balances, edit positions or purchase prices, or set scores. Account-token write tools place and cancel paper orders. Browser-approved management sessions can also provision accounts, join competitions and manage delegated tokens. Limits constrain acceptable prices; the server determines actual fills from market data.

New `portfolio-margin-v2` accounts support custom orders of up to 16 legs, including long/short standard options and spreads, subject to collateral and account rules. Existing `cash-long-v1` accounts retain their original restrictions. This package exposes the same rules as the dashboard; it does not remove backend limits. Index/futures options, adjusted contracts, and physical exercise/assignment are not supported.

The agent's tool arguments and the paper token are sent to the configured backend over HTTPS by default; stored account records, order outcomes, and option contract metadata go back to your agent client. The package does not store a second ledger or require any brokerage credentials locally. Simulated execution depends on the provider configuration of the backend you connect to. No quote or order-price-preview tools are exposed. Owner dashboards read separately persisted valuation snapshots and label their source and age; refreshing the dashboard does not request current prices.

## Troubleshooting

The backend shares request budgets across your tokens, accounts, REST calls and MCP calls. Orders, contract searches and account reads have separate budgets; cancellation has its own allowance. Larger spreads and contract pages consume more budget. When throttled, tool errors include `retryAfterSeconds` when the server supplies it. Wait that long and reduce parallel calls. The local bridge never automatically retries an order.

| Symptom | Check |
| --- | --- |
| Client cannot start the server | Check Node.js and npm are installed and `npx` is on the client’s PATH. Verify the pinned package version is published. Source installs require `npm ci` and an absolute entry-point path. |
| Missing token or conflicting credentials | Set exactly one token source. Do not leave an old `PAPER_TRADING_TOKEN` environment value alongside the file setting. |
| Token file rejected | Check the absolute path, file size, UTF-8 plain token content, and permissions. On macOS/Linux use `chmod 600`. |
| Authentication fails | Create a new token for the intended account, replace the configured token, and restart the client server. Do not share token values in logs or issue reports. |
| Reads work but trades fail | Confirm the token has trade permission and inspect `paper_get_trading_rules`; competition windows and collateral still apply. |
| Service returns `RATE_LIMITED` or HTTP `429` | Wait for the server’s retry interval. Reduce parallel calls and avoid tight polling loops. Reuse the same order ID when retrying an uncertain placement. |
| Orders unavailable | The backend operator must configure its market data provider. Local agents do not need provider keys. |
| Timeout after placing an order | Its outcome may be unknown. Read orders/fills before retrying, and reuse the same `clientOrderId` and order content. Never create a fresh order ID merely because a response was lost. |

## Install from source

This remains available independently of npm publication. Git is required.

```sh
git clone https://github.com/hkrds1996/paper-trading-mcp.git
cd paper-trading-mcp
npm ci
node bin/paper-trading-mcp.js --version
```

Use `command: "node"` and `args: ["/absolute/path/to/paper-trading-mcp/bin/paper-trading-mcp.js"]` in your MCP configuration, retaining the same token environment setting. Keep the checkout in place. This project needs no backend checkout or build step.

## Development

```sh
npm ci
npm test
```

This project implements the local transport and forwards the allowed paper tools to the backend. Changes to balances, execution, or competition accounting belong in the backend. See [architecture and operational behavior](docs/ARCHITECTURE.md).
