/**
 * Russian Rocket Historical Scraper
 * ===================================
 * Scrapes russianrocket.net for all FHL historical seasons predating
 * the stiltweb archive (i.e., everything before Winter 2016).
 *
 * The site structure has two levels:
 *   /seasons → lists top-level season leagues (one per season, e.g. Summer 2016 = league 44)
 *   /leagues/{id} → season page whose sidebar nav lists sub-leagues per division
 *                   (e.g. MA League → /leagues/44, MB League → /leagues/45)
 *
 * We scrape each sub-league as a separate division in the archive.
 *
 * SSL note: russianrocket.net has an expired cert — rejectUnauthorized: false required.
 *
 * Usage:
 *   node scripts/scrape-russian-rocket.mjs [--dry-run] [--force] [--league N]
 *
 * Flags:
 *   --dry-run   Print what would be scraped without writing files
 *   --force     Re-scrape divisions that already exist in the archive
 *   --league N  Scrape only a specific top-level season league ID (for debugging)
 */

import https from 'node:https';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// ── Config ───────────────────────────────────────────────────────────────────

const BASE_URL = 'https://russianrocket.net';
const STILTWEB_CUTOFF_SEASON = 'Winter 2016';

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const LEAGUE_FILTER = (() => {
  const idx = process.argv.indexOf('--league');
  return idx >= 0 ? process.argv[idx + 1] : null;
})();

const DELAY_MS = 300;
const ROOT = resolve(process.cwd());
const ARCHIVE_DIR = resolve(ROOT, 'archive', 'divisions');
const SCRAPE_INDEX_PATH = resolve(ROOT, 'archive', 'rr-scrape-index.json');

const agent = new https.Agent({ rejectUnauthorized: false });

// ── HTTP ──────────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchHtml(path) {
  return new Promise((res, rej) => {
    const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
    https.get(url, { agent }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => res(d));
    }).on('error', rej);
  });
}

// ── HTML helpers ─────────────────────────────────────────────────────────────

function stripTags(html) {
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
}

function parseTable(tableHtml) {
  const rows = [];
  for (const row of (tableHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [])) {
    rows.push((row.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || []).map(c => stripTags(c).trim()));
  }
  return rows;
}

function extractTable(html, tableId) {
  const re = new RegExp(`id=['"]${tableId}['"][\\s\\S]*?<\\/table>`, 'i');
  const match = html.match(re);
  if (!match) return null;
  const start = html.lastIndexOf('<table', html.indexOf(match[0]));
  return html.slice(start, html.indexOf('</table>', start) + 8);
}

// ── Season discovery ──────────────────────────────────────────────────────────

