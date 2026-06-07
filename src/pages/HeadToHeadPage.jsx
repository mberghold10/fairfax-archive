import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import Loading from '../components/Loading.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import TeamLink from '../components/TeamLink.jsx';
import '../styles/h2h-page.css';

/**
 * Create a sorted matchup key from two team IDs.
 * The smaller teamId comes first for consistent lookups.
 */
function matchupKey(teamId1, teamId2) {
  return teamId1 < teamId2
    ? `${teamId1}-${teamId2}`
    : `${teamId2}-${teamId1}`;
}

/**
 * Extract a unique sorted list of all teams from the season catalog.
 * Returns array of { teamId, name } sorted by name.
 */
function extractTeams(catalog) {
  const teamMap = new Map();

  for (const season of catalog.seasons) {
    for (const div of season.divisions) {
      for (const [teamId, teamName] of Object.entries(div.teams)) {
        // Keep the most recent name for each team (catalog is most recent first)
        if (!teamMap.has(teamId)) {
          teamMap.set(teamId, teamName);
        }
      }
    }
  }

  return Array.from(teamMap.entries())
    .map(([teamId, name]) => ({ teamId, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * HeadToHeadPage displays the historical matchup record between two teams.
 *
 * Routes:
 *   /head-to-head — team selection interface
 *   /head-to-head/:team1/:team2 — matchup results
 *
 * Fetches /data/head-to-head.json and /data/season-catalog.json on mount.
 */
export default function HeadToHeadPage() {
  const { team1: team1Param, team2: team2Param } = useParams();
  const navigate = useNavigate();

  const [h2hData, setH2hData] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Local state for the dropdowns
  const [selectedTeam1, setSelectedTeam1] = useState(team1Param || '');
  const [selectedTeam2, setSelectedTeam2] = useState(team2Param || '');

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(null);

    Promise.all([
      fetch('/data/head-to-head.json').then((res) => {
        if (!res.ok) throw new Error('Failed to load head-to-head data');
        return res.json();
      }),
      fetch('/data/season-catalog.json').then((res) => {
        if (!res.ok) throw new Error('Failed to load season catalog');
        return res.json();
      }),
    ])
      .then(([h2h, cat]) => {
        setH2hData(h2h);
        setCatalog(cat);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Sync URL params to dropdown state when params change
  useEffect(() => {
    if (team1Param) setSelectedTeam1(team1Param);
    if (team2Param) setSelectedTeam2(team2Param);
  }, [team1Param, team2Param]);

  // Extract team list from the catalog
  const teams = useMemo(() => {
    if (!catalog) return [];
    return extractTeams(catalog);
  }, [catalog]);

  // Look up the current matchup
  const matchup = useMemo(() => {
    if (!h2hData || !team1Param || !team2Param) return null;
    const key = matchupKey(team1Param, team2Param);
    return h2hData.matchups[key] || null;
  }, [h2hData, team1Param, team2Param]);

  // Handle team selection and navigate
  const handleCompare = () => {
    if (selectedTeam1 && selectedTeam2 && selectedTeam1 !== selectedTeam2) {
      navigate(`/head-to-head/${selectedTeam1}/${selectedTeam2}`);
    }
  };

  if (loading) return <Loading />;
  if (error) return <ErrorMessage message={error} onRetry={fetchData} />;

  // Determine team names for display
  const team1Name = matchup
    ? (matchup.team1.teamId === team1Param ? matchup.team1.name : matchup.team2.name)
    : teams.find((t) => t.teamId === team1Param)?.name || team1Param;
  const team2Name = matchup
    ? (matchup.team1.teamId === team2Param ? matchup.team1.name : matchup.team2.name)
    : teams.find((t) => t.teamId === team2Param)?.name || team2Param;

  // Build breadcrumbs
  const crumbs = [
    { label: 'Home', to: '/' },
    team1Param && team2Param
      ? { label: 'Head-to-Head', to: '/head-to-head' }
      : { label: 'Head-to-Head' },
  ];
  if (team1Param && team2Param) {
    crumbs.push({ label: `${team1Name} vs ${team2Name}` });
  }

  return (
    <div className="h2h-page">
      <Breadcrumbs crumbs={crumbs} />

      <h1 className="h2h-page__title">Head-to-Head</h1>

      {/* Team selection interface */}
      <div className="h2h-page__selection">
        <div className="h2h-page__dropdowns">
          <label className="h2h-page__label">
            <span>Team 1</span>
            <select
              className="h2h-page__select"
              value={selectedTeam1}
              onChange={(e) => setSelectedTeam1(e.target.value)}
              aria-label="Select first team"
            >
              <option value="">Select a team...</option>
              {teams.map((team) => (
                <option key={team.teamId} value={team.teamId}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>

          <span className="h2h-page__vs" aria-hidden="true">vs</span>

          <label className="h2h-page__label">
            <span>Team 2</span>
            <select
              className="h2h-page__select"
              value={selectedTeam2}
              onChange={(e) => setSelectedTeam2(e.target.value)}
              aria-label="Select second team"
            >
              <option value="">Select a team...</option>
              {teams.map((team) => (
                <option key={team.teamId} value={team.teamId}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>

          <button
            className="h2h-page__compare-btn"
            onClick={handleCompare}
            disabled={!selectedTeam1 || !selectedTeam2 || selectedTeam1 === selectedTeam2}
          >
            Compare
          </button>
        </div>

        {selectedTeam1 && selectedTeam2 && selectedTeam1 === selectedTeam2 && (
          <p className="h2h-page__error-hint">Please select two different teams.</p>
        )}
      </div>

      {/* Results section — only when URL params are present */}
      {team1Param && team2Param && (
        <div className="h2h-page__results">
          {matchup ? (
            <MatchupResults
              matchup={matchup}
              team1Id={team1Param}
              team2Id={team2Param}
            />
          ) : (
            <p className="h2h-page__no-matchup">
              No games found between these two teams.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Renders the all-time record and game list for a matchup.
 */
function MatchupResults({ matchup, team1Id, team2Id }) {
  // Determine wins from each perspective based on the URL param order
  // matchup.team1 is always the smaller teamId
  const isTeam1First = matchup.team1.teamId === team1Id;
  const team1Record = isTeam1First ? matchup.team1 : matchup.team2;
  const team2Record = isTeam1First ? matchup.team2 : matchup.team1;

  return (
    <>
      {/* All-time record */}
      <div className="h2h-page__record">
        <h2 className="h2h-page__record-title">All-Time Record</h2>
        <div className="h2h-page__record-grid">
          <div className="h2h-page__record-team">
            <TeamLink teamId={team1Record.teamId} name={team1Record.name} />
            <span className="h2h-page__record-value">{team1Record.wins} W</span>
          </div>
          <div className="h2h-page__record-ties">
            <span className="h2h-page__record-ties-value">{matchup.ties} T</span>
          </div>
          <div className="h2h-page__record-team">
            <TeamLink teamId={team2Record.teamId} name={team2Record.name} />
            <span className="h2h-page__record-value">{team2Record.wins} W</span>
          </div>
        </div>
      </div>

      {/* Game list */}
      <div className="h2h-page__games">
        <h2 className="h2h-page__games-title">
          Game History ({matchup.games.length} game{matchup.games.length !== 1 ? 's' : ''})
        </h2>
        {matchup.games.length > 0 ? (
          <table className="h2h-page__games-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Score</th>
                <th>Season</th>
              </tr>
            </thead>
            <tbody>
              {matchup.games.map((game) => (
                <GameRow
                  key={game.gameId}
                  game={game}
                  team1={team1Record}
                  team2={team2Record}
                />
              ))}
            </tbody>
          </table>
        ) : (
          <p>No games on record.</p>
        )}
      </div>
    </>
  );
}

/**
 * Renders a single game row in the head-to-head game list.
 */
function GameRow({ game, team1, team2 }) {
  // Determine which team was home
  const isTeam1Home = game.homeTeamId === team1.teamId;
  const homeTeamName = isTeam1Home ? team1.name : team2.name;
  const awayTeamName = isTeam1Home ? team2.name : team1.name;

  const scoreDisplay = `${homeTeamName} ${game.score.home} - ${game.score.away} ${awayTeamName}`;

  return (
    <tr className="h2h-page__game-row">
      <td>{game.date || '—'}</td>
      <td>
        {game.gameId ? (
          <Link to={`/games/${game.gameId}`} className="h2h-page__game-link">
            {scoreDisplay}
          </Link>
        ) : (
          scoreDisplay
        )}
      </td>
      <td>{game.seasonName || '—'}</td>
    </tr>
  );
}
