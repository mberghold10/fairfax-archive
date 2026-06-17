/**
 * Stiltweb FHL Scraper
 * ====================
 * Scrapes stiltweb.com/eLeague/fhl for the current (or any specified) season.
 * Handles session management, regular/playoff mode switching, and all data types.
 *
 * Usage:
 *   node scripts/scrape-stiltweb.mjs                         # auto-detect current season
 *   node scripts/scrape-stiltweb.mjs --div 321 --team 1962   # scrape specific div/team
 *   node scripts/scrape-stiltweb.mjs --check-only            # just report current season
 *   node scripts/scrape-stiltweb.mjs --dry-run               # scrape but don't write files
 *
 * Outputs to archive/divisions/{divId}/ — same structure as rest of archive.
 * Also updates archive/scrape-index.json with scrape timestamps.
 */

import https from 'node:https';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// ── Config ───────────────────────────────────────────────────────────────────

const BASE = 'https://stiltweb.com/eLeague/fhl';
const DELAY_MS = 150;
const GAME_DELAY_MS = 100;

const DRY_RUN = process.argv.includes('--dry-run');
const CHECK_ONLY = process.argv.includes('--check-only');

const argDiv = (() => { const i = process.argv.indexOf('--div'); return i >= 0 ? process.argv[i+1] : null; })();
const argTeam = (() => { const i = process.argv.indexOf('--team'); return i >= 0 ? process.argv[i+1] : null; })();

const ROOT = resolve(process.cwd());
const ARCHIVE_DIR = resolve(ROOT, 'archive', 'divisions');
const SCRAPE_INDEX_PATH = resolve(ROOT, 'archive', 'scrape-index.json');

// Known Pharaohs division/team mapping — update when a new season starts
// This is the source of truth for which div/team to scrape
const KNOWN_SEASONS = [
  { divId: '321', teamId: '1962', seasonName: 'Winter 2025', divisionLabel: 'C' },
  { divId: '312', teamId: '1911', seasonName: 'Summer 2025', divisionLabel: 'C2' },
  // Add new seasons here when detected
];

// ── HTTP / Session ────────────────────────────────────────────────────────────

let sessionCookie = '';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function request(path, opts = {}) {
  return new Promise((res, rej) => {
    const url = path.startsWith('http') ? path : `${BASE}/${path}`;
    const headers = { Cookie: sessionCookie, ...opts.headers };
    const req = https.request(url, { method: opts.method || 'GET', headers }, (response) => {
      // Capture cookies from Set-Cookie header
      const setCookie = response.headers['set-cookie'];
      if (setCookie) {
        for (const c of (Array.isArray(setCookie) ? setCookie : [setCookie])) {
          const name = c.split(';')[0];
          if (name) {
            // Merge into session cookie string
            const existing = Object.fromEntries(
              sessionCookie.split(';').map(p => p.trim().split('=')).filter(p => p.length === 2)
            );
            const [k, v] = name.split('=');
            existing[k.trim()] = v?.trim() || '';
            sessionCookie = Object.entries(existing).map(([k,v]) => `${k}=${v}`).join('; ');
          }
        }
      }

      // Follow redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const loc = response.headers.location.startsWith('http')
          ? response.headers.location
          : `${BASE}/${response.headers.location}`;
        return request(loc, opts).then(res).catch(rej);
      }

      let data = '';
      response.on('data', c => data += c);
      response.on('end', () => res(data));
    });
    req.on('error', rej);
    req.end();
  });
}

async function establishSession(teamId, divId) {
  await request(`schedule.php?team=${teamId}`);
  await sleep(DELAY_MS);
  await request(`actions.php?playoffs=no&page=schedule&team=${teamId}&div=${divId}`);
  await sleep(DELAY_MS);
}

async function setMode(mode, page, teamId, divId) {
  const flag = mode === 'playoffs' ? 'yes' : 'no';
  await request(`actions.php?playoffs=${flag}&page=${page}&team=${teamId}&div=${divId}`);
  await sleep(DELAY_MS);
}

// ── HTML helpers ─────────────────────────────────────────────────────────────

