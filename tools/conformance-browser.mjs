import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForOwnedGroup(child) {
  if (!hasExited(child)) await once(child, 'exit');
  if (process.platform === 'win32') return;
  // Playwright starts this ChildProcess in its own POSIX process group.
  for (;;) {
    try { process.kill(-child.pid, 0); }
    catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    await delay(250);
  }
}

/** Shut down the exact process tree launched by this BrowserServer. */
export async function closeConformanceBrowser(server, launch, withDeadline) {
  const child = server.process();
  try {
    await withDeadline(server.close(), 10_000, 'Chrome graceful close timed out.');
  } catch (error) {
    launch.gracefulCloseError = String(error);
    launch.forced = true;
    // The OS process may have exited while the launcher is waiting for pipe EOF or profile cleanup.
    const killing = server.kill();
    try { await withDeadline(killing, 15_000, 'BrowserServer cleanup is still pending.'); }
    catch (cleanupError) {
      launch.cleanupDelay = String(cleanupError);
      console.error(`Confirming termination of owned Chrome group ${child.pid} after delayed cleanup.`);
      await waitForOwnedGroup(child);
      for (const pipe of child.stdio) pipe?.destroy();
      // Destroying our pipes releases Playwright's close listener even if a subprocess inherited a descriptor.
      try { await withDeadline(killing, 5_000, 'BrowserServer cleanup still pending after process exit.'); }
      catch (error) { launch.cleanupError = String(error); }
    }
  }
  if (!hasExited(child)) {
    throw new Error('Playwright shutdown completed while the owned Chrome process was still running.');
  }
  launch.exitedAt = new Date().toISOString();
  launch.exitCode = child.exitCode;
  launch.signal = child.signalCode;
}
