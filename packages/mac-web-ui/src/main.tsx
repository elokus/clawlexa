import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { DevPage } from './dev/DevPage';
import './styles/index.css';

// Simple path-based routing
function Router() {
  const path = window.location.pathname;

  if (path === '/dev' || path === '/dev/') {
    return <DevPage />;
  }

  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router />
  </StrictMode>
);
