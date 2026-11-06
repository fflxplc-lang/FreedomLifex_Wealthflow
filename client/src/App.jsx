import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { api, getToken } from './api.js';
import { AuthCtx } from './auth.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Imports from './pages/Imports.jsx';
import Clients from './pages/Clients.jsx';
import Reports from './pages/Reports.jsx';
import Rates from './pages/Rates.jsx';
import Partner from './pages/Partner.jsx';
import Payouts from './pages/Payouts.jsx';
import AuditLog from './pages/AuditLog.jsx';
import Settings from './pages/Settings.jsx';
import { Spinner } from './ui.jsx';

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(!getToken());

  useEffect(() => {
    if (!getToken()) return;
    api.get('/auth/me').then(setUser).catch(() => {}).finally(() => setReady(true));
  }, []);

  if (!ready) return <Spinner />;
  if (!user) return <AuthCtx.Provider value={{ user, setUser }}><Login /></AuthCtx.Provider>;
  const admin = user.role === 'admin';

  return (
    <AuthCtx.Provider value={{ user, setUser }}>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          {admin && <Route path="/imports" element={<Imports />} />}
          <Route path="/clients" element={<Clients />} />
          <Route path="/reports" element={<Reports />} />
          {admin && <Route path="/rates" element={<Rates />} />}
          <Route path="/partner" element={<Partner />} />
          <Route path="/payouts" element={<Payouts />} />
          {admin && <Route path="/audit" element={<AuditLog />} />}
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Layout>
    </AuthCtx.Provider>
  );
}
