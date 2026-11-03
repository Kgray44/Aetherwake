import { statSync } from 'node:fs';
import { win32 } from 'node:path';

const exists = (file: string) => {
  try { return statSync(file).isFile(); }
  catch { return false; }
};

/** Resolve only absolute entries in the installed PATH, never the workspace cwd.
 * The Windows npm shim needs cmd.exe; launch its official Node entry point
 * directly instead so stdio stays supervised and no shell interprets arguments.
 */
export function windowsCodexLaunch(pathValue: string, node: string, args: string[]) {
  for (const entry of pathValue.split(';')) {
    const dir = entry.trim().replace(/^"(.*)"$/, '$1');
    if (!/^(?:[a-z]:[\\/]|\\\\)/i.test(dir) || !win32.isAbsolute(dir)) continue;
    const executable = win32.join(dir, 'codex.exe');
    if (exists(executable)) return { executable, args };
    if (!exists(win32.join(dir, 'codex.cmd'))) continue;
    const cli = win32.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (exists(cli)) return { executable: node, args: [cli, ...args] };
  }
  return undefined;
}
