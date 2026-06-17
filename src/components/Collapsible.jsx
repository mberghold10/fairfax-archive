import React, { useState } from 'react';
import '../styles/collapsible.css';

/**
 * Collapsible section wrapper.
 * Children are hidden by default unless defaultOpen is true.
 */
export default function Collapsible({ title, defaultOpen = false, children, className = '' }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`collapsible ${open ? 'collapsible--open' : ''} ${className}`}>
      <button
        className="collapsible__toggle"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className="collapsible__title">{title}</span>
        <span className="collapsible__icon" aria-hidden="true">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="collapsible__body">{children}</div>}
    </div>
  );
}
