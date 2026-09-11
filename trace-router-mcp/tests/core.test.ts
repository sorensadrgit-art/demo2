import { describe, expect, it } from 'vitest';
import { policyFingerprint, selectRoute, verifyCandidate } from '../src/core.js';

describe('selectRoute', () => {
  it.each([
    ['Rewrite this sentence more clearly.', 'DIRECT'],
    ['Follow this known procedure step by step and execute the dependent steps.', 'GUIDED'],
    ['Find the latest official documentation and current facts for this API.', 'EVIDENCE'],
    ['Debug why this tool is failing in my environment.', 'ADAPTIVE'],
    ['Design a distinctive landing page concept.', 'CREATE'],
    ['Compare three architectures and choose the best trade-off.', 'SEARCH'],
    ['Audit this candidate against the release criteria and verify every claim.', 'VERIFY'],
    ['Delegate these independent subtasks to parallel agents.', 'DELEGATE'],
  ])('%s -> %s', (task, expected) => {
    expect(selectRoute({ task }).primaryRoute).toBe(expected);
  });

  it('uses ADAPTIVE as primary and EVIDENCE as support for debugging with fresh docs', () => {
    const result = selectRoute({ task: 'Debug this failing integration using the latest official docs.' });
    expect(result.primaryRoute).toBe('ADAPTIVE');
    expect(result.supportingRoutes).toContain('EVIDENCE');
  });

  it('uses VERIFY as primary when verification is explicit', () => {
    const result = selectRoute({ task: 'Verify this current external claim against fresh sources.' });
    expect(result.primaryRoute).toBe('VERIFY');
    expect(result.supportingRoutes).toContain('EVIDENCE');
  });
});

describe('verifyCandidate', () => {
  const criteria = [
    { id: 'c1', description: 'Build succeeds' },
    { id: 'c2', description: 'Tests pass' },
  ];

  it('returns UNKNOWN when required evidence is missing', () => {
    const result = verifyCandidate({ objective: 'Ship safely', criteria, evidence: [] });
    expect(result.overall).toBe('UNKNOWN');
    expect(result.criteria.every(item => item.status === 'UNKNOWN')).toBe(true);
  });

  it('returns FAIL when evidence contradicts a criterion', () => {
    const result = verifyCandidate({
      objective: 'Ship safely',
      criteria,
      evidence: [
        { criterionId: 'c1', verdict: 'supports', detail: 'Build exited 0' },
        { criterionId: 'c2', verdict: 'contradicts', detail: '2 tests failed' },
      ],
    });
    expect(result.overall).toBe('FAIL');
    expect(result.criteria.find(item => item.id === 'c2')?.status).toBe('FAIL');
  });

  it('returns PASS only when every required criterion has supporting evidence', () => {
    const result = verifyCandidate({
      objective: 'Ship safely',
      criteria,
      evidence: [
        { criterionId: 'c1', verdict: 'supports', detail: 'Build exited 0' },
        { criterionId: 'c2', verdict: 'supports', detail: '24/24 tests pass' },
      ],
    });
    expect(result.overall).toBe('PASS');
  });
});

describe('policyFingerprint', () => {
  it('is deterministic and content-sensitive', () => {
    expect(policyFingerprint('abc')).toBe(policyFingerprint('abc'));
    expect(policyFingerprint('abc')).not.toBe(policyFingerprint('abcd'));
  });
});
