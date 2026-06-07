import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import StatsTable from '../components/StatsTable.jsx';
import PlayerLink from '../components/PlayerLink.jsx';
import TeamLink from '../components/TeamLink.jsx';
import Loading from '../components/Loading.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import '../styles/division-page.css';

/**
 * DivisionPage displays standings, schedule, and rosters for a single division.
 * Route: /seasons/:seasonSlug/divisions/:divId
 */
export default function DivisionPage() {
  const { seasonSlug, divId } = useParams();

  const [meta, setMeta] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [playoffSchedule, setPlayoffSchedule] = useState(null);
  const [rosters, setRosters] = useState(null);
  const [standings, setStandings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(null);

    const basePath = `/data/divisions/${divId}`;

    const metaFetch = fetch(`${basePath}/meta.json`).then((res) => {
      if (!res.ok) throw new Error('Failed to load division metadata');
      return res.json();
    });

    const scheduleFetch = fetch(`${basePath}/schedule.regular.json`).then((res) => {
      if (!res.ok) throw new Error('Failed to load schedule');
      return res.json();
    });

    const playoffFetch = fetch(`${basePath}/schedule.playoff.json`).then((res) => {
      if (!res.ok) return null; // 404 is OK for playoffs
      return res.json();
    });

    const rosterFetch = fetch(`${basePath}/rosters.regular.json`).then((res) => {
      if (!res.ok) return null;
      return res.json();
    });

    const standingsFetch = fetch(`${basePath}/standings.json`).then((res) => {
      if (!res.ok) return null;
      return res.json();
    });

    Promise.all([metaFetch, scheduleFetch, playoffFetch, rosterFetch, standingsFetch])
      .then(([metaData, scheduleData, playoffData, rosterData, standingsData]) => {
        setMeta(metaData);
        setSchedule(scheduleData);
        setPlayoffSchedule(playoffData);
        setRosters(rosterData);
        setStandings(standingsData);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [divId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) return <Loading />;
  if (error) return <ErrorMessage message={error} onRetry={fetchData} />;

  const seasonName = meta.seasonName;
  const divisionLabel = meta.divisionLabel;

  const breadcrumbs = [
    { label: 'Home', to: '/' },
    { label: seasonName, to: `/seasons/${seasonSlug}` },
    { label: divisionLabel },
  ];

  return (
    <div className="division-page">
      <Breadcrumbs crumbs={breadcrumbs} />

      <h1>{seasonName} — {divisionLabel}</h1>

      <StandingsSection meta={meta} rosters={rosters} schedule={schedule} precomputedStandings={standings} />
      <ScheduleSection title="Regular Season Schedule" schedule={schedule} />
      {playoffSchedule && playoffSchedule.records && playoffSchedule.records.length > 0 && (
        <ScheduleSection title="Playoff Schedule" schedule={playoffSchedule} />
      )}
      <RostersSection rosters={rosters} meta={meta} />
    </div>
  );
}

/**
 * Compute standings from goalie W/L/T data per team.
 * Falls back to "No standings available" if data is insufficient.
 *
 * Note: When the roster data is a single-bucket dump (all players under one
 * team key), standings cannot be reliably computed from roster data alone.
 * In that case we attempt to derive standings from the schedule + game scores.
 */
function StandingsSection({ meta, rosters, schedule, precomputedStandings }) {
  if (!meta || !meta.teams || Object.keys(meta.teams).length === 0) {
    return (
      <section className="division-standings">
        <h2>Standings</h2>
        <p>No standings available for this division</p>
      </section>
    );
  }

  let standings = [];

  // Prefer pre-computed standings from aggregation step
  if (precomputedStandings && precomputedStandings.standings && precomputedStandings.standings.length > 0) {
    standings = precomputedStandings.standings.map(s => ({
      ...s,
      id: s.teamId,
    }));
  } else {
    // Fallback: compute from roster data if roster has proper multi-team keys
    const rosterTeamIds = rosters ? Object.keys(rosters.records || {}) : [];
    const metaTeamCount = Object.keys(meta.teams).length;
    const isSingleBucket = rosterTeamIds.length <= 1 && metaTeamCount > 1;

    if (!isSingleBucket && rosters && rosters.records) {
      standings = computeStandingsFromRosters(meta, rosters);
    }
  }

  if (standings.length === 0) {
    return (
      <section className="division-standings">
        <h2>Standings</h2>
        <p>No standings available for this division</p>
      </section>
    );
  }

  const columns = [
    { key: 'team', label: 'Team', sortable: false, render: (val, row) => (
      <TeamLink teamId={row.teamId} name={val} />
    )},
    { key: 'gp', label: 'GP' },
    { key: 'w', label: 'W' },
    { key: 'l', label: 'L' },
    { key: 't', label: 'T' },
    { key: 'gf', label: 'GF' },
    { key: 'ga', label: 'GA' },
    { key: 'pts', label: 'PTS' },
  ];

  return (
    <section className="division-standings">
      <h2>Standings</h2>
      <StatsTable columns={columns} data={standings} defaultSort="pts" defaultDirection="desc" />
    </section>
  );
}

/**
 * Compute standings from roster goalie data (works when roster has proper per-team keys).
 */
function computeStandingsFromRosters(meta, rosters) {
  const standings = [];
  const teamIds = Object.keys(rosters.records);

  for (const teamId of teamIds) {
    const teamData = rosters.records[teamId];
    const teamName = meta.teams[teamId] || teamData.skaters?.[0]?.team?.name || `Team ${teamId}`;

    let w = 0, l = 0, t = 0, ga = 0;
    if (teamData.goalies && teamData.goalies.length > 0) {
      for (const goalie of teamData.goalies) {
        w += goalie.w || 0;
        l += goalie.l || 0;
        t += goalie.t || 0;
        ga += goalie.ga || 0;
      }
    }

    const gp = w + l + t;

    let gf = 0;
    if (teamData.skaters) {
      for (const skater of teamData.skaters) {
        gf += skater.g || 0;
      }
    }

    const pts = w * 2 + t;

    standings.push({
      id: teamId,
      teamId,
      team: teamName,
      gp,
      w,
      l,
      t,
      gf,
      ga,
      pts,
    });
  }

  standings.sort((a, b) => b.pts - a.pts);
  return standings;
}



/**
 * Schedule section displaying game rows with optional link to GamePage.
 */
function ScheduleSection({ title, schedule }) {
  if (!schedule || !schedule.records || schedule.records.length === 0) {
    return null;
  }

  const columns = [
    { key: 'date', label: 'Date', sortable: false },
    { key: 'time', label: 'Time', sortable: false },
    { key: 'home', label: 'Home', sortable: false, render: (val, row) => (
      row.homeTeamId
        ? <TeamLink teamId={row.homeTeamId} name={val} />
        : val
    )},
    { key: 'away', label: 'Away', sortable: false, render: (val, row) => (
      row.awayTeamId
        ? <TeamLink teamId={row.awayTeamId} name={val} />
        : val
    )},
    { key: 'score', label: 'Score', sortable: false, render: (val, row) => {
      if (row.gameId) {
        return <Link to={`/games/${row.gameId}`}>Box Score</Link>;
      }
      return '—';
    }},
  ];

  const data = schedule.records.map((game, idx) => ({
    id: game.gameId || `game-${idx}`,
    date: game.date,
    time: game.time,
    home: game.home.name,
    homeTeamId: game.home.teamId,
    away: game.away.name,
    awayTeamId: game.away.teamId,
    gameId: game.gameId,
    score: game.gameId ? 'link' : null,
  }));

  return (
    <section className="division-schedule">
      <h2>{title}</h2>
      <StatsTable columns={columns} data={data} defaultSort="date" defaultDirection="asc" />
    </section>
  );
}

/**
 * Rosters section showing skater and goalie stats for the division.
 *
 * Note: The scraped data stores all players under a single team key per division.
 * We merge all players from all record keys and display them as a division-wide
 * roster, using each player's embedded team.name for identification.
 */
function RostersSection({ rosters, meta }) {
  if (!rosters || !rosters.records || Object.keys(rosters.records).length === 0) {
    return null;
  }

  // Collect all skaters and goalies across all record keys, then group by the
  // player's embedded team info.
  const allSkaters = [];
  const allGoalies = [];

  for (const teamId of Object.keys(rosters.records)) {
    const teamData = rosters.records[teamId];
    if (teamData.skaters) allSkaters.push(...teamData.skaters);
    if (teamData.goalies) allGoalies.push(...teamData.goalies);
  }

  // Group by actual team using meta.json teams map for proper names,
  // falling back to the embedded team field.
  const teams = meta?.teams || {};
  const skatersByTeam = {};
  const goaliesByTeam = {};

  for (const skater of allSkaters) {
    const tid = skater.team?.teamId || 'unknown';
    if (!skatersByTeam[tid]) skatersByTeam[tid] = [];
    skatersByTeam[tid].push(skater);
  }

  for (const goalie of allGoalies) {
    const tid = goalie.team?.teamId || 'unknown';
    if (!goaliesByTeam[tid]) goaliesByTeam[tid] = [];
    goaliesByTeam[tid].push(goalie);
  }

  // Get unique team IDs from both skaters and goalies
  const teamIds = [...new Set([...Object.keys(skatersByTeam), ...Object.keys(goaliesByTeam)])];

  // If only one team ID exists (common with scraped data), check if it's actually
  // a division-wide dump by comparing player count to what a single team would have.
  // In that case, show all players together without a misleading team header.
  const isSingleBucket = teamIds.length === 1 && Object.keys(teams).length > 1;

  if (isSingleBucket) {
    // All players are in one bucket — display as a flat division roster
    return (
      <section className="division-rosters">
        <h2>Rosters</h2>
        <div className="division-rosters__team">
          <SkaterRoster skaters={allSkaters} />
          <GoalieRoster goalies={allGoalies} />
        </div>
      </section>
    );
  }

  // Multiple team IDs exist — display grouped by team
  return (
    <section className="division-rosters">
      <h2>Rosters</h2>
      {teamIds.map((teamId) => {
        const teamName = teams[teamId] ||
                         skatersByTeam[teamId]?.[0]?.team?.name ||
                         goaliesByTeam[teamId]?.[0]?.team?.name ||
                         `Team ${teamId}`;

        return (
          <div key={teamId} className="division-rosters__team">
            <h3><TeamLink teamId={teamId} name={teamName} /></h3>
            <SkaterRoster skaters={skatersByTeam[teamId]} />
            <GoalieRoster goalies={goaliesByTeam[teamId]} />
          </div>
        );
      })}
    </section>
  );
}

/**
 * Skater stats table: Name, #, GP, G, A, PTS, PIM
 */
function SkaterRoster({ skaters }) {
  if (!skaters || skaters.length === 0) return null;

  const columns = [
    { key: 'name', label: 'Name', sortable: false, render: (val, row) => (
      <PlayerLink playerId={row.playerKey} name={val} />
    )},
    { key: 'number', label: '#' },
    { key: 'gp', label: 'GP' },
    { key: 'g', label: 'G' },
    { key: 'a', label: 'A' },
    { key: 'pts', label: 'PTS' },
    { key: 'pim', label: 'PIM' },
  ];

  const data = skaters.map((s, idx) => ({
    id: s.playerKey || `skater-${idx}`,
    playerKey: s.playerKey,
    name: s.name,
    number: s.number,
    gp: s.gp,
    g: s.g,
    a: s.a,
    pts: s.pts,
    pim: s.pim,
  }));

  return (
    <div className="roster-table">
      <h4>Skaters</h4>
      <StatsTable columns={columns} data={data} defaultSort="pts" defaultDirection="desc" />
    </div>
  );
}

/**
 * Goalie stats table: Name, #, GP, W, L, T, GAA, SV%
 */
function GoalieRoster({ goalies }) {
  if (!goalies || goalies.length === 0) return null;

  const columns = [
    { key: 'name', label: 'Name', sortable: false, render: (val, row) => (
      <PlayerLink playerId={row.playerKey} name={val} />
    )},
    { key: 'number', label: '#' },
    { key: 'gp', label: 'GP' },
    { key: 'w', label: 'W' },
    { key: 'l', label: 'L' },
    { key: 't', label: 'T' },
    { key: 'gaa', label: 'GAA' },
    { key: 'svpct', label: 'SV%' },
  ];

  const data = goalies.map((g, idx) => ({
    id: g.playerKey || `goalie-${idx}`,
    playerKey: g.playerKey,
    name: g.name,
    number: g.number,
    gp: g.gp,
    w: g.w,
    l: g.l,
    t: g.t,
    gaa: g.gaa,
    svpct: g.svpct,
  }));

  return (
    <div className="roster-table">
      <h4>Goalies</h4>
      <StatsTable columns={columns} data={data} defaultSort="w" defaultDirection="desc" />
    </div>
  );
}
