import { readdir, readFile, lstat } from 'node:fs/promises';
import { basename, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VIRTUALS_CONTRACTS } from '../skills/evm-wallet-audit/scripts/virtuals-staking.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const skill = resolve(root, 'skills/evm-wallet-audit');
const errors = [];
const expect = (condition, message) => { if (!condition) errors.push(message); };
const required = ['README.md', 'README.zh-CN.md', 'LICENSE', 'CONTRIBUTING.md', 'SECURITY.md',
  'package.json', '.gitignore', '.github/workflows/checks.yml', 'examples/sample-report.md',
  'tests/behavior-cases.md', 'skills/evm-wallet-audit/SKILL.md', 'skills/evm-wallet-audit/SKILL.zh-CN.md',
  'skills/evm-wallet-audit/LICENSE.txt', 'skills/evm-wallet-audit/agents/openai.yaml'];
const ignored = new Set(['.git', 'node_modules', '.agents', '.claude']);
async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) { errors.push(`Symlink must not ship: ${relative(root, path)}`); continue; }
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}
const files = await walk(root);
const names = new Set(files.map((path) => relative(root, path).split(sep).join('/')));
for (const path of required) expect(names.has(path), `Missing required file: ${path}`);
const texts = new Map(await Promise.all(files.map(async (path) => [path, await readFile(path, 'utf8')])));
const entry = texts.get(resolve(skill, 'SKILL.md')) ?? '';
const frontmatter = entry.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
expect(Boolean(frontmatter), 'SKILL.md needs YAML frontmatter');
// This zero-dependency checker supports the simple scalar fields used by this package.
// It is deliberately not a replacement for a full YAML/specification validator.
function scalar(key, text = frontmatter ?? '') {
  const value = text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim() ?? '';
  return value.replace(/^(["'])([\s\S]*)\1$/, '$2');
}
const name = scalar('name');
const description = scalar('description');
expect(name === basename(skill) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) && name.length <= 64, 'Invalid skill name');
expect(description.length > 0 && description.length <= 1024 && !['>', '|'].includes(description), 'Use a nonempty description scalar, at most 1024 characters');
expect(scalar('license') === 'MIT', 'Skill metadata must identify the bundled MIT license');
expect(entry.split('\n').length < 500, 'Keep the main skill entry under 500 lines');
expect(!(texts.get(resolve(skill, 'SKILL.zh-CN.md')) ?? '').startsWith('---'), 'Translation must not create a second frontmatter entry');

const license = texts.get(resolve(root, 'LICENSE'));
expect(Boolean(license) && license === texts.get(resolve(skill, 'LICENSE.txt')), 'Root and installable licenses must match');
const pkg = JSON.parse(texts.get(resolve(root, 'package.json')) ?? '{}');
expect(pkg.private === true && pkg.license === 'MIT', 'Keep the repository private to npm publication and identify MIT');
expect(!Object.keys(pkg.dependencies ?? {}).length && !Object.keys(pkg.devDependencies ?? {}).length, 'Default package must not require npm dependencies');

const ui = texts.get(resolve(skill, 'agents/openai.yaml')) ?? '';
const short = scalar('  short_description', ui);
expect(Array.from(short).length >= 25 && Array.from(short).length <= 64, 'UI short description must have 25–64 characters');
expect(scalar('  default_prompt', ui).includes('$evm-wallet-audit'), 'Default UI prompt must name the skill');

const knownAddresses = new Set([...Object.values(VIRTUALS_CONTRACTS).map((value) => value.toLowerCase()),
  `0x${'0'.repeat(40)}`, `0x${'1'.repeat(40)}`, `0x${'2'.repeat(40)}`, `0x${'abcdef'.repeat(6)}abcd`]);
const readMethods = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getBalance', 'eth_call']);
for (const [path, text] of texts) {
  const label = relative(root, path).split(sep).join('/');
  expect(!/(?:^|\/)\.env(?:\.|$)|\.(?:pem|p12|key)$|(?:^|\/)(?:reports|output)\//i.test(label), `Private/output file must not ship: ${label}`);
  expect(extname(path) !== '.json' || label === 'package.json', `Unexpected JSON artifact: ${label}`);
  expect(!/(?:\/(?:Users|home)\/[^\s/]+|[A-Za-z]:\\Users\\[^\s\\]+)/.test(text), `Personal filesystem path: ${label}`);
  expect(!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text), `Private-key material: ${label}`);
  for (const address of text.match(/0x[0-9a-f]{40}(?![0-9a-f])/gi) ?? []) {
    expect(knownAddresses.has(address.toLowerCase()), `Unreviewed literal wallet/contract address in ${label}`);
  }
  if (label.startsWith('skills/evm-wallet-audit/scripts/') && label.endsWith('.mjs') && !label.endsWith('.test.mjs')) {
    for (const method of text.match(/\beth_[A-Za-z0-9_]+\b/g) ?? []) {
      expect(readMethods.has(method), `Review RPC method ${method} in ${label}`);
    }
  }
  if (!label.endsWith('.md')) continue;
  for (const match of text.matchAll(/\[[^\]\n]+\]\(([^\s)]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, '');
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    const local = decodeURIComponent(target.split('#')[0]);
    const full = resolve(path, '..', local);
    expect(full.startsWith(`${root}${sep}`) || full.startsWith(root), `Link escapes repository: ${label}`);
    try { await lstat(full); } catch { errors.push(`Broken local link in ${label}: ${target}`); }
  }
  if (label.startsWith('skills/evm-wallet-audit/references/')) {
    const twin = label.includes('.zh-CN.md') ? label.replace('.zh-CN.md', '.md') : label.replace(/\.md$/, '.zh-CN.md');
    expect(names.has(twin), `Missing translation pair: ${twin}`);
  }
}
if (errors.length) {
  console.error([...new Set(errors)].map((message) => `FAIL ${message}`).join('\n'));
  process.exitCode = 1;
} else console.log(`Release checks passed (${files.length} files, metadata, bilingual links, license, hygiene, RPC methods).`);
