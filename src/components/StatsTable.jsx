import React, { useState, useMemo } from 'react';
import '../styles/components.css';

/**
 * Reusable sortable table for standings, rosters, and stats.
 *
 * Props:
 *   columns - array of { key, label, sortable? }
 *   data - array of row objects
 *   defaultSort - column key to sort by initially
 *   defaultDirection - 'asc' | 'desc'
 */
export default function StatsTable({ columns, data, defaultSort, defaultDirection = 'desc' }) {
  const [sortKey, setSortKey] = useState(defaultSort !== null ? (defaultSort || (columns[0] && columns[0].key)) : null);
  const [sortDirection, setSortDirection] = useState(defaultDirection);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDirection('desc');
    }
  };

  const sortedData = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];

      // Handle nulls/undefined
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      // Numeric comparison
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }

      // String comparison
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      if (sortDirection === 'asc') {
        return aStr.localeCompare(bStr);
      }
      return bStr.localeCompare(aStr);
    });
  }, [data, sortKey, sortDirection]);

  return (
    <div className="stats-table-wrapper">
      <table className="stats-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={col.sortable !== false ? 'sortable' : ''}
                onClick={col.sortable !== false ? () => handleSort(col.key) : undefined}
                aria-sort={
                  sortKey === col.key
                    ? sortDirection === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : undefined
                }
              >
                <span className="stats-table-header-content">
                  {col.label}
                  {col.sortable !== false && sortKey === col.key && (
                    <span className="sort-indicator" aria-hidden="true">
                      {sortDirection === 'asc' ? ' ▲' : ' ▼'}
                    </span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedData.map((row, rowIndex) => (
            <tr key={row.id || row.key || rowIndex}>
              {columns.map((col) => {
                const cellClass = typeof col.cellClass === 'function'
                  ? col.cellClass(row[col.key], row)
                  : col.cellClass;
                return (
                  <td key={col.key} className={cellClass || undefined}>
                    {col.render ? col.render(row[col.key], row) : row[col.key]}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
