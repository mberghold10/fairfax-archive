/**
 * Full Division Scraper for stiltweb.com/eLeague/fhl
 * =====================================================
 * Scrapes an ENTIRE division — all teams, all rosters, full schedule, and
 * every game recap — matching the archive format used by the original bulk
 * scrape and scrape-russian-rocket.mjs.
 *
 * This replaces the old Pharaohs-only scrape-stiltweb.mjs approach for
 * anything beyond simple "check if my team has new games" use.
 *
 * Usage:
 *   node scripts/scrape-division.mjs --div 321                  # scrape one division fully
 *   node scripts/scrape-division.mjs --div 321 --dry-run         # preview without writing
 *   node scripts/scrape-division.mjs --discover                 # find new divisions beyond archive's max ID
 *   node scripts/scrape-division.mjs --discover --scrape         # discover AND scrape any new divisions found
 *
 * Output (per division), matching existing archive format exactly:
 *   archive/divisions/{divId}/meta.json
 *   archive/divisions/{divId}/rosters.regular.json   (grouped by real teamId)
 *   archive/divisions/{divId}/rosters.playoff.json
 *   archive/divisions/{divId}/schedule.regular.json  (home/away as {teamId, name})
 *   archive/divisions/{divId}/schedule.playoff.json
 *   archive/divisions/{divId}/suspensions.json
 *   archive/games/{gameId}.json                      (full box score: goals, penalties, scoring)
 */

import https from 'node:https';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// ── Config ───────────────────────────────────────────────────────────────────

const BASE = 'https://stiltweb.com/eLeague/fhl';
const DELAY_MS = 150;
const GAME_DELAY_MS = 100;

const DRY_RUN = process.argv.includes('--dry-run');
const DISCOVER = process.argv.includes('--discover');
const DO_SCRAPE = process.argv.includes('--scrape');
const FORCE = process.argv.includes('--force');
const REFRESH_ACTIVE = process.argv.includes('--refresh-active');

const argDiv = (() => { const i = process.argv.indexOf('--div'); return i >= 0 ? process.argv[i + 1] : null; })();

const ROOT = resolve(process.cwd());
const ARCHIVE_DIR = resolve(ROOT, 'archive', 'divisions');
const GAMES_DIR = resolve(ROOT, 'archive', 'games');

// ── HTTP / Session ────────────────────────────────────────────────────────────

