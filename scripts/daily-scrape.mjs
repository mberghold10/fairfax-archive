/**
 * Daily scrape runner for a dedicated Windows automation clone.
 *
 * Real runs synchronize main, scrape, aggregate, then commit and push only
 * archive/. Dry runs preserve the historical behavior: they scrape without
 * archive writes, rebuild ignored public/data, and never run Git mutations.
 */

import { spawn } from 'node:child_process';
import { access, appendFile, mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const LOGS_DIR = resolve(ROOT, 'logs');
const AUTOMATION_MARKER_PATH = resolve(ROOT, '.git', 'fairfax-automation-clone');
const DRY_RUN = process.argv.includes('--dry-run');
const AUTOMATION = process.env.FAIRFAX_AUTOMATION === '1';
const EXPECTED_BRANCH = 'main';

const today = new Date().toISOString().slice(0, 10);
const LOG_PATH = resolve(LOGS_DIR, `daily-scrape-${today}.log`);

async function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  await appendFile(LOG_PATH, `${stamped}\n`, 'utf-8');
}

/** Run a command, mirror its output to the console, and append it to the log. */
function run(cmd, args, { quiet = false } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cmd, args, { cwd: ROOT, shell: false });
    let output = '';
    let spawnError = null;

    const collect = chunk => {
      const text = chunk.toString();
      output += text;
      if (!quiet) process.stdout.write(text);
    };

    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', err => { spawnError = err; });
    child.on('close', async code => {
      try {
        if (output) await appendFile(LOG_PATH, output, 'utf-8');
        if (spawnError) throw spawnError;
        if (code !== 0) {
          const detail = output.trim();
          throw new Error(`${cmd} ${args.join(' ')} exited with code ${code}${detail ? `: ${detail}` : ''}`);
        }
        resolvePromise(output);
      } catch (err) {
        rejectPromise(err);
      }
    });
  });
}

async function currentBranch() {
  return (await run('git', ['branch', '--show-current'], { quiet: true })).trim();
}

async function currentHead() {
  return (await run('git', ['rev-parse', 'HEAD'], { quiet: true })).trim();
}

async function assertMainBranch() {
  const branch = await currentBranch();
  if (branch !== EXPECTED_BRANCH) {
    throw new Error(`real runs require branch ${EXPECTED_BRANCH}; current branch is ${branch || '(detached HEAD)'}`);
  }
}

async function assertCleanWorktree() {
  const status = await run('git', ['status', '--porcelain=v1', '--untracked-files=all'], { quiet: true });
  if (status.trim()) {
    throw new Error(`real runs require a clean non-ignored worktree:\n${status.trim()}`);
  }
}

async function assertNoNonArchiveChanges() {
  const status = await run(
    'git',
    [
      'status', '--porcelain=v1', '--untracked-files=all', '--', '.',
      ':(top,exclude)archive', ':(top,exclude)archive/**',
    ],
    { quiet: true },
  );
  if (status.trim()) {
    throw new Error(`non-archive changes appeared during the run; refusing to commit:\n${status.trim()}`);
  }
}

async function assertAutomationMarker() {
  try {
    const marker = await stat(AUTOMATION_MARKER_PATH);
    if (!marker.isFile()) throw new Error('marker is not a file');
  } catch (error) {
    const detail = error.code === 'ENOENT' ? 'marker is missing' : error.message;
    throw new Error(`automation requires dedicated-clone marker ${AUTOMATION_MARKER_PATH}: ${detail}`);
  }
}

async function rebaseInProgress() {
  const paths = await Promise.all([
    run('git', ['rev-parse', '--git-path', 'rebase-merge'], { quiet: true }),
    run('git', ['rev-parse', '--git-path', 'rebase-apply'], { quiet: true }),
  ]);

  for (const path of paths) {
    try {
      await access(resolve(ROOT, path.trim()));
      return true;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  return false;
}

async function assertNoPreExistingRebase() {
  if (await rebaseInProgress()) {
    throw new Error('an existing rebase is in progress; resolve it manually before running the daily scraper');
  }
}

async function pullMainWithRebase() {
  await assertNoPreExistingRebase();

  try {
    await run('git', ['pull', '--rebase', 'origin', EXPECTED_BRANCH]);
  } catch (err) {
    if (await rebaseInProgress()) {
      try {
        await log('Aborting the rebase started by this pull...');
        await run('git', ['rebase', '--abort']);
      } catch (abortErr) {
        throw new Error(`${err.message}; rebase abort also failed: ${abortErr.message}`);
      }
    }
    throw err;
  }
}

/**
 * Restore only archive/ in the dedicated automation clone. Never use this for
 * direct/manual Node runs, and never touch non-archive paths.
 */
async function cleanAutomationArchive(reason) {
  if (!AUTOMATION) {
    throw new Error('archive cleanup is allowed only in automation mode');
  }
  await assertAutomationMarker();
  await log(`${reason}: restoring tracked archive files and removing untracked archive files...`);
  await run('git', ['restore', '--source=HEAD', '--staged', '--worktree', '--', 'archive/']);
  await run('git', ['clean', '-fd', '--', 'archive/']);
}

async function cleanFailedPreCommitRun(baselineHead) {
  if (!AUTOMATION || !baselineHead) return;

  const head = await currentHead();
  if (head !== baselineHead) {
    await log('Skipping archive cleanup because HEAD changed; preserving the local commit for recovery.');
    return;
  }
  await cleanAutomationArchive('Pre-commit pipeline failed');
}

async function pushMainWithOneRetry() {
  try {
    await run('git', ['push', 'origin', EXPECTED_BRANCH]);
    return;
  } catch (firstError) {
    await log(`Initial push failed; pulling with rebase before one retry: ${firstError.message}`);
  }

  await pullMainWithRebase();
  await assertMainBranch();
  await assertCleanWorktree();
  await run('git', ['push', 'origin', EXPECTED_BRANCH]);
}

async function localCommitsAheadOfOrigin() {
  const output = (await run(
    'git',
    ['rev-list', '--count', `origin/${EXPECTED_BRANCH}..HEAD`],
    { quiet: true },
  )).trim();
  const count = Number.parseInt(output, 10);
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`could not determine commits ahead of origin/${EXPECTED_BRANCH}: ${output || '(empty output)'}`);
  }
  return count;
}

