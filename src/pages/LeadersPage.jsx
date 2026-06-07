import React, { useState, useEffect, useCallback } from 'react';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import Loading from '../components/Loading.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import PlayerLink from '../components/PlayerLink.jsx';
import StatsTable from '../components/StatsTable.jsx';
import '../styles/leaders-page.css';

/**
 * Category definitions for the leaderboard tabs.
 * Skater categories use `playerId`, goalie categories use `goalieId`.
 */
const CATEGORIES = [
  { key: 'goals', label: 'Goals', statLabel: 'G', idField: 'playerId' },
  { key: 'assists', label: 'Assists', statLabel: 'A', idField: 'playerId' },
  { key: 'points', label: 'Points', statLabel: 'PTS', idField: 'playerId' },
  { key: 'pim', label: 'PIM', statLabel: 'PIM', idField: 'playerId' },
  { key: 'wins', label: 'Wins', statLabel: 'W', idField: 'goalieId' },
  { key: 'shutouts', label: 'Shutouts', statLabel: 'SO', idField: 'goalieId' },
];

/**
 * LeadersPage displays all-time statistical leaderboards.
 * Fetches /data/leaders.json on mount and shows tabbed sections
 * for goals, assists, points, PIM (skaters) and wins, shutouts (goalies).
 */
export default function LeadersPage() {
  const [leaders, setLeaders] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('goals');

  const fetchLeaders = useCallback(() => {
    setLoading(true);
    setError(null);

    fetch('/data/leaders.json')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load leaders data');
        return res.json();
      })
      .then((data) => {
        setLeaders(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchLeaders();
  }, [fetchLeaders]);

  if (loading) return <Loading />;
  if (error) return <ErrorMessage message={error} onRetry={fetchLeaders} />;

  const activeCategory = CATEGORIES.find((c) => c.key === activeTab);
  const entries = leaders[activeTab] || [];

  // Build columns for StatsTable
  const columns = [
    {
      key: 'rank',
      label: '#',
      sortable: false,
    },
    {
      key: 'displayName',
      label: 'Player',
      sortable: true,
      render: (value, row) => (
        <PlayerLink playerId={row.id} name={value} />
      ),
    },
    {
      key: 'value',
      label: activeCategory.statLabel,
      sortable: true,
    },
  ];

  // Transform entries into table rows with rank and a unified `id` field
  const rows = entries.map((entry, index) => ({
    key: entry[activeCategory.idField] || index,
    rank: index + 1,
    id: entry[activeCategory.idField],
    displayName: entry.displayName,
    value: entry.value,
  }));

  return (
    <div className="leaders-page">
      <Breadcrumbs
        crumbs={[
          { label: 'Home', to: '/' },
          { label: 'Leaders' },
        ]}
      />

      <h1 className="leaders-page__title">All-Time Leaders</h1>

      <div className="leaders-page__tabs" role="tablist" aria-label="Leaderboard categories">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            role="tab"
            aria-selected={activeTab === cat.key}
            aria-controls={`leaders-panel-${cat.key}`}
            className={`leaders-page__tab ${activeTab === cat.key ? 'leaders-page__tab--active' : ''}`}
            onClick={() => setActiveTab(cat.key)}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div
        id={`leaders-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`leaders-tab-${activeTab}`}
        className="leaders-page__panel"
      >
        <StatsTable
          columns={columns}
          data={rows}
          defaultSort="rank"
          defaultDirection="asc"
        />
      </div>
    </div>
  );
}