let sessionCookie = '';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function request(path, opts = {}) {
  return new Promise((res, rej) => {
    const url = path.startsWith('http') ? path : `${BASE}/${path}`;
    const headers = { Cookie: sessionCookie, ...opts.headers };
    const req = https.request(url, { method: opts.method || 'GET', headers, timeout: 15000 }, (response) => {
      const setCookie = response.headers['set-cookie'];
      if (setCookie) {
        for (const c of (Array.isArray(setCookie) ? setCookie : [setCookie])) {
          const name = c.split(';')[0];
          if (name) {
            const existing = Object.fromEntries(
              sessionCookie.split(';').map(p => p.trim().split('=')).filter(p => p.length === 2)
            );
            const [k, v] = name.split('=');
            existing[k.trim()] = v?.trim() || '';
            sessionCookie = Object.entries(existing).map(([k, v]) => `${k}=${v}`).join('; ');
          }
        }
      }
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
    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', rej);
    req.end();
  });
}

async function establishSession(divId) {
  // Any standings/schedule hit establishes a session cookie
  await request(`standings.php?div=${divId}`);
  await sleep(DELAY_MS);
}

async function setMode(mode, page, teamId, divId) {
  const flag = mode === 'playoffs' ? 'yes' : 'no';
  await request(`actions.php?playoffs=${flag}&page=${page}&team=${teamId || ''}&div=${divId}`);
  await sleep(DELAY_MS);
}

// ── HTML helpers ─────────────────────────────────────────────────────────────

function stripTags(html) {
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
             .replace(/&#039;/g, "'").trim();
}

function parseStandingsTable(html) {
  const tableRe = /<table[^>]*class=['"]standings['"][^>]*>/i;
  const start = html.search(tableRe);
  if (start === -1) return null;

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
  return { headers: rows[0].map(h => h.toLowerCase().replace(/[^a-z0-9%]/g, '')), rows: rows.slice(1), rawHtml: tableHtml };
}

function colIdx(headers, name) { return headers.indexOf(name); }

// ── Season/team discovery ─────────────────────────────────────────────────────

/**
 * Scrape the standings page for a division to get:
 *  - season name
 *  - division label — parsed from the content-title breadcrumb
 *    ("Winter 2025 \ C \ Standings ..." → "C")
 *  - team map { teamId: teamName }
 */
async function scrapeDivisionInfo(divId) {
  const html = await request(`standings.php?div=${divId}`);

  // Season name from heading
  let seasonName = null;
  const seasonMatch = html.match(/(Winter|Summer|Fall|Spring)\s+(20\d{2})/i);
  if (seasonMatch) seasonName = `${seasonMatch[1]} ${seasonMatch[2]}`;

  // Division label from the breadcrumb: "<a>Winter 2025</a> \ C \ <span>...</span>"
  let divisionLabel = '';
  const titleMatch = html.match(/content-title[^>]*>([\s\S]*?)<\/div>/i);
  if (titleMatch) {
    const crumb = stripTags(titleMatch[1]);
    const parts = crumb.split('\\').map(p => p.trim()).filter(Boolean);
    // parts[0] = season name, parts[1] = division label (e.g. "C", "D2", "MB")
    if (parts.length >= 2) divisionLabel = parts[1];
  }

  // Team map from links: schedule.php?team=N or results.php?team=N
  const teamMap = {};
  for (const m of html.matchAll(/team=(\d+)['"][^>]*>([^<]+)</gi)) {
    const id = m[1];
    const name = stripTags(m[2]).trim();
    if (id && name && name.length > 0 && !/^\d+$/.test(name)) {
      teamMap[id] = name;
    }
  }

  return { seasonName, divisionLabel, teamMap, html };
}

// ── Roster scraping (single team) ────────────────────────────────────────────

async function scrapeTeamRoster(teamId, playoffs = false) {
  if (playoffs) {
    await request(`actions.php?playoffs=yes&page=rosters&team=${teamId}`);
    await sleep(DELAY_MS);
  } else {
    await request(`actions.php?playoffs=no&page=rosters&team=${teamId}`);
    await sleep(DELAY_MS);
  }

  const html = await request(`rosters.php?team=${teamId}`);

  const skaters = [];
  const goalies = [];

  let remaining = html;
  while (true) {
    const parsed = parseStandingsTable(remaining);
    if (!parsed) break;

    const { headers, rows } = parsed;
    const isGoalie = headers.includes('gaa') || headers.includes('sv') || headers.includes('svpct') || headers.includes('sv%');
    const nameIdx = headers.findIndex(h => h === 'name' || h === 'player');
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
          number: row[0] || '', name, gp,
          w: +row[col('w')] || 0, l: +row[col('l')] || 0, t: +row[col('t')] || 0,
          ga, sa, sv,
          svpct: row[col('sv%')] || row[col('svpct')] || (sa > 0 ? (sv / sa).toFixed(3) : '0.000'),
          gaa: row[col('gaa')] || (gp > 0 ? (ga / gp).toFixed(2) : '0.00'),
          so: +row[col('so')] || 0, pim: +row[col('pim')] || 0,
        });
      } else {
        skaters.push({
          number: row[0] || '', name,
          gp: +row[col('gp')] || 0, g: +row[col('g')] || 0, a: +row[col('a')] || 0,
          pts: +row[col('pts')] || 0, ppg: +row[col('ppg')] || 0, ppa: +row[col('ppa')] || 0,
          shg: +row[col('shg')] || 0, sha: +row[col('sha')] || 0, pim: +row[col('pim')] || 0,
        });
      }
    }

    const tableRe = /<table[^>]*class=['"]standings['"][^>]*>/i;
    const idx = remaining.search(tableRe);
    if (idx === -1) break;
    remaining = remaining.slice(idx + 10);
  }

  return { skaters, goalies };
}

// ── Schedule scraping (division-wide, via results.php) ──────────────────────

function parseDateTimeLong(str) {
  const m = str.match(/(\w+),\s+(\w+)\s+(\d+),\s+(\d{4})\s+(\d+:\d+\s*[AP]M)/i);
  if (!m) return { date: '', time: '' };
  const months = { January:1,February:2,March:3,April:4,May:5,June:6,July:7,August:8,September:9,October:10,November:11,December:12 };
  const mo = months[m[2]] || 1;
  return {
    date: `${m[4]}-${String(mo).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`,
    time: m[5].trim(),
  };
}

/**
 * Get every gameId for a division (regular or playoff) via results.php?div=N.
 * This page lists all games with recap links regardless of team.
 */
async function getAllGameIds(divId, playoffs) {
  await setMode(playoffs ? 'playoffs' : 'regular', 'schedule', null, divId);
  const html = await request(`results.php?div=${divId}`);
  return [...new Set([...html.matchAll(/results\.php\?game=(\d+)/gi)].map(m => m[1]))];
}

/**
 * Scrape a single game recap into the full archive game format.
 */
/**
 * Extract a single named table (by class) from the recap HTML, honoring
 * simple (non-nested) <table class='X'>...</table> structure used by
 * stiltweb's recap pages.
 */
function extractClassTable(html, className) {
  const re = new RegExp(`<table[^>]*class=['"]${className}['"][^>]*>([\\s\\S]*?)<\\/table>`, 'i');
  const m = html.match(re);
  return m ? m[1] : null;
}

async function scrapeGameRecap(gameId, divId, seasonName, mode) {
  const html = await request(`results.php?game=${gameId}`);

  // Team names/ids come from the "vs" line in the content-title breadcrumb:
  //   ... <a href='results.php?team=1963'>Blue Crabs</a> vs <a href='results.php?team=1966'>Punishers HC</a> Game Recap
  const titleMatch = html.match(/content-title[^>]*>([\s\S]*?)<\/div>/i);
  const titleHtml = titleMatch ? titleMatch[1] : html;
  const teamLinks = [...titleHtml.matchAll(/team=(\d+)['"][^>]*>([^<]+)</gi)];
  if (teamLinks.length < 2) return null;

  const home = { teamId: teamLinks[0][1], name: stripTags(teamLinks[0][2]).trim() };
  const away = { teamId: teamLinks[1][1], name: stripTags(teamLinks[1][2]).trim() };

  // Date: "<div class='date'>Monday, June 8, 2026 8:40 PM</div>"
  const dateDivMatch = html.match(/class=['"]date['"][^>]*>([\s\S]*?)<\/div>/i);
  const dateStr = dateDivMatch ? stripTags(dateDivMatch[1]) : '';
  const { date } = parseDateTimeLong(dateStr);

  // Score table: class='overall' — rows: [TeamName, P1, P2, P3, OT, Final]
  let homeScoring = { p1: 0, p2: 0, p3: 0, ot: 0, final: 0 };
  let awayScoring = { p1: 0, p2: 0, p3: 0, ot: 0, final: 0 };
  const overallTable = extractClassTable(html, 'overall');
  if (overallTable) {
    const rows = [...overallTable.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map(r => (r[1].match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || []).map(c => stripTags(c).trim()))
      .filter(r => r.length >= 5 && !/^\s*$/.test(r[0]));
    // rows[0] = header ('', 1, 2, 3, OT, F); rows[1] = home team row; rows[2] = away team row
    const dataRows = rows.filter(r => isNaN(parseInt(r[0], 10)) && r[0] !== '');
    if (dataRows.length >= 2) {
      const toScoring = (row) => {
        const nums = row.slice(1).map(c => parseInt(c, 10) || 0);
        return { p1: nums[0] || 0, p2: nums[1] || 0, p3: nums[2] || 0, ot: nums[3] || 0, final: nums[nums.length - 1] || 0 };
      };
      homeScoring = toScoring(dataRows[0]);
      awayScoring = toScoring(dataRows[1]);
    }
  }

  // Goals: class='scoring' table. Columns: Period, Time, Team, Scored By, 1st Assist, 2nd Assist.
  // Cells are tagged class='team1'/'team2' but the Team column cell text has the actual team name,
  // which we map back to home/away by exact name match.
  const goals = [];
  const scoringTable = extractClassTable(html, 'scoring');
  if (scoringTable) {
    const rows = [...scoringTable.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map(r => (r[1].match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || []).map(c => stripTags(c).trim()));
    for (const row of rows) {
      if (row.length < 6) continue;
      const [period, time, teamName, scorer, assist1, assist2] = row;
      if (!period || period.toLowerCase() === 'period' || !scorer) continue;
      const team = teamName === home.name ? home : (teamName === away.name ? away : { teamId: null, name: teamName });
      goals.push({
        period, time,
        team,
        scorer: scorer || null,
        assist1: assist1 || null,
        assist2: assist2 || null,
      });
    }
  }

  // Penalties: class='penalty' table. Columns: Period, Time, Team, Player, Mins, Offense.
  const penalties = [];
  const penaltyTable = extractClassTable(html, 'penalty');
  if (penaltyTable) {
    const rows = [...penaltyTable.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map(r => (r[1].match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || []).map(c => stripTags(c).trim()));
    for (const row of rows) {
      if (row.length < 6) continue;
      const [period, time, teamName, player, mins, offense] = row;
      if (!period || period.toLowerCase() === 'period' || !player) continue;
      const team = teamName === home.name ? home : (teamName === away.name ? away : { teamId: null, name: teamName });
      const offenseLower = (offense || '').toLowerCase();
      penalties.push({
        period, time,
        team,
        player: player || null,
        pim: parseInt(mins, 10) || 0,
        offense: offenseLower,
        isMajor: /major/.test(offenseLower) || parseInt(mins, 10) >= 5,
        isMatch: /match/.test(offenseLower),
      });
    }
  }

  return {
    gameId: String(gameId),
    date,
    divId: Number(divId),
    seasonName,
    mode,
    home, away,
    scoring: { home: homeScoring, away: awayScoring },
    goals,
    penalties,
    _updated: new Date().toISOString(),
  };
}

// ── Standings scraping ────────────────────────────────────────────────────────

async function scrapeStandings(divId) {
  await setMode('regular', 'standings', null, divId);
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
    standings.push({
      team: teamName,
      gp: +row[col('gp')] || 0, w: +row[col('w')] || 0, l: +row[col('l')] || 0,
      t: +row[col('t')] || 0, gf: +row[col('gf')] || 0, ga: +row[col('ga')] || 0,
      pts: +row[col('pts')] || 0,
    });
  }
  return standings;
}

// ── Main division scrape ──────────────────────────────────────────────────────

async function scrapeDivision(divId) {
  console.log(`\n═══ Division ${divId} ═══`);

  try {
    await establishSession(divId);
  } catch (err) {
    console.warn(`  ⚠ Cannot reach stiltweb.com (${err.code || err.message}) — skipping`);
    return null;
  }

  console.log('  Discovering teams and season...');
  const { seasonName, divisionLabel, teamMap } = await scrapeDivisionInfo(divId);
  if (!seasonName || Object.keys(teamMap).length === 0) {
    console.warn('  ⚠ No season/teams found — division may not exist or be empty');
    return null;
  }
  console.log(`  Season: ${seasonName} ${divisionLabel} | Teams: ${Object.keys(teamMap).length}`);

  // Scrape each team's roster
  const rosterRecords = {};
  for (const [teamId, teamName] of Object.entries(teamMap)) {
    console.log(`  Roster: ${teamName} (${teamId})...`);
    await sleep(DELAY_MS);
    const { skaters, goalies } = await scrapeTeamRoster(teamId, false);
    rosterRecords[teamId] = {
      skaters: skaters.map(s => ({
        team: { teamId, name: teamName },
        playerKey: `name:${s.name.toLowerCase().replace(/[^a-z,\s]/g, '').trim()}`,
        ...s,
        suspensionColumn: '',
        divId: Number(divId), seasonName, mode: 'regular',
      })),
      goalies: goalies.map(g => ({
        team: { teamId, name: teamName },
        playerKey: `name:${g.name.toLowerCase().replace(/[^a-z,\s]/g, '').trim()}`,
        ...g,
        suspensionColumn: '',
        divId: Number(divId), seasonName, mode: 'regular',
      })),
    };
  }

  // Scrape all regular season game IDs, then recap each
  console.log('  Discovering regular season games...');
  const regularGameIds = await getAllGameIds(divId, false);
  console.log(`  Found ${regularGameIds.length} regular season games`);

  const regularSchedule = [];
  for (const gameId of regularGameIds) {
    await sleep(GAME_DELAY_MS);
    try {
      const game = await scrapeGameRecap(gameId, divId, seasonName, 'regular');
      if (!game) continue;
      if (!DRY_RUN) {
        await mkdir(GAMES_DIR, { recursive: true });
        await writeFile(join(GAMES_DIR, `${gameId}.json`), JSON.stringify(game, null, 2), 'utf-8');
      }
      regularSchedule.push({
        date: game.date, time: '',
        home: { teamId: game.home.teamId, name: game.home.name },
        away: { teamId: game.away.teamId, name: game.away.name },
        gameId: String(gameId), mode: 'regular',
        divId: Number(divId), seasonName,
      });
    } catch (err) {
      console.warn(`    ✗ game ${gameId}: ${err.message}`);
    }
  }

  // Playoffs
  console.log('  Discovering playoff games...');
  let playoffGameIds = [];
  try {
    playoffGameIds = await getAllGameIds(divId, true);
  } catch (err) {
    console.warn(`  ⚠ Playoff discovery failed: ${err.message}`);
  }
  console.log(`  Found ${playoffGameIds.length} playoff games`);

  const playoffSchedule = [];
  const playoffRosterRecords = {};
  for (const gameId of playoffGameIds) {
    await sleep(GAME_DELAY_MS);
    try {
      const game = await scrapeGameRecap(gameId, divId, seasonName, 'playoff');
      if (!game) continue;
      if (!DRY_RUN) {
        await mkdir(GAMES_DIR, { recursive: true });
        await writeFile(join(GAMES_DIR, `${gameId}.json`), JSON.stringify(game, null, 2), 'utf-8');
      }
      playoffSchedule.push({
        date: game.date, time: '',
        home: { teamId: game.home.teamId, name: game.home.name },
        away: { teamId: game.away.teamId, name: game.away.name },
        gameId: String(gameId), mode: 'playoff',
        divId: Number(divId), seasonName,
      });
    } catch (err) {
      console.warn(`    ✗ playoff game ${gameId}: ${err.message}`);
    }
  }

  // Playoff rosters (best-effort, per team)
  if (playoffSchedule.length > 0) {
    for (const [teamId, teamName] of Object.entries(teamMap)) {
      try {
        await sleep(DELAY_MS);
        const { skaters, goalies } = await scrapeTeamRoster(teamId, true);
        if (skaters.length || goalies.length) {
          playoffRosterRecords[teamId] = {
            skaters: skaters.map(s => ({
              team: { teamId, name: teamName },
              playerKey: `name:${s.name.toLowerCase().replace(/[^a-z,\s]/g, '').trim()}`,
              ...s, suspensionColumn: '', divId: Number(divId), seasonName, mode: 'playoff',
            })),
            goalies: goalies.map(g => ({
              team: { teamId, name: teamName },
              playerKey: `name:${g.name.toLowerCase().replace(/[^a-z,\s]/g, '').trim()}`,
              ...g, suspensionColumn: '', divId: Number(divId), seasonName, mode: 'playoff',
            })),
          };
        }
      } catch { /* best-effort */ }
    }
  }

  const meta = {
    seasonName,
    divisionLabel,
    teams: teamMap,
    divId: String(divId),
    _updated: new Date().toISOString(),
  };

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would write div ${divId}:`);
    console.log(`    ${Object.keys(teamMap).length} teams, ${regularSchedule.length} regular games, ${playoffSchedule.length} playoff games`);
    return { meta, regularSchedule, playoffSchedule };
  }

  const dir = join(ARCHIVE_DIR, String(divId));
  await mkdir(dir, { recursive: true });

  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
  await writeFile(join(dir, 'rosters.regular.json'), JSON.stringify({
    divId: String(divId), mode: 'regular', kind: 'rosters', records: rosterRecords,
  }, null, 2), 'utf-8');
  await writeFile(join(dir, 'schedule.regular.json'), JSON.stringify({
    divId: String(divId), mode: 'regular', kind: 'schedule', records: regularSchedule, _updated: new Date().toISOString(),
  }, null, 2), 'utf-8');

  if (playoffSchedule.length > 0) {
    await writeFile(join(dir, 'schedule.playoff.json'), JSON.stringify({
      divId: String(divId), mode: 'playoff', kind: 'schedule', records: playoffSchedule, _updated: new Date().toISOString(),
    }, null, 2), 'utf-8');
  }
  if (Object.keys(playoffRosterRecords).length > 0) {
    await writeFile(join(dir, 'rosters.playoff.json'), JSON.stringify({
      divId: String(divId), mode: 'playoff', kind: 'rosters', records: playoffRosterRecords,
    }, null, 2), 'utf-8');
  }

  try { await readFile(join(dir, 'suspensions.json')); } catch {
    await writeFile(join(dir, 'suspensions.json'), JSON.stringify({ divId: String(divId), suspensions: [] }, null, 2), 'utf-8');
  }

  console.log(`  ✓ Written archive/divisions/${divId}/ (${regularSchedule.length} reg + ${playoffSchedule.length} playoff games)`);
  return { meta, regularSchedule, playoffSchedule };
}

// ── New division discovery ────────────────────────────────────────────────────

/**
 * Try division IDs beyond the archive's current max to find new ones stiltweb
 * has created for a new season. Stops after MAX_MISSES consecutive empty divs.
 */
async function discoverNewDivisions() {
  const existingIds = (await readdir(ARCHIVE_DIR))
    .filter(d => /^\d+$/.test(d))
    .map(d => Number(d));
  const maxKnown = Math.max(...existingIds, 0);

  console.log(`Archive's highest known division ID: ${maxKnown}`);
  console.log('Probing for new divisions...\n');

  const found = [];
  const MAX_MISSES = 5;
  let misses = 0;
  let divId = maxKnown + 1;

  while (misses < MAX_MISSES) {
    try {
      await establishSession(divId);
      const { seasonName, teamMap } = await scrapeDivisionInfo(divId);
      if (seasonName && Object.keys(teamMap).length > 0) {
        console.log(`  div ${divId}: ${seasonName} (${Object.keys(teamMap).length} teams) ← NEW`);
        found.push({ divId, seasonName, teamCount: Object.keys(teamMap).length });
        misses = 0;
      } else {
        console.log(`  div ${divId}: empty`);
        misses++;
      }
    } catch (err) {
      console.log(`  div ${divId}: error (${err.code || err.message})`);
      misses++;
    }
    divId++;
    await sleep(DELAY_MS);
  }

  console.log(`\nFound ${found.length} new division(s).`);
  return found;
}

// ── Active season refresh ─────────────────────────────────────────────────────

/**
 * Sort key for "Winter 2025" style season names — higher = more recent.
 * Mirrors scripts/aggregate/seasonCatalog.mjs.
 */
function seasonSortKey(seasonName) {
  const m = (seasonName || '').match(/(\w+)\s+(\d{4})/);
  if (!m) return 0;
  const term = m[1].toLowerCase();
  const year = parseInt(m[2], 10);
  const termOrder = { spring: 1, summer: 2, fall: 3, winter: 4 };
  return year * 10 + (termOrder[term] || 0);
}

/**
 * Re-scrape every division belonging to the N most recent seasons already
 * in the archive (by meta.json seasonName). This catches new game results,
 * final playoff brackets, and roster updates for in-progress/just-finished
 * seasons without re-scraping the entire historical archive.
 */
async function refreshActiveSeasons(seasonsBack = 2) {
  const dirs = (await readdir(ARCHIVE_DIR)).filter(d => /^\d+$/.test(d));

  const divSeasons = [];
  for (const divId of dirs) {
    try {
      const meta = JSON.parse(await readFile(join(ARCHIVE_DIR, divId, 'meta.json'), 'utf-8'));
      if (meta.seasonName) divSeasons.push({ divId, seasonName: meta.seasonName });
    } catch { /* skip divisions without meta.json */ }
  }

  const distinctSeasons = [...new Set(divSeasons.map(d => d.seasonName))]
    .sort((a, b) => seasonSortKey(b) - seasonSortKey(a));
  const targetSeasons = new Set(distinctSeasons.slice(0, seasonsBack));

  const targetDivs = divSeasons.filter(d => targetSeasons.has(d.seasonName)).map(d => d.divId);

  console.log(`Refreshing ${targetDivs.length} division(s) from ${[...targetSeasons].join(', ')}:`);
  targetDivs.forEach(d => console.log(`  div ${d}`));

  for (const divId of targetDivs) {
    await scrapeDivision(divId);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Full Division Scraper (stiltweb.com)  ║');
  console.log('╚══════════════════════════════════════════╝');
  if (DRY_RUN) console.log('  [DRY RUN]');

  if (DISCOVER) {
    const found = await discoverNewDivisions();
    if (found.length > 0 && DO_SCRAPE) {
      console.log('\nScraping newly discovered divisions...');
      for (const { divId } of found) {
        await scrapeDivision(divId);
      }
    } else if (found.length > 0) {
      console.log('\nRun again with --scrape to fetch these divisions, e.g.:');
      found.forEach(f => console.log(`  node scripts/scrape-division.mjs --div ${f.divId}`));
    }
    return;
  }

  if (REFRESH_ACTIVE) {
    await refreshActiveSeasons();
    return;
  }

  if (argDiv) {
    await scrapeDivision(argDiv);
    return;
  }

  console.error('Usage: node scripts/scrape-division.mjs --div N | --discover [--scrape] | --refresh-active');
  process.exit(1);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
