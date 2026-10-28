import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './responsive.css';
import { AuthGate, AuthProvider } from './auth.jsx';
import { AppProvider } from './context.jsx';
import './firebase.js';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <AuthGate>
          <AppProvider>
            <App />
          </AppProvider>
        </AuthGate>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
