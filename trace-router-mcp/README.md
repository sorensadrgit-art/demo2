# TRACE Router MCP

A small remote MCP plugin that exposes the TRACE Router policy as deterministic routing and verification tools.

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

## Connect

Use the deployed Streamable HTTP MCP URL in any MCP-capable client. After connection, call `trace_route` before a meaningful multi-step task when you want TRACE routing, and `trace_verify` before claiming a candidate satisfies explicit criteria.

## Important host boundary

TRACE Router is a portable policy and advisory plugin. It cannot override system/developer instructions, create tools or permissions, guarantee background execution, manufacture independent agents, or force automatic activation in every conversation. The calling host decides when to invoke it and which actions are actually available and authorized.

## Source of truth

The authoritative policy is `trace-router/SKILL.md`. The plugin performs no LLM calls and does not execute the user's task itself.
