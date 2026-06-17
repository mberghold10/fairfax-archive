import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import Loading from '../components/Loading.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import '../styles/players-page.css';

export default function PlayersPage() {
  const [players, setPlayers] = useState(null);
  const [goalies, setGoalies] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState('skaters');
  const [sortKey, setSortKey] = useState('pts');
  const [sortDir, setSortDir] = useState('desc');
  const [goalieSortKey, setGoalieSortKey] = useState('w');
  const [goalieSortDir, setGoalieSortDir] = useState('desc');

  const fetchAll = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetch('/data/all-players.json').then(r => { if (!r.ok) throw new Error('Failed to load players'); return r.json(); }),
      fetch('/data/all-goalies.json').then(r => { if (!r.ok) throw new Error('Failed to load goalies'); return r.json(); }),
    ])
      .then(([p, g]) => { setPlayers(p); setGoalies(g); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  if (loading) return <Loading />;
  if (error) return <ErrorMessage message={error} onRetry={fetchAll} />;

  const isSkaters = tab === 'skaters';
  const list = isSkaters ? players : goalies;
  const sk = isSkaters ? sortKey : goalieSortKey;
  const sd = isSkaters ? sortDir : goalieSortDir;

  const setSort = isSkaters
    ? (k) => { if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortKey(k); setSortDir('desc'); } }
    : (k) => { if (goalieSortKey === k) setGoalieSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setGoalieSortKey(k); setGoalieSortDir('desc'); } };

  const filtered = filter.trim()
    ? list.filter(p => p.displayName.toLowerCase().includes(filter.toLowerCase()))
    : list;

  const sorted = [...filtered].sort((a, b) => {
    const av = sk === 'displayName' ? a.displayName : (a.totals[sk] ?? 0);
    const bv = sk === 'displayName' ? b.displayName : (b.totals[sk] ?? 0);
    if (typeof av === 'string') return sd === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    return sd === 'asc' ? av - bv : bv - av;
  });

  const ind = (k) => sk === k ? (sd === 'asc' ? ' ▲' : ' ▼') : '';

  return (
    <div className="players-page">
      <Breadcrumbs crumbs={[{ label: 'Home', to: '/' }, { label: 'Players' }]} />
      <h1 className="players-page__title">Players</h1>

      <div className="players-page__tabs">
        <button
          className={`players-page__tab${isSkaters ? ' players-page__tab--active' : ''}`}
          onClick={() => setTab('skaters')}
        >
          Skaters ({players.length.toLocaleString()})
        </button>
        <button
          className={`players-page__tab${!isSkaters ? ' players-page__tab--active' : ''}`}
          onClick={() => setTab('goalies')}
        >
          Goalies ({goalies.length.toLocaleString()})
        </button>
      </div>

      <input
        type="search"
        className="players-page__search"
        placeholder="Search by name…"
        value={filter}
        onChange={e => setFilter(e.target.value)}
        aria-label="Search by name"
      />

      {sorted.length === 0 ? (
        <p className="players-page__empty">No {tab} match "{filter}"</p>
      ) : (
        <div className="players-page__table-wrapper">
          <table className="players-page__table">
            <thead>
              <tr>
                <th className="sortable" onClick={() => setSort('displayName')}>Name{ind('displayName')}</th>
                <th className="sortable" onClick={() => setSort('gp')}>GP{ind('gp')}</th>
                {isSkaters ? (
                  <>
                    <th className="sortable" onClick={() => setSort('g')}>G{ind('g')}</th>
                    <th className="sortable" onClick={() => setSort('a')}>A{ind('a')}</th>
                    <th className="sortable" onClick={() => setSort('pts')}>PTS{ind('pts')}</th>
                    <th className="sortable" onClick={() => setSort('pim')}>PIM{ind('pim')}</th>
                  </>
                ) : (
                  <>
                    <th className="sortable" onClick={() => setSort('w')}>W{ind('w')}</th>
                    <th className="sortable" onClick={() => setSort('l')}>L{ind('l')}</th>
                    <th className="sortable" onClick={() => setSort('t')}>T{ind('t')}</th>
                    <th className="sortable" onClick={() => setSort('gaa')}>GAA{ind('gaa')}</th>
                    <th className="sortable" onClick={() => setSort('svpct')}>SV%{ind('svpct')}</th>
                  </>
                )}
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
                  {isSkaters ? (
                    <>
                      <td>{player.totals.g}</td>
                      <td>{player.totals.a}</td>
                      <td>{player.totals.pts}</td>
                      <td>{player.totals.pim}</td>
                    </>
                  ) : (
                    <>
                      <td>{player.totals.w}</td>
                      <td>{player.totals.l}</td>
                      <td>{player.totals.t}</td>
                      <td>{player.totals.gaa}</td>
                      <td>{player.totals.svpct}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
