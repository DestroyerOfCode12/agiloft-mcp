// Generates docs/capability-matrix.md from the capability registry.
// Run: pnpm docs:capabilities   (CI checks the file is up to date)
import { writeFileSync } from 'node:fs';
import { CAPABILITIES, DOCS_CHECKED_AT } from '../packages/capabilities/src/index.ts';

const USE: Record<string, string> = {
  used: 'Used',
  not_implemented: 'Not implemented yet',
  blocked_by_policy: 'Disabled by policy',
  not_available: 'Not available (manual route)',
};
const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

const groups = [...new Set(CAPABILITIES.map((c) => c.category))];
let out = `# Agiloft capability matrix

> Generated from \`packages/capabilities/src/registry.ts\` by \`pnpm docs:capabilities\`. Do not edit by hand.

Official documentation checked: **${DOCS_CHECKED_AT}** (Agiloft CLM Help, agiloft-public.atlassian.net).
The documentation pages do not state a single product version; they describe the current release line on that date.

**Documentation status** says what the official documentation states. It is not proof that a particular
instance behaves that way. **Instance status** is recorded per connection by a read-only probe and is shown in
the console's Capability Explorer; write capabilities cannot be confirmed without an opt-in sandbox test.

| Status | Meaning |
| --- | --- |
| verified | The official documentation describes the capability and how to call it. |
| unverified | Not established by the documentation; may depend on the KB. |
| unsupported | No documented, externally callable mechanism was found. |
| restricted | Exists but limited by licence or permissions. |

`;
for (const g of groups) {
  out += `\n## ${g[0]!.toUpperCase()}${g.slice(1)}\n\n| ID | Capability | Docs | Agiloft Control | Mechanism | Limits / manual route | Evidence |\n| --- | --- | --- | --- | --- | --- | --- |\n`;
  for (const c of CAPABILITIES.filter((x) => x.category === g)) {
    const limits = [
      ...c.limits,
      ...(c.manualAlternative ? [`Manual: ${c.manualAlternative}`] : []),
    ].join(' ');
    const ev = c.evidence.map((e) => `[${esc(e.title)}](${e.url}) (${e.checkedAt})`).join('<br>');
    out += `| \`${c.id}\` | ${esc(c.title)} | ${c.docStatus} | ${USE[c.productUse]} | ${esc(c.mechanism ?? '—')} | ${esc(limits || '—')} | ${ev} |\n`;
  }
}
out += `\n## Findings in detail\n\n`;
for (const c of CAPABILITIES) {
  out += `### \`${c.id}\` — ${c.title}\n\n${c.description}\n\n- Documentation status: **${c.docStatus}**; Agiloft Control: **${USE[c.productUse]}**\n- Applies to: ${c.appliesTo}\n- Required permissions: ${c.requiredPermissions.join('; ') || '—'}\n- Instance probe: ${c.instanceProbe.replace(/_/g, ' ')}\n`;
  for (const e of c.evidence)
    out += `- Evidence: [${e.title}](${e.url}), checked ${e.checkedAt}: ${e.finding}\n`;
  out += '\n';
}
writeFileSync(new URL('../docs/capability-matrix.md', import.meta.url), out);
console.log(`Wrote ${CAPABILITIES.length} capabilities.`);
