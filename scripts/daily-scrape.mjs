/**
 * Daily Scrape Runner
 * =====================
 * Meant to be invoked once a day (via Windows Task Scheduler) from a
 * non-datacenter IP, since stiltweb.com blocks GitHub Actions' cloud IPs.
 *
 * Steps:
 *   1. Discover + scrape any brand-new divisions (new season started)
 *   2. Refresh the most recent seasons already in the archive (new games,
 *      final playoff results)
 *   3. Rebuild public/data (aggregate.mjs)
 *   4. If archive/ changed, commit and push
 *
 * Logs everything to logs/daily-scrape-YYYY-MM-DD.log so failures can be
 * diagnosed without needing to be at the keyboard when it runs.
 *
 * Usage:
 *   node scripts/daily-scrape.mjs
 *   node scripts/daily-scrape.mjs --dry-run   # scrape/aggregate but never commit/push
 */

import { spawn } from 'node:child_process';
import { mkdir, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const LOGS_DIR = resolve(ROOT, 'logs');
const DRY_RUN = process.argv.includes('--dry-run');

const today = new Date().toISOString().slice(0, 10);
const LOG_PATH = resolve(LOGS_DIR, `daily-scrape-${today}.log`);

async function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  await appendFile(LOG_PATH, stamped + '\n', 'utf-8');
}

/**
 * Run a command, streaming output into the log, resolving with exit code.
 */
function run(cmd, args, opts = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, shell: false, ...opts });
    let output = '';
    child.stdout.on('data', d => { output += d.toString(); });
    child.stderr.on('data', d => { output += d.toString(); });
    child.on('close', async (code) => {
      await appendFile(LOG_PATH, output, 'utf-8');
      if (code === 0) resolvePromise(output);
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

async function main() {
  await mkdir(LOGS_DIR, { recursive: true });
  await log('═══════════════════════════════════════');
  await log(`Daily scrape starting${DRY_RUN ? ' [DRY RUN]' : ''}`);

  const node = process.execPath; // absolute path to the node.exe running this script

  try {
    await log('Step 1/4: Discover new divisions...');
    const discoverArgs = ['scripts/scrape-division.mjs', '--discover', '--scrape'];
    if (DRY_RUN) discoverArgs.push('--dry-run');
    await run(node, discoverArgs);
    await log('  ✓ Discover step complete');
  } catch (err) {
    await log(`  ⚠ Discover step failed (continuing): ${err.message}`);
  }

  try {
    await log('Step 2/4: Refresh active seasons...');
    const refreshArgs = ['scripts/scrape-division.mjs', '--refresh-active'];
    if (DRY_RUN) refreshArgs.push('--dry-run');
    await run(node, refreshArgs);
    await log('  ✓ Refresh step complete');
  } catch (err) {
    await log(`  ⚠ Refresh step failed (continuing): ${err.message}`);
  }

  try {
    await log('Step 3/4: Rebuilding aggregated data...');
    await run(node, ['scripts/aggregate.mjs']);
    await log('  ✓ Aggregate complete');
  } catch (err) {
    await log(`  ✗ Aggregate failed: ${err.message}`);
    await log('Daily scrape finished with errors (aggregate failed) — skipping commit.');
    return;
  }

  if (DRY_RUN) {
    await log('[DRY RUN] Skipping git commit/push.');
    await log('Daily scrape finished (dry run).');
    return;
  }

  // ── Commit + push if archive/ or public/data changed ──
  try {
    const statusOutput = await run('git', ['status', '--porcelain', 'archive/']);
    if (!statusOutput.trim()) {
      await log('Step 4/4: No archive changes detected — nothing to commit.');
      await log('Daily scrape finished (no changes).');
      return;
    }

    await log('Step 4/4: Archive changed — committing and pushing...');
    await run('git', ['add', 'archive/']);
    await run('git', ['commit', '-m', `chore: auto-scrape ${today}`]);
    await run('git', ['push']);
    await log('  ✓ Committed and pushed — deploy workflow will pick it up.');
  } catch (err) {
    await log(`  ✗ Commit/push failed: ${err.message}`);
    await log('Daily scrape finished with errors (commit/push failed).');
    return;
  }

  await log('Daily scrape finished successfully.');
}

main().catch(async (err) => {
  await log(`Fatal: ${err.stack || err.message}`);
  process.exitCode = 1;
});
