# Demo walkthrough

The demo uses the **demo adapter**, a stand-in for an Agiloft KB backed by synthetic data (fictional company "Acme Demo"). It never opens a network connection. Everything above the adapter (permissions, plans, approvals, execution engine, audit) is the production code path.

Start it with `pnpm demo` (or `docker compose up --build`) and open <http://localhost:8080>. The purple **DEMO** badge and banner stay visible throughout.

| User         | Roles                                               |
| ------------ | --------------------------------------------------- |
| Oli Operator | viewer everywhere; operator in demo and development |
| Ana Approver | approver everywhere                                 |
| Avery Admin  | admin                                               |
| Vic Viewer   | viewer                                              |

Two plans are seeded and awaiting approval: the laptop-request process and "Route LR-1004 to manager approval".

## 1. Schema discovery and records (any user)

1. Open **Schema Explorer**, then **Laptop Requests**.
   - Fields, types, required status and links appear (for example `requester → employees.full_name`).
   - There is no edit button: no documented API exists for schema changes.
2. Open **Records**, choose `laptop_requests` and add the filter _Status equals Submitted_.
   - The exact query sent is shown: `status='Submitted'`.
3. Open record **304**. Its justification contains an instruction aimed at AI assistants. It is shown as untrusted data and does nothing.

![Record detail](screenshots/record-detail.png)

## 2. Capabilities and unsupported administration

**Capability Explorer**, search for "rules":

- _Create, read or modify rules_ is **Unsupported**.
- It links to the official documentation.
- It names the manual route: the Rules wizard.

![Capability explorer](screenshots/capability-explorer.png)

## 3. Scenario → plan (Oli Operator)

1. Open **Scenario Builder** and choose **Use the laptop-request example**, then **Analyse**.
2. Review the 13 planning categories, each with an implementation route:
   - Approval and task templates are **configuration records**: executable, because the demo KB stores templates as records.
   - Rules, notifications, escalations and permissions are **manual administrator steps**.
   - Open questions are listed rather than invented (business calendar, time zone, which Finance approver, task list).
   - Test cases include the R20,000 boundary.
3. Choose **Create change plan**, then **Submit for approval**.

![Scenario builder](screenshots/scenario-builder.png)

## 4. Approval (Ana Approver)

1. Open **Approvals** and pick a plan.
2. The review shows the exact operations, before and after values, side effects, recovery limits and the version and hash being approved.
3. Enter a reason, then **Approve** or **Reject**.

Separation of duties: if Oli tried to approve his own plan, the server would refuse.

## 5. Stale-data conflict (Oli, then Ana)

1. Ana approves _Route LR-1004 to manager approval_.
2. Oli opens **Connections → Demo controls**, then **Apply external edit**. This changes LR-1004's status to `Rejected`, as if another Agiloft user had edited it.
3. Oli opens the plan and chooses **Execute**.
4. The execution **fails with `STALE_RECORD`**, and nothing is written: the captured "before" value no longer matches.

![Stale record](screenshots/execution-stale.png)

## 6. Partial failure (Oli, then Ana)

1. **Connections → Demo controls**: arm _Next write is rejected by a validation rule_ on table `task_templates`.
2. Ana approves the seeded laptop-request plan.
3. Oli executes it.
   - The workflow and approval templates are created; the first task template is rejected; later steps are **skipped**.
   - The execution is **Partially succeeded**, with recovery guidance. Nothing is rolled back.

![Partial failure](screenshots/execution-partial.png)

Other faults:

- _Response lost after apply_ demonstrates reconciliation. The engine finds the record by its unique name instead of creating a duplicate.
- _Timeout before apply_ demonstrates a safe retry.

## 7. Successful execution

1. In **Records**, open `tasks` → 505 and choose **Propose an update**. Set the status to _In Progress_.
2. Submit; Ana approves; Oli executes.
3. Result: **Succeeded**. The simulated "Web" rule also fires: see the `notifications` table for status changes on laptop requests.

![Success](screenshots/execution-success.png)

## 8. Audit and settings (Avery Admin)

- **Audit Log**: every action, including denied attempts, with actor, channel (console or MCP), environment and redacted details. CSV export is available.
- **Settings**: environment policies (writes are off by default except in demo), roles, MCP connection instructions and health.

To reset the demo: **Connections → Demo controls → Reset demo data** (administrators only). Or delete `.data/` and restart.

## Doing the same from an AI assistant

Connect an MCP client (see [mcp-clients.md](mcp-clients.md)) and ask, for example:

> "Find laptop requests that are still Submitted and prepare an update routing LR-1004 to manager approval."

The assistant can prepare and submit the plan, but it cannot approve it. Approval happens in the console. Once Ana approves, the assistant can call `execute_approved_plan` and `get_execution_status`.
