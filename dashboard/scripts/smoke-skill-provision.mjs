// Smoke test for provisionRunSkills (server-agent.ts).
// 规则: 宿主有的以宿主为准(每次覆盖),只在 workspace 里有的沿用;
// skill 目录本身按 realpath 解析,目录内部软链接一律丢弃。
// Run: npx tsx scripts/smoke-skill-provision.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentma-skill-smoke-'));
const skillsHome = path.join(tmpRoot, 'host-skills');       // 扮演 ~/.claude/skills
const linkTarget = path.join(tmpRoot, 'cc-switch-skills');  // 扮演 ~/.cc-switch/skills
const cwd = path.join(tmpRoot, 'run-cwd');
fs.mkdirSync(skillsHome, { recursive: true });
fs.mkdirSync(cwd, { recursive: true });

// 1. 普通目录 skill
fs.mkdirSync(path.join(skillsHome, 'plain'), { recursive: true });
fs.writeFileSync(path.join(skillsHome, 'plain', 'SKILL.md'), '# plain');
fs.writeFileSync(path.join(skillsHome, 'plain', 'helper.py'), 'print(1)');

// 2. 顶层软链接 skill (cc-switch 场景),内含一个指向宿主文件的软链接
fs.mkdirSync(path.join(linkTarget, 'linked'), { recursive: true });
fs.writeFileSync(path.join(linkTarget, 'linked', 'SKILL.md'), '# linked');
const secret = path.join(tmpRoot, 'secret.txt');
fs.writeFileSync(secret, 'HOST SECRET');
fs.symlinkSync(secret, path.join(linkTarget, 'linked', 'escape.txt'));
fs.symlinkSync(path.join(linkTarget, 'linked'), path.join(skillsHome, 'linked'));

// 3. 缺 SKILL.md
fs.mkdirSync(path.join(skillsHome, 'no-manifest'), { recursive: true });

// 4. 只在 workspace 里有的 skill (宿主库没有)
const wsOnly = path.join(cwd, '.claude', 'skills', 'ws-only');
fs.mkdirSync(wsOnly, { recursive: true });
fs.writeFileSync(path.join(wsOnly, 'SKILL.md'), '# workspace-only');

// 5. 宿主与 workspace 同名 — 宿主为准
const wsShadow = path.join(cwd, '.claude', 'skills', 'shadow');
fs.mkdirSync(wsShadow, { recursive: true });
fs.writeFileSync(path.join(wsShadow, 'SKILL.md'), '# workspace-version');
fs.mkdirSync(path.join(skillsHome, 'shadow'), { recursive: true });
fs.writeFileSync(path.join(skillsHome, 'shadow', 'SKILL.md'), '# host-version');

process.env.AGENTMA_USER_SKILLS_DIR = skillsHome;
const { provisionRunSkills } = await import('../server-agent.ts');

const result = provisionRunSkills(['plain', 'linked', 'no-manifest', 'missing', '..', 'ws-only', 'shadow'], cwd);

const checks = [];
const check = (name, ok) => { checks.push([name, ok]); if (!ok) process.exitCode = 1; };
const dest = (...p) => path.join(cwd, '.claude', 'skills', ...p);

check('plain provisioned', result.provisioned.includes('plain') && fs.existsSync(dest('plain', 'helper.py')));
check('linked (top-level symlink) provisioned', result.provisioned.includes('linked') && fs.existsSync(dest('linked', 'SKILL.md')));
check('inner symlink dropped', !fs.existsSync(dest('linked', 'escape.txt')) && !fs.lstatSync(dest('linked', 'SKILL.md')).isSymbolicLink());
check('no-manifest rejected', result.issues.some((i) => i.skill === 'no-manifest'));
check('missing rejected', result.issues.some((i) => i.skill === 'missing'));
check('".." rejected, parent intact', result.issues.some((i) => i.skill === '..') && fs.existsSync(dest()));
check('workspace-only skill kept', result.provisioned.includes('ws-only') && fs.readFileSync(dest('ws-only', 'SKILL.md'), 'utf8') === '# workspace-only');
check('host wins on name collision', result.provisioned.includes('shadow') && fs.readFileSync(dest('shadow', 'SKILL.md'), 'utf8') === '# host-version');

// 6. 宿主更新后再投放 → 刷新
fs.writeFileSync(path.join(skillsHome, 'plain', 'SKILL.md'), '# plain v2');
const second = provisionRunSkills(['plain'], cwd);
check('re-provision refreshes from host', second.provisioned.includes('plain') && fs.readFileSync(dest('plain', 'SKILL.md'), 'utf8') === '# plain v2');

for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
console.log(`\nissues: ${JSON.stringify(result.issues)}`);
fs.rmSync(tmpRoot, { recursive: true, force: true });
