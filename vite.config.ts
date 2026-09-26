import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Keep the web3 stack out of the entry chunk so the Market Track paints first.
        manualChunks: {
          web3: ['viem', 'wagmi', '@tanstack/react-query'],
          zod: ['zod'],
        },
      },
    },
  },
  server: {
    port: 3000,
    host: true,
    allowedHosts: true,
  },
});
