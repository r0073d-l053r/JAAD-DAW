import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: '/JAAD-DAW/',
    plugins: [react(), tailwindcss()],
    // Strip noisy debug logging from production bundles (keeps console.warn /
    // console.error for real diagnostics). `pure` lets esbuild drop these calls
    // since their return value is always unused.
    esbuild: mode === 'production' ? { pure: ['console.log', 'console.debug', 'console.info'] } : {},
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
              // On-device stem separation (ADR-0010) is dynamic-imported. Let
              // Rollup split it naturally (return undefined) instead of naming
              // a manual chunk — named manual chunks get <link rel=modulepreload>
              // in index.html and putting them in 'vendor' loads them eagerly;
              // both would make every visitor download ~400KB they may never use.
              if (id.includes('onnxruntime-web') || id.includes('demucs-web')) return undefined;
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
