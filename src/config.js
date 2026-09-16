import { open } from 'node:fs/promises';
import { constants, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
export const DEFAULT_URL = 'https://api.krh1996.com/api/paper/mcp';
export class ConfigurationError extends Error {}

export function parseEndpoint(value = DEFAULT_URL) {
  let endpoint;
  try { endpoint = new URL(value); } catch { throw new ConfigurationError('PAPER_TRADING_MCP_URL must be an absolute HTTPS URL.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  if ((endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && local)) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new ConfigurationError('PAPER_TRADING_MCP_URL must use HTTPS (HTTP is allowed only for localhost, 127.0.0.1 or [::1]) and cannot contain credentials, a query or a fragment.');
  }
  return endpoint;
}

async function readTokenFile(filename) {
  if (!isAbsolute(filename)) throw new ConfigurationError('PAPER_TRADING_TOKEN_FILE must be an absolute path.');
  let file;
  try {
    // Avoid blocking forever if a misconfigured path points to a FIFO/device.
    file = await open(filename, constants.O_RDONLY | constants.O_NONBLOCK);
    const info = await file.stat();
    if (!info.isFile() || info.size > 8192) throw new ConfigurationError('PAPER_TRADING_TOKEN_FILE must be a regular text file smaller than 8 KiB.');
    if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) throw new ConfigurationError('Restrict PAPER_TRADING_TOKEN_FILE permissions to its owner with chmod 600.');
    const data = Buffer.alloc(8193);
    const { bytesRead } = await file.read(data, 0, data.length, 0);
    if (bytesRead > 8192) throw new ConfigurationError('PAPER_TRADING_TOKEN_FILE must be smaller than 8 KiB.');
    return data.subarray(0, bytesRead).toString('utf8').trim();
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    throw new ConfigurationError('Cannot read PAPER_TRADING_TOKEN_FILE. Check the absolute path and file permissions.');
  } finally { await file?.close().catch(() => {}); }
}

export async function loadConfiguration(env = process.env) {
  const tokenFile = env.PAPER_TRADING_TOKEN_FILE;
  const tokenValue = env.PAPER_TRADING_TOKEN;
  if (tokenFile !== undefined && tokenValue !== undefined) throw new ConfigurationError('Set only one of PAPER_TRADING_TOKEN_FILE or PAPER_TRADING_TOKEN.');
  const token = tokenFile ? await readTokenFile(tokenFile) : tokenValue?.trim();
  if (token !== undefined && !/^paper_[A-Za-z0-9_-]{43}$/.test(token)) throw new ConfigurationError('The paper trading token format is invalid. Create an account-scoped access token in the dashboard.');
  const timeoutValue = env.PAPER_TRADING_TIMEOUT_MS ?? '30000';
  const timeoutMs = Number(timeoutValue);
  if (!/^\d+$/.test(timeoutValue) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) throw new ConfigurationError('PAPER_TRADING_TIMEOUT_MS must be an integer from 1000 through 120000.');
  if (env.PAPER_TRADING_CREDENTIAL_DIR && !isAbsolute(env.PAPER_TRADING_CREDENTIAL_DIR)) throw new ConfigurationError('PAPER_TRADING_CREDENTIAL_DIR must be absolute.');
  const webUrl = parseEndpoint(env.PAPER_TRADING_WEB_URL || 'https://krh1996.com');
  if (webUrl.pathname !== '/') throw new ConfigurationError('PAPER_TRADING_WEB_URL must be an origin.');
  return { token, webUrl, credentialDir:env.PAPER_TRADING_CREDENTIAL_DIR, endpoint: parseEndpoint(env.PAPER_TRADING_MCP_URL), timeoutMs };
}
