import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { Web3Providers } from './web3/providers';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Tagei: #root element is missing from index.html');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <Web3Providers>
      <App />
    </Web3Providers>
  </React.StrictMode>
);
