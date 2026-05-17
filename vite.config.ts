import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: '/JAAD/',
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        // Suppress essentia.js Node-specific module warnings in browser build
        'path': 'path-browserify',
        'fs': 'path-browserify',
        'crypto': 'path-browserify',
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      }
    },
    build: {
      target: 'esnext',
      chunkSizeWarningLimit: 3000,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('motion') || id.includes('framer-motion')) return 'motion';
              if (id.includes('lucide-react')) return 'lucide';
              if (id.includes('@google/genai')) return 'genai';
              if (id.includes('firebase')) return 'firebase';
              if (id.includes('essentia.js')) return 'essentia';
              return 'vendor';
            }
          }
        }
      },
      commonjsOptions: {
        transformMixedEsModules: true
      }
    },
    optimizeDeps: {
      exclude: ['essentia.js']
    }
  };
});
