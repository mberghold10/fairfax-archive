import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

let playerIndexPromise = null;
let playerIndex = null;

function normalizeName(value) {
  return String(value || '')
    .replace(/^name:/, '')
    .toLowerCase()
    .replace(/[^a-z\s,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadPlayerIndex() {
  if (playerIndex) return Promise.resolve(playerIndex);
  if (!playerIndexPromise) {
    playerIndexPromise = Promise.all([
      fetch('/data/all-players.json').then((res) => (res.ok ? res.json() : [])),
      fetch('/data/all-goalies.json').then((res) => (res.ok ? res.json() : [])),
    ]).then(([skaters, goalies]) => {
      const byId = new Map();
      const byName = new Map();
      for (const player of [...skaters, ...goalies]) {
        byId.set(String(player.id), String(player.id));
        const normalized = normalizeName(player.displayName);
        if (normalized && !byName.has(normalized)) byName.set(normalized, String(player.id));
      }
      playerIndex = { byId, byName };
      return playerIndex;
    });
  }
  return playerIndexPromise;
}

function resolvePlayerId(index, playerId, name) {
  const id = String(playerId || '');
  if (index.byId.has(id)) return id;
  const fromIdName = index.byName.get(normalizeName(id));
  if (fromIdName) return fromIdName;
  return index.byName.get(normalizeName(name)) || null;
}

/**
 * Link to a player's page.
 *
 * Props:
 *   playerId - the player's unique identifier
 *   name - display text (optional if children provided)
 *   children - alternative to name prop
 */
export default function PlayerLink({ playerId, name, children }) {
  const [resolvedId, setResolvedId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setResolvedId(null);
    loadPlayerIndex()
      .then((index) => {
        if (!cancelled) setResolvedId(resolvePlayerId(index, playerId, name));
      })
      .catch(() => {
        if (!cancelled) setResolvedId(null);
      });
    return () => { cancelled = true; };
  }, [playerId, name]);

  const display = children || name;
  if (!resolvedId) {
    return <span className="player-link">{display}</span>;
  }

  return (
    <Link to={`/players/${resolvedId}`} className="player-link">
      {display}
    </Link>
  );
}
