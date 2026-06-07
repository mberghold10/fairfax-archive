import React from 'react';
import { NavLink } from 'react-router-dom';
import SearchOverlay from './SearchOverlay.jsx';

export default function MobileNav({ open, onClose }) {
  return (
    <nav
      className={`mobile-nav${open ? ' open' : ''}`}
      aria-label="Mobile navigation"
    >
      <NavLink to="/" end onClick={onClose}>Seasons</NavLink>
      <NavLink to="/leaders" onClick={onClose}>Leaders</NavLink>
      <NavLink to="/suspensions" onClick={onClose}>Suspensions</NavLink>

      <div className="mobile-nav-search">
        <SearchOverlay />
      </div>
    </nav>
  );
}
