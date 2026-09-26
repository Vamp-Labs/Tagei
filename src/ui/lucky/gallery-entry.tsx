import React from 'react';
import ReactDOM from 'react-dom/client';
import '../../index.css';
import { Gallery } from './Gallery';

const root = document.getElementById('root');
if (root) {
  document.documentElement.style.overflow = 'auto';
  document.body.style.overflow = 'auto';
  document.body.style.height = 'auto';
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <Gallery />
    </React.StrictMode>
  );
}
