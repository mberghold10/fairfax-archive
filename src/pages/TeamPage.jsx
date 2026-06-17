import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import Loading from '../components/Loading.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import PlayerLink from '../components/PlayerLink.jsx';
import TeamLink from '../components/TeamLink.jsx';
import StatsTable from '../components/StatsTable.jsx';
import Collapsible from '../components/Collapsible.jsx';
import '../styles/team-page.css';
import '../styles/division-page.css';

function toSeasonSlug(seasonName) {
  return seasonName.toLowerCase().replace(/\s+/g, '-');
}

function generatePlayerIdFromName(name) {
  const normalized = name.toLowerCase().replace(/[^a-z\s,]/g, '').replace(/\s+/g, ' ').trim();
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(12, '0').slice(0, 12);
}

export default function TeamPage() {
  const { teamId } = useParams();
  const [team, setTeam] = useState(null);
  const [seasonData, setSeasonData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const fetchTeam = useCallback(() => {
    setLoading(true);
    setError(null);
    setNotFound(false);

    fetch(`/data/teams/${teamId}.json`)
      .then((res) => {
        if (res.ok) return res.json();
        if (res.status === 404) {
          return fetch('/data/teams/team-id-index.json')
            .then((r) => r.ok ? r.json() : {})
            .then((index) => {
              const slug = index[String(teamId)];
              if (!slug) return null;
              return fetch(`/data/teams/${slug}.json`).then((r) => r.ok ? r.json() : null);
            });
        }
        throw new Error('Failed to load team data');
      })
      .then((data) => {
        if (!data) { setNotFound(true); setLoading(false); return; }
        setTeam(data);
        // Fetch schedule+scores for each season in parallel
        return Promise.all(
          data.seasons.map((season) => {
            const base = `/data/divisions/${season.divId}`;
            return Promise.all([
              fetch(`${base}/schedule.regular.json`).then(r => r.ok ? r.json() : null).catch(() => null),
              fetch(`${base}/scores.json`).then(r => r.ok ? r.json() : null).catch(() => null),
            ]).then(([schedule, scores]) => ({ divId: season.divId, schedule, scores }));
          })
        ).then((results) => {
          const map = {};
          for (const { divId, schedule, scores } of results) {
            map[divId] = { schedule, scores };
          }
          setSeasonData(map);
          setLoading(false);
        });
      })
      .catch((err) => { setError(err.message); setLoading(false); });
  }, [teamId]);

  useEffect(() => { fetchTeam(); }, [fetchTeam]);

  if (loading) return <Loading />;
  if (error) return <ErrorMessage message={error} onRetry={fetchTeam} />;
  if (notFound) {
    return (
      <div className="team-page">
        <Breadcrumbs crumbs={[{ label: 'Home', to: '/' }, { label: 'Team not found' }]} />
        <ErrorMessage message="Team not found" />
      </div>
    );
  }

  return (
    <div className="team-page">
      <Breadcrumbs crumbs={[{ label: 'Home', to: '/' }, { label: team.teamName }]} />
      <header className="team-page__header">
        <h1 className="team-page__name">{team.teamName}</h1>
        {team.aliases && team.aliases.length > 0 && (
          <p className="team-page__aliases">Also known as: {team.aliases.join(', ')}</p>
        )}
      </header>

      <SeasonRecordTable seasons={team.seasons} />
      <AllTimeLeaders seasons={team.seasons} />

      <section className="team-page__seasons">
        <h2>Seasons</h2>
        {team.seasons.map((season, index) => (
          <SeasonSection
            key={`${season.divId}-${index}`}
            season={season}
            teamIds={team.teamIds}
            divData={seasonData[season.divId]}
          />
        ))}
      </section>
    </div>
  );
}

/**
 * Per-season collapsible block with schedule + roster.
 */
function SeasonSection({ season, teamIds, divData }) {
  const title = `${season.seasonName} — ${season.divisionLabel}`;

  // Find the specific teamId for this season from the team's teamIds array
  // The season.divId can help us narrow down which teamId was active
  const seasonTeamId = useMemo(() => {
    // Try each team ID to find one that appears in the schedule for this division
    if (!divData?.schedule?.records) return null;
    if (!teamIds || teamIds.length === 0) return null;
    for (const id of teamIds) {
      const found = divData.schedule.records.some(
        g => String(g.home?.teamId) === String(id) || String(g.away?.teamId) === String(id)
      );
      if (found) return String(id);
    }
    return null;
  }, [teamIds, divData]);

  return (
    <div className="team-page__season-section">
      <h3 className="team-page__season-heading">
        <Link to={`/seasons/${toSeasonSlug(season.seasonName)}/divisions/${season.divId}`}>
          {title}
        </Link>
        {season.record && (
          <span className="team-page__season-record">
            {season.record.w}–{season.record.l}–{season.record.t}
            {season.record.placement ? ` · Place ${season.record.placement}` : ''}
          </span>
        )}
      </h3>

      <Collapsible title="Schedule" defaultOpen={false}>
        <TeamSeasonSchedule
          teamId={seasonTeamId}
          season={season}
          data={divData}
        />
      </Collapsible>

      <Collapsible title="Roster" defaultOpen={false}>
        <SeasonRoster season={season} />
      </Collapsible>
    </div>
  );
}

function TeamSeasonSchedule({ teamId, season, data }) {
  if (!teamId || !data?.schedule?.records) {
    return <p className="team-page__empty">No schedule data available.</p>;
  }

  const scoreMap = data.scores?.scores || {};
  const games = data.schedule.records.filter(
    g => String(g.home?.teamId) === teamId || String(g.away?.teamId) === teamId
  );

  if (games.length === 0) {
    return <p className="team-page__empty">No games found for this team this season.</p>;
  }

  const columns = [
    { key: 'date', label: 'Date', sortable: false },
    {
      key: 'opponent',
      label: 'Opponent',
      sortable: false,
      cellClass: (val, row) => row.resultClass,
      render: (val, row) => (
        <span className="schedule-team">
          <span>
            <span className="team-schedule__loc">{row.homeAway}</span>{' '}
            {row.opponentId ? <TeamLink teamId={row.opponentId} name={val} /> : val}
          </span>
          {row.played && (
            <span className="schedule-team__score">{row.teamScore}–{row.oppScore}</span>
          )}
        </span>
      ),
    },
    {
      key: 'link', label: '', sortable: false,
      render: (val, row) => row.gameId
        ? <Link to={`/games/${row.gameId}`}>Box Score{row.ot ? ' (OT)' : ''}</Link>
        : '—',
    },
  ];

  const rows = games.map((g, idx) => {
    const isHome = String(g.home?.teamId) === teamId;
    const opponent = isHome ? g.away : g.home;
    const result = g.gameId ? scoreMap[g.gameId] || null : null;
    let teamScore = null, oppScore = null, resultClass;
    if (result) {
      teamScore = result.homeTeamId === teamId ? result.homeScore : result.awayScore;
      oppScore = result.homeTeamId === teamId ? result.awayScore : result.homeScore;
      if (result.tie) resultClass = 'cell-result--tie';
      else if (result.winnerTeamId === teamId) resultClass = 'cell-result--win';
      else resultClass = result.ot ? 'cell-result--otl' : 'cell-result--loss';
    }
    return {
      id: g.gameId || `g-${idx}`,
      date: g.date,
      opponent: opponent?.name || '',
      opponentId: opponent?.teamId,
      homeAway: isHome ? 'vs' : '@',
      played: !!result,
      teamScore, oppScore, ot: result?.ot, resultClass,
      gameId: g.gameId,
    };
  });

  return <StatsTable columns={columns} data={rows} defaultSort="date" defaultDirection="asc" />;
}

function SeasonRecordTable({ seasons }) {
  if (!seasons || seasons.length === 0) return null;
  const columns = [
    { key: 'seasonName', label: 'Season', sortable: true,
      render: (value, row) => <Link to={`/seasons/${toSeasonSlug(value)}/divisions/${row.divId}`}>{value}</Link> },
    { key: 'divisionLabel', label: 'Division', sortable: true,
      render: (value, row) => <Link to={`/seasons/${toSeasonSlug(row.seasonName)}/divisions/${row.divId}`}>{value}</Link> },
    { key: 'w', label: 'W', sortable: true },
    { key: 'l', label: 'L', sortable: true },
    { key: 't', label: 'T', sortable: true },
    { key: 'pts', label: 'PTS', sortable: true },
    { key: 'placement', label: 'Place', sortable: true },
  ];
  const data = seasons.map((s, i) => ({
    key: `${s.divId}-${i}`, seasonName: s.seasonName, divId: s.divId,
    divisionLabel: s.divisionLabel, w: s.record?.w || 0, l: s.record?.l || 0,
    t: s.record?.t || 0, pts: s.record?.pts || 0, placement: s.record?.placement,
  }));
  return (
    <section className="team-page__records">
      <h2>Season-by-Season Record</h2>
      <StatsTable columns={columns} data={data} defaultSort="seasonName" defaultDirection="desc" />
    </section>
  );
}

/**
 * All-time leaders computed from team's roster snapshots across all seasons.
 */
function AllTimeLeaders({ seasons }) {
  const leaders = useMemo(() => {
    const skaterTotals = {}; // name → {g,a,pts,pim,gp}
    const goalieTotals = {}; // name → {w,gp}

    for (const season of seasons) {
      for (const s of (season.roster?.skaters || [])) {
        if (!s.name) continue;
        if (!skaterTotals[s.name]) skaterTotals[s.name] = { g: 0, a: 0, pts: 0, pim: 0, gp: 0 };
        skaterTotals[s.name].g += s.g || 0;
        skaterTotals[s.name].a += s.a || 0;
        skaterTotals[s.name].pts += (s.g || 0) + (s.a || 0);
        skaterTotals[s.name].pim += s.pim || 0;
        skaterTotals[s.name].gp += s.gp || 0;
      }
      for (const g of (season.roster?.goalies || [])) {
        if (!g.name) continue;
        if (!goalieTotals[g.name]) goalieTotals[g.name] = { w: 0, gp: 0, sa: 0 };
        goalieTotals[g.name].w += g.w || 0;
        goalieTotals[g.name].gp += g.gp || 0;
        goalieTotals[g.name].sa += g.sa || 0;
      }
    }

    const top = (obj, key, n = 5, asc = false) =>
      Object.entries(obj)
        .map(([name, v]) => ({ name, value: v[key], gp: v.gp }))
        .filter(e => e.value > 0)
        .sort((a, b) => asc ? a.value - b.value : b.value - a.value)
        .slice(0, n);

    return {
      pts: top(skaterTotals, 'pts'),
      goals: top(skaterTotals, 'g'),
      assists: top(skaterTotals, 'a'),
      pim: top(skaterTotals, 'pim'),
      wins: top(goalieTotals, 'w'),
      sa: top(goalieTotals, 'sa'),
    };
  }, [seasons]);

  const hasAny = Object.values(leaders).some(l => l.length > 0);
  if (!hasAny) return null;

  const categories = [
    { key: 'pts', label: 'Points' },
    { key: 'goals', label: 'Goals' },
    { key: 'assists', label: 'Assists' },
    { key: 'pim', label: 'PIM' },
    { key: 'wins', label: 'Goalie Wins' },
    { key: 'sa', label: 'Shots Against' },
  ].filter(c => leaders[c.key]?.length > 0);

  return (
    <section className="team-page__leaders">
      <h2>All-Time Leaders</h2>
      <div className="team-page__leaders-grid">
        {categories.map(cat => (
          <div key={cat.key} className="team-page__leaders-card">
            <h3>{cat.label}</h3>
            <ol className="team-page__leaders-list">
              {leaders[cat.key].map((entry, i) => (
                <li key={`${entry.name}-${i}`} className="team-page__leaders-row">
                  <span className="team-page__leaders-rank">{i + 1}</span>
                  <span className="team-page__leaders-name">
                    <PlayerLink playerId={generatePlayerIdFromName(entry.name)} name={entry.name} />
                  </span>
                  <span className="team-page__leaders-value">{entry.value}</span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}

function SeasonRoster({ season }) {
  const hasSkaters = season.roster?.skaters?.length > 0;
  const hasGoalies = season.roster?.goalies?.length > 0;
  if (!hasSkaters && !hasGoalies) return <p className="team-page__empty">No roster data available.</p>;

  return (
    <div>
      {hasSkaters && <SkaterRoster skaters={season.roster.skaters} />}
      {hasGoalies && <GoalieRoster goalies={season.roster.goalies} />}
    </div>
  );
}

function SkaterRoster({ skaters }) {
  const columns = [
    { key: 'numberSort', label: '#', sortable: true, render: (val, row) => row.number },
    { key: 'name', label: 'Name', sortable: true,
      render: (val) => <PlayerLink playerId={generatePlayerIdFromName(val)} name={val} /> },
    { key: 'gp', label: 'GP', sortable: true },
    { key: 'g', label: 'G', sortable: true },
    { key: 'a', label: 'A', sortable: true },
    { key: 'pts', label: 'PTS', sortable: true },
    { key: 'pim', label: 'PIM', sortable: true },
  ];
  const data = skaters.map((s, idx) => ({
    id: `skater-${idx}`, name: s.name, number: s.number,
    numberSort: parseInt(s.number, 10) || 0,
    gp: s.gp, g: s.g, a: s.a, pts: s.pts, pim: s.pim,
  }));
  return (
    <div className="roster-table">
      <h4>Skaters</h4>
      <StatsTable columns={columns} data={data} defaultSort="numberSort" defaultDirection="asc" />
    </div>
  );
}

function GoalieRoster({ goalies }) {
  const columns = [
    { key: 'numberSort', label: '#', sortable: true, render: (val, row) => row.number },
    { key: 'name', label: 'Name', sortable: true,
      render: (val) => <PlayerLink playerId={generatePlayerIdFromName(val)} name={val} /> },
    { key: 'gp', label: 'GP', sortable: true },
    { key: 'w', label: 'W', sortable: true },
    { key: 'l', label: 'L', sortable: true },
    { key: 't', label: 'T', sortable: true },
    { key: 'gaa', label: 'GAA', sortable: true },
    { key: 'svpct', label: 'SV%', sortable: true },
  ];
  const data = goalies.map((g, idx) => ({
    id: `goalie-${idx}`, name: g.name, number: g.number,
    numberSort: parseInt(g.number, 10) || 0,
    gp: g.gp, w: g.w, l: g.l, t: g.t, gaa: g.gaa, svpct: g.svpct,
  }));
  return (
    <div className="roster-table">
      <h4>Goalies</h4>
      <StatsTable columns={columns} data={data} defaultSort="numberSort" defaultDirection="asc" />
    </div>
  );
}
