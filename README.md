# Paper Trading MCP

Connect a local AI agent to your KH paper trading account with a standard MCP `stdio` server. Your client launches a local Node.js process; configure a command and a paper token, without entering a hosted endpoint URL.

The package supports stock orders, standard stock/ETF options, custom spreads, account history, and competition standings. It connects to the hosted paper brokerage, which remains responsible for balances, internal pricing, execution, collateral, and scores. Account tools return stored cash, holdings, cost basis and fills; contract search returns metadata. They do not offer quotes or price previews. The competition tool returns stored standings, including scores. Internet access is required; this is not an offline trading simulator or a real-money brokerage.

```text
Local agent → local MCP process (stdio) → hosted paper brokerage (HTTPS)
                                           ├─ paper account and ledger
                                           ├─ market data and order execution
                                           └─ competition rules and standings
```

## Quick setup with npm

Requirements: Node.js **20.19 or newer** and npm on the machine running your MCP client.

Published package: [`@hkrds1996/paper-trading-mcp`](https://www.npmjs.com/package/@hkrds1996/paper-trading-mcp), version **0.2.1**. [Source installation](#install-from-source) is also available. A newly published version may take a few minutes to become available through the registry.

The client runs `npx -y @hkrds1996/paper-trading-mcp@0.2.1`. npm downloads the package when needed and launches it; no repository checkout, absolute script path, or separate running terminal is required. The version is pinned so updates are deliberate. Installing the package does not create an account or issue a token.

## Create an account token

1. Open the [paper trading dashboard](https://krh1996.com/#/paper-trading), create a practice account or join a competition, and open its MCP access screen.
2. Choose an account and either **Read only** or **Read account records & place paper orders**, then create an access token.
3. Save the token when it appears; the dashboard shows its value once. Supply it as `PAPER_TRADING_TOKEN` through your client’s secret/environment settings or the configuration below. A literal token in JSON is stored in that configuration file; keep it out of shared repositories.

A token file is optional. If you prefer one, store only the token in a private UTF-8 file and use `PAPER_TRADING_TOKEN_FILE` instead. A trailing newline is accepted; the filename does not need a `.txt` extension.

On macOS/Linux, give only your user access to that file:

```sh
chmod 600 /absolute/path/to/paper-trading-token
```

On Windows, restrict the file's security permissions to your account. Keep the file outside shared repositories. This local project uses the paper token only; users do not need market-data provider keys, database credentials, or backend source code.

## Configure your local agent

Replace `YOUR_PAPER_TRADING_TOKEN` with your account token, or use your client’s secret-input mechanism. `npx` must be available to the client; GUI clients may have a different `PATH` from your terminal. On Windows, clients may require `npx.cmd`. Tokens are never passed in `args`.

For a client using the common `mcpServers` format:

```json
{
  "mcpServers": {
    "paper-trading": {
      "command": "npx",
      "args": ["-y", "@hkrds1996/paper-trading-mcp@0.2.1"],
      "env": {
        "PAPER_TRADING_TOKEN": "YOUR_PAPER_TRADING_TOKEN"
      }
    }
  }
}
```

Merge this server entry into your existing configuration. Restart the server from your client after saving. Client-specific templates are included:

| Client | Template | Where to configure it |
| --- | --- | --- |
| Claude Desktop | [claude-desktop.json](examples/claude-desktop.json) | Settings → Developer → Edit Config; restart Claude Desktop. See the [official local MCP guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers). |
| Cursor | [cursor.json](examples/cursor.json) | Personal `~/.cursor/mcp.json`, or workspace `.cursor/mcp.json`. See [Cursor's MCP configuration](https://cursor.com/docs/mcp). |
| VS Code | [vscode.json](examples/vscode.json) | Run **MCP: Open User Configuration**, or use workspace `.vscode/mcp.json`. Its root key is `servers`. See the [official VS Code guide](https://code.visualstudio.com/docs/agent-customization/mcp-servers). |

For Windows JSON paths, use forward slashes (`C:/Users/YOUR_USER/...`) or escaped backslashes (`C:\\Users\\YOUR_USER\\...`). The token file path must be absolute; `~` is not expanded by this package.

Your client starts the process and communicates over standard input/output. You do not need to run a local web server, open a port, or leave a separate terminal running.

## Check the connection

With `PAPER_TRADING_TOKEN` or `PAPER_TRADING_TOKEN_FILE` already supplied in your environment, run:

```sh
npx -y @hkrds1996/paper-trading-mcp@0.2.1 --check
```

For source installation, use `node bin/paper-trading-mcp.js --check` from the checkout instead.

A successful check prints JSON with `ok: true`, `mode: "paper"`, and the number of available tools. This check only discovers tools; it does not place orders or prove that market data is configured. Normal server mode reserves stdout for MCP messages and sends diagnostics to stderr.

Then ask your agent:

> List my paper account, read its trading rules, and show its cash, position quantities, cost basis, orders, and recorded fills. Do not place an order.

See the [tool reference and order examples](docs/TOOLS.md) for stock orders, multi-leg orders, pagination, and retry handling.

## Configuration

| Environment variable | Purpose |
| --- | --- |
| `PAPER_TRADING_TOKEN_FILE` | Optional: absolute path to a private file containing one paper token. File must be regular, at most 8 KiB, with no group/other access on POSIX systems. |
| `PAPER_TRADING_TOKEN` | Token supplied through your client's secret/environment facility. Do not set this together with `PAPER_TRADING_TOKEN_FILE`. |
| `PAPER_TRADING_MCP_URL` | Optional override for a development or separately hosted paper backend. Normal users can omit it. Accepts HTTPS, or HTTP on an exact loopback host only. Credentials, query parameters, and fragments are rejected. |
| `PAPER_TRADING_TIMEOUT_MS` | Optional request timeout, from 1,000 to 120,000 milliseconds. Default: 30,000. |

`--help` describes the command line; `--version` prints the package version. The token is loaded at startup, so restart your MCP server after changing it. To stop an agent's access, select **Revoke** for its connection in the dashboard. Revocation invalidates subsequent authenticated requests; it does not cancel orders already accepted by the brokerage.

## What remains controlled by the brokerage

Every participant in a competition receives the same competition-defined starting deposit once. MCP cannot fund or reset an account, transfer balances, edit positions or purchase prices, or set scores. The only write tools place and cancel paper orders. Limits constrain acceptable prices; the server determines actual fills from market data.

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
