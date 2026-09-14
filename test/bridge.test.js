import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { loadConfiguration, parseEndpoint } from '../src/config.js';
import { PAPER_TOOLS } from '../src/bridge.js';

const BIN = fileURLToPath(new URL('../bin/paper-trading-mcp.js', import.meta.url));
const TOKEN = `paper_${'x'.repeat(43)}`;
const orderSchema = {
  type: 'object', additionalProperties: false, required: ['accountId', 'type', 'clientOrderId'],
  properties: {
    accountId: { type: 'string' }, type: { type: 'string', enum: ['market', 'limit'] },
    clientOrderId: { type: 'string', minLength: 8 }, netLimit: { type: 'number' },
    legs: { type: 'array', minItems: 1, maxItems: 16, items: {
      type: 'object', additionalProperties: false, required: ['symbol', 'assetClass', 'side', 'quantity', 'positionIntent'],
      properties: { symbol: { type: 'string' }, assetClass: { enum: ['stock', 'option'] }, side: { enum: ['buy', 'sell'] }, quantity: { type: 'integer' }, positionIntent: { enum: ['open', 'close'] } },
    } },
  },
};
const combo = {
  accountId: 'account-a', type: 'limit', clientOrderId: 'stable-id-123', netLimit: -150,
  legs: [
    { symbol: 'AAPL261218C00200000', assetClass: 'option', side: 'sell', quantity: 1, positionIntent: 'open' },
    { symbol: 'AAPL261218C00210000', assetClass: 'option', side: 'buy', quantity: 1, positionIntent: 'open' },
  ],
};

