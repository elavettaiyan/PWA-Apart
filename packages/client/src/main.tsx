import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import App from './App';
import NavigationBridge from './components/routing/NavigationBridge';
import PushNotificationsBootstrap from './components/routing/PushNotificationsBootstrap';
import { shouldUseHashRouter } from './lib/platform';
import { queryClient } from './lib/queryClient';
import './lib/theme'; // apply saved accent color before first paint
import './index.css';

const Router = shouldUseHashRouter() ? HashRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Router>
      <QueryClientProvider client={queryClient}>
        <NavigationBridge />
        <PushNotificationsBootstrap />
        <App />
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 4000,
            style: { borderRadius: '12px', background: '#1f2937', color: '#f9fafb', fontSize: '14px' },
          }}
        />
      </QueryClientProvider>
    </Router>
  </React.StrictMode>,
);
