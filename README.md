# Paper Trading MCP

Connect a local AI agent to your KH paper trading account with a standard MCP `stdio` server. Your client launches a local Node.js process; configure a command and a paper token, without entering a hosted endpoint URL.

The package supports stock orders, standard stock/ETF options, custom spreads, account history, and competition standings. It connects to the hosted paper brokerage, which remains responsible for balances, quotes, execution, collateral, and scores. Internet access is required; this is not an offline trading simulator or a real-money brokerage.

```text
Local agent → local MCP process (stdio) → hosted paper brokerage (HTTPS)
                                           ├─ paper account and ledger
                                           ├─ market data and order execution
                                           └─ competition rules and standings
```

## Install from source

Requirements: Node.js **20.19 or newer**, npm, and Git. This repository is distributed from source; the package is not published to the npm registry. Access to the private GitHub repository is required.

```sh
git clone https://github.com/hkrds1996/paper-trading-mcp.git
cd paper-trading-mcp
npm ci
node bin/paper-trading-mcp.js --version
```

This project has its own dependencies and needs no checkout of the backend or frontend. There is no build step. Keep this directory in place: your MCP client will launch its entry point directly.

## Create an account token

1. Open the [paper trading dashboard](https://krh1996.com/#/paper-trading), create a practice account or join a competition, and open its MCP access screen.
2. Choose an account and either **Read only** or **Read portfolio & place paper orders**, then create an access token.
3. Save the token when it appears; the dashboard shows its value once. Store only the token itself in a private UTF-8 text file, such as `/Users/YOUR_USER/.config/paper-trading/token`. A trailing newline is accepted.

On macOS/Linux, give only your user access to that file:

```sh
chmod 600 /absolute/path/to/paper-trading-token
```

On Windows, restrict the file's security permissions to your account. Keep the file outside shared repositories. This local project uses the paper token only; users do not need Alpaca keys, database credentials, or backend source code.

## Configure your local agent

Replace all placeholder paths below with absolute paths on your computer. `command` must point to the Node.js executable; find it with `command -v node` on macOS/Linux or `where.exe node` on Windows. GUI clients may have a different `PATH` from your terminal.

For a client using the common `mcpServers` format:

```json
{
  "mcpServers": {
    "paper-trading": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/paper-trading-mcp/bin/paper-trading-mcp.js"],
      "env": {
        "PAPER_TRADING_TOKEN_FILE": "/absolute/path/to/paper-trading-token"
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

Before configuring a client, you can verify credentials and tool discovery. On macOS/Linux:

```sh
PAPER_TRADING_TOKEN_FILE=/absolute/path/to/paper-trading-token \
  node /absolute/path/to/paper-trading-mcp/bin/paper-trading-mcp.js --check
```

PowerShell:

```powershell
$env:PAPER_TRADING_TOKEN_FILE = 'C:/Users/YOUR_USER/.config/paper-trading/token'
node 'C:/Users/YOUR_USER/projects/paper-trading-mcp/bin/paper-trading-mcp.js' --check
```

A successful check prints JSON with `ok: true`, `mode: "paper"`, and the number of available tools. This check only discovers tools; it does not place orders or prove that market data is configured. Normal server mode reserves stdout for MCP messages and sends diagnostics to stderr.

Then ask your agent:

> List my paper account, read its trading rules, and show its positions and buying power. Do not place an order.

See the [tool reference and order examples](docs/TOOLS.md) for stock orders, multi-leg orders, pagination, and retry handling.

## Configuration

| Environment variable | Purpose |
| --- | --- |
| `PAPER_TRADING_TOKEN_FILE` | Preferred: absolute path to a private file containing one paper token. File must be regular, at most 8 KiB, with no group/other access on POSIX systems. |
| `PAPER_TRADING_TOKEN` | Alternative: token supplied through your client's secret/environment facility. Do not set this together with `PAPER_TRADING_TOKEN_FILE`. |
| `PAPER_TRADING_MCP_URL` | Optional override for a development or separately hosted paper backend. Normal users can omit it. Accepts HTTPS, or HTTP on an exact loopback host only. Credentials, query parameters, and fragments are rejected. |
| `PAPER_TRADING_TIMEOUT_MS` | Optional request timeout, from 1,000 to 120,000 milliseconds. Default: 30,000. |

`--help` describes the command line; `--version` prints the package version. The token is loaded at startup, so restart your MCP server after changing it. To stop an agent's access, select **Revoke** for its connection in the dashboard. Revocation invalidates subsequent authenticated requests; it does not cancel orders already accepted by the brokerage.

## What remains controlled by the brokerage

Every participant in a competition receives the same competition-defined starting deposit once. MCP cannot fund or reset an account, transfer balances, edit positions or purchase prices, or set scores. The only write tools place and cancel paper orders. Limits constrain acceptable prices; the server determines actual fills from market data.

New `portfolio-margin-v2` accounts support custom orders of up to 16 legs, including long/short standard options and spreads, subject to collateral and account rules. Existing `cash-long-v1` accounts retain their original restrictions. This package exposes the same rules as the dashboard; it does not remove backend limits. Index/futures options, adjusted contracts, and physical exercise/assignment are not supported.

The agent's tool arguments and the paper token are sent to the configured backend over HTTPS by default; returned account and market data go back to your agent client. The package does not store a second ledger or require any brokerage credentials locally. Market quotes and simulated execution depend on the provider configuration of the backend you connect to.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Client cannot start the server | Run the configured Node executable with `--version`; verify the entry point is an absolute path and `npm ci` completed. |
| Missing token or conflicting credentials | Set exactly one token source. Do not leave an old `PAPER_TRADING_TOKEN` environment value alongside the file setting. |
| Token file rejected | Check the absolute path, file size, UTF-8 plain token content, and permissions. On macOS/Linux use `chmod 600`. |
| Authentication fails | Create a new token for the intended account, replace the file, and restart the client server. Do not share token values in logs or issue reports. |
| Reads work but trades fail | Confirm the token has trade permission and inspect `paper_get_trading_rules`; competition windows and collateral still apply. |
| Quotes or orders unavailable | The backend operator must configure its market data provider. Local agents do not need provider keys. |
| Timeout after placing an order | Its outcome may be unknown. Read orders/fills before retrying, and reuse the same `clientOrderId` and order content. Never create a fresh order ID merely because a response was lost. |

## Development

```sh
npm ci
npm test
```

This project implements the local transport and forwards the allowed paper tools to the backend. Changes to balances, execution, or competition accounting belong in the backend. See [architecture and operational behavior](docs/ARCHITECTURE.md).
