# Manual scrape commands

Run these from a non-datacenter IP (stiltweb.com blocks GitHub Actions' cloud IPs).

## Daily automation (already set up)

A Windows Task Scheduler task named **FairfaxArchiveDailyScrape** runs
`scripts\run-daily-scrape.ps1` every day at 2:00 AM. It's configured to wake
the PC from sleep to run (`WakeToRun`), so the machine can sleep normally.

It runs `scripts/daily-scrape.mjs`, which does discover → refresh-active →
aggregate → commit/push (only if `archive/` actually changed), and logs
everything to `logs/daily-scrape-YYYY-MM-DD.log` (gitignored).

To inspect/change the task:
```
Get-ScheduledTask -TaskName "FairfaxArchiveDailyScrape"
Get-ScheduledTaskInfo -TaskName "FairfaxArchiveDailyScrape"
```
To run it manually right now (writes files, commits/pushes if changed):
```
node scripts/daily-scrape.mjs
```
To preview without writing/committing:
```
node scripts/daily-scrape.mjs --dry-run
```

## Discover + scrape new divisions for a new season
```
node scripts/scrape-division.mjs --discover --scrape
node scripts/aggregate.mjs
```

## Refresh the most recent seasons (new games, final playoff results)
```
node scripts/scrape-division.mjs --refresh-active
node scripts/aggregate.mjs
```

## Scrape/re-scrape one specific division
```
node scripts/scrape-division.mjs --div 321
node scripts/aggregate.mjs
```

Add `--dry-run` to any command to preview without writing files.
