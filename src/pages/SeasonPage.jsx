import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import StatsTable from '../components/StatsTable.jsx';
import TeamLink from '../components/TeamLink.jsx';
import Loading from '../components/Loading.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import '../styles/season-page.css';

/**
 * Convert a season name to a URL slug. e.g. "Winter 2024" → "winter-2024"
 */
function toSeasonSlug(seasonName) {
  return seasonName.toLowerCase().replace(/\s+/g, '-');
}

/**
 * SeasonPage shows all divisions in a single season, each with its standings
 * (teams + records). Route: /seasons/:seasonSlug
 */
export default function SeasonPage() {
  const { seasonSlug } = useParams();

  const [season, setSeason] = useState(null);
  const [standingsByDiv, setStandingsByDiv] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const fetchData = useCallback(() => {
    setLoading(true);
    setError(null);
    setNotFound(false);

    fetch('/data/season-catalog.json')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load season catalog');
        return res.json();
      })
      .then((data) => {
        const found = data.seasons.find(
          (s) => toSeasonSlug(s.seasonName) === seasonSlug
        );
        if (!found) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        setSeason(found);

        // Fetch standings for each division in parallel
        return Promise.all(
          found.divisions.map((div) =>
            fetch(`/data/divisions/${div.divId}/standings.json`)
              .then((res) => (res.ok ? res.json() : null))
              .then((standings) => ({ divId: div.divId, standings }))
              .catch(() => ({ divId: div.divId, standings: null }))
          )
        ).then((results) => {
          const map = {};
          for (const { divId, standings } of results) {
            map[divId] = standings;
          }
          setStandingsByDiv(map);
          setLoading(false);
        });
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [seasonSlug]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) return <Loading />;
  if (error) return <ErrorMessage message={error} onRetry={fetchData} />;

  if (notFound) {
    return (
      <div className="season-page">
        <Breadcrumbs crumbs={[{ label: 'Home', to: '/' }, { label: 'Season not found' }]} />
        <ErrorMessage message="Season not found" />
      </div>
    );
  }

  const slug = toSeasonSlug(season.seasonName);

  return (
    <div className="season-page">
      <Breadcrumbs
        crumbs={[
          { label: 'Home', to: '/' },
          { label: season.seasonName },
        ]}
      />

      <h1 className="season-page__title">{season.seasonName}</h1>

      {season.divisions.map((div) => (
        <DivisionStandings
          key={div.divId}
          seasonSlug={slug}
          division={div}
          standings={standingsByDiv[div.divId]}
        />
      ))}
    </div>
  );
}

/**
 * Standings table for a single division within the season overview.
 * Falls back to a simple team list when standings aren't available.
 */
function DivisionStandings({ seasonSlug, division, standings }) {
  const divUrl = `/seasons/${seasonSlug}/divisions/${division.divId}`;

  const columns = [
    {
      key: 'team',
      label: 'Team',
      sortable: false,
      render: (val, row) => <TeamLink teamId={row.teamId} name={val} />,
    },
    { key: 'gp', label: 'GP' },
    { key: 'w', label: 'W' },
    { key: 'l', label: 'L' },
    { key: 't', label: 'T' },
    { key: 'gf', label: 'GF' },
    { key: 'ga', label: 'GA' },
    { key: 'pts', label: 'PTS' },
  ];

  const hasStandings = standings && standings.standings && standings.standings.length > 0;

  return (
    <section className="season-page__division">
      <h2 className="season-page__division-title">
        <Link to={divUrl}>{division.divisionLabel}</Link>
      </h2>

      {hasStandings ? (
        <StatsTable
          columns={columns}
          data={standings.standings.map((s) => ({ ...s, id: s.teamId }))}
          defaultSort="pts"
          defaultDirection="desc"
        />
      ) : (
        <ul className="season-page__team-list">
          {Object.entries(division.teams).map(([teamId, teamName]) => (
            <li key={teamId}>
              <TeamLink teamId={teamId} name={teamName} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
