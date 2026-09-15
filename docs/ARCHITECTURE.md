# Architecture and operations

`@hkrds1996/paper-trading-mcp` is a separately installable Node.js project. It is an MCP server for the local agent and an authenticated MCP client for the paper brokerage. The default service is built into the package, so client configuration consists of a local command and a token source.

## Boundaries

| Component | Responsibility |
| --- | --- |
| Local agent client | Launches the process, chooses tool calls, and applies its own tool permissions. |
| Local package | Handles MCP over stdio, loads one account token, discovers allowed paper tool schemas, and forwards calls to the backend. |
| Hosted brokerage | Authenticates every request, checks account scope, sources market data, executes simulated orders, and owns accounting and competition rules. |

The account-record interface returns stored cash, position quantities, cost basis, orders, and immutable fills. Option-chain tools return contract metadata only. Account tools do not expose current market marks or P&L. The competition tool returns stored standings and scores. The owner dashboard uses separately persisted valuation snapshots with source and age labels.

The bridge allows only the 11 named paper tools listed in [TOOLS.md](TOOLS.md). It does not expose arbitrary HTTP requests or add tools to fund accounts, reset deposits, or edit prices. Read-only and trade permissions are enforced on the server even if a client ignores tool annotations.

Equal competition funding must stay with the shared brokerage: every entrant gets its competition's fixed starting capital once, and the same server records all fills and scores. Running the transport locally does not make the local machine authoritative for accounting.

## Credentials and network

Use an account-scoped paper token. The token is loaded once when the process starts, either from `PAPER_TRADING_TOKEN_FILE` or `PAPER_TRADING_TOKEN`, with both together rejected. File mode checks on POSIX systems prevent a token file readable by other users; Windows file access is controlled by the user's ACLs. A replacement token takes effect after restarting the process.

The default upstream connection uses HTTPS. `PAPER_TRADING_MCP_URL` is an operator/development override, intended for an alternate deployment of the same paper service. It accepts HTTPS or loopback HTTP and rejects embedded credentials, query strings, and URL fragments. Point it only to a service you intend to receive the token and account requests.

No market-data provider, model-provider, database, or real brokerage keys are required by this package. The backend operator configures the market data provider. Tool discovery can succeed while execution remains unavailable due to missing provider configuration.

## Process behavior

The client owns the child process and exchanges MCP messages through its stdin/stdout. Normal diagnostics use stderr so that logs do not corrupt the protocol stream. There is no listening port, background daemon, or local database to manage.

`--check` is a separate read-only diagnostic mode that authenticates and lists the available tools, prints a JSON success summary, and exits. It does not place an order, fetch every account, or validate the provider's current quotes.

The request timeout is configurable with `PAPER_TRADING_TIMEOUT_MS`. A local timeout is not a rollback on the remote brokerage. The bridge does not retry writes automatically: callers must preserve `clientOrderId` and reconcile unknown outcomes as described in [TOOLS.md](TOOLS.md).

Token revocation rejects later authenticated requests. Orders that the backend already accepted continue according to the brokerage's order rules; revoking a token does not cancel them.

The backend applies shared per-user operation budgets to REST and MCP, plus bounded admission and concurrency limits. A new token or local process does not reset the user's budget. HTTP 429 responses become redacted MCP errors; a valid `Retry-After` header is preserved as `retryAfterSeconds` and in the message. The caller decides whether and when to retry. Cancellation has a separate backend budget and operation pool, so exhausting order capacity does not consume the cancellation allowance.

## Distribution

The package can run through a version-pinned `npx` command after npm publication, or from its source repository with `npm ci`. The bin entry launches `bin/paper-trading-mcp.js`. No backend checkout or build step is needed. Installing the package does not provision user credentials.

The source repository is public. npm release status is recorded in the README; prepared installation examples do not imply publication has completed. See PUBLISHING.md for the release procedure.

## Browser-approved onboarding (0.3.0)

Without an account token, the bridge exposes sign-in tools and uses the backend's dedicated browser approval flow. This is a local stdio onboarding protocol, not the MCP HTTP OAuth standard. The human logs in using an existing KH browser session. The bridge generates a random management credential and sends its SHA-256 hash in a short-lived approval request. The browser receives only a confirmation code; the polling secret stays local. Approval binds the hash to the authenticated user for 24 hours. Optional token management requires separate consent.

Management grants are memory-only in the local process, database-checked for expiry/revocation on every backend call, restricted to the MCP endpoint, and never carry admin authority. Child account tokens are saved in owner-only local files and remain dependent on the parent grant. No user signup, refresh-token flow, or long-lived management credential storage is implemented. Existing account-token authentication stays supported.