function stripTags(html) {
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
             .replace(/&#039;/g, "'").trim();
}

/**
 * Parse a standings-class table, handling nested tables by tracking depth.
 * Returns { headers: string[], rows: string[][] }
 */
function parseStandingsTable(html) {
  const tableRe = /<table[^>]*class=['"]standings['"][^>]*>/i;
  const start = html.search(tableRe);
  if (start === -1) return null;

  // Find matching end tag with depth tracking
  let depth = 0, pos = start;
  while (pos < html.length) {
    const nextOpen = html.indexOf('<table', pos + 1);
    const nextClose = html.indexOf('</table>', pos);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen;
    } else {
      if (depth === 0) { pos = nextClose + 8; break; }
      depth--;
      pos = nextClose + 8;
    }
  }
  const tableHtml = html.slice(start, pos);

  const rows = [];
  for (const row of (tableHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || [])) {
    rows.push((row.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || []).map(c => stripTags(c).trim()));
  }

  if (rows.length < 2) return null;
  return { headers: rows[0].map(h => h.toLowerCase().replace(/[^a-z0-9%]/g, '')), rows: rows.slice(1) };
}

function colIdx(headers, name) { return headers.indexOf(name); }

// ── Current season detection ──────────────────────────────────────────────────

/**
 * Hits stiltweb's main standings page with a known div to extract the
 * current season name shown on the page.
 */
async function detectCurrentSeason(divId, teamId) {
  await establishSession(teamId, divId);
  const html = await request(`standings.php?div=${divId}`);
  // Season name typically appears in a heading near the top
  const titleMatch = html.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i);
  if (titleMatch) {
    const text = stripTags(titleMatch[1]).trim();
    const seasonMatch = text.match(/((?:Winter|Summer|Fall|Spring)\s+\d{4})/i);
    if (seasonMatch) return seasonMatch[1];
  }
  // Fallback: look in page title or any prominent text
  const bodyMatch = html.match(/(Winter|Summer|Fall|Spring)\s+(20\d{2})/i);
  if (bodyMatch) return `${bodyMatch[1]} ${bodyMatch[2]}`;
  return null;
}

// ── Roster scraping ───────────────────────────────────────────────────────────

