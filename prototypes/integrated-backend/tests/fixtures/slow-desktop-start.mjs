import { setTimeout as delay } from 'node:timers/promises';
import { isMainThread } from 'node:worker_threads';

// Reproduce hosted cold startup without slowing the worker or the RPCs after readiness.
if (isMainThread && process.argv[1]?.endsWith('desktop-host.mts')) await delay(5500);
