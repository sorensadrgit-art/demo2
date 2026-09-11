# TRACE Router MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a deterministic remote MCP plugin that exposes the TRACE Router policy as route-selection, verification, and policy-inspection tools.

**Architecture:** Keep `trace-router/SKILL.md` as the authoritative policy. Implement pure deterministic functions in `src/core.ts`, expose them through a stateless Streamable HTTP MCP server in `src/server.ts`, and test the core plus a live MCP smoke path. Deploy the repository subdirectory to Manufact.

**Tech Stack:** Node.js 22+, TypeScript, `@modelcontextprotocol/server`, `@modelcontextprotocol/node`, `zod`, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-11-trace-router-mcp-design.md`

## Global Constraints
- The plugin must not claim it overrides host/system instructions.
- The plugin must not call an LLM or execute the user's task.
- Missing evidence can never become PASS.
- DELEGATE is advisory unless the host actually provides delegation.
- The original uploaded TRACE policy remains available verbatim as `trace-router/SKILL.md`.
- Remote transport is Streamable HTTP on `/mcp`.

---

### Task 1: Deterministic TRACE core
**Files:** Create `trace-router-mcp/src/core.ts`; Test `trace-router-mcp/tests/core.test.ts`.
**Interfaces:** Produces `selectRoute(input)`, `verifyCandidate(input)`, `policyFingerprint(text)` and exported TRACE route/status types.
- [ ] Write failing route-selection tests for DIRECT, GUIDED, EVIDENCE, ADAPTIVE, CREATE, SEARCH, VERIFY, DELEGATE and priority conflicts.
- [ ] Run `npm test -- tests/core.test.ts` and confirm RED failures because the core is missing.
- [ ] Implement the smallest deterministic selector and verifier.
- [ ] Re-run core tests and require 0 failures.

### Task 2: MCP tool surface
**Files:** Create `trace-router-mcp/src/server.ts`; Test `trace-router-mcp/tests/server.test.ts`.
**Interfaces:** Exposes `trace_route`, `trace_verify`, `trace_policy`; reads policy from `trace-router/SKILL.md`.
- [ ] Write failing MCP tests that list all three tools and call each tool through the SDK client/handler path.
- [ ] Run the server test and confirm RED failures.
- [ ] Implement the stateless MCP handler and `/health` endpoint.
- [ ] Re-run server tests and require 0 failures.

### Task 3: Packaging and authoritative policy
**Files:** Create `trace-router-mcp/package.json`, `trace-router-mcp/tsconfig.json`, `trace-router-mcp/trace-router/SKILL.md`, `trace-router-mcp/README.md`.
**Interfaces:** `npm run build`, `npm test`, `npm start`; server listens on `$PORT` and exposes `/mcp`.
- [ ] Add exact uploaded TRACE policy to `trace-router/SKILL.md`.
- [ ] Add package/build configuration using official MCP packages.
- [ ] Document install, endpoint, tools, examples, and host limitations.
- [ ] Run `npm install`, `npm run build`, and `npm test` locally.

### Task 4: Deploy and live verification
**Files:** No application-code changes unless live verification finds a defect.
**Interfaces:** Manufact remote MCP URL and health URL.
- [ ] Deploy `sorensadrgit-art/demo2` with root directory `trace-router-mcp` and server name `trace-router-mcp`.
- [ ] Poll deployment to RUNNING and inspect build/runtime logs for errors.
- [ ] Connect an MCP client to the live `/mcp` URL; list tools and call `trace_policy`, `trace_route`, and `trace_verify`.
- [ ] Verify the live policy fingerprint matches the local test fingerprint.
- [ ] Report the MCP URL and exact connection instructions; do not claim ChatGPT-global automatic activation.
