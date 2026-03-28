import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import App from './App';
import NavigationBridge from './components/routing/NavigationBridge';
import PushNotificationsBootstrap from './components/routing/PushNotificationsBootstrap';
import { shouldUseHashRouter } from './lib/platform';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

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
