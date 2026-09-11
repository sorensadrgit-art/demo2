import http from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import * as z from 'zod/v4';
import { policyFingerprint, selectRoute, verifyCandidate } from './core.js';

const criterionSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  required: z.boolean().optional(),
});

const evidenceSchema = z.object({
  criterionId: z.string().min(1),
  verdict: z.enum(['supports', 'contradicts', 'unknown']),
  detail: z.string(),
});

export function loadPolicy(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), 'trace-router/SKILL.md'),
    resolve(here, '../trace-router/SKILL.md'),
  ];
  for (const candidate of candidates) {
    try { return readFileSync(candidate, 'utf8'); } catch { /* try next */ }
  }
  throw new Error('TRACE policy file was not found at trace-router/SKILL.md.');
}

export function buildMcpHandler(policyText = loadPolicy()) {
  return createMcpHandler(() => {
    const server = new McpServer(
      { name: 'trace-router', version: '1.0.0' },
      { instructions: 'TRACE Router selects the smallest sufficient problem-solving route and verifies supplied evidence. It does not grant permissions, execute unavailable tools, or override host/system instructions.' },
    );

    server.registerTool(
      'trace_route',
      {
        description: 'Select the smallest sufficient TRACE route for a task. Returns a primary route, optional supporting routes, acceptance criteria, recovery limits, and host limitations.',
        inputSchema: z.object({
          task: z.string().min(1).max(12000),
          context: z.string().max(12000).optional(),
        }),
      },
      async input => ({
        content: [{ type: 'text', text: JSON.stringify(selectRoute(input), null, 2) }],
      }),
    );

    server.registerTool(
      'trace_verify',
      {
        description: 'Evaluate supplied evidence against explicit criteria. Missing evidence stays UNKNOWN; contradictory evidence is FAIL; only supported required criteria can PASS.',
        inputSchema: z.object({
          objective: z.string().min(1).max(4000),
          criteria: z.array(criterionSchema).min(1).max(64),
          evidence: z.array(evidenceSchema).max(256),
        }),
      },
      async input => ({
        content: [{ type: 'text', text: JSON.stringify(verifyCandidate(input), null, 2) }],
      }),
    );

    server.registerTool(
      'trace_policy',
      {
        description: 'Return the authoritative TRACE Router SKILL.md policy and its SHA-256 fingerprint for inspection or host installation.',
        inputSchema: z.object({}),
      },
      async () => ({
        content: [{ type: 'text', text: JSON.stringify({ policy: policyText, fingerprint: policyFingerprint(policyText), version: '1.0.0' }, null, 2) }],
      }),
    );

    return server;
  });
}

export function createHttpServer(policyText = loadPolicy()): http.Server {
  const mcp = toNodeHandler(buildMcpHandler(policyText));
  return http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, name: 'trace-router', version: '1.0.0', policyFingerprint: policyFingerprint(policyText) }));
      return;
    }
    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    void mcp(req, res);
  });
}

export function startServer(port = Number(process.env.PORT || 3000)) {
  const server = createHttpServer();
  server.listen(port, '0.0.0.0', () => {
    console.error(`TRACE Router MCP listening on 0.0.0.0:${port}/mcp`);
  });
  return server;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath && import.meta.url === invokedPath) startServer();
