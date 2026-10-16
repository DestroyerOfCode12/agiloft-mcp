import { z } from 'zod';

/**
 * Structured requirements: the contract between interpretation (deterministic
 * parser, a structured form, an MCP client, or an optional model provider)
 * and the deterministic planner. Every interpreter's output is validated
 * against this schema before planning.
 */
export const ApprovalRequirementSchema = z.object({
  name: z.string().min(1).max(80),
  approverSource: z.enum(['requester_manager', 'team', 'named_user', 'unknown']),
  team: z.string().max(120).optional(),
  namedUser: z.string().max(120).optional(),
  threshold: z
    .object({
      op: z.enum(['gt', 'gte']),
      amount: z.number().nonnegative(),
      currency: z.string().max(8).optional(),
    })
    .optional(),
  order: z.number().int().min(1).max(20),
});
export type ApprovalRequirement = z.infer<typeof ApprovalRequirementSchema>;

export const StructuredRequirementsSchema = z.object({
  subject: z.object({
    entity: z.string().min(1).max(120),
    table: z.string().max(128).optional(),
  }),
  trigger: z.object({
    event: z.enum(['created', 'submitted', 'updated', 'status_change']),
    statusValue: z.string().max(120).optional(),
  }),
  approvals: z.array(ApprovalRequirementSchema).max(10).default([]),
  rejection: z
    .enum(['reject_request', 'return_to_requester', 'unspecified'])
    .default('unspecified'),
  tasks: z
    .object({
      when: z.enum(['after_approval', 'on_trigger']),
      label: z.string().max(80).default('fulfilment'),
      items: z
        .array(
          z.object({
            name: z.string().max(120),
            team: z.string().max(120).optional(),
            slaBusinessDays: z.number().int().min(0).max(365).optional(),
          }),
        )
        .max(20)
        .default([]),
      dependencies: z.enum(['sequential', 'parallel', 'unspecified']).default('unspecified'),
    })
    .optional(),
  notifications: z
    .array(
      z.object({ audience: z.enum(['requester', 'approver', 'team']), event: z.string().max(120) }),
    )
    .max(10)
    .default([]),
  escalations: z
    .array(
      z.object({
        target: z.enum(['overdue_tasks', 'pending_approvals']),
        after: z.string().max(60).optional(),
        to: z.string().max(120).optional(),
      }),
    )
    .max(10)
    .default([]),
  calendar: z
    .object({
      businessCalendar: z.string().max(120).optional(),
      timezone: z.string().max(64).optional(),
    })
    .default({}),
});
export type StructuredRequirements = z.infer<typeof StructuredRequirementsSchema>;
export type StructuredRequirementsInput = z.input<typeof StructuredRequirementsSchema>;

export interface InterpretationResult {
  requirements: StructuredRequirements;
  /** Phrases the interpreter recognised, for transparency in the UI. */
  recognised: { phrase: string; meaning: string }[];
  /** Sentences that did not map to any known requirement. */
  unrecognised: string[];
  interpreter: 'deterministic' | 'model' | 'structured';
}

const CURRENCY: Record<string, string> = {
  r: 'ZAR',
  zar: 'ZAR',
  $: 'USD',
  usd: 'USD',
  '€': 'EUR',
  eur: 'EUR',
  '£': 'GBP',
  gbp: 'GBP',
};

function parseAmount(raw: string, suffix?: string): number {
  const n = Number(raw.replace(/[,\s]/g, ''));
  const mult =
    suffix?.toLowerCase() === 'k' ? 1_000 : suffix?.toLowerCase() === 'm' ? 1_000_000 : 1;
  return n * mult;
}

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Deterministic, rule-based interpretation of common approval/task phrasing.
 * It is intentionally conservative: anything it does not recognise is listed
 * as unrecognised rather than guessed.
 */