async function pushRecoveredCommitsIfNeeded() {
  const ahead = await localCommitsAheadOfOrigin();
  if (ahead === 0) return;

  await log(`Found ${ahead} local commit(s) ahead of origin/${EXPECTED_BRANCH}; pushing before scraping...`);
  await pushMainWithOneRetry();

  const remaining = await localCommitsAheadOfOrigin();
  if (remaining !== 0) {
    throw new Error(`${remaining} local commit(s) remain ahead of origin/${EXPECTED_BRANCH} after push`);
  }
  await log('  ✓ Previously unpushed local commits reached origin/main.');
}

async function main() {
  await mkdir(LOGS_DIR, { recursive: true });
  await log('═══════════════════════════════════════');
  await log(`Daily scrape starting${DRY_RUN ? ' [DRY RUN]' : ''}${AUTOMATION ? ' [AUTOMATION]' : ''}`);

  const node = process.execPath;
  let baselineHead = null;

  try {
    if (!DRY_RUN) {
      if (AUTOMATION) {
        await assertAutomationMarker();
        await assertNoPreExistingRebase();
        await assertMainBranch();
        await assertNoNonArchiveChanges();
        await cleanAutomationArchive('Automation startup');
      } else {
        await assertMainBranch();
      }

      await assertCleanWorktree();
      await log('Synchronizing with origin/main...');
      await pullMainWithRebase();
      await assertMainBranch();
      await assertCleanWorktree();
      await pushRecoveredCommitsIfNeeded();
      await assertMainBranch();
      await assertCleanWorktree();
      baselineHead = await currentHead();
    }

    await log('Step 1/4: Discover new divisions...');
    const discoverArgs = ['scripts/scrape-division.mjs', '--discover', '--scrape'];
    if (DRY_RUN) discoverArgs.push('--dry-run');
    await run(node, discoverArgs);
    await log('  ✓ Discover step complete');

    await log('Step 2/4: Refresh active seasons...');
    const refreshArgs = ['scripts/scrape-division.mjs', '--refresh-active'];
    if (DRY_RUN) refreshArgs.push('--dry-run');
    await run(node, refreshArgs);
    await log('  ✓ Refresh step complete');

    await log('Step 3/4: Rebuilding aggregated data...');
    await run(node, ['scripts/aggregate.mjs']);
    await log('  ✓ Aggregate complete');

    if (DRY_RUN) {
      await log('Daily scrape finished successfully (dry run; archive and Git unchanged).');
      return;
    }

    await assertNoNonArchiveChanges();
    const archiveStatus = await run(
      'git',
      ['status', '--porcelain=v1', '--untracked-files=all', '--', 'archive/'],
      { quiet: true },
    );
    if (!archiveStatus.trim()) {
      await log('Step 4/4: No archive changes detected — nothing to commit.');
      await log('Daily scrape finished successfully (no archive changes).');
      return;
    }

    await log('Step 4/4: Archive changed — committing and pushing...');
    await run('git', ['add', '--', 'archive/']);
    await run('git', ['commit', '-m', `chore: auto-scrape ${today}`]);
    await assertCleanWorktree();

    // From this point onward, never clean archive/: the new HEAD may contain a
    // valid automation commit that only failed to reach the remote.
    await pushMainWithOneRetry();
    await log('  ✓ Committed and pushed to origin/main; deploy will follow.');
    await log('Daily scrape finished successfully.');
  } catch (err) {
    try {
      await cleanFailedPreCommitRun(baselineHead);
    } catch (cleanupErr) {
      err = new Error(`${err.message}; archive cleanup also failed: ${cleanupErr.message}`);
    }
    await log(`Daily scrape FAILED: ${err.stack || err.message}`);
    throw err;
  }
}

main().catch(err => {
  console.error(`Nightly pipeline failed: ${err.message}`);
  process.exitCode = 1;
});
