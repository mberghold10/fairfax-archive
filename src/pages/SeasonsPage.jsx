import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import Loading from '../components/Loading.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import '../styles/seasons-page.css';

/**
 * Helper to convert a season name to a URL slug.
 * e.g. "Winter 2024" → "winter-2024"
 */
function toSeasonSlug(seasonName) {
  return seasonName.toLowerCase().replace(/\s+/g, '-');
}

/**
 * SeasonsPage displays all seasons from the season catalog,
 * ordered chronologically (most recent first) with divisions and team counts.
 */
export default function SeasonsPage() {
  const [seasons, setSeasons] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchSeasons = useCallback(() => {
    setLoading(true);
    setError(null);

    fetch('/data/season-catalog.json')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load season catalog');
        return res.json();
      })
      .then((data) => {
        setSeasons(data.seasons);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchSeasons();
  }, [fetchSeasons]);

  if (loading) return <Loading />;
  if (error) return <ErrorMessage message={error} onRetry={fetchSeasons} />;

  return (
    <div className="seasons-page">
      <Breadcrumbs crumbs={[{ label: 'Seasons' }]} />

      <h1 className="seasons-page__title">Seasons</h1>

      <div className="seasons-grid">
        {seasons.map((season) => {
          const slug = toSeasonSlug(season.seasonName);
          const totalTeams = season.divisions.reduce(
            (sum, div) => sum + Object.keys(div.teams).length,
            0
          );

          return (
            <article key={season.seasonName} className="season-card">
              <h2 className="season-card__name">{season.seasonName}</h2>
              <p className="season-card__summary">
                {season.divisions.length} division{season.divisions.length !== 1 ? 's' : ''} &middot; {totalTeams} team{totalTeams !== 1 ? 's' : ''}
              </p>

              <ul className="season-card__divisions">
                {season.divisions.map((div) => {
                  const teamCount = Object.keys(div.teams).length;
                  return (
                    <li key={div.divId} className="season-card__division">
                      <Link
                        to={`/seasons/${slug}/divisions/${div.divId}`}
                        className="season-card__division-link"
                      >
                        <span className="season-card__division-label">{div.divisionLabel}</span>
                        <span className="season-card__division-teams">
                          {teamCount} team{teamCount !== 1 ? 's' : ''}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </article>
          );
        })}
      </div>
    </div>
  );
}
