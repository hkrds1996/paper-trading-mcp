# Paper tools and order flow

The local server exposes the hosted paper broker's 11 allowed tools. Input schemas come from the backend and reject unknown fields. An account token can only access its assigned account. A read-only token can discover tools but cannot place or cancel orders.

| Tool | Purpose |
| --- | --- |
| `paper_list_accounts` | Find the account accessible to this token. |
| `paper_get_account` | Read stored cash, position quantities, cost basis, orders, and immutable fills. |
| `paper_list_positions` | Read held quantities and recorded cost basis, without market valuations. |
| `paper_list_orders` | Read recent order statuses. |
| `paper_list_fills` | Read recent server-recorded executions. |
| `paper_get_trading_rules` | Read account version, locked funding, trading window, allowed actions, and execution rules. |
| `paper_get_option_chain` | Read metadata for an initial page of up to 200 standard option contracts; no bid/ask or last prices. |
| `paper_get_option_chain_page` | Search contract metadata by expiration dates and calls/puts, with additional pages; no price data. |
| `paper_place_order` | Submit a server-priced paper order with an idempotent `clientOrderId`. |
| `paper_cancel_order` | Cancel an open paper order. |
| `paper_get_competition` | Read the account's competition and standings under the backend access policy. |

There are no quote or price-preview tools. Account records omit equity, market prices/values, and profit-and-loss fields. Option-chain responses contain instrument metadata only; immutable fill prices remain visible as execution records.

Tool results use MCP content blocks. Paper responses generally contain JSON text with `success`, `mode: "paper"`, and `data`; failures return `isError: true`. Clients should inspect error results as well as transport failures.

## Start by reading the account

Call `paper_list_accounts` with `{}`, then use the returned ID:

```json
{
  "accountId": "YOUR_ACCOUNT_ID"
}
```

Pass that object to `paper_get_trading_rules` and `paper_get_account`. A new `portfolio-margin-v2` account supports custom stock/option orders and collateral checks; old `cash-long-v1` accounts retain the original long-only rules. Read the trading window before attempting competition trades.

## Stock order

These are illustrative arguments for `paper_place_order`. The limit is supplied by your strategy; it is not an execution-price estimate:

```json
{
  "accountId": "YOUR_ACCOUNT_ID",
  "symbol": "AAPL",
  "assetClass": "stock",
  "side": "buy",
  "quantity": 1,
  "type": "limit",
  "limitPrice": 150,
  "clientOrderId": "agent_order_20260914_001"
}
```

Choose and persist a unique `clientOrderId` for each intended order. A buy limit is the maximum acceptable per-share price; it is not the price the server must record. A market order omits `limitPrice`.

The server validates internal execution data, market hours, collateral, and competition rules when processing the order. There is no market-price or collateral preview API. Read accepted order status and recorded fills to learn the outcome; do not treat a local structural review as an eligibility or price guarantee.

## Option chains and custom spreads

Discover actual contracts before building an order. For example, call `paper_get_option_chain_page` with:

```json
{
  "underlying": "AAPL",
  "expirationFrom": "2027-01-01",
  "expirationTo": "2027-03-31",
  "optionType": "call",
  "limit": 100
}
```

If the response includes `nextPageToken`, pass its value as `pageToken` on the next call while keeping the same filters. Use contract symbols returned by the provider; do not assume a contract exists from its symbol format.

Submit a two-leg order using this shape after replacing symbol placeholders with discovered contracts and assigning a stable client order ID:

```json
{
  "accountId": "YOUR_ACCOUNT_ID",
  "legs": [
    {
      "symbol": "DISCOVERED_LONG_CALL_SYMBOL",
      "assetClass": "option",
      "side": "buy",
      "quantity": 1,
      "positionIntent": "open"
    },
    {
      "symbol": "DISCOVERED_SHORT_CALL_SYMBOL",
      "assetClass": "option",
      "side": "sell",
      "quantity": 1,
      "positionIntent": "open"
    }
  ],
  "type": "limit",
  "netLimit": 250,
  "clientOrderId": "agent_spread_20260914_001"
}
```

`netLimit` is the **total signed USD amount for every leg and quantity, including contract multipliers**. `250` allows a maximum total debit of $250. `-250` requires a minimum total credit of $250. This is not a per-contract or per-share quote, and it cannot override actual execution prices. The normal standard option multiplier is 100. Preserve `clientOrderId` and identical order arguments when reconciling an uncertain submission.

Custom orders may have up to 16 unique instruments. Option legs require `positionIntent: "open"` or `"close"`; quantities are positive whole numbers and `side` gives the trade direction. Use `legs` and `netLimit` for a combination, or the single-leg fields and `limitPrice` for a single instrument, without mixing both shapes. Market combinations omit `netLimit`.

The engine fills all legs together or leaves the order unfilled. Server collateral rules apply to long and short positions. Cash settlement is simulated; physical exercise/assignment, adjusted contracts, and index/futures options are outside the current contract coverage.

## Handle uncertain outcomes and concurrency

Give each intended order a stable `clientOrderId` of 8–100 characters, using letters, numbers, underscores, or hyphens. Persist it before submitting. Reuse that ID and identical order content when retrying the same intent; a genuinely new intended trade needs a different ID.

A timeout or client disconnection can happen after the brokerage accepts an order. Cancellation of the local request does not mean the trade was canceled. Read `paper_list_orders`, `paper_list_fills`, or `paper_get_account` to reconcile the result before retrying. The local process does not automatically resubmit trades.

Multiple agents can use tokens for the same account, so saved account records may change before a later order is processed. The backend's account checks determine whether the submitted order can proceed. Maintain separate client order IDs for distinct intents and inspect order status after submitting.

An accepted cancellation may lose a race with execution. Read the final order and fills; do not infer that an order was canceled merely because a cancel request was sent.
