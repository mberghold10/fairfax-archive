import React from 'react';
import '../styles/components.css';

/**
 * Centered loading spinner/message.
 */
export default function Loading() {
  return (
    <div className="loading-container" role="status" aria-live="polite">
      <div className="loading-spinner" aria-hidden="true"></div>
      <p className="loading-text">Loading...</p>
    </div>
  );
}
