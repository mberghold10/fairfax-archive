import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from './utils/ThemeProvider.jsx';
import App from './App.jsx';
import './styles/global.css';

const root = createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
