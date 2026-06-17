import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import Loading from '../components/Loading.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import TeamLink from '../components/TeamLink.jsx';
import PlayerLink from '../components/PlayerLink.jsx';
import '../styles/h2h-page.css';

/**
 * Convert a team name to its URL slug. Mirrors TeamLink.jsx.
 */
function toTeamSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Extract a unique sorted list of all canonical teams from the season catalog.
 */
function extractTeams(catalog) {
  const seen = new Set();
  const teams = [];
  for (const season of catalog.seasons) {
    for (const div of season.divisions) {
      for (const [, name] of Object.entries(div.teams)) {
        if (!seen.has(name)) {
          seen.add(name);
          teams.push({ slug: toTeamSlug(name), name });
        }
      }
    }
  }
  return teams.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Find a matchup from h2hData where team name slugs match the URL params.
 */
function findMatchupByParams(h2hData, slug1, slug2) {
  for (const matchup of Object.values(h2hData.matchups)) {
    const s1 = toTeamSlug(matchup.team1.name);
    const s2 = toTeamSlug(matchup.team2.name);
    if ((s1 === slug1 && s2 === slug2) || (s1 === slug2 && s2 === slug1)) {
      return matchup;
    }
  }
  return null;
}

/**
 * Generate a player ID from name — mirrors the aggregation pipeline's hash.
 */
function generatePlayerIdFromName(name) {
  const normalized = name.toLowerCase().replace(/[^a-z\s,]/g, '').replace(/\s+/g, ' ').trim();
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(12, '0').slice(0, 12);
}

/**
 * HeadToHeadPage displays the historical matchup record between two teams,
 * split into regular season / playoffs, with per-player stats vs opponent.
 */
export default function HeadToHeadPage() {
  const { team1: team1Param, team2: team2Param } = useParams();
  const navigate = useNavigate();

  const [h2hData, setH2hData] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [playerStats, setPlayerStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedTeam1, setSelectedTeam1] = useState(team1Param || '');
  const [selectedTeam2, setSelectedTeam2] = useState(team2Param || '');

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetch('/data/head-to-head.json').then(r => { if (!r.ok) throw new Error('Failed to load head-to-head data'); return r.json(); }),
      fetch('/data/season-catalog.json').then(r => { if (!r.ok) throw new Error('Failed to load season catalog'); return r.json(); }),
    ])
      .then(([h2h, cat]) => { setH2hData(h2h); setCatalog(cat); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (team1Param) setSelectedTeam1(team1Param);
    if (team2Param) setSelectedTeam2(team2Param);
  }, [team1Param, team2Param]);

  // When a matchup is selected, fetch its per-player stats file
  useEffect(() => {
    if (!team1Param || !team2Param || !h2hData) return;
    setPlayerStats(null);
    const matchup = findMatchupByParams(h2hData, team1Param, team2Param);
    if (!matchup) return;
    // H2H player stats files are now keyed by slug pair
    const [a, b] = [toTeamSlug(matchup.team1.name), toTeamSlug(matchup.team2.name)].sort();
    fetch(`/data/h2h-players/${a}-${b}.json`)
      .then(r => r.ok ? r.json() : null)
      .then(data => setPlayerStats(data))
      .catch(() => setPlayerStats(null));
  }, [team1Param, team2Param, h2hData]);

  const teams = useMemo(() => {
    if (!catalog) return [];
    return extractTeams(catalog);
  }, [catalog]);

  const matchup = useMemo(() => {
    if (!h2hData || !team1Param || !team2Param) return null;
    return findMatchupByParams(h2hData, team1Param, team2Param);
  }, [h2hData, team1Param, team2Param]);

  const handleCompare = () => {
    if (selectedTeam1 && selectedTeam2 && selectedTeam1 !== selectedTeam2) {
      navigate(`/head-to-head/${selectedTeam1}/${selectedTeam2}`);
    }
  };

  if (loading) return <Loading />;
  if (error) return <ErrorMessage message={error} onRetry={fetchData} />;

  const team1Name = matchup
    ? (toTeamSlug(matchup.team1.name) === team1Param ? matchup.team1.name : matchup.team2.name)
    : teams.find(t => t.slug === team1Param)?.name || team1Param;
  const team2Name = matchup
    ? (toTeamSlug(matchup.team2.name) === team2Param ? matchup.team2.name : matchup.team1.name)
    : teams.find(t => t.slug === team2Param)?.name || team2Param;

  const crumbs = [
    { label: 'Home', to: '/' },
    team1Param && team2Param
      ? { label: 'Matchups', to: '/head-to-head' }
      : { label: 'Matchups' },
  ];
  if (team1Param && team2Param) {
    crumbs.push({ label: `${team1Name} vs ${team2Name}` });
  }

  return (
    <div className="h2h-page">
      <Breadcrumbs crumbs={crumbs} />
      <h1 className="h2h-page__title">Matchups</h1>

      <div className="h2h-page__selection">
        <div className="h2h-page__dropdowns">
          <TeamCombobox
            label="Your Team"
            teams={teams}
            value={selectedTeam1}
            onChange={setSelectedTeam1}
          />
          <span className="h2h-page__vs" aria-hidden="true">vs</span>
          <TeamCombobox
            label="Opponent"
            teams={teams}
            value={selectedTeam2}
            onChange={setSelectedTeam2}
          />
          <button
            className="h2h-page__compare-btn"
            onClick={handleCompare}
            disabled={
              !selectedTeam1 || !selectedTeam2 ||
              selectedTeam1 === selectedTeam2 ||
              !teams.some(t => t.slug === selectedTeam1) ||
              !teams.some(t => t.slug === selectedTeam2)
            }
          >
            Compare
          </button>
        </div>
        {selectedTeam1 && selectedTeam2 && selectedTeam1 === selectedTeam2 && (
          <p className="h2h-page__error-hint">Please select two different teams.</p>
        )}
      </div>

      {team1Param && team2Param && (
        <div className="h2h-page__results">
          {matchup ? (
            <MatchupResults matchup={matchup} team1Slug={team1Param} team2Slug={team2Param} playerStats={playerStats} />
          ) : (
            <p className="h2h-page__no-matchup">No games found between these two teams.</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Renders the all-time record, games split by regular/playoff, and player stats.
 */
function MatchupResults({ matchup, team1Slug, team2Slug, playerStats }) {
  const [activeTab, setActiveTab] = useState('regular');

  const isTeam1First = toTeamSlug(matchup.team1.name) === team1Slug;
  const team1 = isTeam1First ? matchup.team1 : matchup.team2;
  const team2 = isTeam1First ? matchup.team2 : matchup.team1;

  const regularGames = matchup.games.filter(g => !g.playoff);
  const playoffGames = matchup.games.filter(g => g.playoff);

  const countWins = (games, teamId) => games.filter(g =>
    (g.homeTeamId === teamId && g.score.home > g.score.away) ||
    (g.homeTeamId !== teamId && g.score.away > g.score.home)
  ).length;

  const regT1W = countWins(regularGames, team1.teamId);
  const regT2W = countWins(regularGames, team2.teamId);
  const regTies = regularGames.filter(g => g.score.home === g.score.away).length;
  const tabGames = activeTab === 'playoffs' ? playoffGames : regularGames;

  return (
    <>
      {/* Record split by regular season / playoffs */}
      <div className="h2h-page__record">
        <h2 className="h2h-page__record-title">All-Time Record</h2>
        <div className="h2h-page__record-grid">
          <div className="h2h-page__record-team">
            <TeamLink teamId={team1.teamId} name={team1.name} />
            <span className="h2h-page__record-value">{team1.wins} W</span>
          </div>
          <div className="h2h-page__record-ties">
            <span className="h2h-page__record-ties-value">{matchup.ties} T</span>
          </div>
          <div className="h2h-page__record-team">
            <TeamLink teamId={team2.teamId} name={team2.name} />
            <span className="h2h-page__record-value">{team2.wins} W</span>
          </div>
        </div>

        {/* Sub-records */}
        <div className="h2h-page__subrecords">
          <div className="h2h-page__subrecord">
            <span className="h2h-page__subrecord-label">Regular Season</span>
            <span className="h2h-page__subrecord-value">
              {regT1W}–{regTies}–{regT2W}
            </span>
          </div>
          {playoffGames.length > 0 && (
            <div className="h2h-page__subrecord">
              <span className="h2h-page__subrecord-label">🏆 Playoffs</span>
              <span className="h2h-page__subrecord-value">
                {countWins(playoffGames, team1.teamId)}–0–{countWins(playoffGames, team2.teamId)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="h2h-page__tabs">
        <button className={`h2h-page__tab${activeTab === 'regular' ? ' h2h-page__tab--active' : ''}`} onClick={() => setActiveTab('regular')}>
          Regular Season ({regularGames.length})
        </button>
        {playoffGames.length > 0 && (
          <button className={`h2h-page__tab${activeTab === 'playoffs' ? ' h2h-page__tab--active' : ''}`} onClick={() => setActiveTab('playoffs')}>
            🏆 Playoffs ({playoffGames.length})
          </button>
        )}
      </div>

      {/* Game list */}
      <div className="h2h-page__games">
        {tabGames.length > 0 ? (
          <table className="h2h-page__games-table">
            <thead>
              <tr><th>Date</th><th>Score</th><th>Season</th></tr>
            </thead>
            <tbody>
              {tabGames.map(game => (
                <GameRow key={game.gameId || game.date} game={game} team1={team1} team2={team2} />
              ))}
            </tbody>
          </table>
        ) : (
          <p className="h2h-page__no-matchup">No {activeTab === 'playoffs' ? 'playoff' : 'regular season'} games on record.</p>
        )}
      </div>

      {/* Player stats vs this opponent */}
      {playerStats && (
        <PlayerStatsSection playerStats={playerStats} team1={team1} team2={team2} />
      )}
    </>
  );
}

function PlayerStatsSection({ playerStats, team1, team2 }) {
  // Player stats are now keyed by team slug, not teamId
  const t1Slug = toTeamSlug(team1.name);
  const t2Slug = toTeamSlug(team2.name);
  const availableTeams = [team1, team2].filter(t =>
    (playerStats.players[toTeamSlug(t.name)] || []).length > 0
  );
  const [viewSlug, setViewSlug] = useState(() => availableTeams[0] ? toTeamSlug(availableTeams[0].name) : t1Slug);

  if (availableTeams.length === 0) return null;

  const players = playerStats.players[viewSlug] || [];

  return (
    <div className="h2h-page__player-stats">
      <h2 className="h2h-page__games-title">Player Stats vs This Opponent</h2>
      <div className="h2h-page__tabs">
        {availableTeams.map(t => (
          <button
            key={t.teamId}
            className={`h2h-page__tab${viewSlug === toTeamSlug(t.name) ? ' h2h-page__tab--active' : ''}`}
            onClick={() => setViewSlug(toTeamSlug(t.name))}
          >
            {t.name}
          </button>
        ))}
      </div>
      <table className="h2h-page__games-table h2h-page__player-table">
        <thead>
          <tr><th>Player</th><th>G</th><th>A</th><th>PTS</th><th>PIM</th></tr>
        </thead>
        <tbody>
          {players.map((p, i) => (
            <tr key={`${p.name}-${i}`}>
              <td><PlayerLink playerId={generatePlayerIdFromName(p.name)} name={p.name} /></td>
              <td>{p.g}</td>
              <td>{p.a}</td>
              <td>{p.pts}</td>
              <td>{p.pim || 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GameRow({ game, team1, team2 }) {
  // Use stored homeTeamSlug for reliable cross-season matching
  const team1Slug = toTeamSlug(team1.name);
  const homeIsTeam1 = game.homeTeamSlug
    ? game.homeTeamSlug === team1Slug
    : game.homeTeamId === team1.teamId;

  const homeLabel = homeIsTeam1 ? team1.name : team2.name;
  const awayLabel = homeIsTeam1 ? team2.name : team1.name;

  return (
    <tr className={`h2h-page__game-row${game.playoff ? ' h2h-page__game-row--playoff' : ''}`}>
      <td>{game.date || '—'}</td>
      <td>
        {game.gameId
          ? <Link to={`/games/${game.gameId}`} className="h2h-page__game-link">
              {homeLabel} {game.score.home}–{game.score.away} {awayLabel}
            </Link>
          : `${homeLabel} ${game.score.home}–${game.score.away} ${awayLabel}`}
        {game.playoff && <span className="h2h-page__playoff-badge"> 🏆</span>}
      </td>
      <td>{game.seasonName || '—'}</td>
    </tr>
  );
}

/**
 * Typeahead combobox for team selection.
 * Allows typing to filter, resolves to a slug on valid selection.
 * Fixes the browser dropdown overflow/positioning bug with native <select>.
 */
function TeamCombobox({ label, teams, value, onChange }) {
  const [inputText, setInputText] = useState(() => teams.find(t => t.slug === value)?.name || '');
  const [open, setOpen] = useState(false);
  const containerRef = React.useRef(null);

  // Sync display text when value changes externally (e.g. from URL)
  React.useEffect(() => {
    const found = teams.find(t => t.slug === value);
    if (found) setInputText(found.name);
  }, [value, teams]);

  const filtered = inputText
    ? teams.filter(t => t.name.toLowerCase().includes(inputText.toLowerCase()))
    : teams;

  const handleInput = (e) => {
    setInputText(e.target.value);
    setOpen(true);
    // If input no longer matches a team, clear the slug value
    const exact = teams.find(t => t.name.toLowerCase() === e.target.value.toLowerCase());
    onChange(exact ? exact.slug : '');
  };

  const handleSelect = (team) => {
    setInputText(team.name);
    onChange(team.slug);
    setOpen(false);
  };

  // Close on outside click
  React.useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="h2h-combobox" ref={containerRef}>
      <label className="h2h-page__label">
        <span>{label}</span>
        <input
          type="text"
          className="h2h-page__select h2h-combobox__input"
          value={inputText}
          onChange={handleInput}
          onFocus={() => setOpen(true)}
          placeholder="Type to search..."
          autoComplete="off"
          aria-label={label}
          aria-expanded={open}
          aria-autocomplete="list"
        />
      </label>
      {open && filtered.length > 0 && (
        <ul className="h2h-combobox__list" role="listbox">
          {filtered.slice(0, 50).map(team => (
            <li
              key={team.slug}
              className={`h2h-combobox__item${team.slug === value ? ' h2h-combobox__item--selected' : ''}`}
              onMouseDown={() => handleSelect(team)}
              role="option"
              aria-selected={team.slug === value}
            >
              {team.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
