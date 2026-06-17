import React, { useState, useEffect, useCallback } from 'react';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import TeamLink from '../components/TeamLink.jsx';
import Loading from '../components/Loading.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import '../styles/teams-page.css';

/**
 * TeamsPage — lists all canonical teams alphabetically with their
 * total seasons played. Links to each team's full history page.
 */
export default function TeamsPage() {
  const [teams, setTeams] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');

  const fetchTeams = useCallback(() => {
    setLoading(true);
    setError(null);

    fetch('/data/season-catalog.json')
      .then(r => { if (!r.ok) throw new Error('Failed to load catalog'); return r.json(); })
      .then(catalog => {
        const teamMap = new Map();
        for (const season of catalog.seasons) {
          for (const div of season.divisions) {
            for (const [, name] of Object.entries(div.teams)) {
              if (!teamMap.has(name)) {
                teamMap.set(name, { name, seasons: 0, mostRecentSeason: season.seasonName });
              }
              teamMap.get(name).seasons++;
            }
          }
        }
        setTeams([...teamMap.values()].sort((a, b) => a.name.localeCompare(b.name)));
        setLoading(false);
      })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  useEffect(() => { fetchTeams(); }, [fetchTeams]);

  if (loading) return <Loading />;
  if (error) return <ErrorMessage message={error} onRetry={fetchTeams} />;

  const filtered = filter.trim()
    ? teams.filter(t => t.name.toLowerCase().includes(filter.toLowerCase()))
    : teams;

  return (
    <div className="teams-page">
      <Breadcrumbs crumbs={[{ label: 'Home', to: '/' }, { label: 'Teams' }]} />
      <h1 className="teams-page__title">Teams</h1>
      <p className="teams-page__subtitle">{teams.length} teams across all seasons</p>

      <input
        type="search"
        className="teams-page__search"
        placeholder="Filter teams…"
        value={filter}
        onChange={e => setFilter(e.target.value)}
        aria-label="Filter teams by name"
      />

      <div className="teams-page__grid">
        {filtered.map(team => (
          <div key={team.name} className="teams-page__card">
            <TeamLink name={team.name} teamId={team.name}>
              <span className="teams-page__card-name">{team.name}</span>
            </TeamLink>
            <span className="teams-page__card-meta">
              {team.seasons} season{team.seasons !== 1 ? 's' : ''}
            </span>
          </div>
        ))}
      </div>
      {filtered.length === 0 && (
        <p className="teams-page__empty">No teams match "{filter}"</p>
      )}
    </div>
  );
}
