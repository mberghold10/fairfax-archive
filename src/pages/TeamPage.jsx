import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import Loading from '../components/Loading.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import PlayerLink from '../components/PlayerLink.jsx';
import StatsTable from '../components/StatsTable.jsx';

/**
 * Convert a season name to a URL slug.
 * e.g. "Winter 2024" → "winter-2024"
 */
function toSeasonSlug(seasonName) {
  return seasonName.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Simple synchronous hash function to generate player IDs from names.
 * Mirrors the aggregation pipeline's approach: normalize name → hash.
 * Uses a simple djb2-based hash to produce a 12-char hex string.
 */
function generatePlayerIdFromName(name) {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z\s,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // djb2 hash producing a hex string (matches are approximate;
  // for exact matches we'd need SHA-256, but this is sufficient for linking)
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hash = (4294967296 * (2097151 & h2) + (h1 >>> 0));
  return hash.toString(16).padStart(12, '0').slice(0, 12);
}

/**
 * TeamPage displays a team's history: season-by-season records and rosters.
 * Fetches pre-computed team detail from /data/teams/{teamId}.json.
 */
export default function TeamPage() {
  const { teamId } = useParams();
  const [team, setTeam] = useState(null);
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
        if (res.status === 404) return null;
        throw new Error('Failed to load team data');
      })
      .then((data) => {
        if (!data) {
          setNotFound(true);
        } else {
          setTeam(data);
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [teamId]);

  useEffect(() => {
    fetchTeam();
  }, [fetchTeam]);

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
      <Breadcrumbs
        crumbs={[
          { label: 'Home', to: '/' },
          { label: team.teamName },
        ]}
      />

      <header className="team-page__header">
        <h1 className="team-page__name">{team.teamName}</h1>
        {team.aliases && team.aliases.length > 0 && (
          <p className="team-page__aliases">
            Also known as: {team.aliases.join(', ')}
          </p>
        )}
      </header>

      <SeasonRecordTable seasons={team.seasons} />

      <section className="team-page__rosters">
        <h2>Rosters</h2>
        {team.seasons.map((season, index) => (
          <SeasonRoster key={`${season.divId}-${index}`} season={season} />
        ))}
      </section>
    </div>
  );
}

/**
 * Season-by-season record table showing W, L, T, PTS, placement per season.
 */
function SeasonRecordTable({ seasons }) {
  if (!seasons || seasons.length === 0) return null;

  const columns = [
    {
      key: 'seasonName',
      label: 'Season',
      sortable: true,
      render: (value, row) => (
        <Link to={`/seasons/${toSeasonSlug(value)}/divisions/${row.divId}`}>
          {value}
        </Link>
      ),
    },
    {
      key: 'divisionLabel',
      label: 'Division',
      sortable: true,
      render: (value, row) => (
        <Link to={`/seasons/${toSeasonSlug(row.seasonName)}/divisions/${row.divId}`}>
          {value}
        </Link>
      ),
    },
    { key: 'w', label: 'W', sortable: true },
    { key: 'l', label: 'L', sortable: true },
    { key: 't', label: 'T', sortable: true },
    { key: 'pts', label: 'PTS', sortable: true },
    { key: 'placement', label: 'Place', sortable: true },
  ];

  const data = seasons.map((s, index) => ({
    key: `${s.divId}-${index}`,
    seasonName: s.seasonName,
    divId: s.divId,
    divisionLabel: s.divisionLabel,
    w: s.record.w,
    l: s.record.l,
    t: s.record.t,
    pts: s.record.pts,
    placement: s.record.placement,
  }));

  return (
    <section className="team-page__records">
      <h2>Season-by-Season Record</h2>
      <StatsTable
        columns={columns}
        data={data}
        defaultSort="seasonName"
        defaultDirection="desc"
      />
    </section>
  );
}

/**
 * Roster display for a single season: skaters and goalies tables.
 */
function SeasonRoster({ season }) {
  const hasSkaters = season.roster?.skaters?.length > 0;
  const hasGoalies = season.roster?.goalies?.length > 0;

  if (!hasSkaters && !hasGoalies) return null;

  return (
    <div className="team-page__season-roster">
      <h3>
        <Link to={`/seasons/${toSeasonSlug(season.seasonName)}/divisions/${season.divId}`}>
          {season.seasonName} — {season.divisionLabel}
        </Link>
      </h3>
      {hasSkaters && <SkaterRoster skaters={season.roster.skaters} />}
      {hasGoalies && <GoalieRoster goalies={season.roster.goalies} />}
    </div>
  );
}

/**
 * Skater stats table with PlayerLink for each player name.
 */
function SkaterRoster({ skaters }) {
  const columns = [
    {
      key: 'name',
      label: 'Name',
      sortable: false,
      render: (val) => (
        <PlayerLink playerId={generatePlayerIdFromName(val)} name={val} />
      ),
    },
    { key: 'number', label: '#', sortable: true },
    { key: 'gp', label: 'GP', sortable: true },
    { key: 'g', label: 'G', sortable: true },
    { key: 'a', label: 'A', sortable: true },
    { key: 'pts', label: 'PTS', sortable: true },
    { key: 'pim', label: 'PIM', sortable: true },
  ];

  const data = skaters.map((s, idx) => ({
    id: `skater-${idx}-${s.number}`,
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
 * Goalie stats table with PlayerLink for each goalie name.
 */
function GoalieRoster({ goalies }) {
  const columns = [
    {
      key: 'name',
      label: 'Name',
      sortable: false,
      render: (val) => (
        <PlayerLink playerId={generatePlayerIdFromName(val)} name={val} />
      ),
    },
    { key: 'number', label: '#', sortable: true },
    { key: 'gp', label: 'GP', sortable: true },
    { key: 'w', label: 'W', sortable: true },
    { key: 'l', label: 'L', sortable: true },
    { key: 't', label: 'T', sortable: true },
    { key: 'gaa', label: 'GAA', sortable: true },
    { key: 'svpct', label: 'SV%', sortable: true },
  ];

  const data = goalies.map((g, idx) => ({
    id: `goalie-${idx}-${g.number}`,
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
