import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { buildMcpHandler } from '../src/server.js';
import { policyFingerprint } from '../src/core.js';

const policy = `---\nname: trace-router\ndescription: test\n---\n# TRACE Router\nTest policy body.`;
const servers: http.Server[] = [];
const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map(client => client.close().catch(() => undefined)));
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

async function connect(policyText = policy) {
  const nodeHandler = toNodeHandler(buildMcpHandler(policyText));
  const server = http.createServer(nodeHandler);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  const client = new Client({ name: 'trace-router-test', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
  clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`)));
  return client;
}

function text(result: { content?: Array<{ type: string; text?: string }> }) {
  const item = result.content?.find(part => part.type === 'text');
  return JSON.parse(item?.text || '{}');
}

describe('TRACE Router MCP server', () => {
  it('lists the three public tools', async () => {
    const client = await connect();
    const result = await client.listTools();
    expect(result.tools.map(tool => tool.name).sort()).toEqual(['trace_policy','trace_route','trace_verify']);
  });

  it('routes a debugging task', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'trace_route', arguments: { task: 'Debug this failing runtime with the latest docs.' } });
    const body = text(result);
    expect(body.primaryRoute).toBe('ADAPTIVE');
    expect(body.supportingRoutes).toContain('EVIDENCE');
  });

  it('never passes missing verification evidence', async () => {
    const client = await connect();
    const result = await client.callTool({
      name: 'trace_verify',
      arguments: { objective: 'Release', criteria: [{ id: 'tests', description: 'Tests pass' }], evidence: [] },
    });
    expect(text(result).overall).toBe('UNKNOWN');
  });

  it('returns the authoritative policy and fingerprint', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'trace_policy', arguments: {} });
    const body = text(result);
    expect(body.policy).toBe(policy);
    expect(body.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('canonicalizes CRLF policy text before returning and fingerprinting it', async () => {
    const client = await connect(policy.replace(/\n/g, '\r\n'));
    const result = await client.callTool({ name: 'trace_policy', arguments: {} });
    const body = text(result);
    expect(body.policy).toBe(policy);
    expect(body.fingerprint).toBe(policyFingerprint(policy));
  });
});
