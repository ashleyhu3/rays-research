import React from 'react';
import ReactDOM from 'react-dom/client';
import './utils/chartSetup';
import './index.css';
import { DataProvider } from './context/DataContext';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <DataProvider>
      <App />
    </DataProvider>
  </React.StrictMode>,
);
