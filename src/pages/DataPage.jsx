import React, { useState, useEffect, useCallback } from 'react';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import Loading from '../components/Loading.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import '../styles/data-page.css';

const BASE = '';  // same origin

/**
 * Trigger a JSON download in the browser.
 * Fetches the URL, converts to a formatted JSON blob, and clicks a hidden link.
 */
async function downloadJson(url, filename) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  const data = await res.json();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  triggerDownload(blob, filename);
}

/**
 * Convert a flat array of objects to CSV and download it.
 */
function toCSV(rows) {
  if (!rows || rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    if (v == null) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const lines = [
    headers.join(','),
    ...rows.map(row => headers.map(h => escape(row[h])).join(',')),
  ];
  return lines.join('\n');
}

async function downloadCSV(url, filename, transform) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}`);
  const data = await res.json();
  const rows = transform(data);
  const csv = toCSV(rows);
  const blob = new Blob([csv], { type: 'text/csv' });
  triggerDownload(blob, filename);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── CSV transformers ──────────────────────────────────────────────────────────

function flattenPlayers(data) {
  return data.map(p => ({
    name: p.displayName,
    gp: p.totals.gp,
    g: p.totals.g,
    a: p.totals.a,
    pts: p.totals.pts,
    ppg: p.totals.ppg,
    ppa: p.totals.ppa,
    shg: p.totals.shg,
    sha: p.totals.sha,
    pim: p.totals.pim,
  }));
}

function flattenGoalies(data) {
  return data.map(g => ({
    name: g.displayName,
    gp: g.totals.gp,
    w: g.totals.w,
    l: g.totals.l,
    t: g.totals.t,
    ga: g.totals.ga,
    sa: g.totals.sa,
    sv: g.totals.sv,
    so: g.totals.so,
    gaa: g.totals.gaa,
    svpct: g.totals.svpct,
  }));
}

function flattenTeamSeasons(data) {
  return (data.seasons || []).map(s => ({
    seasonName: s.seasonName,
    divisionLabel: s.divisionLabel,
    w: s.record?.w ?? 0,
    l: s.record?.l ?? 0,
    t: s.record?.t ?? 0,
    pts: s.record?.pts ?? 0,
    placement: s.record?.placement ?? '',
  }));
}

function flattenTeamSkaters(data) {
  const rows = [];
  for (const season of (data.seasons || [])) {
    for (const s of (season.roster?.skaters || [])) {
      rows.push({
        season: season.seasonName,
        division: season.divisionLabel,
        name: s.name,
        number: s.number,
        gp: s.gp,
        g: s.g,
        a: s.a,
        pts: s.pts,
        pim: s.pim,
      });
    }
  }
  return rows;
}

// ── Download button ───────────────────────────────────────────────────────────

function DownloadButton({ label, onDownload, format }) {
  const [state, setState] = useState('idle'); // idle | loading | done | error

  const handleClick = async () => {
    setState('loading');
    try {
      await onDownload();
      setState('done');
      setTimeout(() => setState('idle'), 2000);
    } catch (err) {
      console.error(err);
      setState('error');
      setTimeout(() => setState('idle'), 3000);
    }
  };

  const icon = format === 'csv' ? '📊' : '📄';
  const statusLabel = state === 'loading' ? 'Downloading…'
    : state === 'done' ? '✓ Done'
    : state === 'error' ? '✗ Error'
    : `${icon} ${label} (${format.toUpperCase()})`;

  return (
    <button
      className={`data-page__btn data-page__btn--${state}`}
      onClick={handleClick}
      disabled={state === 'loading'}
    >
      {statusLabel}
    </button>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DataPage() {
  const [catalog, setCatalog] = useState(null);
  const [selectedTeam, setSelectedTeam] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [catalogError, setCatalogError] = useState(null);

  useEffect(() => {
    fetch('/data/season-catalog.json')
      .then(r => r.json())
      .then(d => {
        // Build unique canonical team list
        const seen = new Set();
        const teams = [];
        for (const season of d.seasons) {
          for (const div of season.divisions) {
            for (const [, name] of Object.entries(div.teams)) {
              if (!seen.has(name)) { seen.add(name); teams.push(name); }
            }
          }
        }
        teams.sort();
        setCatalog(teams);
      })
      .catch(err => setCatalogError(err.message));
  }, []);

  const toSlug = (name) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const filteredTeams = teamFilter.trim()
    ? (catalog || []).filter(t => t.toLowerCase().includes(teamFilter.toLowerCase()))
    : (catalog || []);

  return (
    <div className="data-page">
      <Breadcrumbs crumbs={[{ label: 'Home', to: '/' }, { label: 'Data' }]} />
      <h1 className="data-page__title">Download Data</h1>
      <p className="data-page__subtitle">
        All data is served as JSON or CSV. Files are generated fresh on each deployment.
      </p>

      {/* ── Archive-wide ── */}
      <section className="data-page__section">
        <h2>Full Archive</h2>
        <p className="data-page__desc">
          Career stats for every player and goalie across all seasons.
        </p>
        <div className="data-page__buttons">
          <DownloadButton
            label="All Skaters"
            format="json"
            onDownload={() => downloadJson('/data/all-players.json', 'fhl-skaters.json')}
          />
          <DownloadButton
            label="All Skaters"
            format="csv"
            onDownload={() => downloadCSV('/data/all-players.json', 'fhl-skaters.csv', flattenPlayers)}
          />
          <DownloadButton
            label="All Goalies"
            format="json"
            onDownload={() => downloadJson('/data/all-goalies.json', 'fhl-goalies.json')}
          />
          <DownloadButton
            label="All Goalies"
            format="csv"
            onDownload={() => downloadCSV('/data/all-goalies.json', 'fhl-goalies.csv', flattenGoalies)}
          />
          <DownloadButton
            label="Leaders"
            format="json"
            onDownload={() => downloadJson('/data/leaders.json', 'fhl-leaders.json')}
          />
          <DownloadButton
            label="Season Catalog"
            format="json"
            onDownload={() => downloadJson('/data/season-catalog.json', 'fhl-seasons.json')}
          />
        </div>
      </section>

      {/* ── Team ── */}
      <section className="data-page__section">
        <h2>Team Data</h2>
        <p className="data-page__desc">
          Download season records, rosters, and stats for a specific team.
        </p>

        {catalogError && <p className="data-page__error">Could not load team list: {catalogError}</p>}

        {catalog ? (
          <div className="data-page__team-picker">
            <input
              type="search"
              className="data-page__search"
              placeholder="Type a team name…"
              value={teamFilter}
              onChange={e => { setTeamFilter(e.target.value); setSelectedTeam(''); }}
              aria-label="Search teams"
            />

            {teamFilter.trim() && (
              <ul className="data-page__team-list">
                {filteredTeams.slice(0, 20).map(t => (
                  <li
                    key={t}
                    className={`data-page__team-item${selectedTeam === t ? ' data-page__team-item--selected' : ''}`}
                    onClick={() => setSelectedTeam(t)}
                  >
                    <span className="data-page__team-name">{t}</span>
                  </li>
                ))}
                {filteredTeams.length === 0 && (
                  <li className="data-page__team-empty">No teams match "{teamFilter}"</li>
                )}
              </ul>
            )}

            {selectedTeam && (
              <div className="data-page__team-downloads">
                <p className="data-page__team-selected">
                  Downloads for <strong>{selectedTeam}</strong>:
                </p>
                <div className="data-page__buttons">
                  <DownloadButton
                    label="Full History"
                    format="json"
                    onDownload={() =>
                      downloadJson(`/data/teams/${toSlug(selectedTeam)}.json`, `${toSlug(selectedTeam)}.json`)
                    }
                  />
                  <DownloadButton
                    label="Season Records"
                    format="csv"
                    onDownload={() =>
                      downloadCSV(
                        `/data/teams/${toSlug(selectedTeam)}.json`,
                        `${toSlug(selectedTeam)}-seasons.csv`,
                        flattenTeamSeasons
                      )
                    }
                  />
                  <DownloadButton
                    label="All Rosters"
                    format="csv"
                    onDownload={() =>
                      downloadCSV(
                        `/data/teams/${toSlug(selectedTeam)}.json`,
                        `${toSlug(selectedTeam)}-rosters.csv`,
                        flattenTeamSkaters
                      )
                    }
                  />
                </div>
              </div>
            )}
          </div>
        ) : !catalogError ? (
          <Loading />
        ) : null}
      </section>
    </div>
  );
}
