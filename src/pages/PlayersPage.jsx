import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import Loading from '../components/Loading.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import '../styles/players-page.css';

/**
 * PlayersPage — searchable/browsable list of all players.
 * Shows career stats (GP, G, A, PTS, PIM) and links to each player's card.
 */
export default function PlayersPage() {
  const [players, setPlayers] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');
  const [sortKey, setSortKey] = useState('pts');
  const [sortDir, setSortDir] = useState('desc');

  const fetchPlayers = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/data/all-players.json')
      .then(r => { if (!r.ok) throw new Error('Failed to load players'); return r.json(); })
      .then(data => { setPlayers(data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  useEffect(() => { fetchPlayers(); }, [fetchPlayers]);

  if (loading) return <Loading />;
  if (error) return <ErrorMessage message={error} onRetry={fetchPlayers} />;

  const filtered = filter.trim()
    ? players.filter(p => p.displayName.toLowerCase().includes(filter.toLowerCase()))
    : players;

  const sorted = [...filtered].sort((a, b) => {
    const av = sortKey === 'displayName' ? a.displayName : (a.totals[sortKey] ?? 0);
    const bv = sortKey === 'displayName' ? b.displayName : (b.totals[sortKey] ?? 0);
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  const sortIndicator = (key) => sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  return (
    <div className="players-page">
      <Breadcrumbs crumbs={[{ label: 'Home', to: '/' }, { label: 'Players' }]} />
      <h1 className="players-page__title">Players</h1>
      <p className="players-page__subtitle">{players.length.toLocaleString()} players in the archive</p>

      <input
        type="search"
        className="players-page__search"
        placeholder="Search by name…"
        value={filter}
        onChange={e => setFilter(e.target.value)}
        aria-label="Search players by name"
      />

      {sorted.length === 0 ? (
        <p className="players-page__empty">No players match "{filter}"</p>
      ) : (
        <div className="players-page__table-wrapper">
          <table className="players-page__table">
            <thead>
              <tr>
                <th className="sortable" onClick={() => handleSort('displayName')}>
                  Name{sortIndicator('displayName')}
                </th>
                <th className="sortable" onClick={() => handleSort('gp')}>GP{sortIndicator('gp')}</th>
                <th className="sortable" onClick={() => handleSort('g')}>G{sortIndicator('g')}</th>
                <th className="sortable" onClick={() => handleSort('a')}>A{sortIndicator('a')}</th>
                <th className="sortable" onClick={() => handleSort('pts')}>PTS{sortIndicator('pts')}</th>
                <th className="sortable" onClick={() => handleSort('pim')}>PIM{sortIndicator('pim')}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(player => (
                <tr key={player.id}>
                  <td>
                    <Link to={`/players/${player.id}`} className="player-link">
                      {player.displayName}
                    </Link>
                  </td>
                  <td>{player.totals.gp}</td>
                  <td>{player.totals.g}</td>
                  <td>{player.totals.a}</td>
                  <td>{player.totals.pts}</td>
                  <td>{player.totals.pim}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
