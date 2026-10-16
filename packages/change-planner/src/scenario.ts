import {
  ChangePlanContentSchema,
  PLAN_SCHEMA_VERSION,
  type ChangePlanContent,
  type Environment,
  type FieldSchema,
  type ImplementationRoute,
  type OperationInput,
  type ScenarioStep,
  type TableSchema,
  type Unknown,
} from '@agiloft-control/shared';
import { getCapability } from '@agiloft-control/capabilities';
import type { StructuredRequirements } from './requirements.ts';

export interface ScenarioCatalog {
  /** Described tables considered relevant (bounded by the caller). */
  tables: readonly TableSchema[];
  /** Values of the team/group table's name column, when known. */
  teamNames: readonly string[];
}

export interface ScenarioTarget {
  connectionId: string;
  environment: Environment;
  kbName: string;
  instanceLabel: string;
}

export interface ScenarioMapping {
  subjectTable: string | null;
  amountField: string | null;
  statusField: string | null;
  requesterField: string | null;
  peopleTable: string | null;
  managerField: string | null;
  teamTable: string | null;
  templateTables: { workflow: string | null; approval: string | null; task: string | null };
}

export interface ScenarioAnalysis {
  requirements: StructuredRequirements;
  mapping: ScenarioMapping;
  steps: ScenarioStep[];
  unknowns: Unknown[];
  assumptions: ChangePlanContent['assumptions'];
  operations: OperationInput[];
  testCases: ChangePlanContent['testCases'];
  summary: string;
}

const RULES_URL =
  getCapability('admin.rules')?.evidence[1]?.url ??
  getCapability('admin.rules')?.evidence[0]?.url ??
  '';

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));

function scoreTable(entity: string, t: TableSchema): number {
  const target = words(entity);
  const hay = new Set([...words(t.name), ...words(t.label)]);
  const hits = target.filter((w) => hay.has(w)).length;
  return hits === 0 ? 0 : hits / Math.max(target.length, hay.size);
}

function findTable(tables: readonly TableSchema[], pred: (t: TableSchema) => boolean) {
  return tables.find(pred) ?? null;
}

const has = (t: TableSchema, ...needles: string[]) => {
  const h = `${t.name} ${t.label}`.toLowerCase();
  return needles.every((n) => h.includes(n));
};

function linkTo(field: FieldSchema, table: string | null) {
  return !!table && field.type === 'link' && !!field.links?.some((l) => l.table === table);
}

