import React from 'react';
import ReactDOM from 'react-dom/client';
import './utils/chartSetup';   // registers all Chart.js components once
import './index.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
