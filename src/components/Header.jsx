import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useTheme } from '../utils/ThemeProvider.jsx';

export default function Header({ onMenuToggle, menuOpen }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link to="/" className="header-title">
          Fairfax Ice Arena Archive
        </Link>

        <nav className="header-nav" aria-label="Main navigation">
          <NavLink to="/" end>Seasons</NavLink>
          <NavLink to="/teams">Teams</NavLink>
          <NavLink to="/players">Players</NavLink>
          <NavLink to="/leaders">Leaders</NavLink>
          <NavLink to="/head-to-head">Matchups</NavLink>
          <NavLink to="/feedback">Feedback</NavLink>
        </nav>

        <div className="header-actions">
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >
            {theme === 'light' ? '🌙' : '☀️'}
          </button>

          <button
            className="mobile-nav-toggle"
            onClick={onMenuToggle}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
          >
            {menuOpen ? '✕' : '☰'}
          </button>
        </div>
      </div>
    </header>
  );
}
