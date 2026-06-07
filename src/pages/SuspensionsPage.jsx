import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import Loading from '../components/Loading.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import StatsTable from '../components/StatsTable.jsx';
import TeamLink from '../components/TeamLink.jsx';
import PlayerLink from '../components/PlayerLink.jsx';
import { filterSuspensions } from '../utils/suspensionFilters.mjs';
import '../styles/suspensions-page.css';

/**
 * Parse a playerKey to determine if we can link to a player page.
 * playerKey format is "name:first last" — we can link if there's an actual name.
 */
function getPlayerLinkId(playerKey) {
  if (!playerKey) return null;
  const name = playerKey.replace(/^name:/, '');
  if (!name || name.trim() === '') return null;
  return playerKey;
}

/**
 * Clean up playerName for display.
 * Format is "#660 - Alex  Gusev" — strip number prefix and extra spaces.
 */
function formatPlayerName(playerName) {
  if (!playerName) return 'Unknown';
  const cleaned = playerName
    .replace(/^#\d*\s*-\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || 'Unknown';
}

/**
 * Format the appliesToGames array for display.
 */
function formatGamesAffected(games) {
  if (!games || games.length === 0) return '—';
  return `${games.length}`;
}

/**
 * Format rule string for human-readable display.
 */
function formatRule(rule) {
  if (!rule) return '—';
  return rule
    .replace(/-/g, ' ')
    .replace(/(\d+)/g, ' $1 ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * SuspensionsPage displays all inferred suspensions with filtering capabilities.
 * Route: /suspensions
 */
export default function SuspensionsPage() {
  const [suspensions, setSuspensions] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  // Filter state
  const [seasonFilter, setSeasonFilter] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [ruleFilter, setRuleFilter] = useState('');

  const fetchSuspensions = useCallback(() => {
    setLoading(true);
    setError(null);

    fetch('/data/suspensions.json')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load suspensions data');
        return res.json();
      })
      .then((data) => {
        setSuspensions(data.suspensions || []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchSuspensions();
  }, [fetchSuspensions]);

  // Compute unique filter options from the data
  const filterOptions = useMemo(() => {
    if (!suspensions) return { seasons: [], teams: [], rules: [] };

    const seasons = [...new Set(suspensions.map((s) => s.seasonName))].sort();
    const teams = [...new Set(suspensions.map((s) => s.team.name))].sort();
    const rules = [...new Set(suspensions.map((s) => s.rule))].sort();

    return { seasons, teams, rules };
  }, [suspensions]);

  // Apply filters (AND logic)
  const filteredSuspensions = useMemo(() => {
    if (!suspensions) return [];
    const filters = {};
    if (seasonFilter) filters.season = seasonFilter;
    if (teamFilter) filters.team = teamFilter;
    if (ruleFilter) filters.rule = ruleFilter;
    return filterSuspensions(suspensions, filters);
  }, [suspensions, seasonFilter, teamFilter, ruleFilter]);

  // Transform data for StatsTable rows
  const tableData = useMemo(() => {
    return filteredSuspensions.map((suspension, idx) => ({
      key: `${suspension.playerKey}-${suspension.divId}-${suspension.rule}-${idx}`,
      playerKey: suspension.playerKey,
      playerName: suspension.playerName,
      team: suspension.team,
      seasonName: suspension.seasonName,
      divId: suspension.divId,
      rule: suspension.rule,
      gamesAffected: suspension.appliesToGames ? suspension.appliesToGames.length : 0,
      appliesToGames: suspension.appliesToGames,
      corroborated: suspension.corroboratedByRosterColumn,
      discrepancy: suspension.discrepancy,
    }));
  }, [filteredSuspensions]);

  // Define StatsTable columns with custom renderers
  const columns = useMemo(() => [
    {
      key: 'playerName',
      label: 'Player',
      sortable: true,
      render: (_val, row) => {
        const playerLinkId = getPlayerLinkId(row.playerKey);
        const displayName = formatPlayerName(row.playerName);
        if (playerLinkId) {
          return <PlayerLink playerId={playerLinkId} name={displayName} />;
        }
        return <span className="suspensions-table__unknown-player">{displayName}</span>;
      },
    },
    {
      key: 'team',
      label: 'Team',
      sortable: true,
      render: (_val, row) => (
        <TeamLink teamId={row.team.teamId} name={row.team.name} />
      ),
    },
    {
      key: 'seasonName',
      label: 'Season',
      sortable: true,
    },
    {
      key: 'divId',
      label: 'Division',
      sortable: true,
    },
    {
      key: 'rule',
      label: 'Rule',
      sortable: true,
      render: (val) => <span className="suspensions-table__rule">{formatRule(val)}</span>,
    },
    {
      key: 'gamesAffected',
      label: 'Games Affected',
      sortable: true,
      render: (_val, row) => formatGamesAffected(row.appliesToGames),
    },
    {
      key: 'corroborated',
      label: 'Corroborated',
      sortable: true,
      render: (val) => val ? (
        <span className="suspensions-status suspensions-status--corroborated" title="Corroborated by roster column" aria-label="Corroborated">✓</span>
      ) : (
        <span className="suspensions-status suspensions-status--not-corroborated" title="Not corroborated by roster column" aria-label="Not corroborated">✗</span>
      ),
    },
    {
      key: 'discrepancy',
      label: 'Discrepancy',
      sortable: true,
      render: (val) => val ? (
        <span className="suspensions-status suspensions-status--discrepancy" title="Discrepancy detected" aria-label="Discrepancy">⚠</span>
      ) : (
        <span className="suspensions-status suspensions-status--no-discrepancy" title="No discrepancy" aria-label="No discrepancy">—</span>
      ),
    },
  ], []);

  if (loading) return <Loading />;
  if (error) return <ErrorMessage message={error} onRetry={fetchSuspensions} />;

  const breadcrumbs = [
    { label: 'Home', to: '/' },
    { label: 'Suspensions' },
  ];

  return (
    <div className="suspensions-page">
      <Breadcrumbs crumbs={breadcrumbs} />

      <h1 className="suspensions-page__title">Suspensions</h1>

      <div className="suspensions-page__filters">
        <label className="suspensions-filter">
          <span className="suspensions-filter__label">Season</span>
          <select
            value={seasonFilter}
            onChange={(e) => setSeasonFilter(e.target.value)}
            className="suspensions-filter__select"
          >
            <option value="">All Seasons</option>
            {filterOptions.seasons.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>

        <label className="suspensions-filter">
          <span className="suspensions-filter__label">Team</span>
          <select
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
            className="suspensions-filter__select"
          >
            <option value="">All Teams</option>
            {filterOptions.teams.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>

        <label className="suspensions-filter">
          <span className="suspensions-filter__label">Rule</span>
          <select
            value={ruleFilter}
            onChange={(e) => setRuleFilter(e.target.value)}
            className="suspensions-filter__select"
          >
            <option value="">All Rules</option>
            {filterOptions.rules.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
      </div>

      <p className="suspensions-page__count">
        Showing {filteredSuspensions.length} of {suspensions.length} suspension{suspensions.length !== 1 ? 's' : ''}
      </p>

      {filteredSuspensions.length === 0 ? (
        <p className="suspensions-page__empty">No suspensions match the current filters.</p>
      ) : (
        <StatsTable
          columns={columns}
          data={tableData}
          defaultSort="seasonName"
          defaultDirection="desc"
        />
      )}
    </div>
  );
}
