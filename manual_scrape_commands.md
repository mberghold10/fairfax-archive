# Manual scrape commands

Run these from a non-datacenter IP (stiltweb.com blocks GitHub Actions' cloud IPs).

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
