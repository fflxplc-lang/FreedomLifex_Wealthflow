import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { ToastProvider } from './ui.jsx';
import './index.css';

try { document.documentElement.dataset.theme = localStorage.getItem('wf_theme') || 'light'; } catch { /* storage blocked */ }

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <ToastProvider><App /></ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
