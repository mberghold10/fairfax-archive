import React, { useState } from 'react';
import Header from './Header.jsx';
import MobileNav from './MobileNav.jsx';
import '../styles/layout.css';

export default function Layout({ children }) {
  const [menuOpen, setMenuOpen] = useState(false);

  function handleMenuToggle() {
    setMenuOpen((prev) => !prev);
  }

  function handleMenuClose() {
    setMenuOpen(false);
  }

  return (
    <div className="layout">
      <Header onMenuToggle={handleMenuToggle} menuOpen={menuOpen} />
      <MobileNav open={menuOpen} onClose={handleMenuClose} />
      <main className="layout-main">
        {children}
      </main>
    </div>
  );
}
