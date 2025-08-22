import path from 'node:path';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

// https://vite.dev/config/
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            'bridge-sdk': path.resolve(__dirname, '../dist/index.mjs'),
        },
    },
    optimizeDeps: {
        exclude: ['bridge-sdk'],
    },
});
