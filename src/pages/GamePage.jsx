import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import TeamLink from '../components/TeamLink.jsx';
import Loading from '../components/Loading.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import '../styles/game-page.css';

/**
 * Converts a season name like "Winter 2018" to a URL slug like "winter-2018".
 */
function seasonSlug(seasonName) {
  return seasonName.toLowerCase().replace(/\s+/g, '-');
}

export default function GamePage() {
  const { gameId } = useParams();
  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setError(null);

    fetch(`/data/games/${gameId}.json`)
      .then((res) => {
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return null;
        }
        if (!res.ok) throw new Error(`Failed to load game data (${res.status})`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled && data) setGame(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [gameId]);

  if (loading) return <Loading />;

  if (notFound) {
    return (
      <div className="game-page container">
        <ErrorMessage message="Game data not found" />
        {game?.divId && (
          <p className="game-page__back-link">
            <Link to={`/seasons/${seasonSlug(game.seasonName)}/divisions/${game.divId}`}>
              Back to division
            </Link>
          </p>
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div className="game-page container">
        <ErrorMessage message={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  if (!game) return null;

  const { home, away, scoring, goals, penalties, date, seasonName, divId, mode } = game;
  const hasOT = scoring.home.ot > 0 || scoring.away.ot > 0;

  const crumbs = [
    { label: 'Home', to: '/' },
    { label: seasonName, to: `/seasons/${seasonSlug(seasonName)}` },
    { label: `Division`, to: `/seasons/${seasonSlug(seasonName)}/divisions/${divId}` },
    { label: `Game #${gameId}` },
  ];

  return (
    <div className="game-page container">
      <Breadcrumbs crumbs={crumbs} />

      {/* Game Header */}
      <header className="game-page__header">
        <h1 className="game-page__title">
          <TeamLink teamId={away.teamId} name={away.name} /> {' @ '}
          <TeamLink teamId={home.teamId} name={home.name} />
        </h1>
        <p className="game-page__context">
          {date} &middot; {seasonName} &middot; {mode === 'playoff' ? 'Playoff' : 'Regular Season'}
        </p>
      </header>

      {/* Scoring Summary */}
      <section className="game-page__section" aria-labelledby="scoring-heading">
        <h2 id="scoring-heading" className="game-page__section-title">Scoring Summary</h2>
        <div className="table-wrapper">
          <table className="game-page__scoring-table">
            <thead>
              <tr>
                <th>Team</th>
                <th data-type="number">P1</th>
                <th data-type="number">P2</th>
                <th data-type="number">P3</th>
                {hasOT && <th data-type="number">OT</th>}
                <th data-type="number">Final</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><TeamLink teamId={away.teamId} name={away.name} /></td>
                <td data-type="number">{scoring.away.p1}</td>
                <td data-type="number">{scoring.away.p2}</td>
                <td data-type="number">{scoring.away.p3}</td>
                {hasOT && <td data-type="number">{scoring.away.ot}</td>}
                <td data-type="number"><strong>{scoring.away.final}</strong></td>
              </tr>
              <tr>
                <td><TeamLink teamId={home.teamId} name={home.name} /></td>
                <td data-type="number">{scoring.home.p1}</td>
                <td data-type="number">{scoring.home.p2}</td>
                <td data-type="number">{scoring.home.p3}</td>
                {hasOT && <td data-type="number">{scoring.home.ot}</td>}
                <td data-type="number"><strong>{scoring.home.final}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Goals Table */}
      {goals && goals.length > 0 && (
        <section className="game-page__section" aria-labelledby="goals-heading">
          <h2 id="goals-heading" className="game-page__section-title">Goals</h2>
          <div className="table-wrapper">
            <table className="game-page__goals-table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Time</th>
                  <th>Team</th>
                  <th>Scorer</th>
                  <th>Assists</th>
                </tr>
              </thead>
              <tbody>
                {goals.map((goal, idx) => (
                  <tr key={idx}>
                    <td>{goal.period}</td>
                    <td>{goal.time}</td>
                    <td><TeamLink teamId={goal.team.teamId} name={goal.team.name} /></td>
                    <td>{goal.scorer}</td>
                    <td>
                      {goal.assist1 && goal.assist2
                        ? `${goal.assist1}, ${goal.assist2}`
                        : goal.assist1
                          ? goal.assist1
                          : 'Unassisted'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Penalties Table */}
      {penalties && penalties.length > 0 && (
        <section className="game-page__section" aria-labelledby="penalties-heading">
          <h2 id="penalties-heading" className="game-page__section-title">Penalties</h2>
          <div className="table-wrapper">
            <table className="game-page__penalties-table">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Time</th>
                  <th>Team</th>
                  <th>Player</th>
                  <th data-type="number">PIM</th>
                  <th>Offense</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {penalties.map((pen, idx) => (
                  <tr key={idx} className={pen.isMajor || pen.isMatch ? 'game-page__penalty--severe' : ''}>
                    <td>{pen.period}</td>
                    <td>{pen.time}</td>
                    <td><TeamLink teamId={pen.team.teamId} name={pen.team.name} /></td>
                    <td>{pen.player}</td>
                    <td data-type="number">{pen.pim}</td>
                    <td>{pen.offense}</td>
                    <td>
                      {pen.isMatch ? 'Match' : pen.isMajor ? 'Major' : 'Minor'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* No goals or penalties */}
      {(!goals || goals.length === 0) && (
        <section className="game-page__section">
          <h2 className="game-page__section-title">Goals</h2>
          <p className="game-page__empty">No goals recorded for this game.</p>
        </section>
      )}
      {(!penalties || penalties.length === 0) && (
        <section className="game-page__section">
          <h2 className="game-page__section-title">Penalties</h2>
          <p className="game-page__empty">No penalties recorded for this game.</p>
        </section>
      )}
    </div>
  );
}
