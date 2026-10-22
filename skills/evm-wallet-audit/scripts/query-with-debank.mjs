#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { AuditInputError } from './collect-snapshot.mjs';
import { parseQuickArgs, runQuickCli, validateQuickOptions } from './quick-audit.mjs';

const runFile = promisify(execFile);
const dialog = `
set resultDialog to display dialog "请输入 DeBank Cloud 的 API AccessKey。仅用于本次只读查询，不会保存到文件或配置。请勿输入钱包私钥或助记词。" default answer "" with hidden answer buttons {"取消", "查询"} default button "查询" with title "连接 DeBank" giving up after 180
if gave up of resultDialog then error number -128
return text returned of resultDialog
`;

// osascript output stays in this process's memory. Never print it or an upstream error.
export async function promptDeBankKey({ platform = process.platform, execFileImpl = runFile } = {}) {
  if (platform !== 'darwin') throw new AuditInputError('LOCAL_SECRET_PROMPT_UNSUPPORTED');
  let response;
  try {
    response = await execFileImpl('osascript', ['-e', dialog], {
      encoding: 'utf8', maxBuffer: 8192, timeout: 185000, windowsHide: true,
    });
  } catch { throw new AuditInputError('LOCAL_SECRET_PROMPT_CANCELLED_OR_FAILED'); }
  const key = typeof response?.stdout === 'string' ? response.stdout.trim() : '';
  if (!key || key.length > 4096 || /[\r\n\0]/.test(key)) throw new AuditInputError('INVALID_ACCESS_KEY_INPUT');
  return key;
}

export async function runDeBankCli(args = process.argv.slice(2), dependencies = {}) {
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  try {
    const options = parseQuickArgs(args);
    if (options.help) {
      stdout.write('Usage: node query-with-debank.mjs ADDRESS [quick-audit options]\nUses an existing runtime AccessKey or a macOS hidden-input dialog. Forces DeBank mode. Does not save credentials or change environment configuration.\n');
      return 0;
    }
    validateQuickOptions(options);
    if (args.includes('--provider') && options.provider === 'rpc') throw new AuditInputError('DEBANK_PROVIDER_REQUIRED');
    if (options.output) {
      try { await lstat(options.output); throw new AuditInputError('OUTPUT_ALREADY_EXISTS'); }
      catch (caught) { if (caught?.code !== 'ENOENT') throw caught; }
    }
    const env = dependencies.env ?? process.env;
    let key = typeof env.DEBANK_ACCESS_KEY === 'string' ? env.DEBANK_ACCESS_KEY.trim() : '';
    if (!key) key = await (dependencies.promptKey ?? promptDeBankKey)();
    const forwarded = args.includes('--provider') ? args.map((value, index) => args[index - 1] === '--provider' ? 'debank' : value)
      : [...args, '--provider', 'debank'];
    // A private object, not process.env, shell configuration, argv, or a credential file.
    return await runQuickCli(forwarded, { ...dependencies, env: { ...env, DEBANK_ACCESS_KEY: key } });
  } catch (caught) {
    stderr.write(`${JSON.stringify({ status: 'failed', errorCode: caught instanceof AuditInputError ? caught.code : 'INTERNAL_ERROR' })}\n`);
    return 1;
  }
}

const entryPath = process.argv[1] ? await realpath(process.argv[1]).catch(() => null) : null;
if (entryPath && entryPath === await realpath(fileURLToPath(import.meta.url))) process.exitCode = await runDeBankCli();
