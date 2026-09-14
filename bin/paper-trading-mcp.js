#!/usr/bin/env node
import { loadConfiguration, ConfigurationError, VERSION } from '../src/config.js';
import { createBridge, safeFailure } from '../src/bridge.js';

const args = process.argv.slice(2);
const help = `KH Paper Trading MCP ${VERSION}
Usage: paper-trading-mcp [--help | --version | --check]

With no arguments, serve MCP over stdin/stdout for a local agent.
--check performs read-only upstream tool discovery and exits.

Credentials (choose one; tokens never belong in command-line arguments):
  PAPER_TRADING_TOKEN_FILE  Absolute path to a private token text file (preferred)
  PAPER_TRADING_TOKEN       Account-scoped token from the paper trading dashboard
Optional:
  PAPER_TRADING_MCP_URL     Hosted endpoint override for self-hosting
  PAPER_TRADING_TIMEOUT_MS  1000–120000 milliseconds; default 30000

Prices, trades, balances, collateral and competition scores remain on the server.
`;

async function main() {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) { process.stdout.write(help); return; }
  if (args.length === 1 && ['--version', '-v'].includes(args[0])) { process.stdout.write(`${VERSION}\n`); return; }
  if (args.length && !(args.length === 1 && args[0] === '--check')) throw new ConfigurationError('Unknown arguments. Use --help. Supply credentials through a token file or environment, never command-line arguments.');
  const bridge = createBridge(await loadConfiguration());
  let stopping;
  const stop = () => {
    if (stopping) return stopping;
    // Bound shutdown when a remote connection or an output pipe is no longer responsive.
    const force = setTimeout(() => process.exit(process.exitCode || 0), 1500);
    force.unref();
    // Keep the unref'ed bound armed: SDK close can finish while stdout still has
    // a blocked write to a client that stopped reading. It does not keep a
    // normally closed process alive, but guarantees that blocked pipes exit.
    stopping = bridge.close().finally(() => { process.stdin.pause(); });
    return stopping;
  };
  process.once('SIGTERM', () => { void stop(); });
  process.once('SIGINT', () => { void stop(); });
  process.stdin.once('end', () => { void stop(); });
  process.stdin.once('error', () => { void stop(); });
  process.stdout.once('error', () => { void stop(); });
  bridge.server.onerror = () => { process.stderr.write('Paper Trading MCP: invalid protocol input or closed transport.\n'); };
  if (args[0] === '--check') {
    try { const result = await bridge.listTools(); process.stdout.write(`${JSON.stringify({ ok: true, mode: 'paper', tools: result.tools.length })}\n`); }
    finally { await stop(); }
  } else await bridge.start();
}

main().catch(error => {
  const message = error instanceof ConfigurationError ? error.message : safeFailure(error).message;
  process.stderr.write(`Paper Trading MCP: ${message}\n`);
  process.exitCode = 1;
});
