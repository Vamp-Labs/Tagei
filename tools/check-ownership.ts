// Folder-ownership guard for the multi-agent workflow (docs/spec/F0-repo.md §Ownership).
// Run by .githooks/pre-commit with --staged, or in CI with --base <ref>.

import { execFileSync } from 'node:child_process';

type Rule = { agent: string; branch: RegExp; allow: string[] };

const A0_ONLY = 'A0 owns this path — raise a change request in docs/handoffs instead';

const RULES: Rule[] = [
  { agent: 'A1', branch: /^feat\/a1-/, allow: ['research/**', 'e2e/**', 'server/test/integration/**', 'server/test/fakes/**', 'tools/demo-check.ts'] },
  { agent: 'A2', branch: /^feat\/a2-/, allow: ['contracts/**'] },
  {
    agent: 'A3',
    branch: /^feat\/a3-/,
    allow: [
      'server/src/{pricehub,relayer,recorder,ops,indexer,market}/**',
      'server/src/db/schema/{oracle,relayer,rounds,chain}.ts',
      'server/test/{pricehub,relayer,recorder,ops,indexer,market}/**',
    ],
  },
  {
    agent: 'A4',
    branch: /^feat\/a4-/,
    allow: [
      'server/src/{api,sse,auth,faucet,progression,pix}/**',
      'server/src/db/schema/{players,progression,pix,faucet,events}.ts',
      'server/test/{api,sse,auth,faucet,progression,pix}/**',
      'packages/shared/src/templates/**',
    ],
  },
  { agent: 'A5', branch: /^feat\/a5-/, allow: ['src/{web3,api,game}/**', 'src/services/**', 'src/types/**', 'src/main.tsx', 'test/**'] },
  { agent: 'A6', branch: /^feat\/a6-/, allow: ['src/App.tsx', 'src/components/**', 'src/canvas/**', 'src/ui/**', 'src/index.css', 'test/ui/**'] },
];

function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i++;
      if (glob[i + 1] === '/') i++;
    } else if (c === '*') re += '[^/]*';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      re += `(?:${glob.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|')})`;
      i = end;
    } else re += c.replace(/[.+^$()|[\]\\?]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();

function changedFiles(): string[] {
  const baseIdx = process.argv.indexOf('--base');
  const out = baseIdx > 0 ? git('diff', '--name-only', `${process.argv[baseIdx + 1]}...HEAD`) : git('diff', '--cached', '--name-only');
  return out.split('\n').filter(Boolean);
}

const branch = process.env.OWNERSHIP_BRANCH ?? git('rev-parse', '--abbrev-ref', 'HEAD');
const rule = RULES.find((r) => r.branch.test(branch));
if (!rule) process.exit(0); // A0 branches (main, integration, chore/a0-*) may touch everything.

const allowed = rule.allow.map(globToRegExp);
const violations = changedFiles().filter((f) => !allowed.some((re) => re.test(f)));
if (violations.length > 0) {
  console.error(`ownership: ${rule.agent} (${branch}) may not change:\n${violations.map((v) => `  - ${v}`).join('\n')}\n${A0_ONLY}`);
  process.exit(1);
}
