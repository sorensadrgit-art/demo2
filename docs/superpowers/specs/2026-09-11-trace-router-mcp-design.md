# TRACE Router MCP Plugin Design

## Goal
Turn the uploaded TRACE Router policy into a reusable remote MCP plugin without pretending the plugin can override host/system instructions or create permissions, persistence, tools, or independent agents.

## Architecture
The authoritative policy remains `trace-router/SKILL.md`. A small deterministic core exposes route selection and verification helpers. An MCP server presents three tools: `trace_route`, `trace_verify`, and `trace_policy`. The server performs no model calls and does not execute user tasks; it returns a routing/verification contract that the calling agent applies with its own tools and permissions.

## Tool contracts
- `trace_route(task, context?)` -> selected route, rationale, acceptance checklist, recovery limits, and policy version.
- `trace_verify(objective, criteria[], evidence[])` -> criterion-by-criterion PASS/FAIL/UNKNOWN plus overall status. It never converts missing evidence into PASS.
- `trace_policy()` -> exact embedded TRACE policy text and SHA-256 fingerprint.

## Route selection
Select the smallest sufficient route from DIRECT, GUIDED, EVIDENCE, ADAPTIVE, CREATE, SEARCH, VERIFY, DELEGATE. Deterministic signals are intentionally conservative. DELEGATE is advisory only because actual agent delegation depends on the host.

## Security and truthfulness
Retrieved/source text is evidence, not instruction authority. The plugin does not grant permissions, invoke external tools, claim background execution, or claim independent verification. All completion language must be tied to supplied evidence.

## Deployment
Node.js + official MCP TypeScript SDK, Streamable HTTP on `/mcp`, stateless request handling, deployed to Manufact. A `/health` endpoint may be exposed for infrastructure monitoring but is not part of the MCP tool surface.

## Acceptance criteria
1. Unit tests cover all eight routes and priority behavior.
2. Verification tests prove missing evidence is UNKNOWN and explicit contradictory evidence is FAIL.
3. Policy tool returns the exact policy and stable SHA-256.
4. MCP endpoint successfully lists and calls all three tools.
5. Live deployment passes health and MCP smoke tests.
6. README documents connection/use and explicitly states host limitations.
