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
const BASE_URL = new URL(`${BASE}/`);
const BASE_ORIGIN = BASE_URL.origin;
const DELAY_MS = 150;
const GAME_DELAY_MS = 100;
const REQUEST_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;
const MAX_RETRY_DELAY_MS = 120_000;
const MAX_REDIRECTS = 5;

const DRY_RUN = process.argv.includes('--dry-run');
const DISCOVER = process.argv.includes('--discover');
const DO_SCRAPE = process.argv.includes('--scrape');
const REFRESH_ACTIVE = process.argv.includes('--refresh-active');

const argDiv = (() => { const i = process.argv.indexOf('--div'); return i >= 0 ? process.argv[i + 1] : null; })();

const ROOT = resolve(process.cwd());
const ARCHIVE_DIR = resolve(ROOT, 'archive', 'divisions');
const GAMES_DIR = resolve(ROOT, 'archive', 'games');

// ── HTTP / Session ────────────────────────────────────────────────────────────

let sessionCookie = '';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function updateSessionCookie(setCookie) {
  if (!setCookie) return;
  const existing = Object.fromEntries(
    sessionCookie.split(';').map(p => p.trim().split('=')).filter(p => p.length === 2),
  );
  for (const cookie of (Array.isArray(setCookie) ? setCookie : [setCookie])) {
    const [nameValue] = cookie.split(';');
    const separator = nameValue.indexOf('=');
    if (separator === -1) continue;
    existing[nameValue.slice(0, separator).trim()] = nameValue.slice(separator + 1).trim();
  }
  sessionCookie = Object.entries(existing).map(([name, value]) => `${name}=${value}`).join('; ');
}

function retryAfterMs(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.min(Math.max(seconds * 1000, 0), MAX_RETRY_DELAY_MS);
  }
  const date = Date.parse(value);
  return Number.isNaN(date)
    ? 0
    : Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_DELAY_MS);
}

function allowedRequestUrl(value, kind = 'request') {
  let url;
  try {
    url = value instanceof URL ? value : new URL(value);
  } catch (error) {
    throw new Error(`Invalid ${kind} URL: ${error.message}`, { cause: error });
  }
  if (url.protocol !== 'https:' || url.origin !== BASE_ORIGIN) {
    throw new Error(`Refusing ${kind} to ${url.href}; only HTTPS on ${BASE_ORIGIN} is allowed`);
  }
  return url.href;
}

async function requestOnce(url, opts = {}, redirects = 0) {
  const safeUrl = allowedRequestUrl(url);
  return new Promise((resolveRequest, rejectRequest) => {
    const headers = { Cookie: sessionCookie, ...opts.headers };
    const req = https.request(safeUrl, { method: opts.method || 'GET', headers, timeout: 15000 }, response => {
      const rejectResponseError = error => {
        if (!error.code) error.code = 'ECONNRESET';
        rejectRequest(error);
      };
      response.on('aborted', () => {
        const error = new Error(`Response aborted while requesting ${safeUrl}`);
        error.code = 'ECONNRESET';
        rejectResponseError(error);
      });
      response.on('error', rejectResponseError);

      updateSessionCookie(response.headers['set-cookie']);

      const status = response.statusCode || 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirects >= MAX_REDIRECTS) {
          rejectRequest(new Error(`Too many redirects requesting ${safeUrl}`));
          return;
        }
        try {
          const location = allowedRequestUrl(new URL(response.headers.location, safeUrl), 'redirect');
          requestOnce(location, opts, redirects + 1).then(resolveRequest, rejectRequest);
        } catch (error) {
          rejectRequest(error);
        }
        return;
      }

      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        if (status >= 200 && status < 300) {
          resolveRequest(data);
          return;
        }
        const error = new Error(`HTTP ${status} requesting ${safeUrl}`);
        error.statusCode = status;
        error.retryable = status === 408 || status === 429 || status >= 500;
        error.retryAfterMs = retryAfterMs(response.headers['retry-after']);
        rejectRequest(error);
      });
    });

    req.on('timeout', () => {
      const error = new Error(`Request timed out: ${safeUrl}`);
      error.code = 'ETIMEDOUT';
      req.destroy(error);
    });
    req.on('error', rejectRequest);
    req.end();
  });
}