async function discoverSeasons() {
  console.log('Discovering seasons from /seasons...');
  const html = await fetchHtml('/seasons');
  const seasons = [];
  const seen = new Set();
  for (const m of html.matchAll(/<a[^>]+href=['"]\/leagues\/(\d+)['"][^>]*>([\s\S]*?)<\/a>/gi)) {
    const leagueId = m[1];
    if (seen.has(leagueId)) continue;
    seen.add(leagueId);
    const inner = m[2];
    const nameMatch = inner.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    const seasonName = nameMatch ? stripTags(nameMatch[1]).trim() : stripTags(inner).trim();
    if (seasonName) seasons.push({ leagueId, seasonName });
  }
  return seasons;
}

// ── Cutoff check ─────────────────────────────────────────────────────────────

function isBeforeCutoff(seasonName) {
  const m = seasonName.match(/(\w+)\s+(\d{4})/);
  if (!m) return true;
  const term = m[1].toLowerCase();
  const year = parseInt(m[2], 10);
  const order = { spring: 0, summer: 1, fall: 2, winter: 3 };
  if (year < 2016) return true;
  if (year > 2016) return false;
  // 2016: include Summer (1) but not Winter (3)
  return (order[term] ?? 0) < order['winter'];
}

// ── Sub-league discovery ──────────────────────────────────────────────────────

/**
 * Parse the sidebar nav of a season's league page to find all per-division
 * sub-leagues and their team lists.
 *
 * Nav structure:
 *   <li class='px-nav-dropdown'>
 *     <a href='#'><span class='px-nav-label'>MA League</span></a>
 *     <ul class='px-nav-dropdown-menu'>
 *       <li><a href='/leagues/44'>Summary</a></li>
 *       <li><a href='/teams/300'>Bruins</a></li>
 *       ...
 *     </ul>
 *   </li>
 *
 * Returns: [{ subLeagueId, divisionLabel, teamLinks: [{teamId, name}] }]
 */
async function discoverSubLeagues(seasonLeagueId) {
  const html = await fetchHtml(`/leagues/${seasonLeagueId}`);
  const subLeagues = [];

  // Extract the sidebar nav element first to bound our search,
  // then split into per-division dropdown blocks.
  const navMatch = html.match(/<nav[^>]*px-nav[^>]*>([\s\S]*?)<\/nav>/i);
  const navHtml = navMatch ? navMatch[1] : html.slice(0, 10000); // fallback: first 10KB

  const blockOpenerRe = /<li[^>]*px-nav-dropdown[^>]*>/gi;
  const blockStarts = [...navHtml.matchAll(blockOpenerRe)];

  for (let bi = 0; bi < blockStarts.length; bi++) {
    const start = blockStarts[bi].index;
    const end = bi + 1 < blockStarts.length ? blockStarts[bi + 1].index : navHtml.length;
    const block = navHtml.slice(start, end);

    const labelMatch = block.match(/<span[^>]*px-nav-label[^>]*>([\s\S]*?)<\/span>/i);
    if (!labelMatch) continue;
    const rawLabel = stripTags(labelMatch[1]).trim();
    // "MA League" → "MA", "C League" → "C", "D2 League" → "D2"
    const divisionLabel = rawLabel.replace(/\s*League\s*$/i, '').trim();
    if (!divisionLabel) continue;

    const subLeagueMatch = block.match(/href="\/leagues\/(\d+)"/i);
    if (!subLeagueMatch) continue;
    const subLeagueId = subLeagueMatch[1];

    const teamLinks = [];
    for (const tm of block.matchAll(/href="\/teams\/(\d+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const name = stripTags(tm[2]).trim();
      if (name && name.toLowerCase() !== 'summary') {
        teamLinks.push({ teamId: tm[1], name });
      }
    }

    if (teamLinks.length > 0) {
      subLeagues.push({ subLeagueId, divisionLabel, teamLinks });
    }
  }

  return subLeagues;
}

// ── Team scraping ─────────────────────────────────────────────────────────────

async function scrapeTeam(teamId) {
  const html = await fetchHtml(`/teams/${teamId}`);
  return {
    skaters: parseSkaterTable(extractTable(html, 'skater_table')),
    goalies: parseGoalieTable(extractTable(html, 'goalie_table')),
    schedule: parseScheduleTable(extractTable(html, 'schedule_table')),
  };
}

function parseSkaterTable(tableHtml) {
  if (!tableHtml) return [];
  const rows = parseTable(tableHtml);
  if (rows.length < 2) return [];
  const h = rows[0].map(v => v.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const col = n => h.indexOf(n);
  const nameIdx = h.findIndex(v => v === 'name' || v === 'player');
  const skaters = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = r[nameIdx >= 0 ? nameIdx : 1] || '';
    if (!name || /^substit/i.test(name) || name.toLowerCase() === 'name') continue;
    skaters.push({
      number: r[0] || '',
      name,
      gp: +r[col('gp')] || 0, g: +r[col('g')] || 0, a: +r[col('a')] || 0,
      pts: +r[col('pts')] || 0, ppg: +r[col('ppg')] || 0, ppa: +r[col('ppa')] || 0,
      shg: +r[col('shg')] || 0, sha: +r[col('sha')] || 0, pim: +r[col('pim')] || 0,
    });
  }
  return skaters;
}

function parseGoalieTable(tableHtml) {
  if (!tableHtml) return [];
  const rows = parseTable(tableHtml);
  if (rows.length < 2) return [];
  const h = rows[0].map(v => v.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const col = n => h.indexOf(n);
  const nameIdx = h.findIndex(v => v === 'name' || v === 'player');
  const goalies = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const name = r[nameIdx >= 0 ? nameIdx : 1] || '';
    if (!name || /^substit/i.test(name) || name.toLowerCase() === 'name') continue;
    const sa = +r[col('sa')] || 0;
    const sv = +r[col('sv')] || 0;
    const gp = +r[col('gp')] || 0;
    const ga = +r[col('ga')] || 0;
    const svpctIdx = h.findIndex(v => v === 'sv' || v === 'svpct');
    goalies.push({
      number: r[0] || '',
      name, gp,
      w: +r[col('w')] || 0, l: +r[col('l')] || 0, t: +r[col('t')] || 0,
      ga, sa, sv,
      gaa: r[col('gaa')] || (gp > 0 ? (ga / gp).toFixed(2) : '0.00'),
      svpct: (svpctIdx >= 0 ? r[svpctIdx] : null) || (sa > 0 ? (sv / sa).toFixed(3) : '0.000'),
      so: +r[col('so')] || 0, pim: +r[col('pim')] || 0,
    });
  }
  return goalies;
}

function parseScheduleTable(tableHtml) {
  if (!tableHtml) return [];
  const rows = parseTable(tableHtml);
  if (rows.length < 2) return [];
  const games = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < 3 || !r[0] || r[0].toLowerCase() === 'date') continue;
    const dateStr = r[0];
    const home = r.length >= 4 ? r[1] : r[1];
    const away = r.length >= 4 ? r[2] : '';
    const result = r.length >= 4 ? r[3] : r[2];
    games.push({ dateStr, home: home.trim(), away: away.trim(), ...parseResult(result) });
  }
  return games;
}

function parseResult(s) {
  if (!s) return { homeScore: null, awayScore: null, ot: false };
  if (/forfeit/i.test(s)) return { homeScore: null, awayScore: null, ot: false, forfeit: true };
  if (/tie/i.test(s)) {
    const m = s.match(/(\d+)\s*[-–]\s*(\d+)/);
    return m ? { homeScore: +m[1], awayScore: +m[2], tie: true, ot: false }
             : { homeScore: null, awayScore: null, tie: true, ot: false };
  }
  // "TeamName 7 - 4" (russianrocket winner-first format)
  const rr = s.match(/^(.+?)\s+(\d+)\s*[-–]\s*(\d+)$/);
  if (rr) return { winnerName: rr[1].trim(), score1: +rr[2], score2: +rr[3], homeScore: null, awayScore: null, ot: false };
  // "W (7-4)" or "L (2-8)"
  const sw = s.match(/^([WL])\s*\((\d+)-(\d+)\)/i);
  if (sw) return { result: sw[1].toUpperCase(), homeScore: +sw[2], awayScore: +sw[3], ot: false };
  return { homeScore: null, awayScore: null, ot: false };
}

function parseDateStr(dateStr, seasonName) {
  if (!dateStr) return '';

  // Full year formats from stiltweb:
  const long = dateStr.match(/(\w+),\s+(\w+)\s+(\d+),\s+(\d{4})/);
  if (long) {
    const months = {January:1,February:2,March:3,April:4,May:5,June:6,July:7,August:8,September:9,October:10,November:11,December:12};
    const mo = months[long[2]] || 1;
    return `${long[4]}-${String(mo).padStart(2,'0')}-${String(long[3]).padStart(2,'0')}`;
  }
  const short = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (short) return `${short[3]}-${short[1].padStart(2,'0')}-${short[2].padStart(2,'0')}`;

  // russianrocket format: "Tue, 19 Apr  9:50pm" — no year.
  // Infer year from the season name (e.g. "Summer 2016" → 2016).
  // For summer seasons (Apr–Sep), use the season year.
  // For winter seasons (Oct–Mar), months Oct–Dec = year, Jan–Mar = year+1.
  const rr = dateStr.match(/(\w+),\s+(\d+)\s+(\w+)/);
  if (rr) {
    const day = rr[2];
    const monthName = rr[3];
    const months = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
    const mo = months[monthName];
    if (!mo) return dateStr;

    // Extract base year from season name
    const yearMatch = (seasonName || '').match(/(\d{4})/);
    const baseYear = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();
    const termMatch = (seasonName || '').match(/(\w+)\s+\d{4}/);
    const term = termMatch ? termMatch[1].toLowerCase() : 'summer';

    let year = baseYear;
    if (term === 'winter') {
      // Winter season spans Oct–Mar: Oct/Nov/Dec = baseYear, Jan/Feb/Mar = baseYear+1
      if (mo >= 1 && mo <= 3) year = baseYear + 1;
    }
    // Summer seasons are all within the same calendar year

    return `${year}-${String(mo).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }

  return dateStr;
}

// ── File writing ──────────────────────────────────────────────────────────────

async function writeDivisionFiles(divId, { meta, rosters, schedule }) {
  const dir = join(ARCHIVE_DIR, divId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
  await writeFile(join(dir, 'rosters.regular.json'), JSON.stringify(rosters, null, 2), 'utf-8');
  await writeFile(join(dir, 'schedule.regular.json'), JSON.stringify(schedule, null, 2), 'utf-8');
  await writeFile(join(dir, 'suspensions.json'), JSON.stringify({ divId, suspensions: [] }, null, 2), 'utf-8');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Russian Rocket Historical Scraper     ║');
  console.log('╚══════════════════════════════════════════╝');
  if (DRY_RUN) console.log('  [DRY RUN — no files will be written]');

  let scrapeIndex = {};
  try { scrapeIndex = JSON.parse(await readFile(SCRAPE_INDEX_PATH, 'utf-8')); }
  catch { scrapeIndex = { _updated: new Date().toISOString(), leagues: {} }; }

  const allSeasons = await discoverSeasons();
  console.log(`\nFound ${allSeasons.length} total seasons on russianrocket.net`);

  const seasons = LEAGUE_FILTER
    ? allSeasons.filter(s => s.leagueId === LEAGUE_FILTER)
    : allSeasons.filter(s => isBeforeCutoff(s.seasonName));

  console.log(`\nScraping ${seasons.length} seasons (before ${STILTWEB_CUTOFF_SEASON}):`);
  seasons.forEach(s => console.log(`  ${s.leagueId}: ${s.seasonName}`));

  // Pick up counter from where we left off
  const usedIds = new Set(
    Object.values(scrapeIndex.leagues || {})
      .filter(e => e.divId)
      .map(e => e.divId)
  );
  let rrCounter = 1;
  while (usedIds.has(`rr-${rrCounter}`)) rrCounter++;

  let scraped = 0, skipped = 0;

  for (const season of seasons) {
    console.log(`\n── Season ${season.leagueId}: ${season.seasonName} ──`);
    const seasonKey = `season-${season.leagueId}`;

    if (scrapeIndex.leagues?.[seasonKey] && !FORCE) {
      console.log(`  [skip] Already fully scraped`);
      skipped++;
      continue;
    }

    await sleep(DELAY_MS);

    let subLeagues;
    try {
      subLeagues = await discoverSubLeagues(season.leagueId);
    } catch (err) {
      console.error(`  ✗ Failed to load season page: ${err.message}`);
      continue;
    }

    if (subLeagues.length === 0) {
      console.log('  No divisions found — skipping');
      continue;
    }

    console.log(`  Divisions: ${subLeagues.map(s => s.divisionLabel).join(', ')}`);
    const divisionDivIds = [];

    for (const { subLeagueId, divisionLabel, teamLinks: teams } of subLeagues) {
      const divKey = `subleague-${subLeagueId}`;
      if (scrapeIndex.leagues?.[divKey] && !FORCE) {
        console.log(`  [skip] ${divisionLabel} — already scraped`);
        skipped++;
        continue;
      }

      const divId = `rr-${rrCounter}`;
      const seasonName = season.seasonName;
      console.log(`\n  ${divisionLabel} (${divId}): ${teams.length} teams`);

      const teamRosters = {};
      const allGames = [];
      const gameKeys = new Set();

      for (const team of teams) {
        const rrTeamId = `rr-t-${team.teamId}`;
        console.log(`    team ${team.teamId}: ${team.name}...`);
        await sleep(DELAY_MS);

        try {
          const data = await scrapeTeam(team.teamId);

          teamRosters[rrTeamId] = {
            skaters: data.skaters.map(s => ({
              ...s,
              team: { teamId: rrTeamId, name: team.name },
              divId, seasonName, mode: 'regular',
              playerKey: `name:${s.name.toLowerCase().replace(/[^a-z,\s]/g, '').trim()}`,
            })),
            goalies: data.goalies.map(g => ({
              ...g,
              team: { teamId: rrTeamId, name: team.name },
              divId, seasonName, mode: 'regular',
            })),
          };

          for (const game of data.schedule) {
            const gk = `${game.dateStr}|${game.home}|${game.away}`;
            if (gameKeys.has(gk)) continue;
            gameKeys.add(gk);

            const homeTeam = teams.find(t => game.home &&
              game.home.toLowerCase().includes(t.name.toLowerCase().split(' ')[0]));
            const awayTeam = teams.find(t => game.away &&
              game.away.toLowerCase().includes(t.name.toLowerCase().split(' ')[0]));

            let homeScore = game.homeScore, awayScore = game.awayScore;
            if (game.score1 != null && game.score2 != null && game.winnerName) {
              const winnerIsHome = homeTeam &&
                game.winnerName.toLowerCase().includes(homeTeam.name.toLowerCase().split(' ')[0]);
              homeScore = winnerIsHome ? game.score1 : game.score2;
              awayScore = winnerIsHome ? game.score2 : game.score1;
            }

            allGames.push({
              date: parseDateStr(game.dateStr, seasonName), time: '',
              home: { teamId: homeTeam ? `rr-t-${homeTeam.teamId}` : 'unknown', name: game.home || '' },
              away: { teamId: awayTeam ? `rr-t-${awayTeam.teamId}` : 'unknown', name: game.away || '' },
              homeScore, awayScore, tie: game.tie || false,
              mode: 'regular', divId, seasonName,
            });
          }
        } catch (err) {
          console.error(`    ✗ ${err.message}`);
        }
      }

      console.log(`  → ${divId}: ${teams.length} teams, ${allGames.length} games`);

      if (!DRY_RUN) {
        await writeDivisionFiles(divId, {
          meta: {
            seasonName, divisionLabel,
            teams: Object.fromEntries(teams.map(t => [`rr-t-${t.teamId}`, t.name])),
            divId, source: 'russianrocket.net', leagueId: subLeagueId,
            _updated: new Date().toISOString(),
          },
          rosters: { divId, mode: 'regular', kind: 'rosters', records: teamRosters },
          schedule: { divId, mode: 'regular', kind: 'schedule', records: allGames },
        });
        scrapeIndex.leagues[divKey] = {
          divId, seasonName, divisionLabel,
          scrapedAt: new Date().toISOString(),
          teams: teams.length, games: allGames.length,
        };
        scrapeIndex._updated = new Date().toISOString();
        await writeFile(SCRAPE_INDEX_PATH, JSON.stringify(scrapeIndex, null, 2), 'utf-8');
      }

      divisionDivIds.push(divId);
      scraped++;
      rrCounter++;
    }

    if (!DRY_RUN && divisionDivIds.length > 0) {
      scrapeIndex.leagues[seasonKey] = {
        seasonName: season.seasonName, divisions: divisionDivIds,
        scrapedAt: new Date().toISOString(),
      };
      await writeFile(SCRAPE_INDEX_PATH, JSON.stringify(scrapeIndex, null, 2), 'utf-8');
    }
  }

  console.log('\n╔══════════════════════════════════════════╗');
  console.log(`║  Done: ${scraped} divisions scraped, ${skipped} skipped  ║`);
  console.log('╚══════════════════════════════════════════╝');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
