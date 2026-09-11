# TRACE Router MCP

A small remote MCP plugin that exposes the TRACE Router policy as deterministic routing and verification tools.

## Live deployment

- MCP (Streamable HTTP): `https://api-v2.appdeploy.ai/app/trace-router-mcp-x4bj66/api/mcp`
- Diagnostic UI: `https://trace-router-mcp-x4bj66.v2.appdeploy.ai/`
- Canonical policy SHA-256: `01ba565744e0f97595c2f7c3f3107eb1dd74aedd9464fc4a1476df99e83e1390`

The live endpoint has been exercised with the official MCP client against all three public tools.

## Tools

### `trace_route`
Input: `{ task, context? }`

Returns a primary TRACE route (`DIRECT`, `GUIDED`, `EVIDENCE`, `ADAPTIVE`, `CREATE`, `SEARCH`, `VERIFY`, or `DELEGATE`), optional supporting routes, route-specific acceptance criteria, bounded recovery limits, and limitations.

### `trace_verify`
Input: `{ objective, criteria[], evidence[] }`

Each evidence item targets a criterion and has verdict `supports`, `contradicts`, or `unknown`. Required criteria become PASS only with supporting evidence, FAIL on contradiction, and UNKNOWN when support is missing. Overall PASS requires every required criterion to pass.

### `trace_policy`
Returns the exact embedded `trace-router/SKILL.md` policy, version, and SHA-256 fingerprint.

## Run locally

```bash
npm install
npm run build
npm test
npm start
```

Default endpoint: `http://localhost:3000/mcp`

Health: `http://localhost:3000/health`

## Connect in ChatGPT or another MCP host

Create a custom remote MCP app/connector and use the live Streamable HTTP URL above as the server URL. No provider OAuth or API key is required by TRACE Router itself. The calling host still controls whether custom MCP apps are allowed, when the tool is invoked, and which actions are authorized.

After connection, call `trace_route` before a meaningful multi-step task when you want TRACE routing, `trace_verify` before claiming a candidate satisfies explicit criteria, and `trace_policy` when you need the exact installed policy/fingerprint.

## Important host boundary

TRACE Router is a portable policy and advisory plugin. It cannot override system/developer instructions, create tools or permissions, guarantee background execution, manufacture independent agents, or force automatic activation in every conversation. The calling host decides when to invoke it and which actions are actually available and authorized.

## Source of truth

The authoritative policy is `trace-router/SKILL.md`. The plugin performs no LLM calls and does not execute the user's task itself.