function isTransientRequestError(error) {
  return error.retryable || [
    'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH',
    'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EPIPE',
  ].includes(error.code);
}

async function request(path, opts = {}) {
  const url = allowedRequestUrl(new URL(path, BASE_URL));
  let lastError;

  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt++) {
    try {
      return await requestOnce(url, opts);
    } catch (error) {
      lastError = error;
      if (!isTransientRequestError(error) || attempt === REQUEST_ATTEMPTS) break;
      const delay = error.retryAfterMs || Math.min(
        RETRY_BASE_MS * (2 ** (attempt - 1)),
        MAX_RETRY_DELAY_MS,
      );
      console.warn(`  ⚠ Request failed (attempt ${attempt}/${REQUEST_ATTEMPTS}): ${error.message}; retrying in ${delay}ms`);
      await sleep(delay);
    }
  }

  throw new Error(`Request failed after retries: ${lastError.message}`, { cause: lastError });
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
  const flag = playoffs ? 'yes' : 'no';
  await request(`actions.php?playoffs=${flag}&page=rosters&team=${teamId}`);
  await sleep(DELAY_MS);

  const html = await request(`rosters.php?team=${teamId}`);
  const skaters = [];
  const goalies = [];
  let tablesParsed = 0;

  let remaining = html;
  while (true) {
    const parsed = parseStandingsTable(remaining);
    if (!parsed) break;
    tablesParsed++;

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

  if (tablesParsed === 0) {
    throw new Error(`Could not parse ${playoffs ? 'playoff' : 'regular'} roster for team ${teamId}`);
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
  if (!/content-title/i.test(html)) {
    throw new Error(`Could not parse ${playoffs ? 'playoff' : 'regular'} results page for division ${divId}`);
  }

  const gameIds = [...new Set([...html.matchAll(/results\.php\?game=(\d+)/gi)].map(m => m[1]))];
  const mode = playoffs ? 'playoff' : 'regular';
  const schedulePath = join(ARCHIVE_DIR, String(divId), `schedule.${mode}.json`);
  try {
    const existing = JSON.parse(await readFile(schedulePath, 'utf-8'));
    const found = new Set(gameIds);
    const missing = (existing.records || [])
      .map(game => String(game.gameId))
      .filter(gameId => !found.has(gameId));
    if (missing.length > 0) {
      throw new Error(`${mode} results for division ${divId} omitted archived games: ${missing.join(', ')}`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  return gameIds;
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
  if (teamLinks.length < 2) {
    throw new Error(`Could not parse teams for game ${gameId}`);
  }

  const home = { teamId: teamLinks[0][1], name: stripTags(teamLinks[0][2]).trim() };
  const away = { teamId: teamLinks[1][1], name: stripTags(teamLinks[1][2]).trim() };

  // Date: "<div class='date'>Monday, June 8, 2026 8:40 PM</div>"
  const dateDivMatch = html.match(/class=['"]date['"][^>]*>([\s\S]*?)<\/div>/i);
  const dateStr = dateDivMatch ? stripTags(dateDivMatch[1]) : '';
  const { date } = parseDateTimeLong(dateStr);
  if (!date) throw new Error(`Could not parse date for game ${gameId}`);

  // Score table: class='overall' — rows: [TeamName, P1, P2, P3, OT, Final]
  let homeScoring = { p1: 0, p2: 0, p3: 0, ot: 0, final: 0 };
  let awayScoring = { p1: 0, p2: 0, p3: 0, ot: 0, final: 0 };
  const overallTable = extractClassTable(html, 'overall');
  if (!overallTable) throw new Error(`Could not parse score table for game ${gameId}`);
  {
    const rows = [...overallTable.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
      .map(r => (r[1].match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || []).map(c => stripTags(c).trim()))
      .filter(r => r.length >= 5);
    const normalizeName = name => (name || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const headerRow = rows.find(row => {
      const cells = row.map(cell => cell.trim().toLowerCase());
      return cells.includes('1') && cells.includes('2') && cells.includes('3')
        && (cells.includes('f') || cells.includes('final'));
    });
    const homeRow = rows.find(row => normalizeName(row[0]) === normalizeName(home.name));
    const awayRow = rows.find(row => normalizeName(row[0]) === normalizeName(away.name));
    if (!headerRow || !homeRow || !awayRow) {
      throw new Error(`Could not parse both scores for game ${gameId}`);
    }

    const headers = headerRow.map(cell => cell.trim().toLowerCase());
    const column = (...names) => headers.findIndex(header => names.includes(header));
    const p1Column = column('1');
    const p2Column = column('2');
    const p3Column = column('3');
    const overtimeColumn = column('ot');
    const finalColumn = column('f', 'final');
    if ([p1Column, p2Column, p3Column, finalColumn].some(index => index < 0)) {
      throw new Error(`Score table has unexpected headers for game ${gameId}: ${headers.join(', ')}`);
    }

    const toScoring = row => ({
      p1: parseInt(row[p1Column], 10) || 0,
      p2: parseInt(row[p2Column], 10) || 0,
      p3: parseInt(row[p3Column], 10) || 0,
      ot: overtimeColumn >= 0 ? (parseInt(row[overtimeColumn], 10) || 0) : 0,
      final: parseInt(row[finalColumn], 10) || 0,
    });
    homeScoring = toScoring(homeRow);
    awayScoring = toScoring(awayRow);
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
  if (!parsed) throw new Error(`Could not parse standings for division ${divId}`);

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

function comparableJson(value) {
  if (Array.isArray(value)) return value.map(comparableJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== '_updated')
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, comparableJson(child)]),
    );
  }
  return value;
}

async function writeJsonIfChanged(filePath, value) {
  try {
    const existing = JSON.parse(await readFile(filePath, 'utf-8'));
    if (JSON.stringify(comparableJson(existing)) === JSON.stringify(comparableJson(value))) {
      return false;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8');
  return true;
}

async function assertTeamMapNotShrunk(divId, teamMap) {
  const metaPath = join(ARCHIVE_DIR, String(divId), 'meta.json');
  let existing;
  try {
    existing = JSON.parse(await readFile(metaPath, 'utf-8'));
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  if (!existing.teams || typeof existing.teams !== 'object' || Array.isArray(existing.teams)) {
    throw new Error(`Cannot safely refresh division ${divId}: existing meta.json has no valid teams map`);
  }

  const existingTeamIds = Object.keys(existing.teams);
  const currentTeamIds = Object.keys(teamMap);
  if (currentTeamIds.length < existingTeamIds.length) {
    const current = new Set(currentTeamIds);
    const missing = existingTeamIds
      .filter(teamId => !current.has(teamId))
      .map(teamId => `${teamId} (${existing.teams[teamId]})`);
    throw new Error(
      `Refusing to overwrite division ${divId}: current standings returned ${currentTeamIds.length} team(s), `
      + `but existing meta.json has ${existingTeamIds.length}; missing archived team(s): ${missing.join(', ') || 'unknown'}`,
    );
  }
}

function assertScheduleTeamsKnown(divId, teamMap, schedules) {
  for (const [mode, records] of Object.entries(schedules)) {
    for (const game of records) {
      for (const side of ['home', 'away']) {
        const teamId = String(game[side]?.teamId || '');
        if (!teamId || !Object.prototype.hasOwnProperty.call(teamMap, teamId)) {
          const teamName = game[side]?.name || 'unknown team';
          throw new Error(
            `Refusing to write division ${divId}: ${mode} game ${game.gameId} has ${side} team `
            + `${teamId || '(missing ID)'} (${teamName}) absent from the current standings team map`,
          );
        }
      }
    }
  }
}

// ── Main division scrape ──────────────────────────────────────────────────────

async function scrapeDivision(divId) {
  console.log(`\n═══ Division ${divId} ═══`);

  await establishSession(divId);

  console.log('  Discovering teams and season...');
  const { seasonName, divisionLabel, teamMap } = await scrapeDivisionInfo(divId);
  if (!seasonName || Object.keys(teamMap).length === 0) {
    throw new Error(`Could not parse season and teams for known division ${divId}`);
  }
  await assertTeamMapNotShrunk(divId, teamMap);
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

  const gamesToWrite = [];
  const regularSchedule = [];
  for (const gameId of regularGameIds) {
    await sleep(GAME_DELAY_MS);
    const game = await scrapeGameRecap(gameId, divId, seasonName, 'regular');
    gamesToWrite.push(game);
    regularSchedule.push({
      date: game.date, time: '',
      home: { teamId: game.home.teamId, name: game.home.name },
      away: { teamId: game.away.teamId, name: game.away.name },
      gameId: String(gameId), mode: 'regular',
      divId: Number(divId), seasonName,
    });
  }

  // Playoffs
  console.log('  Discovering playoff games...');
  const playoffGameIds = await getAllGameIds(divId, true);
  console.log(`  Found ${playoffGameIds.length} playoff games`);

  const playoffSchedule = [];
  const playoffRosterRecords = {};
  for (const gameId of playoffGameIds) {
    await sleep(GAME_DELAY_MS);
    const game = await scrapeGameRecap(gameId, divId, seasonName, 'playoff');
    gamesToWrite.push(game);
    playoffSchedule.push({
      date: game.date, time: '',
      home: { teamId: game.home.teamId, name: game.home.name },
      away: { teamId: game.away.teamId, name: game.away.name },
      gameId: String(gameId), mode: 'playoff',
      divId: Number(divId), seasonName,
    });
  }

  assertScheduleTeamsKnown(divId, teamMap, {
    regular: regularSchedule,
    playoff: playoffSchedule,
  });

  // Only playoff participants have playoff rosters; their requests are required.
  if (playoffSchedule.length > 0) {
    const playoffTeamIds = new Set(
      playoffSchedule.flatMap(game => [String(game.home.teamId), String(game.away.teamId)]),
    );
    for (const [teamId, teamName] of Object.entries(teamMap)) {
      if (!playoffTeamIds.has(String(teamId))) continue;
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
    }
  }

  const updatedAt = new Date().toISOString();
  const meta = {
    seasonName,
    divisionLabel,
    teams: teamMap,
    divId: String(divId),
    _updated: updatedAt,
  };

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would write div ${divId}:`);
    console.log(`    ${Object.keys(teamMap).length} teams, ${regularSchedule.length} regular games, ${playoffSchedule.length} playoff games`);
    return { meta, regularSchedule, playoffSchedule };
  }

  const dir = join(ARCHIVE_DIR, String(divId));
  await mkdir(dir, { recursive: true });
  await mkdir(GAMES_DIR, { recursive: true });

  // All remote data has been parsed successfully before any archive write.
  for (const game of gamesToWrite) {
    await writeJsonIfChanged(join(GAMES_DIR, `${game.gameId}.json`), game);
  }

  await writeJsonIfChanged(join(dir, 'meta.json'), meta);
  await writeJsonIfChanged(join(dir, 'rosters.regular.json'), {
    divId: String(divId), mode: 'regular', kind: 'rosters', records: rosterRecords,
  });
  await writeJsonIfChanged(join(dir, 'schedule.regular.json'), {
    divId: String(divId), mode: 'regular', kind: 'schedule', records: regularSchedule, _updated: updatedAt,
  });

  if (playoffSchedule.length > 0) {
    await writeJsonIfChanged(join(dir, 'schedule.playoff.json'), {
      divId: String(divId), mode: 'playoff', kind: 'schedule', records: playoffSchedule, _updated: updatedAt,
    });
  }
  if (Object.keys(playoffRosterRecords).length > 0) {
    await writeJsonIfChanged(join(dir, 'rosters.playoff.json'), {
      divId: String(divId), mode: 'playoff', kind: 'rosters', records: playoffRosterRecords,
    });
  }

  try {
    await readFile(join(dir, 'suspensions.json'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeJsonIfChanged(join(dir, 'suspensions.json'), { divId: String(divId), suspensions: [] });
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
    const meta = JSON.parse(await readFile(join(ARCHIVE_DIR, divId, 'meta.json'), 'utf-8'));
    if (!meta.seasonName) throw new Error(`Division ${divId} meta.json has no seasonName`);
    divSeasons.push({ divId, seasonName: meta.seasonName });
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