export function mapScenario(
  req: StructuredRequirements,
  catalog: ScenarioCatalog,
): ScenarioMapping {
  const tables = catalog.tables;
  const templateLike = (t: TableSchema) => has(t, 'template');
  let subject: TableSchema | null = null;
  if (req.subject.table) subject = tables.find((t) => t.name === req.subject.table) ?? null;
  if (!subject) {
    const ranked = tables
      .filter((t) => !templateLike(t))
      .map((t) => ({ t, s: scoreTable(req.subject.entity, t) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
    subject = ranked[0]?.t ?? null;
  }
  const people = findTable(
    tables,
    (t) =>
      /employee|people|person|contact|staff|user/.test(`${t.name} ${t.label}`.toLowerCase()) &&
      !templateLike(t),
  );
  const teams = findTable(
    tables,
    (t) => /\bteam|group/.test(`${t.name} ${t.label}`.toLowerCase()) && !templateLike(t),
  );
  const currencyFields = subject?.fields.filter((f) => f.type === 'currency') ?? [];
  const requester =
    subject?.fields.find(
      (f) => linkTo(f, people?.name ?? null) && /request|submit|creat|owner/.test(f.name),
    ) ?? null;
  const manager =
    people?.fields.find(
      (f) => linkTo(f, people.name) && /manager|supervisor|reports/.test(f.name),
    ) ?? null;
  const status =
    subject?.fields.find((f) => f.type === 'choice' && /status|state|stage/.test(f.name)) ?? null;
  return {
    subjectTable: subject?.name ?? null,
    amountField: currencyFields.length === 1 ? currencyFields[0]!.name : null,
    statusField: status?.name ?? null,
    requesterField: requester?.name ?? null,
    peopleTable: people?.name ?? null,
    managerField: manager?.name ?? null,
    teamTable: teams?.name ?? null,
    templateTables: {
      workflow: findTable(tables, (t) => has(t, 'workflow', 'template'))?.name ?? null,
      approval: findTable(tables, (t) => has(t, 'approval', 'template'))?.name ?? null,
      task: findTable(tables, (t) => has(t, 'task', 'template'))?.name ?? null,
    },
  };
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'item';

const fmtMoney = (amount: number, currency?: string) =>
  `${currency === 'ZAR' ? 'R' : currency ? `${currency} ` : ''}${amount.toLocaleString('en-ZA')}`;

/**
 * Decomposes structured requirements into the planning categories and
 * classifies each into an implementation route. Only steps that map onto
 * documented record operations against tables that exist on the connected KB
 * become executable operations; everything else becomes a manual step with
 * instructions, or an explicit unknown.
 */
export function analyseScenario(
  req: StructuredRequirements,
  catalog: ScenarioCatalog,
): ScenarioAnalysis {
  const m = mapScenario(req, catalog);
  const unknowns: Unknown[] = [];
  const assumptions: ChangePlanContent['assumptions'] = [];
  const steps: ScenarioStep[] = [];
  const operations: OperationInput[] = [];
  const schemas = new Map(catalog.tables.map((t) => [t.name, t]));

  const unknown = (id: string, question: string, impact: string, blocking: boolean) => {
    unknowns.push({ id, question, impact, blocking });
    return id;
  };
  const step = (
    s: Omit<ScenarioStep, 'operationIds' | 'unknownIds' | 'operationalNotes'> &
      Partial<ScenarioStep>,
  ) => steps.push({ operationIds: [], unknownIds: [], operationalNotes: [], ...s });
  const subjectLabel = m.subjectTable
    ? (schemas.get(m.subjectTable)?.label ?? m.subjectTable)
    : req.subject.entity;

  // ---------------------------------------------------------------- trigger
  const triggerUnknowns: string[] = [];
  if (!m.subjectTable) {
    triggerUnknowns.push(
      unknown(
        'u-subject-table',
        `Which Agiloft table holds "${req.subject.entity}" records?`,
        'No table could be matched; nothing can be planned against it.',
        true,
      ),
    );
  }
  const statusField = m.statusField
    ? schemas.get(m.subjectTable!)?.fields.find((f) => f.name === m.statusField)
    : undefined;
  const submittedChoice = statusField?.choices?.find(
    (c) => c.toLowerCase() === (req.trigger.statusValue ?? '').toLowerCase(),
  );
  if (req.trigger.event === 'submitted' && !submittedChoice) {
    triggerUnknowns.push(
      unknown(
        'u-submitted-state',
        `How is "submitted" represented on ${subjectLabel}?`,
        'The trigger condition for the rule cannot be written without it.',
        false,
      ),
    );
  }
  triggerUnknowns.push(
    unknown(
      'u-existing-rules',
      `Does ${subjectLabel} already have rules that instantiate approvals or tasks from templates?`,
      'Rule definitions cannot be read through any documented API, so overlap with existing automation must be checked in Setup > Rules.',
      false,
    ),
  );
  step({
    id: 's-trigger',
    category: 'trigger',
    title: 'Trigger',
    detail: m.subjectTable
      ? `Event-specific rule on "${m.subjectTable}" when a record is ${req.trigger.event}${submittedChoice ? ` (${m.statusField} = '${submittedChoice}')` : ''}. The rule should include the "Web" modification type so records created through the API are covered too.`
      : `Trigger on ${req.subject.entity} ${req.trigger.event}; table not yet identified.`,
    route: 'manual_admin',
    routeRationale: 'Rules can only be created in the Rules wizard; no rule API is documented.',
    status: m.subjectTable ? 'resolved' : 'needs_input',
    unknownIds: triggerUnknowns,
  });

  // ---------------------------------------------------- tables and fields
  const tf: string[] = [];
  if (m.subjectTable && !m.amountField && req.approvals.some((a) => a.threshold)) {
    tf.push(
      unknown(
        'u-amount-field',
        `Which field on ${subjectLabel} holds the amount compared with the threshold?`,
        'Threshold-based approval cannot be configured.',
        true,
      ),
    );
  }
  step({
    id: 's-tables',
    category: 'tables_fields',
    title: 'Tables and fields',
    detail: [
      `Subject: ${m.subjectTable ?? 'unknown'}`,
      `Amount: ${m.amountField ?? 'unknown'}`,
      `Status: ${m.statusField ?? 'unknown'}`,
      `Requester link: ${m.requesterField ?? 'unknown'}`,
      `People: ${m.peopleTable ?? 'unknown'}${m.managerField ? ` (manager via ${m.managerField})` : ''}`,
      `Teams: ${m.teamTable ?? 'unknown'}`,
      `Templates: ${Object.entries(m.templateTables)
        .map(([k, v]) => `${k}=${v ?? 'none'}`)
        .join(', ')}`,
    ].join('; '),
    route: 'native_existing',
    routeRationale:
      'Discovered from table metadata (EWTable) on the connected KB. No schema changes are proposed.',
    status: tf.length ? 'needs_input' : 'resolved',
    unknownIds: tf,
  });

  // ---------------------------------------------------------- conditions
  const thresholds = req.approvals.filter((a) => a.threshold);
  step({
    id: 's-conditions',
    category: 'conditions',
    title: 'Conditions and branching',
    detail: thresholds.length
      ? thresholds
          .map(
            (a) =>
              `${a.name} only when ${m.amountField ?? 'amount'} ${a.threshold!.op === 'gt' ? '>' : '≥'} ${fmtMoney(a.threshold!.amount, a.threshold!.currency)}`,
          )
          .join('; ')
      : 'No conditional branches were stated.',
    route: m.templateTables.approval ? 'config_records' : 'manual_admin',
    routeRationale: m.templateTables.approval
      ? `Thresholds are stored on approval template records in "${m.templateTables.approval}".`
      : 'Conditions must be expressed as saved-search conditions on rules in the Rules wizard.',
    status: 'resolved',
  });
  for (const a of thresholds) {
    if (a.threshold!.currency && a.threshold!.currency !== 'ZAR' && m.amountField) {
      assumptions.push({
        id: `a-currency-${slug(a.name)}`,
        text: `Amounts in ${m.amountField} are assumed to be in ${a.threshold!.currency}.`,
        source: 'planner',
      });
    }
    if (a.threshold!.op === 'gt') {
      assumptions.push({
        id: `a-boundary-${slug(a.name)}`,
        text: `"Above ${fmtMoney(a.threshold!.amount, a.threshold!.currency)}" is read as strictly greater than; exactly ${fmtMoney(a.threshold!.amount, a.threshold!.currency)} does not need ${a.name.toLowerCase()}.`,
        source: 'planner',
      });
    }
  }

  // -------------------------------------------------- approver resolution
  const approverUnknowns: string[] = [];
  const resolution: string[] = [];
  for (const a of req.approvals) {
    if (a.approverSource === 'requester_manager') {
      if (m.requesterField && m.managerField) {
        resolution.push(
          `${a.name}: ${m.subjectTable}.${m.requesterField} → ${m.peopleTable}.${m.managerField}`,
        );
      } else {
        approverUnknowns.push(
          unknown(
            `u-approver-${slug(a.name)}`,
            `How is the requester's manager found? No requester link to a people table with a manager field was discovered.`,
            `${a.name} cannot be routed.`,
            true,
          ),
        );
      }
    } else if (a.approverSource === 'team') {
      const team = catalog.teamNames.find((t) => t.toLowerCase() === (a.team ?? '').toLowerCase());
      if (team) {
        resolution.push(`${a.name}: team queue "${team}" (${m.teamTable})`);
        approverUnknowns.push(
          unknown(
            `u-approver-person-${slug(a.name)}`,
            `Should ${a.name.toLowerCase()} go to the "${team}" team queue, or to a named person within it?`,
            'Defaults to the team queue. Change before approval if a named approver is required.',
            false,
          ),
        );
      } else {
        approverUnknowns.push(
          unknown(
            `u-approver-${slug(a.name)}`,
            `Who performs ${a.name.toLowerCase()}? No team named "${a.team}" was found.`,
            `${a.name} cannot be routed.`,
            true,
          ),
        );
      }
    } else {
      approverUnknowns.push(
        unknown(
          `u-approver-${slug(a.name)}`,
          `Who performs ${a.name.toLowerCase()}?`,
          `${a.name} cannot be routed.`,
          true,
        ),
      );
    }
  }
  approverUnknowns.push(
    unknown(
      'u-manager-missing',
      'What happens when the requester has no manager recorded, or is their own approver?',
      'Without a rule for this, such requests may stall.',
      false,
    ),
  );
  step({
    id: 's-approvers',
    category: 'approver_resolution',
    title: 'Approver resolution',
    detail: resolution.length ? resolution.join('; ') : 'No approvers could be resolved.',
    route: m.templateTables.approval ? 'config_records' : 'manual_admin',
    routeRationale: m.templateTables.approval
      ? 'Approver sources are recorded on approval template records.'
      : 'Approvers must be set in rule actions in the Rules wizard.',
    status: approverUnknowns.some((u) => unknowns.find((x) => x.id === u)?.blocking)
      ? 'needs_input'
      : 'resolved',
    unknownIds: approverUnknowns,
  });

  // ------------------------------------------------------ approval order
  step({
    id: 's-order',
    category: 'approval_order',
    title: 'Approval order and rejection',
    detail: `${req.approvals.map((a) => `${a.order}. ${a.name}`).join(' → ') || 'No approvals'}. Rejection: ${
      req.rejection === 'unspecified'
        ? 'not stated; assumed to reject the request and skip later approvals'
        : req.rejection.replace(/_/g, ' ')
    }.`,
    route: m.templateTables.approval ? 'config_records' : 'manual_admin',
    routeRationale: m.templateTables.approval
      ? 'Order and rejection behaviour are fields on approval templates.'
      : 'Encoded in rule priorities and conditions.',
    status: 'resolved',
  });
  if (req.rejection === 'unspecified') {
    assumptions.push({
      id: 'a-rejection',
      text: 'Any rejection rejects the request; later approvals are not requested.',
      source: 'default',
    });
  }

  // -------------------------------------- executable config-record operations
  const wfTable = m.templateTables.workflow ? schemas.get(m.templateTables.workflow) : undefined;
  const apTable = m.templateTables.approval ? schemas.get(m.templateTables.approval) : undefined;
  const tkTable = m.templateTables.task ? schemas.get(m.templateTables.task) : undefined;
  const workflowName = `${titleCase(req.subject.entity)} – threshold approval`;
  const fieldOf = (t: TableSchema | undefined, ...names: string[]) =>
    t?.fields.find((f) => names.includes(f.name))?.name;

  const configOps: string[] = [];
  if (wfTable && fieldOf(wfTable, 'name')) {
    const fields: Record<string, unknown> = { name: workflowName };
    if (fieldOf(wfTable, 'description'))
      fields.description = `Generated by Agiloft Control from scenario. ${req.approvals.length} approval step(s).`;
    if (fieldOf(wfTable, 'applies_to') && m.subjectTable) fields.applies_to = m.subjectTable;
    const activeField = wfTable.fields.find((f) => f.name === 'active');
    if (activeField?.choices?.includes('No')) fields.active = 'No';
    operations.push({
      id: 'create-workflow-template',
      kind: 'record.create',
      title: `Create workflow template "${workflowName}"`,
      route: 'config_records',
      table: wfTable.name,
      fields: fields as OperationInput['fields'],
      reconcileBy: { field: 'name', value: workflowName },
      risk: 'low',
      description: activeField
        ? 'Created inactive so that it has no effect until an administrator activates it after rule configuration.'
        : undefined,
      sideEffects: [`Rules on "${wfTable.name}" that run for Web changes may fire.`],
      compensation: 'Set the template inactive or delete it in the Agiloft UI.',
      capabilityIds: ['records.create'],
    });
    configOps.push('create-workflow-template');
  }
  if (apTable && wfTable && configOps.length) {
    for (const a of req.approvals) {
      const name = `${workflowName}: ${a.name}`;
      const fields: Record<string, unknown> = { name, workflow: { qbe: { value: workflowName } } };
      const src = apTable.fields.find((f) => f.name === 'approver_source');
      if (src?.choices) {
        const choice =
          a.approverSource === 'requester_manager'
            ? src.choices.find((c) => /manager/i.test(c))
            : a.approverSource === 'team'
              ? src.choices.find((c) => /team/i.test(c))
              : undefined;
        if (choice) fields.approver_source = choice;
      }
      if (
        a.approverSource === 'team' &&
        a.team &&
        fieldOf(apTable, 'approver_team') &&
        catalog.teamNames.some((t) => t.toLowerCase() === a.team!.toLowerCase())
      ) {
        fields.approver_team = {
          qbe: { value: catalog.teamNames.find((t) => t.toLowerCase() === a.team!.toLowerCase())! },
        };
      }
      if (a.threshold && fieldOf(apTable, 'min_amount'))
        fields.min_amount =
          a.threshold.op === 'gt' ? a.threshold.amount : a.threshold.amount - 0.01;
      if (fieldOf(apTable, 'step_order')) fields.step_order = a.order;
      const rej = apTable.fields.find((f) => f.name === 'on_reject');
      if (rej?.choices) {
        const choice =
          req.rejection === 'return_to_requester'
            ? rej.choices.find((c) => /return/i.test(c))
            : rej.choices.find((c) => /reject/i.test(c));
        if (choice) fields.on_reject = choice;
      }
      const id = `create-approval-${slug(a.name)}`;
      operations.push({
        id,
        kind: 'record.create',
        title: `Create approval template "${a.name}"`,
        route: 'config_records',
        dependsOn: ['create-workflow-template'],
        table: apTable.name,
        fields: fields as OperationInput['fields'],
        reconcileBy: { field: 'name', value: name },
        risk: 'low',
        sideEffects: [`Rules on "${apTable.name}" that run for Web changes may fire.`],
        compensation: 'Delete the template record in the Agiloft UI.',
        capabilityIds: ['records.create', 'records.link_by_value'],
      });
      configOps.push(id);
    }
  }

  // ---------------------------------------------------------------- tasks
  const taskUnknowns: string[] = [];
  if (req.tasks) {
    const items = req.tasks.items.length
      ? req.tasks.items
      : [
          { name: 'Procure device', team: undefined, slaBusinessDays: undefined },
          { name: 'Prepare and enrol device', team: undefined, slaBusinessDays: undefined },
          { name: 'Deliver to requester', team: undefined, slaBusinessDays: undefined },
        ];
    if (!req.tasks.items.length) {
      assumptions.push({
        id: 'a-task-list',
        text: `The ${req.tasks.label} tasks were not listed; a placeholder sequence (procure, prepare, deliver) is proposed for review.`,
        source: 'planner',
      });
      taskUnknowns.push(
        unknown(
          'u-task-list',
          `Which ${req.tasks.label} tasks are needed, and which team owns each?`,
          'Placeholder tasks will be created as templates unless changed.',
          false,
        ),
      );
    }
    if (tkTable && configOps.includes('create-workflow-template')) {
      items.forEach((item, i) => {
        const name = `${workflowName}: ${item.name}`;
        const fields: Record<string, unknown> = {
          name,
          workflow: { qbe: { value: workflowName } },
        };
        if (fieldOf(tkTable, 'step_order')) fields.step_order = i + 1;
        if (item.team && fieldOf(tkTable, 'assigned_team') && catalog.teamNames.includes(item.team))
          fields.assigned_team = { qbe: { value: item.team } };
        if (item.slaBusinessDays != null && fieldOf(tkTable, 'sla_business_days'))
          fields.sla_business_days = item.slaBusinessDays;
        const id = `create-task-${slug(item.name)}`;
        operations.push({
          id,
          kind: 'record.create',
          title: `Create task template "${item.name}"`,
          route: 'config_records',
          dependsOn: ['create-workflow-template'],
          table: tkTable.name,
          fields: fields as OperationInput['fields'],
          reconcileBy: { field: 'name', value: name },
          risk: 'low',
          sideEffects: [`Rules on "${tkTable.name}" that run for Web changes may fire.`],
          compensation: 'Delete the template record in the Agiloft UI.',
          capabilityIds: ['records.create', 'records.link_by_value'],
        });
        configOps.push(id);
      });
    }
    step({
      id: 's-tasks',
      category: 'tasks',
      title: 'Tasks and dependencies',
      detail: `${items.map((t, i) => `${i + 1}. ${t.name}`).join(', ')}; created ${req.tasks.when === 'after_approval' ? 'after the final approval' : 'when triggered'}; ${
        req.tasks.dependencies === 'parallel' ? 'in parallel' : 'sequentially (assumed)'
      }.`,
      route: tkTable ? 'config_records' : 'manual_admin',
      routeRationale: tkTable
        ? `Task templates are records in "${tkTable.name}". A rule must still instantiate tasks from templates after approval.`
        : 'Tasks must be created by a rule action (Rules wizard).',
      status: 'resolved',
      operationIds: configOps.filter((o) => o.startsWith('create-task')),
      unknownIds: taskUnknowns,
    });
  }

  // ------------------------------------------------- rule configuration (manual)
  const ruleOpId = 'configure-rules';
  const ruleInstructions = [
    `Open Setup > Rules (or Setup [Table] > Rules for "${m.subjectTable ?? req.subject.entity}") and click New.`,
    `Rule type: "When a record is created/edited". Condition: ${req.trigger.event === 'submitted' && m.statusField ? `${m.statusField} changes to '${submittedChoice ?? 'Submitted'}'` : `record ${req.trigger.event}`}; tick Web (covers API/web-service changes) and API if other rules can change the status.`,
    ...req.approvals.map(
      (a) =>
        `Action: create an approval record for "${a.name}"${a.threshold ? ` only when ${m.amountField ?? 'amount'} ${a.threshold.op === 'gt' ? '>' : '≥'} ${fmtMoney(a.threshold.amount, a.threshold.currency)}` : ''}; order ${a.order}.`,
    ),
    req.tasks
      ? `Separate rule after the final approval: create ${req.tasks.label} task records from the task templates linked to "${workflowName}".`
      : '',
    'Set rule priorities so validations run first and approvals are created before tasks.',
    `Reference: ${RULES_URL}`,
  ].filter(Boolean);
  operations.push({
    id: ruleOpId,
    kind: 'manual.configure',
    title: 'Configure approval and task rules in the Rules wizard',
    route: 'manual_admin',
    dependsOn: configOps.length ? [...configOps] : [],
    risk: 'high',
    irreversible: false,
    sideEffects: [
      'Once enabled, rules act on every matching record created or edited from that moment.',
    ],
    manualInstructions: ruleInstructions,
    capabilityIds: ['admin.rules'],
  });

  // ------------------------------------------------------- notifications
  if (req.notifications.length) {
    operations.push({
      id: 'configure-notifications',
      kind: 'manual.configure',
      title: 'Configure requester notifications',
      route: 'manual_admin',
      dependsOn: [ruleOpId],
      risk: 'medium',
      sideEffects: ['Emails sent by Agiloft cannot be recalled.'],
      manualInstructions: [
        `Add an Email action to the status-change rule on "${m.subjectTable ?? req.subject.entity}" addressed to the ${req.notifications.map((n) => n.audience).join(', ')}.`,
        'Email actions run in the background by default; choose foreground processing if later actions depend on the email content.',
      ],
      capabilityIds: ['admin.actions'],
    });
    step({
      id: 's-notifications',
      category: 'notifications',
      title: 'Notifications',
      detail: req.notifications.map((n) => `Notify ${n.audience} on ${n.event}`).join('; '),
      route: 'manual_admin',
      routeRationale:
        'Email actions are configured in the Rules wizard Action tab; no action API is documented.',
      status: 'resolved',
      operationIds: ['configure-notifications'],
    });
  }

  // -------------------------------------------- deadlines and escalations
  const calUnknowns: string[] = [];
  if (!req.calendar.businessCalendar) {
    calUnknowns.push(
      unknown(
        'u-calendar',
        'Which business calendar and public holidays define "overdue"?',
        'Escalation timing cannot be configured correctly. Not invented by the planner.',
        false,
      ),
    );
  }
  if (!req.calendar.timezone) {
    calUnknowns.push(
      unknown(
        'u-timezone',
        'Which time zone applies to deadlines (requester, fulfilment team, or KB default)?',
        'Deadlines may be off by hours for distributed teams.',
        false,
      ),
    );
  }
  step({
    id: 's-deadlines',
    category: 'deadlines',
    title: 'Deadlines, business calendar and time zone',
    detail: `Task SLAs: ${req.tasks?.items.some((i) => i.slaBusinessDays != null) ? 'from requirements' : 'not stated'}. Calendar: ${req.calendar.businessCalendar ?? 'unknown'}. Time zone: ${req.calendar.timezone ?? 'unknown'}.`,
    route: 'manual_admin',
    routeRationale:
      'Rules can be restricted to a team’s working hours in the Schedule tab of the Rules wizard; holiday calendars are not exposed via API.',
    status: calUnknowns.length ? 'needs_input' : 'resolved',
    unknownIds: calUnknowns,
  });
  if (req.escalations.length) {
    operations.push({
      id: 'configure-escalations',
      kind: 'manual.configure',
      title: 'Configure time-based escalation rules',
      route: 'manual_admin',
      dependsOn: [ruleOpId],
      risk: 'medium',
      sideEffects: ['Escalation emails cannot be recalled.'],
      manualInstructions: [
        'Create a time-based rule ("At selected time intervals") on the task table with a saved search for open tasks past their due date.',
        'Agiloft-hosted KBs run time-based rules at most every 5 minutes; by default only one time-based rule runs per KB at a time.',
        'Do not enable until the business calendar and time zone questions are answered.',
        'Time-based rule errors are emailed to the admin team automatically.',
      ],
      capabilityIds: ['admin.rules'],
    });
    step({
      id: 's-escalations',
      category: 'escalations',
      title: 'Escalations',
      detail: req.escalations
        .map(
          (e) =>
            `Escalate ${e.target.replace('_', ' ')}${e.after ? ` after ${e.after}` : ''}${e.to ? ` to ${e.to}` : ''}`,
        )
        .join('; '),
      route: 'manual_admin',
      routeRationale:
        'Native time-based rules are the documented mechanism. External orchestration (a scheduler polling the API) was considered and not substituted: it would need separate hosting, credentials and monitoring and would duplicate native behaviour.',
      status: calUnknowns.length ? 'needs_input' : 'resolved',
      operationIds: ['configure-escalations'],
      unknownIds: calUnknowns,
      operationalNotes: [
        'Escalation recipients are not stated; defaulting to the assigned team lead is an assumption to confirm.',
      ],
    });
    assumptions.push({
      id: 'a-escalation-target',
      text: 'Overdue tasks escalate to the assigned team’s lead.',
      source: 'default',
    });
  }

  // ---------------------------------------------------------- permissions
  operations.push({
    id: 'review-permissions',
    kind: 'manual.configure',
    title: 'Review group permissions for approvers and fulfilment teams',
    route: 'manual_admin',
    dependsOn: [ruleOpId],
    risk: 'medium',
    manualInstructions: [
      'Ensure approvers can view the request and edit the decision on their approval records only.',
      'Ensure fulfilment teams can edit tasks assigned to them.',
      'Keep the Agiloft Control integration account limited to the template tables it writes.',
    ],
    capabilityIds: ['admin.permissions'],
  });
  step({
    id: 's-permissions',
    category: 'permissions',
    title: 'Permissions',
    detail:
      'Approvers: edit own approval decisions. Fulfilment teams: edit assigned tasks. Integration account: create on template tables only.',
    route: 'manual_admin',
    routeRationale: 'Group permissions have no documented API.',
    status: 'resolved',
    operationIds: ['review-permissions'],
  });

  // ------------------------------------------------- audit, failure, tests
  step({
    id: 's-audit',
    category: 'audit',
    title: 'Audit evidence',
    detail:
      'Agiloft record history captures approval decisions and task changes (rules can be set to always record history). Agiloft Control records who prepared, approved and executed this plan, with per-operation results.',
    route: 'native_existing',
    routeRationale: 'Uses existing Agiloft history plus the Agiloft Control audit log.',
    status: 'resolved',
  });
  step({
    id: 's-failure',
    category: 'failure_retry',
    title: 'Failure and retry behaviour',
    detail:
      'Template creation: each create carries a unique name for reconciliation; an ambiguous failure is checked before any retry. Rules: a failing Validate action blocks the save; time-based rule errors are emailed to the admin team.',
    route: 'native_existing',
    routeRationale:
      'Combines Agiloft Control execution safeguards with documented Agiloft rule behaviour.',
    status: 'resolved',
  });

  const testCases: ChangePlanContent['testCases'] = [];
  const t = (title: string, given: string, when: string, then: string) =>
    testCases.push({ id: `t-${testCases.length + 1}`, title, given, when, then });
  const finance = thresholds[0];
  const mgr = req.approvals.find((a) => a.approverSource === 'requester_manager');
  if (finance) {
    const thr = finance.threshold!;
    t(
      'Below threshold',
      `A request of ${fmtMoney(thr.amount - 100, thr.currency)}`,
      'it is submitted',
      `${mgr ? `${mgr.name} only` : 'no threshold approval'}; ${finance.name} is not requested.`,
    );
    t(
      'Exactly at threshold',
      `A request of ${fmtMoney(thr.amount, thr.currency)}`,
      'it is submitted',
      thr.op === 'gt'
        ? `${finance.name} is NOT requested (strictly above).`
        : `${finance.name} is requested.`,
    );
    t(
      'Above threshold',
      `A request of ${fmtMoney(thr.amount + 100, thr.currency)}`,
      'it is submitted',
      `${req.approvals.map((a) => a.name).join(' then ')}, in that order.`,
    );
  }
  if (mgr)
    t(
      'Manager rejects',
      'A submitted request',
      `the ${mgr.name.toLowerCase()} is rejected`,
      'The request is rejected; no later approvals or tasks are created; the requester is notified.',
    );
  if (finance)
    t(
      `${finance.name} rejects`,
      'A request above the threshold approved by the manager',
      `${finance.name.toLowerCase()} is rejected`,
      'The request is rejected; no tasks are created.',
    );
  t(
    'Requester without manager',
    'A requester with no manager recorded',
    'they submit a request',
    'The request is routed to the agreed fallback, not left pending silently.',
  );
  if (req.tasks)
    t(
      'Tasks after approval',
      'A request with all required approvals',
      'the final approval is recorded',
      `${req.tasks.label} tasks are created once, in order.`,
    );
  if (req.notifications.length)
    t(
      'Requester notified',
      'A request',
      'its status changes',
      'The requester receives exactly one email per change.',
    );
  if (req.escalations.length)
    t(
      'Overdue escalation',
      'A task past its due date in the agreed calendar',
      'the time-based rule runs',
      'The escalation is sent once and recorded in history.',
    );
  t(
    'API-created request',
    'A request created through the REST API',
    'it is saved',
    'The same rules fire as for a web-created request (rules include the Web modification type).',
  );
  step({
    id: 's-tests',
    category: 'test_cases',
    title: 'Test cases',
    detail: `${testCases.length} test cases generated; run them in a non-production KB before enabling rules in production.`,
    route: 'manual_admin',
    routeRationale: 'Rule behaviour can only be observed by exercising the KB.',
    status: 'resolved',
  });

  const executable = operations.filter((o) => o.kind === 'record.create').length;
  const manual = operations.length - executable;
  return {
    requirements: req,
    mapping: m,
    steps,
    unknowns,
    assumptions,
    operations,
    testCases,
    summary: `${steps.length} planning steps; ${executable} executable record operation(s) on configuration tables and ${manual} manual administrator step(s). ${
      unknowns.filter((u) => u.blocking).length
    } blocking and ${unknowns.filter((u) => !u.blocking).length} non-blocking open question(s).`,
  };
}

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

export function planFromScenario(
  analysis: ScenarioAnalysis,
  target: ScenarioTarget,
  requestText?: string,
): ChangePlanContent {
  const ops = analysis.operations;
  const writeOps = ops
    .filter((o) => o.kind === 'record.create' || o.kind === 'record.update')
    .map((o) => o.id);
  return ChangePlanContentSchema.parse({
    schemaVersion: PLAN_SCHEMA_VERSION,
    title: `Implement: ${titleCase(analysis.requirements.subject.entity)} approval process`,
    summary: analysis.summary,
    target,
    request: {
      source: 'scenario',
      ...(requestText ? { text: requestText } : {}),
      structured: analysis.requirements,
    },
    assumptions: analysis.assumptions,
    unknowns: analysis.unknowns,
    capabilityEvidence: [],
    preconditions: [
      ...Object.values(analysis.mapping.templateTables)
        .filter((t): t is string => !!t)
        .map((t) => ({
          id: `p-table-${t}`,
          description: `Table "${t}" exists`,
          kind: 'table_exists' as const,
          table: t,
        })),
      {
        id: 'p-writes',
        description: 'Writes are enabled for the target environment',
        kind: 'writes_enabled',
      },
    ],
    operations: ops,
    sideEffects: writeOps.length
      ? [
          {
            id: 'se-rules',
            description:
              'Creating records through the API can trigger any event rule on the affected tables that includes the "Web" modification type, including emails and record changes. These cannot be enumerated through a documented API.',
            reversible: false,
            operationIds: writeOps,
          },
        ]
      : [],
    validationSteps: [
      {
        id: 'v-read-back',
        description: 'Each created record is read back and compared with the requested values.',
        operationIds: writeOps,
      },
      {
        id: 'v-tests',
        description: 'Run the generated test cases in a non-production KB before enabling rules.',
        operationIds: [],
      },
    ],
    recovery: {
      strategy:
        'Templates are created inactive where the table supports it, so they have no effect until rules are configured. Recovery is manual: deactivate or delete created templates in the Agiloft UI.',
      compensatingActions: writeOps.map((id) => ({
        operationId: id,
        description: 'Deactivate or delete the created record in the Agiloft UI.',
        automated: false,
      })),
      limits: [
        'No atomic transaction exists across Agiloft API calls.',
        'Emails or other effects of rules triggered by these writes cannot be undone.',
      ],
    },
    testCases: analysis.testCases,
    scenarioSteps: analysis.steps,
  });
}
