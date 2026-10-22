import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = new URL('../skills/evm-wallet-audit/scripts/', import.meta.url);
const files = (await readdir(directory)).filter((name) => name.endsWith('.test.mjs')).sort()
  .map((name) => fileURLToPath(new URL(name, directory)));
if (!files.length) throw new Error('No regression tests found');
const child = spawn(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit' });
child.on('error', () => { process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
