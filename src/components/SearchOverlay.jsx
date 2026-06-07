import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { filterSearchIndex } from '../utils/searchFilter.mjs';
import '../styles/search-overlay.css';

// Module-level cache for the search index (shared across all instances)
let cachedIndex = null;
let indexLoadPromise = null;

/**
 * Load the search index asynchronously. Caches in module-level variable.
 * @returns {Promise<object|null>}
 */
function loadSearchIndex() {
  if (cachedIndex) return Promise.resolve(cachedIndex);
  if (indexLoadPromise) return indexLoadPromise;

  indexLoadPromise = fetch('/data/search-index.json')
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      cachedIndex = data;
      return data;
    })
    .catch(() => {
      indexLoadPromise = null;
      return null;
    });

  return indexLoadPromise;
}

export default function SearchOverlay() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [indexError, setIndexError] = useState(false);
  const [index, setIndex] = useState(cachedIndex);

  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const navigate = useNavigate();

  // Load search index asynchronously after mount
  useEffect(() => {
    loadSearchIndex().then((data) => {
      if (data) {
        setIndex(data);
      } else {
        setIndexError(true);
      }
    });
  }, []);

  // Filter results when query changes
  useEffect(() => {
    if (!index || !query.trim()) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    const filtered = filterSearchIndex(query, index);
    setResults(filtered);
    setShowDropdown(true);
    setActiveIndex(-1);
  }, [query, index]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const navigateToResult = useCallback(
    (result) => {
      const path = result.type === 'player'
        ? `/players/${result.id}`
        : `/teams/${result.id}`;
      setQuery('');
      setShowDropdown(false);
      navigate(path);
    },
    [navigate]
  );

  function handleKeyDown(e) {
    if (!showDropdown || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < results.length) {
        navigateToResult(results[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  }

  function handleChange(e) {
    setQuery(e.target.value);
  }

  function handleFocus() {
    if (query.trim() && results.length > 0) {
      setShowDropdown(true);
    }
  }

  return (
    <div className="search-overlay" ref={containerRef}>
      <input
        ref={inputRef}
        type="search"
        placeholder="Search players & teams…"
        aria-label="Search players and teams"
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        disabled={indexError}
        autoComplete="off"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls="search-results-list"
        aria-activedescendant={activeIndex >= 0 ? `search-result-${activeIndex}` : undefined}
      />
      {indexError && (
        <span className="search-overlay__error">Search unavailable</span>
      )}
      {showDropdown && (
        <ul
          id="search-results-list"
          className="search-overlay__dropdown"
          role="listbox"
        >
          {results.length === 0 && query.trim() && (
            <li className="search-overlay__no-results">No results found</li>
          )}
          {results.map((result, i) => (
            <li
              key={`${result.type}-${result.id}`}
              id={`search-result-${i}`}
              className={`search-overlay__item${i === activeIndex ? ' search-overlay__item--active' : ''}`}
              role="option"
              aria-selected={i === activeIndex}
              onClick={() => navigateToResult(result)}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span className="search-overlay__item-name">{result.name}</span>
              <span className="search-overlay__item-type">{result.type}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
