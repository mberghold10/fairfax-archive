import React from 'react';
import { Link } from 'react-router-dom';
import '../styles/components.css';

/**
 * Error message display with optional retry button and "Go Home" link.
 *
 * Props:
 *   message - the error message to display
 *   onRetry - optional callback for "Try Again" button
 */
export default function ErrorMessage({ message, onRetry }) {
  return (
    <div className="error-container" role="alert">
      <p className="error-message">{message}</p>
      <div className="error-actions">
        {onRetry && (
          <button className="error-retry-btn" onClick={onRetry}>
            Try Again
          </button>
        )}
        <Link to="/" className="error-home-link">
          Go Home
        </Link>
      </div>
    </div>
  );
}
