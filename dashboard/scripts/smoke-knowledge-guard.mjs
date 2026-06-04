// Fast, model-free unit check for the knowledge read-only guard.
// Verifies that knowledgeWriteBlock() denies writes targeting a read-only
// knowledge directory while leaving every other call untouched.
import path from 'node:path';
import { knowledgeWriteBlock, isKnowledgeSourceWritable } from '../server-agent.ts';

const cwd = '/tmp/agentma-run';
const vault = '/tmp/agentma-vault';
const dirs = [vault];

const cases = [
  // [label, toolName, input, readOnlyDirs, expectedBlockedTarget]
  ['Write into vault is blocked', 'Write', { file_path: `${vault}/note.md` }, dirs, `${vault}/note.md`],
  ['Edit into vault is blocked', 'Edit', { file_path: `${vault}/Projects/a.md` }, dirs, `${vault}/Projects/a.md`],
  ['MultiEdit into vault is blocked', 'MultiEdit', { file_path: `${vault}/b.md` }, dirs, `${vault}/b.md`],
  ['NotebookEdit into vault is blocked', 'NotebookEdit', { notebook_path: `${vault}/c.ipynb` }, dirs, `${vault}/c.ipynb`],
  ['the vault root itself is blocked', 'Write', { file_path: vault }, dirs, vault],
  ['relative path resolving into vault is blocked', 'Write', { file_path: '../agentma-vault/x.md' }, ['/tmp/agentma-run/../agentma-vault'], '../agentma-vault/x.md'],

  ['Write outside vault is allowed', 'Write', { file_path: `${cwd}/out.md` }, dirs, null],
  ['Read is never blocked', 'Read', { file_path: `${vault}/note.md` }, dirs, null],
  ['Grep is never blocked', 'Grep', { pattern: 'x', path: vault }, dirs, null],
  ['Bash is not path-guarded (out of scope)', 'Bash', { command: `echo x > ${vault}/note.md` }, dirs, null],
  ['no read-only dirs means no block', 'Write', { file_path: `${vault}/note.md` }, [], null],
  ['sibling prefix is not treated as inside', 'Write', { file_path: '/tmp/agentma-vault-other/note.md' }, dirs, null],
  ['missing path field is a no-op', 'Write', {}, dirs, null],
];

let failures = 0;
for (const [label, tool, input, readOnlyDirs, expected] of cases) {
  const actual = knowledgeWriteBlock(tool, input, cwd, readOnlyDirs);
  const norm = (v) => (v == null ? null : path.resolve(cwd, v));
  const ok = expected == null ? actual == null : actual != null && norm(actual) === norm(expected);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} -> ${JSON.stringify(actual)}`);
  if (!ok) failures += 1;
}

// Creator-aware writability: only the creator, with read_only off, may write.
const alice = 'alice@example.test';
const bob = 'bob@example.test';
const writableCases = [
  ['creator + read_only off is writable', { createdBy: alice, readOnly: false }, alice, true],
  ['creator + read_only on stays locked', { createdBy: alice, readOnly: true }, alice, false],
  ['non-creator never writes (even read_only off)', { createdBy: alice, readOnly: false }, bob, false],
  ['unknown creator never writes', { createdBy: null, readOnly: false }, alice, false],
  ['no runner identity never writes', { createdBy: alice, readOnly: false }, undefined, false],
];
for (const [label, source, sub, expected] of writableCases) {
  const actual = isKnowledgeSourceWritable(source, sub);
  const ok = actual === expected;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} -> ${actual}`);
  if (!ok) failures += 1;
}

const total = cases.length + writableCases.length;
if (failures) {
  console.error(`knowledge guard smoke failed: ${failures} case(s)`);
  process.exit(1);
}
console.log(`knowledge guard smoke passed: ${total}/${total}`);