async function upstream(t) {
  const state = { requests: [], calls: [], mode: 'healthy', redirects: 0 };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body;
    try { body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined; } catch { res.writeHead(400).end(); return; }
    state.requests.push({ method: req.method, body, authorization: req.headers.authorization });
    if (req.url === '/redirect-target') { state.redirects++; res.writeHead(500).end('must not reach'); return; }
    if (state.mode === 'redirect') { res.writeHead(307, { Location: `${state.url}/../redirect-target` }).end(); return; }
    if (state.mode === '401' || state.mode === '403') { res.writeHead(Number(state.mode), { 'Content-Type': 'text/plain' }).end(`secret upstream detail ${TOKEN}`); return; }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401).end('bad token'); return; }
    if (req.method === 'GET') { res.writeHead(405).end(); return; }
    if (body?.method === 'tools/call') {
      state.calls.push(body.params);
      if (state.mode === 'disconnect') { req.socket.destroy(); return; }
      if (state.mode === 'timeout') return;
      if (state.mode === '404') { res.writeHead(404).end(`session lost ${TOKEN}`); return; }
    }
    const sdk = new Server({ name: 'fixture-paper', version: '1.0.0' }, { capabilities: { tools: {} } });
    sdk.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [...PAPER_TOOLS, 'admin_reset_balance', 'paper_get_quotes', 'paper_preview_order'].map(name => ({ name, description: state.mode === 'large' && name === 'paper_list_accounts' ? 'x'.repeat(4 * 1024 * 1024) : name, inputSchema: name === 'paper_place_order' ? orderSchema : { type: 'object', additionalProperties: false, properties: {} }, annotations: { readOnlyHint: name !== 'paper_place_order', idempotentHint: true } })),
      _meta: { source: 'fixture' },
    }));
    sdk.setRequestHandler(CallToolRequestSchema, async request => {
      if (state.mode === 'concurrent') await new Promise(resolve => setTimeout(resolve, request.params.arguments?.index === 1 ? 50 : 5));
      return {
        content: [{ type: 'text', text: JSON.stringify({ mode: 'paper', data: request.params.arguments }) }],
        structuredContent: { echoed: request.params.arguments || {}, mode: 'paper' },
        _meta: { source: 'fixture', trace: 'safe-trace' },
        ...(request.params.arguments?.domainFailure ? { isError: true } : {}),
      };
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.once('close', () => { void sdk.close(); });
    await sdk.connect(transport);
    try { await transport.handleRequest(req, res, body); } catch { if (!res.headersSent) res.writeHead(500).end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  state.url = `http://127.0.0.1:${server.address().port}/api/paper/mcp`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return state;
}

async function local(t, fixture, env = {}) {
  const client = new Client({ name: 'test-local-agent', version: '1.0.0' }, { capabilities: {} });
  const transport = new StdioClientTransport({ command: process.execPath, args: [BIN], env: { PAPER_TRADING_TOKEN: TOKEN, PAPER_TRADING_MCP_URL: fixture.url, ...env }, stderr: 'pipe' });
  let stderr = '';
  transport.stderr.on('data', chunk => { stderr += chunk.toString(); });
  const protocolErrors = [];
  client.onerror = error => { protocolErrors.push(error); };
  await client.connect(transport);
  t.after(async () => { await client.close(); assert.ok(!stderr.includes(TOKEN), 'token must not appear on stderr'); });
  return { client, transport, stderr: () => stderr, protocolErrors };
}

async function rawCLI(args = [], env = {}, input = undefined) {
  const child = spawn(process.execPath, [BIN, ...args], { env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  if (input !== undefined) child.stdin.end(input); else child.stdin.end();
  const [code, signal] = await once(child, 'exit');
  return { code, signal, stdout, stderr };
}

test('configuration rejects ambiguous credentials, invalid tokens and unsafe endpoints without echoing secrets', async () => {
  for (const url of ['http://api.krh1996.com/api/paper/mcp', 'https://user:secret@api.krh1996.com/mcp', 'https://api.krh1996.com/mcp?token=secret', 'https://api.krh1996.com/mcp#secret', 'file:///tmp/mcp', 'http://localhost.evil.example/mcp']) assert.throws(() => parseEndpoint(url));
  for (const url of ['https://api.krh1996.com/api/paper/mcp', 'https://selfhost.example/mcp', 'http://127.0.0.1:5000/mcp', 'http://localhost:5000/mcp', 'http://[::1]:5000/mcp']) assert.equal(parseEndpoint(url).href, url);
  await assert.rejects(loadConfiguration({ PAPER_TRADING_TOKEN: TOKEN, PAPER_TRADING_TOKEN_FILE: '/tmp/ignored' }), /only one/);
  await assert.rejects(loadConfiguration({ PAPER_TRADING_TOKEN: 'not-a-secret-token' }), /format/);
  for (const timeout of ['0', '999', '120001', '1000.5', '1e4', 'abc']) await assert.rejects(loadConfiguration({ PAPER_TRADING_TOKEN: TOKEN, PAPER_TRADING_TIMEOUT_MS: timeout }), /1000/);
  assert.equal((await loadConfiguration({ PAPER_TRADING_TOKEN: TOKEN })).timeoutMs, 30000);
  const missing = await rawCLI();
  assert.equal(missing.code, 1); assert.equal(missing.stdout, ''); assert.match(missing.stderr, /PAPER_TRADING_TOKEN_FILE/);
  const unknown = await rawCLI(['--token', TOKEN]);
  assert.equal(unknown.code, 1); assert.ok(!unknown.stderr.includes(TOKEN));
});

test('local initialization works while upstream is offline and stdout remains MCP only', async t => {
  const { client, protocolErrors } = await local(t, { url: 'http://127.0.0.1:1/mcp' });
  assert.equal(client.getServerVersion().name, 'kh-paper-trading-local');
  await assert.rejects(client.listTools(), /UPSTREAM_UNAVAILABLE/);
  assert.deepEqual(protocolErrors, []);
});

test('discovers only 11 execution/account-record tools and preserves strict nested schemas, annotations and metadata', async t => {
  const fixture = await upstream(t); const { client } = await local(t, fixture);
  assert.equal(fixture.requests.length, 0, 'local initialization must not contact upstream');
  const result = await client.listTools();
  assert.equal(result.tools.length, 11);
  assert.deepEqual(result.tools.find(tool => tool.name === 'paper_place_order').inputSchema, orderSchema);
  assert.deepEqual(result.tools.find(tool => tool.name === 'paper_place_order').annotations, { readOnlyHint: false, idempotentHint: true });
  assert.deepEqual(result._meta, { source: 'fixture' });
  assert.ok(fixture.requests.every(req => req.authorization === `Bearer ${TOKEN}`));
  for (const name of ['admin_reset_balance','paper_get_quotes','paper_preview_order']) {
    const denied = await client.callTool({ name, arguments: {} });
    assert.equal(denied.isError, true);
    assert.match(denied.content[0].text, /UNKNOWN_TOOL/);
  }
  assert.equal(fixture.calls.length, 0);
});

test('custom multi-leg orders preserve exact fields, stable IDs, results and domain errors', async t => {
  const fixture = await upstream(t); const { client } = await local(t, fixture);
  for (const name of ['paper_place_order']) {
    const result = await client.callTool({ name, arguments: combo, _meta: { correlation: 'a' } });
    assert.deepEqual(result.structuredContent, { mode: 'paper', echoed: combo });
    assert.deepEqual(result._meta, { source: 'fixture', trace: 'safe-trace' });
    assert.deepEqual(fixture.calls.at(-1), { name, arguments: combo, _meta: { correlation: 'a' } });
  }
  const result = await client.callTool({ name: 'paper_get_account', arguments: { domainFailure: true } });
  assert.equal(result.isError, true); assert.equal(result.structuredContent.echoed.domainFailure, true);
});

test('token file authentication handles private files, missing files and oversized files', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'paper-mcp-test-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const tokenFile = join(dir, 'account.token'); await writeFile(tokenFile, `${TOKEN}\n`, { mode: 0o600 });
  const fixture = await upstream(t);
  const client = new Client({ name: 'file-token-client', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [BIN], env: { PAPER_TRADING_TOKEN_FILE: tokenFile, PAPER_TRADING_MCP_URL: fixture.url }, stderr: 'pipe' });
  let stderr = ''; transport.stderr.on('data', chunk => { stderr += chunk; });
  t.after(async () => { await client.close(); assert.ok(!stderr.includes(TOKEN)); });
  await client.connect(transport); assert.equal((await client.listTools()).tools.length, 11);
  await assert.rejects(loadConfiguration({ PAPER_TRADING_TOKEN_FILE: join(dir, 'missing') }), /Cannot read/);
  await assert.rejects(loadConfiguration({ PAPER_TRADING_TOKEN_FILE: 'relative.token' }), /absolute/);
  await assert.rejects(loadConfiguration({ PAPER_TRADING_TOKEN_FILE: dir }), /regular text file/);
  const large = join(dir, 'large.token'); await writeFile(large, 'x'.repeat(8193), { mode: 0o600 });
  await assert.rejects(loadConfiguration({ PAPER_TRADING_TOKEN_FILE: large }), /8 KiB/);
  if (process.platform !== 'win32') {
    const publicFile = join(dir, 'public.token'); await writeFile(publicFile, TOKEN, { mode: 0o644 });
    await assert.rejects(loadConfiguration({ PAPER_TRADING_TOKEN_FILE: publicFile }), /chmod 600/);
  }
});

for (const status of ['401', '403']) test(`revocation/access status ${status} is actionable without response-body or token leakage`, async t => {
  const fixture = await upstream(t); const { client, stderr } = await local(t, fixture);
  await client.listTools(); fixture.mode = status;
  const result = await client.callTool({ name: 'paper_place_order', arguments: combo });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, status === '401' ? /AUTHENTICATION_FAILED/ : /ACCESS_DENIED/);
  assert.ok(!JSON.stringify(result).includes(TOKEN)); assert.ok(!stderr().includes(TOKEN));
  assert.equal(fixture.requests.filter(req => req.body?.method === 'tools/call').length, 1);
});

for (const mode of ['timeout', 'disconnect', '404']) test(`${mode} never retries/replays an ambiguous trade; subsequent requests can recover`, async t => {
  const fixture = await upstream(t); const { client } = await local(t, fixture, { PAPER_TRADING_TIMEOUT_MS: '1000' });
  await client.listTools(); fixture.mode = mode;
  const result = await client.callTool({ name: 'paper_place_order', arguments: combo });
  assert.equal(result.isError, true); assert.match(result.content[0].text, /no automatic retry/);
  assert.ok(!JSON.stringify(result).includes(TOKEN)); assert.equal(fixture.calls.length, 1);
  fixture.mode = 'healthy';
  const next = await client.callTool({ name: 'paper_get_account', arguments: { accountId: 'account-a' } });
  assert.notEqual(next.isError, true); assert.equal(fixture.calls.filter(call => call.name === 'paper_place_order').length, 1);
});

test('concurrent calls share one initialization and keep each request/result separate', async t => {
  const fixture = await upstream(t); fixture.mode = 'concurrent'; const { client } = await local(t, fixture);
  const results = await Promise.all([1, 2, 3].map(index => client.callTool({ name: 'paper_get_account', arguments: { index } })));
  assert.deepEqual(results.map(result => result.structuredContent.echoed.index), [1, 2, 3]);
  assert.equal(fixture.requests.filter(req => req.body?.method === 'initialize').length, 1);
  assert.equal(fixture.calls.length, 3);
});

test('successful calls never emit delayed cancellation after their deadline', async t => {
  const fixture = await upstream(t); const { client } = await local(t, fixture, { PAPER_TRADING_TIMEOUT_MS: '1000' });
  await client.listTools();
  const placed = await client.callTool({ name: 'paper_place_order', arguments: combo });
  assert.notEqual(placed.isError, true);
  const requests = fixture.requests.length;
  await new Promise(resolve => setTimeout(resolve, 1150));
  assert.equal(fixture.requests.filter(req => req.body?.method === 'notifications/cancelled').length, 0);
  assert.equal(fixture.requests.length, requests);
});

test('redirects are never followed with credentials', async t => {
  const fixture = await upstream(t); fixture.mode = 'redirect'; const { client } = await local(t, fixture);
  await assert.rejects(client.listTools(), /UPSTREAM_UNAVAILABLE/);
  assert.equal(fixture.requests.length, 1); assert.equal(fixture.redirects, 0);
});

test('cancelling an in-flight placement does not replay it or cancel another caller', async t => {
  const fixture = await upstream(t); const { client } = await local(t, fixture, { PAPER_TRADING_TIMEOUT_MS: '1000' });
  await client.listTools(); fixture.mode = 'timeout';
  const controller = new AbortController();
  const pending = client.callTool({ name: 'paper_place_order', arguments: combo }, undefined, { signal: controller.signal });
  while (!fixture.calls.length) await new Promise(resolve => setTimeout(resolve, 10));
  controller.abort(); await assert.rejects(pending);
  fixture.mode = 'healthy';
  const next = await client.callTool({ name: 'paper_get_account', arguments: { accountId: 'account-a' } });
  assert.notEqual(next.isError, true); assert.equal(fixture.calls.filter(call => call.name === 'paper_place_order').length, 1);
});

test('EOF and SIGTERM close a local process cleanly; help/version need no credentials', async () => {
  const initialized = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'raw-client', version: '1' } } };
  const eof = await rawCLI([], { PAPER_TRADING_TOKEN: TOKEN }, `${JSON.stringify(initialized)}\n`);
  assert.equal(eof.code, 0); assert.equal(eof.stderr, '');
  for (const line of eof.stdout.trim().split('\n').filter(Boolean)) assert.equal(JSON.parse(line).jsonrpc, '2.0');
  const child = spawn(process.execPath, [BIN], { env: { PATH: process.env.PATH, PAPER_TRADING_TOKEN: TOKEN }, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.write(`${JSON.stringify(initialized)}\n`);
  await once(child.stdout, 'data'); child.kill('SIGTERM');
  const [code, signal] = await once(child, 'exit'); assert.equal(code, 0); assert.equal(signal, null);
  assert.match((await rawCLI(['--help'])).stdout, /PAPER_TRADING_TOKEN_FILE/);
  assert.equal((await rawCLI(['--version'])).stdout, '0.2.0\n');
});

test('--check is read-only discovery and returns a redacted diagnostic', async t => {
  const fixture = await upstream(t);
  const result = await rawCLI(['--check'], { PAPER_TRADING_TOKEN: TOKEN, PAPER_TRADING_MCP_URL: fixture.url });
  assert.equal(result.code, 0); assert.deepEqual(JSON.parse(result.stdout), { ok: true, mode: 'paper', tools: 11 });
  assert.equal(fixture.calls.length, 0); assert.equal(result.stderr, '');
  fixture.mode = '401';
  const rejected = await rawCLI(['--check'], { PAPER_TRADING_TOKEN: TOKEN, PAPER_TRADING_MCP_URL: fixture.url });
  assert.equal(rejected.code, 1); assert.equal(rejected.stdout, '');
  assert.match(rejected.stderr, /token was rejected or revoked/); assert.ok(!rejected.stderr.includes(TOKEN));
});

test('stdin EOF cancels a pending HTTP operation and exits without waiting for the request timeout', async t => {
  const fixture = await upstream(t);
  const child = spawn(process.execPath, [BIN], { env: { PATH: process.env.PATH, PAPER_TRADING_TOKEN: TOKEN, PAPER_TRADING_MCP_URL: fixture.url }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'raw', version: '1' } } }) + '\n');
  while (!stdout.includes('"id":1')) await new Promise(resolve => setTimeout(resolve, 10));
  fixture.mode = 'timeout';
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'paper_place_order', arguments: combo } }) + '\n');
  while (!fixture.calls.length) await new Promise(resolve => setTimeout(resolve, 10));
  const exited = once(child, 'exit'); const started = Date.now(); child.stdin.end();
  const [code] = await exited;
  assert.equal(code, 0); assert.ok(Date.now() - started < 2500); assert.equal(fixture.calls.length, 1);
  assert.ok(!stderr.includes(TOKEN));
  for (const line of stdout.trim().split('\n').filter(Boolean)) assert.equal(JSON.parse(line).jsonrpc, '2.0');
});

test('SIGTERM exits within the shutdown bound when the MCP client stops reading stdout', async t => {
  const fixture = await upstream(t); fixture.mode = 'large';
  const child = spawn(process.execPath, [BIN], { env: { PATH: process.env.PATH, PAPER_TRADING_TOKEN: TOKEN, PAPER_TRADING_MCP_URL: fixture.url }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'raw', version: '1' } } }) + '\n');
  await once(child.stdout, 'data'); child.stdout.pause();
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
  while (!fixture.requests.some(request => request.body?.method === 'tools/list')) await new Promise(resolve => setTimeout(resolve, 10));
  await new Promise(resolve => setTimeout(resolve, 100));
  const exited = once(child, 'exit'); const started = Date.now(); child.kill('SIGTERM');
  const [code] = await exited;
  assert.equal(code, 0); assert.ok(Date.now() - started < 2500);
});
