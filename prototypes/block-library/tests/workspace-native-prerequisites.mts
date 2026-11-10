import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// The real fixture includes a Clock & Timer card and requires the owner's
// reserve guard. The portable unit tests in these suites still run everywhere.
function nativePreparationSkip(): string | false {
  if (process.platform !== 'win32') return 'requires the Windows elapsed clock and host reserve guard';
  const guard = join(homedir(), 'AppData/Local/AeroStorageWatch/ReserveGuard.ps1');
  try {
    statSync(guard);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'requires the installed AeroStorageWatch reserve guard';
    throw error;
  }
  return false;
}

export const workspaceNativePreparationSkip = nativePreparationSkip();
