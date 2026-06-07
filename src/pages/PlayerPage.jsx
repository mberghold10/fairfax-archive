import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import Loading from '../components/Loading.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import TeamLink from '../components/TeamLink.jsx';
import StatsTable from '../components/StatsTable.jsx';

/**
 * Convert a season name to a URL slug.
 * e.g. "Winter 2024" → "winter-2024"
 */
function toSeasonSlug(seasonName) {
  return seasonName.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Skater career totals columns for display.
 */
const SKATER_TOTALS_COLUMNS = [
  { key: 'gp', label: 'GP' },
  { key: 'g', label: 'G' },
  { key: 'a', label: 'A' },
  { key: 'pts', label: 'PTS' },
  { key: 'ppg', label: 'PPG' },
  { key: 'ppa', label: 'PPA' },
  { key: 'shg', label: 'SHG' },
  { key: 'sha', label: 'SHA' },
  { key: 'pim', label: 'PIM' },
];

/**
 * Goalie career totals columns for display.
 */
const GOALIE_TOTALS_COLUMNS = [
  { key: 'gp', label: 'GP' },
  { key: 'w', label: 'W' },
  { key: 'l', label: 'L' },
  { key: 't', label: 'T' },
  { key: 'ga', label: 'GA' },
  { key: 'sa', label: 'SA' },
  { key: 'sv', label: 'SV' },
  { key: 'so', label: 'SO' },
  { key: 'gaa', label: 'GAA' },
  { key: 'svpct', label: 'SV%' },
];

/**
 * PlayerPage displays a player's career stats and season-by-season breakdown.
 * Fetches pre-computed player detail from /data/players/{id}.json.
 * Falls back to /data/goalies/{id}.json if player 404s.
 */
export default function PlayerPage() {
  const { playerId } = useParams();
  const [player, setPlayer] = useState(null);
  const [playerType, setPlayerType] = useState(null); // 'skater' | 'goalie'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const fetchPlayer = useCallback(() => {
    setLoading(true);
    setError(null);
    setNotFound(false);

    fetch(`/data/players/${playerId}.json`)
      .then((res) => {
        if (res.ok) return res.json().then((data) => ({ data, type: 'skater' }));
        if (res.status === 404) {
          // Try goalie endpoint
          return fetch(`/data/goalies/${playerId}.json`).then((goalieRes) => {
            if (goalieRes.ok) return goalieRes.json().then((data) => ({ data, type: 'goalie' }));
            if (goalieRes.status === 404) return { data: null, type: null };
            throw new Error('Failed to load player data');
          });
        }
        throw new Error('Failed to load player data');
      })
      .then(({ data, type }) => {
        if (!data) {
          setNotFound(true);
        } else {
          setPlayer(data);
          setPlayerType(type);
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [playerId]);

  useEffect(() => {
    fetchPlayer();
  }, [fetchPlayer]);

  if (loading) return <Loading />;
  if (error) return <ErrorMessage message={error} onRetry={fetchPlayer} />;

  if (notFound) {
    return (
      <div className="player-page">
        <Breadcrumbs crumbs={[{ label: 'Home', to: '/' }, { label: 'Player not found' }]} />
        <ErrorMessage message="Player not found" />
      </div>
    );
  }

  const isGoalie = playerType === 'goalie';
  const totalsColumns = isGoalie ? GOALIE_TOTALS_COLUMNS : SKATER_TOTALS_COLUMNS;

  // Build season-by-season table columns
  const seasonColumns = buildSeasonColumns(isGoalie);

  // Transform season data for the StatsTable
  const seasonRows = (player.seasons || []).map((s, index) => ({
    key: `${s.divId}-${index}`,
    seasonName: s.seasonName,
    divId: s.divId,
    divisionLabel: s.divisionLabel,
    teamId: s.teamId,
    teamName: s.teamName,
    number: s.number,
    ...s.stats,
  }));

  return (
    <div className="player-page">
      <Breadcrumbs
        crumbs={[
          { label: 'Home', to: '/' },
          { label: player.displayName },
        ]}
      />

      <header className="player-page__header">
        <h1 className="player-page__name">{player.displayName}</h1>
        {player.number && (
          <span className="player-page__number">#{player.number}</span>
        )}
      </header>

      <section className="player-page__totals">
        <h2>Career Totals</h2>
        <div className="player-page__totals-grid">
          {totalsColumns.map((col) => (
            <div key={col.key} className="player-page__stat">
              <span className="player-page__stat-label">{col.label}</span>
              <span className="player-page__stat-value">
                {player.totals[col.key] != null ? player.totals[col.key] : '—'}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="player-page__seasons">
        <h2>Season-by-Season</h2>
        <StatsTable
          columns={seasonColumns}
          data={seasonRows}
          defaultSort="seasonName"
          defaultDirection="desc"
        />
      </section>
    </div>
  );
}

/**
 * Build column definitions for the season-by-season table.
 */
function buildSeasonColumns(isGoalie) {
  const baseColumns = [
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
    {
      key: 'teamName',
      label: 'Team',
      sortable: true,
      render: (value, row) => (
        <TeamLink teamId={row.teamId} name={value} />
      ),
    },
    {
      key: 'number',
      label: '#',
      sortable: false,
    },
  ];

  const statColumns = isGoalie
    ? [
        { key: 'gp', label: 'GP', sortable: true },
        { key: 'w', label: 'W', sortable: true },
        { key: 'l', label: 'L', sortable: true },
        { key: 't', label: 'T', sortable: true },
        { key: 'ga', label: 'GA', sortable: true },
        { key: 'sa', label: 'SA', sortable: true },
        { key: 'sv', label: 'SV', sortable: true },
        { key: 'so', label: 'SO', sortable: true },
        { key: 'gaa', label: 'GAA', sortable: true },
        { key: 'svpct', label: 'SV%', sortable: true },
      ]
    : [
        { key: 'gp', label: 'GP', sortable: true },
        { key: 'g', label: 'G', sortable: true },
        { key: 'a', label: 'A', sortable: true },
        { key: 'pts', label: 'PTS', sortable: true },
        { key: 'ppg', label: 'PPG', sortable: true },
        { key: 'ppa', label: 'PPA', sortable: true },
        { key: 'shg', label: 'SHG', sortable: true },
        { key: 'sha', label: 'SHA', sortable: true },
        { key: 'pim', label: 'PIM', sortable: true },
      ];

  return [...baseColumns, ...statColumns];
}