export function interpretDeterministically(text: string): InterpretationResult {
  const recognised: InterpretationResult['recognised'] = [];
  const sentences = text
    .split(/(?<=[.!?;])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const used = new Set<number>();

  // Subject and trigger
  let entity = 'record';
  let event: StructuredRequirements['trigger']['event'] = 'created';
  const trig =
    /\b(?:when|whenever|once|after)\s+(?:an?|the|each|every)?\s*([a-z][a-z \-]{1,60}?)\s+(?:is|are|gets|get|has been)\s+(submitted|created|raised|logged|updated|changed)/i.exec(
      text,
    );
  if (trig) {
    entity = trig[1]!.trim().toLowerCase();
    const verb = trig[2]!.toLowerCase();
    event =
      verb === 'submitted'
        ? 'submitted'
        : verb === 'updated' || verb === 'changed'
          ? 'updated'
          : 'created';
    recognised.push({ phrase: trig[0], meaning: `Trigger: ${entity} ${event}` });
    sentences.forEach((s, i) => s.includes(trig[0]) && used.add(i));
  }

  // Approvals, possibly conditional on an amount threshold in the same sentence.
  const approvals: ApprovalRequirement[] = [];
  sentences.forEach((sentence, i) => {
    const re =
      /\b(?:require|requires|needs?|get|obtain)\s+(?:an?\s+)?([a-z]+(?:\s+[a-z]+)?)\s+approval/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sentence))) {
      const who = m[1]!.toLowerCase().replace(/^(the|a|an)\s+/, '');
      const thr =
        /\b(above|over|more than|exceeds?|exceeding|greater than|at least|from)\s*(r|zar|\$|usd|€|eur|£|gbp)?\s?(\d[\d,\s]*(?:\.\d+)?)\s*(k|m)?\b/i.exec(
          sentence,
        );
      const threshold = thr
        ? {
            op: (/at least|from/i.test(thr[1]!) ? 'gte' : 'gt') as 'gt' | 'gte',
            amount: parseAmount(thr[3]!, thr[4]),
            currency: thr[2] ? CURRENCY[thr[2].toLowerCase()] : undefined,
          }
        : undefined;
      const manager = /manager|line manager|supervisor/.test(who);
      approvals.push({
        name: `${titleCase(who)} approval`,
        approverSource: manager ? 'requester_manager' : 'team',
        ...(manager ? {} : { team: titleCase(who) }),
        ...(threshold ? { threshold } : {}),
        order: approvals.length + 1,
      });
      recognised.push({
        phrase: m[0],
        meaning: `${titleCase(who)} approval${threshold ? ` when amount ${threshold.op === 'gt' ? '>' : '≥'} ${threshold.amount}${threshold.currency ? ` ${threshold.currency}` : ''}` : ''}`,
      });
      used.add(i);
    }
  });

  // Rejection behaviour
  let rejection: StructuredRequirements['rejection'] = 'unspecified';
  sentences.forEach((s, i) => {
    if (/reject(ed|ion)?\b.*\b(return|send back)/i.test(s)) {
      rejection = 'return_to_requester';
      used.add(i);
    } else if (/if (?:\w+\s){0,3}reject/i.test(s)) {
      rejection = 'reject_request';
      used.add(i);
    }
  });

  // Tasks
  let tasks: StructuredRequirements['tasks'];
  sentences.forEach((s, i) => {
    const t =
      /\bcreate\s+([a-z\- ]{0,40}?)\s*tasks?\b(?:\s+(after|once|when|on)\s+([a-z ]+?)(?:[,.;]|\s+and\b|$))?/i.exec(
        s,
      );
    if (t) {
      const when = /approv/i.test(t[3] ?? '') ? 'after_approval' : 'on_trigger';
      tasks = {
        when,
        label: (t[1] || 'fulfilment').trim() || 'fulfilment',
        items: [],
        dependencies: 'unspecified',
      };
      recognised.push({
        phrase: t[0],
        meaning: `Create ${tasks.label} tasks ${when === 'after_approval' ? 'after final approval' : 'when triggered'}`,
      });
      used.add(i);
    }
  });

  // Notifications
  const notifications: StructuredRequirements['notifications'] = [];
  sentences.forEach((s, i) => {
    const re =
      /\b(?:notify|email|inform|alert)\s+(?:the\s+)?(requester|requestor|approver|approvers|team)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const raw = m[1]!.toLowerCase();
      const audience = raw.startsWith('request')
        ? 'requester'
        : raw.startsWith('approver')
          ? 'approver'
          : 'team';
      notifications.push({ audience, event: 'status change' });
      recognised.push({ phrase: m[0], meaning: `Notify the ${audience}` });
      used.add(i);
    }
  });

  // Escalations
  const escalations: StructuredRequirements['escalations'] = [];
  sentences.forEach((s, i) => {
    const m = /\bescalate\s+(overdue|late|stale|pending)\s+(tasks?|approvals?)/i.exec(s);
    if (m) {
      escalations.push({ target: /approv/i.test(m[2]!) ? 'pending_approvals' : 'overdue_tasks' });
      const after = /\bafter\s+(\d+\s+(?:business\s+)?(?:hours?|days?))/i.exec(s);
      if (after) escalations[escalations.length - 1]!.after = after[1];
      recognised.push({ phrase: m[0], meaning: `Escalate ${m[1]} ${m[2]}` });
      used.add(i);
    }
  });

  const requirements = StructuredRequirementsSchema.parse({
    subject: { entity },
    trigger: { event, ...(event === 'submitted' ? { statusValue: 'Submitted' } : {}) },
    approvals,
    rejection,
    tasks,
    notifications,
    escalations,
    calendar: {},
  });
  return {
    requirements,
    recognised,
    unrecognised: sentences.filter((_, i) => !used.has(i)),
    interpreter: 'deterministic',
  };
}
