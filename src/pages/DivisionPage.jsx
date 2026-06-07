import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import StatsTable from '../components/StatsTable.jsx';
import PlayerLink from '../components/PlayerLink.jsx';
import TeamLink from '../components/TeamLink.jsx';
import Loading from '../components/Loading.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';

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

    Promise.all([metaFetch, scheduleFetch, playoffFetch, rosterFetch])
      .then(([metaData, scheduleData, playoffData, rosterData]) => {
        setMeta(metaData);
        setSchedule(scheduleData);
        setPlayoffSchedule(playoffData);
        setRosters(rosterData);
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

      <StandingsSection meta={meta} rosters={rosters} />
      <ScheduleSection title="Regular Season Schedule" schedule={schedule} />
      {playoffSchedule && playoffSchedule.records && playoffSchedule.records.length > 0 && (
        <ScheduleSection title="Playoff Schedule" schedule={playoffSchedule} />
      )}
      <RostersSection rosters={rosters} />
    </div>
  );
}

/**
 * Compute standings from goalie W/L/T data per team.
 * Falls back to "No standings available" if data is insufficient.
 */
function StandingsSection({ meta, rosters }) {
  if (!rosters || !rosters.records || Object.keys(rosters.records).length === 0) {
    return (
      <section className="division-standings">
        <h2>Standings</h2>
        <p>No standings available for this division</p>
      </section>
    );
  }

  const standings = computeStandings(meta, rosters);

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
    { key: 'otl', label: 'OTL' },
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
 * Compute standings from roster goalie data.
 * Each team's W/L/T comes from summing goalie records.
 * GP = W + L + T, PTS = W*2 + T, GF/GA from skater/goalie data.
 */
function computeStandings(meta, rosters) {
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

    // Compute goals for from skater goals
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
      otl: 0, // OTL not tracked in source data
      gf,
      ga,
      pts,
    });
  }

  // Sort by points descending
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
 * Rosters section showing skater and goalie stats for each team.
 */
function RostersSection({ rosters }) {
  if (!rosters || !rosters.records || Object.keys(rosters.records).length === 0) {
    return null;
  }

  const teamIds = Object.keys(rosters.records);

  return (
    <section className="division-rosters">
      <h2>Rosters</h2>
      {teamIds.map((teamId) => {
        const teamData = rosters.records[teamId];
        const teamName = teamData.skaters?.[0]?.team?.name ||
                         teamData.goalies?.[0]?.team?.name ||
                         `Team ${teamId}`;

        return (
          <div key={teamId} className="division-rosters__team">
            <h3><TeamLink teamId={teamId} name={teamName} /></h3>
            <SkaterRoster skaters={teamData.skaters} />
            <GoalieRoster goalies={teamData.goalies} />
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
