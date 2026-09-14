import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { VERSION } from './config.js';

export const PAPER_TOOLS = new Set([
  'paper_list_accounts', 'paper_get_account', 'paper_list_positions', 'paper_list_orders',
  'paper_list_fills', 'paper_get_trading_rules', 'paper_get_quotes', 'paper_get_option_chain',
  'paper_get_option_chain_page', 'paper_preview_order', 'paper_place_order', 'paper_cancel_order',
  'paper_get_competition',
]);

class PublicBridgeError extends McpError {
  constructor(failure) {
    super(ErrorCode.InternalError, `${failure.code}: ${failure.message}`);
    this.failure = failure;
  }
}

export function safeFailure(error, { mutation = false, cancelled = false } = {}) {
  if (error instanceof PublicBridgeError) return error.failure;
  const status = Number(error?.code);
  let code = 'UPSTREAM_UNAVAILABLE';
  let message = 'The paper trading service could not complete the connection. Check connectivity and PAPER_TRADING_MCP_URL, then try a new request.';
  if (status === 401) { code = 'AUTHENTICATION_FAILED'; message = 'The paper trading token was rejected or revoked. Create a new account token, update its secret, and restart this MCP server.'; }
  else if (status === 403) { code = 'ACCESS_DENIED'; message = 'The paper trading service denied access. Check this token’s account and read/trade permissions.'; }
  else if (status === 429) { code = 'RATE_LIMITED'; message = 'The paper trading service is busy. Wait before making another request.'; }
  else if (cancelled || error?.name === 'AbortError') { code = 'REQUEST_CANCELLED'; message = 'The request was cancelled.'; }
  else if (error?.name === 'TimeoutError' || status === ErrorCode.RequestTimeout) { code = 'REQUEST_TIMEOUT'; message = 'The paper trading request timed out. Check connectivity or increase PAPER_TRADING_TIMEOUT_MS.'; }
  else if (status === ErrorCode.InvalidParams) { code = 'INVALID_REQUEST'; message = 'The paper trading service rejected the request parameters. Read the tool schema and account trading rules.'; }
  if (mutation) message += ' The execution outcome may be unknown; no automatic retry was made. Read the account’s orders before retrying. For placement, reuse the same clientOrderId and arguments.';
  return { code, message };
}

/** Local transport only: execution, prices, risk, balances and scores remain hosted. */
export function createBridge(config) {
  let current;
  let connecting;
  let closed = false;
  const connections = new Set();
  const server = new Server({ name: 'kh-paper-trading-local', version: VERSION }, {
    capabilities: { tools: {} },
    instructions: 'This is a paper brokerage. Read paper_get_trading_rules before trading. The hosted server owns fills, collateral, cash and competition scores. Never invent execution prices. Submit a stable clientOrderId; if the connection fails, inspect orders and reuse that ID and the same arguments. This bridge never retries an order automatically.',
  });

  async function discard(entry) {
    entry.invalid = true;
    if (current === entry) current = undefined;
    if (entry.pending === 0) { connections.delete(entry); await entry.client.close().catch(() => {}); }
  }

  function getConnection() {
    if (closed) return Promise.reject(new Error('closed'));
    if (current && !current.invalid) return Promise.resolve(current);
    if (connecting) return connecting;
    const client = new Client({ name: 'kh-paper-trading-local', version: VERSION }, { capabilities: {} });
    const entry = { client, pending: 0, invalid: false };
    const transport = new StreamableHTTPClientTransport(config.endpoint, {
      requestInit: { headers: { Authorization: `Bearer ${config.token}` }, redirect: 'error', cache: 'no-store' },
      // Retries/resumption must never replay an ambiguous order submission.
      reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
      fetch: (url, init = {}) => fetch(url, {
        ...init, redirect: 'error', cache: 'no-store',
        signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(config.timeoutMs)]),
      }),
    });
    client.onerror = () => {}; // SDK errors may contain upstream bodies or credentials.
    client.onclose = () => { entry.invalid = true; if (current === entry) current = undefined; };
    connections.add(entry);
    const attempt = client.connect(transport, { timeout: config.timeoutMs }).then(() => {
      if (closed) throw new Error('closed');
      current = entry;
      return entry;
    }).catch(async error => { await discard(entry); throw error; });
    connecting = attempt;
    void attempt.finally(() => { if (connecting === attempt) connecting = undefined; }).catch(() => {});
    return attempt;
  }

  async function run(operation, signal) {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const combined = controller.signal;
    // SDK 1.29 retains its abort listener after a request succeeds. Clear our timer
    // and detach caller cancellation on completion so no completed trade receives
    // a later, spurious cancellation notification.
    const timeout = setTimeout(() => controller.abort(new DOMException('Request deadline exceeded.', 'TimeoutError')), config.timeoutMs);
    const onCancel = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', onCancel, { once: true });
    // A caller cancelling does not tear down another caller’s shared initialization.
    let onAbort;
    const interrupted = new Promise((_, reject) => {
      onAbort = () => reject(combined.reason);
      combined.addEventListener('abort', onAbort, { once: true });
    });
    let entry;
    try {
      entry = await Promise.race([getConnection(), interrupted]);
      combined.throwIfAborted();
      entry.pending++;
      try { return await operation(entry.client, { signal: combined, timeout: config.timeoutMs }); }
      catch (error) {
        // Abandon this connection for future calls. In-flight siblings complete separately.
        if (!combined.aborted) await discard(entry);
        throw error;
      } finally { entry.pending--; if (entry.invalid) await discard(entry); }
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onCancel);
      combined.removeEventListener('abort', onAbort);
    }
  }

  async function listTools(params = {}, signal) {
    try {
      const result = await run((client, options) => client.listTools(params, options), signal);
      return { ...result, tools: result.tools.filter(tool => PAPER_TOOLS.has(tool.name)) };
    } catch (error) {
      const safe = safeFailure(error, { cancelled: signal?.aborted });
      throw new PublicBridgeError(safe);
    }
  }

  server.setRequestHandler(ListToolsRequestSchema, (request, extra) => listTools(request.params, extra.signal));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name } = request.params;
    if (!PAPER_TOOLS.has(name)) return { isError: true, content: [{ type: 'text', text: JSON.stringify({ success: false, code: 'UNKNOWN_TOOL', error: 'This local server only exposes paper trading tools.' }) }] };
    try {
      // Preserve arguments, nested legs, idempotency keys, result metadata and isError.
      return await run((client, options) => client.callTool(request.params, undefined, options), extra.signal);
    } catch (error) {
      const safe = safeFailure(error, { mutation: name === 'paper_place_order' || name === 'paper_cancel_order', cancelled: extra.signal.aborted });
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ success: false, code: safe.code, error: safe.message }) }] };
    }
  });

  return {
    server,
    listTools,
    async start() { await server.connect(new StdioServerTransport()); },
    async close() {
      if (closed) return;
      closed = true;
      current = undefined;
      await Promise.allSettled([...connections].map(entry => entry.client.close()));
      connections.clear();
      await server.close().catch(() => {});
    },
  };
}
