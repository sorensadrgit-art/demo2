import { createHash } from 'node:crypto';

export const TRACE_ROUTES = ['DIRECT','GUIDED','EVIDENCE','ADAPTIVE','CREATE','SEARCH','VERIFY','DELEGATE'] as const;
export type TraceRoute = typeof TRACE_ROUTES[number];
export type VerificationStatus = 'PASS' | 'FAIL' | 'UNKNOWN';

export interface RouteRequest { task: string; context?: string; }
export interface RouteDecision {
  primaryRoute: TraceRoute;
  supportingRoutes: TraceRoute[];
  reason: string;
  acceptanceCriteria: string[];
  recovery: { maxSameOperationRetries: 2; maxStrategyChanges: 2 };
  policyVersion: '1.0.0';
  limitations: string[];
}

export interface Criterion { id: string; description: string; required?: boolean; }
export interface EvidenceItem { criterionId: string; verdict: 'supports' | 'contradicts' | 'unknown'; detail: string; }
export interface VerificationRequest { objective: string; criteria: Criterion[]; evidence: EvidenceItem[]; }
export interface CriterionResult extends Criterion { status: VerificationStatus; evidence: EvidenceItem[]; }
export interface VerificationResult { objective: string; overall: VerificationStatus; criteria: CriterionResult[]; }

const patterns: Record<Exclude<TraceRoute,'DIRECT'>, RegExp> = {
  GUIDED: /\b(step[- ]?by[- ]?step|known procedure|dependent steps|follow (?:the )?procedure|execute (?:the )?plan|implementation plan)\b/i,
  EVIDENCE: /\b(latest|current|fresh|up[- ]?to[- ]?date|research|official docs?|documentation|find sources?|search (?:the )?web|look up)\b/i,
  ADAPTIVE: /\b(debug|fix|investigate|failing|failure|error|unexpected|environment|tooling|tool|runtime|broken)\b/i,
  CREATE: /\b(design|brainstorm|draft|write|create|invent|compose|story|visual|concept)\b/i,
  SEARCH: /\b(compare|choose between|trade[- ]?offs?|alternatives?|which (?:is|one is) better|evaluate options?|competing)\b/i,
  VERIFY: /\b(verify|audit|validate|prove|release gate|check (?:this )?candidate|review against|acceptance criteria)\b/i,
  DELEGATE: /\b(delegate|parallel agents?|independent subtasks?|multiple agents?|split .* across .* agents?)\b/i,
};

const routePriority: TraceRoute[] = ['VERIFY','ADAPTIVE','EVIDENCE','SEARCH','DELEGATE','CREATE','GUIDED','DIRECT'];

const acceptanceByRoute: Record<TraceRoute,string[]> = {
  DIRECT: ['The requested answer or action is delivered directly.', 'A proportionate correctness check is applied.'],
  GUIDED: ['Dependencies are ordered before execution.', 'Each meaningful output is checked before moving downstream.'],
  EVIDENCE: ['Material external claims are supported by fresh, relevant evidence.', 'Search results are treated as leads until the source itself is inspected when needed.'],
  ADAPTIVE: ['The current environment is observed before changing it.', 'Each action has a testable hypothesis and the actual result is inspected before replanning.'],
  CREATE: ['The deliverable follows the brief and explicit constraints.', 'Subjective choices are labeled as choices rather than objective facts.'],
  SEARCH: ['Distinct candidates are compared with discriminating criteria.', 'Irreversible real-world actions are not used merely to explore alternatives.'],
  VERIFY: ['Every required criterion is reported PASS, FAIL, or UNKNOWN.', 'No missing or contradictory evidence is converted into a passing claim.'],
  DELEGATE: ['Only independent subtasks with clear ownership/interfaces are delegated.', 'Delegation is advisory unless the host actually provides authorized worker execution.'],
};

const reasons: Record<TraceRoute,string> = {
  DIRECT: 'No stronger routing signal is present; use the smallest sufficient direct path.',
  GUIDED: 'The task explicitly asks for a known or dependency-ordered procedure.',
  EVIDENCE: 'The task depends on changing or externally verifiable facts.',
  ADAPTIVE: 'The task involves debugging, an uncertain environment, or interacting tools where observation must drive the next step.',
  CREATE: 'The requested output is primarily creative or subjective.',
  SEARCH: 'The task asks to compare competing choices before committing.',
  VERIFY: 'The task explicitly requires validation, audit, or criterion-based proof.',
  DELEGATE: 'The task explicitly identifies independent work suitable for separate workers when the host supports them.',
};

export function selectRoute(input: RouteRequest): RouteDecision {
  const text = `${input.task || ''}\n${input.context || ''}`.trim();
  const matched = TRACE_ROUTES.filter(route => route !== 'DIRECT' && patterns[route as Exclude<TraceRoute,'DIRECT'>].test(text));
  const primaryRoute = routePriority.find(route => route === 'DIRECT' || matched.includes(route)) ?? 'DIRECT';
  const supportingRoutes = routePriority.filter(route => route !== 'DIRECT' && route !== primaryRoute && matched.includes(route));
  return {
    primaryRoute,
    supportingRoutes,
    reason: reasons[primaryRoute],
    acceptanceCriteria: acceptanceByRoute[primaryRoute],
    recovery: { maxSameOperationRetries: 2, maxStrategyChanges: 2 },
    policyVersion: '1.0.0',
    limitations: [
      'This router recommends a procedure; it does not grant permissions or execute unavailable tools.',
      'Host/system instructions and safety boundaries remain higher priority.',
      'Independent review is only independent when the host provides a genuinely separate authorized context.',
    ],
  };
}

export function verifyCandidate(input: VerificationRequest): VerificationResult {
  const results: CriterionResult[] = input.criteria.map(criterion => {
    const evidence = input.evidence.filter(item => item.criterionId === criterion.id);
    const status: VerificationStatus = evidence.some(item => item.verdict === 'contradicts')
      ? 'FAIL'
      : evidence.some(item => item.verdict === 'supports')
        ? 'PASS'
        : 'UNKNOWN';
    return { ...criterion, required: criterion.required !== false, status, evidence };
  });
  const required = results.filter(item => item.required !== false);
  const overall: VerificationStatus = required.some(item => item.status === 'FAIL')
    ? 'FAIL'
    : required.some(item => item.status === 'UNKNOWN')
      ? 'UNKNOWN'
      : 'PASS';
  return { objective: input.objective, overall, criteria: results };
}

export function policyFingerprint(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
