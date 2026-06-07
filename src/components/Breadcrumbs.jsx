import React from 'react';
import { Link } from 'react-router-dom';
import '../styles/breadcrumbs.css';

/**
 * Breadcrumbs component for contextual navigation.
 *
 * @param {{ crumbs: Array<{ label: string, to?: string }> }} props
 *   - crumbs: ordered array of breadcrumb items. The last item typically
 *     has no `to` property (represents the current page).
 */
export default function Breadcrumbs({ crumbs }) {
  if (!crumbs || crumbs.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="breadcrumbs">
      <ol className="breadcrumbs__list">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;

          return (
            <li key={index} className="breadcrumbs__item">
              {!isLast && crumb.to ? (
                <Link to={crumb.to} className="breadcrumbs__link">
                  {crumb.label}
                </Link>
              ) : (
                <span className="breadcrumbs__current" aria-current={isLast ? 'page' : undefined}>
                  {crumb.label}
                </span>
              )}
              {!isLast && (
                <span className="breadcrumbs__separator" aria-hidden="true">/</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
