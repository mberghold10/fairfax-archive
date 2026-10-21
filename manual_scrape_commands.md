# Scrape operations

stiltweb.com blocks datacenter IPs, so cloud scraping is intentionally disabled. GitHub Actions only builds and deploys committed archive data; scraping must run from a non-datacenter connection.

## Unattended Windows automation

The **FairfaxArchiveDailyScrape** Task Scheduler task runs `scripts\run-daily-scrape.ps1`. Use the wrapper only in a dedicated, disposable clone with no human work in progress. From that clone's repository root, create its required marker once:

```powershell
New-Item -ItemType File -Path .git\fairfax-automation-clone -Force
```

The wrapper refuses to set `FAIRFAX_AUTOMATION=1` or start Node unless `.git\fairfax-automation-clone` is a file. The Node runner independently requires both that marker and `FAIRFAX_AUTOMATION=1` before any destructive archive restore/clean operation.

A real unattended run:

1. Refuses to touch a pre-existing rebase, requires branch `main`, and rejects non-archive worktree changes before startup cleanup.
2. Restores/removes only `archive/` changes left by an interrupted prior automation run. It never discards non-archive changes.
3. Requires the resulting non-ignored worktree to be clean and runs `git pull --rebase origin main`.
4. Detects local commits ahead of `origin/main` after synchronization and pushes them before scraping, so a valid commit preserved after an earlier push failure is not stranded.
5. Runs discover → refresh-active → aggregate, stages only `archive/`, commits only when archive data changed, and explicitly pushes `origin main`.
6. If a push fails, pulls with rebase and retries the push once. It aborts only a rebase started by that pull; a rebase that existed before the process started requires manual intervention. A successfully created commit is preserved if both bounded push attempts fail.

Any failed scrape or aggregation stops the pipeline and returns a nonzero process exit. Before a commit exists, marked automation restores/cleans only `archive/` so the next night is not jammed by partial data. Direct `node scripts/daily-scrape.mjs` runs never perform that cleanup.

Logs are written to `logs/daily-scrape-YYYY-MM-DD.log` (gitignored). The final line is either `Daily scrape finished successfully...` or `Daily scrape FAILED: ...`. The PowerShell wrapper explicitly returns Node's native exit code, so Task Scheduler's `LastTaskResult` is `0` on success and nonzero on failure.

Inspect or start the task:

```powershell
Get-ScheduledTask -TaskName "FairfaxArchiveDailyScrape"
Get-ScheduledTaskInfo -TaskName "FairfaxArchiveDailyScrape"
Start-ScheduledTask -TaskName "FairfaxArchiveDailyScrape"
```

## Manual commands

Run these from the repository root on a non-datacenter connection.

Full daily pipeline (real runs require `main` and a completely clean non-ignored worktree):

```powershell
node scripts/daily-scrape.mjs
```

Daily dry run (does not write `archive/`, commit, pull, or push; it does rebuild ignored `public/data/`):

```powershell
node scripts/daily-scrape.mjs --dry-run
```

Discover and scrape new divisions, then aggregate:

```powershell
node scripts/scrape-division.mjs --discover --scrape
node scripts/aggregate.mjs
```

Refresh the two most recent seasons, then aggregate:

```powershell
node scripts/scrape-division.mjs --refresh-active
node scripts/aggregate.mjs
```

Scrape one known division, then aggregate:

```powershell
node scripts/scrape-division.mjs --div 321
node scripts/aggregate.mjs
```

The three scraper commands accept `--dry-run`; in that mode the scraper performs network/parser validation but does not write archive files. Regular-season fixtures are collected from every team's schedule page and deduplicated division-wide, including upcoming games whose `gameId` is `null`. Completed-game discovery and authoritative scores still come from game recaps; upcoming games do not have game JSON or scores until a recap exists. `scripts/aggregate.mjs` does not have a dry-run mode.

## Scrape freshness timestamps

For scrape-generated records that contain `_updated`, the field means the time that record's material content last changed, not the time it was most recently checked. A successful scrape whose parsed content is unchanged preserves the existing file and timestamp. The dated daily log is the record that the source was successfully fetched, parsed, validated, and aggregated on a given run; dry runs are identified in that log and never update archive timestamps.
