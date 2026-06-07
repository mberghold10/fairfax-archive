import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout.jsx';

const SeasonsPage = lazy(() => import('./pages/SeasonsPage'));
const DivisionPage = lazy(() => import('./pages/DivisionPage'));
const GamePage = lazy(() => import('./pages/GamePage'));
const PlayerPage = lazy(() => import('./pages/PlayerPage'));
const TeamPage = lazy(() => import('./pages/TeamPage'));
const HeadToHeadPage = lazy(() => import('./pages/HeadToHeadPage'));
const LeadersPage = lazy(() => import('./pages/LeadersPage'));
const SuspensionsPage = lazy(() => import('./pages/SuspensionsPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Suspense fallback={<div>Loading…</div>}>
          <Routes>
            <Route path="/" element={<SeasonsPage />} />
            <Route path="/seasons/:seasonSlug/divisions/:divId" element={<DivisionPage />} />
            <Route path="/games/:gameId" element={<GamePage />} />
            <Route path="/players/:playerId" element={<PlayerPage />} />
            <Route path="/teams/:teamId" element={<TeamPage />} />
            <Route path="/head-to-head" element={<HeadToHeadPage />} />
            <Route path="/head-to-head/:team1/:team2" element={<HeadToHeadPage />} />
            <Route path="/leaders" element={<LeadersPage />} />
            <Route path="/suspensions" element={<SuspensionsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </Layout>
    </BrowserRouter>
  );
}