async function scrapeRoster(teamId, mode, divId) {
  if (mode === 'playoffs') {
    await setMode('playoffs', 'rosters', teamId, divId);
    await request(`actions.php?playoffs=yes&page=rosters&team=${teamId}&div=${divId}`);
    await sleep(DELAY_MS);
  }

  const html = await request(`rosters.php?team=${teamId}${mode === 'playoffs' ? '' : ''}`);

  const skaters = [];
  const goalies = [];

  // Parse each standings table on the page (skaters + goalies)
  let remaining = html;
  while (true) {
    const parsed = parseStandingsTable(remaining);
    if (!parsed) break;

    const { headers, rows } = parsed;
    const isGoalie = headers.includes('gaa') || headers.includes('sv') || headers.includes('svpct');
    const nameIdx = headers.findIndex(h => h === 'name' || h === 'player') ;
    const col = n => colIdx(headers, n);

    for (const row of rows) {
      const name = row[nameIdx >= 0 ? nameIdx : 1] || '';
      if (!name || /^substit/i.test(name) || name.toLowerCase() === 'name') continue;

      if (isGoalie) {
        const sa = parseInt(row[col('sa')] || '0', 10) || 0;
        const sv = parseInt(row[col('sv')] || '0', 10) || 0;
        const gp = parseInt(row[col('gp')] || '0', 10) || 0;
        const ga = parseInt(row[col('ga')] || '0', 10) || 0;
        goalies.push({
          number: row[0] || '',
          name,
          gp, w: +row[col('w')]||0, l: +row[col('l')]||0, t: +row[col('t')]||0,
          ga, sa, sv,
          svpct: row[col('sv%')] || row[col('svpct')] || (sa > 0 ? (sv/sa).toFixed(3) : '0.000'),
          gaa: row[col('gaa')] || (gp > 0 ? (ga/gp).toFixed(2) : '0.00'),
          so: +row[col('so')]||0, pim: +row[col('pim')]||0,
        });
      } else {
        skaters.push({
          number: row[0] || '',
          name,
          gp: +row[col('gp')]||0, g: +row[col('g')]||0, a: +row[col('a')]||0,
          pts: +row[col('pts')]||0, ppg: +row[col('ppg')]||0, ppa: +row[col('ppa')]||0,
          shg: +row[col('shg')]||0, sha: +row[col('sha')]||0, pim: +row[col('pim')]||0,
        });
      }
    }

    // Advance past this table in the HTML
    const tableRe = /<table[^>]*class=['"]standings['"][^>]*>/i;
    const idx = remaining.search(tableRe);
    if (idx === -1) break;
    remaining = remaining.slice(idx + 10);
  }

  return { skaters, goalies };
}

// ── Schedule scraping (regular season) ───────────────────────────────────────

function parseDateTimeLong(str) {
  // "Monday, December 1, 2025 7:20 PM"
  const m = str.match(/(\w+),\s+(\w+)\s+(\d+),\s+(\d{4})\s+(\d+:\d+\s*[AP]M)/i);
  if (!m) return { date: '', time: '' };
  const months = {January:1,February:2,March:3,April:4,May:5,June:6,July:7,August:8,September:9,October:10,November:11,December:12};
  const mo = months[m[2]] || 1;
  return {
    date: `${m[4]}-${String(mo).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`,
    time: m[5].trim(),
  };
}

function parseResult(recap) {
  if (!recap) return { result: null, score: null };
  const s = recap.trim();
  if (/forfeit/i.test(s)) return { result: 'F', score: null };
  const tie = s.match(/Tie\s+(\d+-\d+)/i);
  if (tie) return { result: 'T', score: tie[1] };
  const wl = s.match(/^([WL])\s*\((\d+-\d+)\)/i);
  if (wl) return { result: wl[1].toUpperCase(), score: wl[2] };
  return { result: null, score: null };
}

async function scrapeRegularSchedule(teamId, divId) {
  await setMode('regular', 'schedule', teamId, divId);
  const html = await request(`schedule.php?team=${teamId}`);
  const parsed = parseStandingsTable(html);
  if (!parsed) return [];

  const { headers, rows } = parsed;
  const games = [];

  for (const row of rows) {
    if (row.length < 3) continue;
    // Columns: Date (long form), Home, Away, Recap
    const dateTimeStr = row[0] || '';
    if (!dateTimeStr || dateTimeStr.toLowerCase() === 'date') continue;

    const { date, time } = parseDateTimeLong(dateTimeStr);
    const home = row[1] || '';
    const away = row[2] || '';
    const recap = row[3] || '';

    // Extract gameId from recap link if present
    const gameIdMatch = recap.match(/game=(\d+)/i) || row.join('').match(/game=(\d+)/i);

    // Also check raw HTML for game links
    const { result, score } = parseResult(stripTags(recap));

    games.push({ date, time, home: home.trim(), away: away.trim(), result, score, gameId: gameIdMatch ? gameIdMatch[1] : null });
  }

  return games;
}

// ── Standings scraping ────────────────────────────────────────────────────────

async function scrapeStandings(divId, teamId) {
  await setMode('regular', 'standings', '', divId);
  const html = await request(`standings.php?div=${divId}`);
  const parsed = parseStandingsTable(html);
  if (!parsed) return [];

  const { headers, rows } = parsed;
  const col = n => colIdx(headers, n);
  const standings = [];

  for (const row of rows) {
    if (row.length < 3) continue;
    const teamName = row[col('team') >= 0 ? col('team') : 0] || '';
    if (!teamName || teamName.toLowerCase() === 'team') continue;

    // Extract teamId from link in raw HTML — search surrounding context
    standings.push({
      team: teamName,
      gp: +row[col('gp')]||0, w: +row[col('w')]||0, l: +row[col('l')]||0,
      t: +row[col('t')]||0, gf: +row[col('gf')]||0, ga: +row[col('ga')]||0,
      pts: +row[col('pts')]||0,
    });
  }

  return standings;
}

// ── Playoff scraping (game-by-game, Option B) ─────────────────────────────────

async function scrapePlayoffGames(divId, teamId) {
  // Get all game IDs from the div results page
  await setMode('playoffs', 'schedule', '', divId);
  await sleep(DELAY_MS);
  const html = await request(`results.php?div=${divId}`);

  const gameIds = [...new Set(
    [...html.matchAll(/results\.php\?game=(\d+)/gi)].map(m => m[1])
  )];

  const pharaohsGames = [];

  for (const gameId of gameIds) {
    await sleep(GAME_DELAY_MS);
    const gameHtml = await request(`results.php?game=${gameId}`);

    // Extract team names from links
    const teamLinks = [...gameHtml.matchAll(/results\.php\?team=(\d+)['"]>([\s\S]*?)<\/a>/gi)];
    if (teamLinks.length < 2) continue;

    const home = { teamId: teamLinks[0][1], name: stripTags(teamLinks[0][2]).trim() };
    const away = { teamId: teamLinks[1][1], name: stripTags(teamLinks[1][2]).trim() };

    // Only keep games where Pharaohs played
    if (!/phar/i.test(home.name) && !/phar/i.test(away.name)) continue;

    // Extract date/time
    const dateMatch = gameHtml.match(/(\w+,\s+\w+\s+\d+,\s+\d{4})/);
    const timeMatch = gameHtml.match(/(\d+:\d+\s*[AP]M)/i);
    const { date } = dateMatch ? parseDateTimeLong(dateMatch[1] + ' ' + (timeMatch?.[1] || '12:00 AM')) : {};

    // Extract scores from the score table
    let homeScore = null, awayScore = null;
    const scoreRows = [...gameHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
    for (const sr of scoreRows) {
      const cells = (sr[1].match(/<td[^>]*>([\s\S]*?)<\/td>/gi) || []).map(c => stripTags(c).trim());
      if (cells.length >= 4 && !isNaN(parseInt(cells[cells.length-1], 10))) {
        const score = parseInt(cells[cells.length-1], 10);
        if (homeScore === null) homeScore = score;
        else if (awayScore === null) awayScore = score;
      }
    }

    if (homeScore === null || awayScore === null) continue;

    const pharIsHome = /phar/i.test(home.name);
    const result = homeScore === awayScore ? 'T' :
      (pharIsHome ? (homeScore > awayScore ? 'W' : 'L') : (awayScore > homeScore ? 'W' : 'L'));

    pharaohsGames.push({
      gameId, date: date || '',
      home: home.name, homeTeamId: home.teamId,
      away: away.name, awayTeamId: away.teamId,
      homeScore, awayScore, result,
    });
  }

  // Infer playoff result from games
  const playoffResult = inferPlayoffResult(pharaohsGames);

  // Also get playoff roster
  await setMode('playoffs', 'rosters', teamId, divId);
  const playoffRoster = await scrapeRoster(teamId, 'playoffs', divId);

  const pw = pharaohsGames.filter(g => g.result === 'W').length;
  const pl = pharaohsGames.filter(g => g.result === 'L').length;
  const pt = pharaohsGames.filter(g => g.result === 'T').length;

  return {
    record: { w: pw, l: pl, t: pt },
    result: playoffResult,
    games: pharaohsGames,
    roster: playoffRoster,
  };
}

function inferPlayoffResult(games) {
  if (!games.length) return null;
  const last = games[games.length - 1];
  const wins = games.filter(g => g.result === 'W').length;
  const losses = games.filter(g => g.result === 'L').length;
  if (wins >= 3) return '🏆 Champions';
  if (losses === 0 && wins >= 2) return '🥈 Runner-up';
  if (last.result === 'W' && wins >= 2) return '🥈 Runner-up';
  if (last.result === 'L') {
    if (losses === 1) return 'First Round';
    if (losses === 2) return 'Quarterfinal';
    if (losses === 3) return '🥉 Semifinal';
    return '🥈 Runner-up';
  }
  return null;
}

// ── Team ID resolution ────────────────────────────────────────────────────────

/**
 * Extract all team IDs and names from the standings page for this division.
 * This lets us build meta.json with the full team map.
 */
async function scrapeTeamMap(divId, teamId) {
  const html = await request(`standings.php?div=${divId}`);
  const teamMap = {};

  // Extract team links: results.php?team=N or schedule.php?team=N
  for (const m of html.matchAll(/(?:team=(\d+))['"]\s*(?:class=[^>]*)?>([^<]+)/gi)) {
    const id = m[1];
    const name = m[2].trim();
    if (id && name && !/^\d+$/.test(name)) {
      teamMap[id] = name;
    }
  }

  return teamMap;
}

// ── Archive file writing ──────────────────────────────────────────────────────

async function writeArchiveFiles(divId, { meta, rosters, schedule, playoffSchedule, playoffRosters }) {
  const dir = join(ARCHIVE_DIR, divId);
  await mkdir(dir, { recursive: true });

  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');

  await writeFile(join(dir, 'rosters.regular.json'), JSON.stringify({
    divId, mode: 'regular', kind: 'rosters',
    records: { [meta.teams && Object.keys(meta.teams).find(id => /phar/i.test(meta.teams[id])) || 'pharaohs']: rosters.regular },
  }, null, 2), 'utf-8');

  await writeFile(join(dir, 'schedule.regular.json'), JSON.stringify({
    divId, mode: 'regular', kind: 'schedule', records: schedule,
  }, null, 2), 'utf-8');

  if (playoffSchedule && playoffSchedule.length > 0) {
    await writeFile(join(dir, 'rosters.playoff.json'), JSON.stringify({
      divId, mode: 'playoff', kind: 'rosters',
      records: { pharaohs: playoffRosters },
    }, null, 2), 'utf-8');

    await writeFile(join(dir, 'schedule.playoff.json'), JSON.stringify({
      divId, mode: 'playoff', kind: 'schedule', records: playoffSchedule,
    }, null, 2), 'utf-8');
  }

  // Write empty suspensions if missing
  try { await readFile(join(dir, 'suspensions.json')); } catch {
    await writeFile(join(dir, 'suspensions.json'), JSON.stringify({ divId, suspensions: [] }, null, 2), 'utf-8');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function scrapeDiv(divId, teamId, seasonName, divisionLabel) {
  console.log(`\nScraping div ${divId} (${seasonName} ${divisionLabel}), team ${teamId}`);

  console.log('  Establishing session...');
  await establishSession(teamId, divId);

  console.log('  Detecting season name...');
  const detectedSeason = await detectCurrentSeason(divId, teamId);
  const finalSeasonName = seasonName || detectedSeason || 'Unknown';
  console.log(`  Season: ${finalSeasonName}`);

  console.log('  Scraping standings...');
  const standings = await scrapeStandings(divId, teamId);

  console.log('  Scraping regular season roster...');
  const regularRoster = await scrapeRoster(teamId, 'regular', divId);

  console.log('  Scraping regular season schedule...');
  await setMode('regular', 'schedule', teamId, divId);
  const regularSchedule = await scrapeRegularSchedule(teamId, divId);

  console.log('  Scraping playoff data...');
  let playoffs = null;
  try {
    playoffs = await scrapePlayoffGames(divId, teamId);
    console.log(`  Playoffs: ${playoffs.games.length} games, result: ${playoffs.result || 'in progress'}`);
  } catch (err) {
    console.warn(`  Playoffs scrape failed: ${err.message} — skipping`);
  }

  // Reset session to regular mode
  await setMode('regular', 'schedule', teamId, divId);

  // Build team map from standings
  const teamMap = {};
  // We'll populate with what we can from schedule
  teamMap[teamId] = 'Pharaohs';
  for (const game of regularSchedule) {
    // We don't have teamIds for opponents from this scrape — leave for now
  }

  const meta = {
    seasonName: finalSeasonName,
    divisionLabel: divisionLabel || '',
    teams: teamMap,
    divId,
    _updated: new Date().toISOString(),
  };

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would write ${divId}:`);
    console.log(`    Regular: ${regularRoster.skaters.length} skaters, ${regularRoster.goalies.length} goalies, ${regularSchedule.length} games`);
    if (playoffs) console.log(`    Playoffs: ${playoffs.games.length} games`);
    return;
  }

  await writeArchiveFiles(divId, {
    meta,
    rosters: { regular: regularRoster },
    schedule: regularSchedule,
    playoffSchedule: playoffs?.games || [],
    playoffRosters: playoffs?.roster || { skaters: [], goalies: [] },
  });

  // Update scrape index
  let scrapeIndex = {};
  try { scrapeIndex = JSON.parse(await readFile(SCRAPE_INDEX_PATH, 'utf-8')); } catch {}
  scrapeIndex.divisions = scrapeIndex.divisions || {};
  scrapeIndex.divisions[divId] = {
    seasonName: finalSeasonName, divisionLabel, teamId,
    lastScrapedAt: new Date().toISOString(), complete: true,
  };
  scrapeIndex._updated = new Date().toISOString();
  await writeFile(SCRAPE_INDEX_PATH, JSON.stringify(scrapeIndex, null, 2), 'utf-8');

  console.log(`  ✓ Written to archive/divisions/${divId}/`);
  return { seasonName: finalSeasonName, standings, playoffs };
}

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Stiltweb FHL Scraper                  ║');
  console.log('╚══════════════════════════════════════════╝');
  if (DRY_RUN) console.log('  [DRY RUN]');

  if (argDiv && argTeam) {
    // Scrape specific div/team
    const known = KNOWN_SEASONS.find(s => s.divId === argDiv);
    await scrapeDiv(argDiv, argTeam, known?.seasonName, known?.divisionLabel);
    return;
  }

  if (CHECK_ONLY) {
    // Just report what season stiltweb is currently showing
    const latest = KNOWN_SEASONS[0];
    await establishSession(latest.teamId, latest.divId);
    const season = await detectCurrentSeason(latest.divId, latest.teamId);
    console.log('Current season on stiltweb:', season || '(could not detect)');
    console.log('Latest in archive:', latest.seasonName);
    if (season && season !== latest.seasonName) {
      console.log('⚠️  NEW SEASON DETECTED — run without --check-only to scrape');
      process.exitCode = 10; // Signal to calling workflow that a new season exists
    } else {
      console.log('✓  Archive is current');
    }
    return;
  }

  // Default: scrape all known seasons
  for (const { divId, teamId, seasonName, divisionLabel } of KNOWN_SEASONS) {
    await scrapeDiv(divId, teamId, seasonName, divisionLabel);
  }

  console.log('\n✓ All done');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
