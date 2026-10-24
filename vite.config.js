import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        port: 5174,
        open: false
    },
    preview: {
        port: 8000,
        open: false
    },
    worker: {
        format: 'es'
    },
    resolve: {
        dedupe: ['three', 'three-mesh-bvh'],
        alias: [
            { find: /^three\/addons\//, replacement: 'three/examples/jsm/' }
        ]
    },
    optimizeDeps: {
        include: ['three', 'three-mesh-bvh', 'three-bvh-csg', 'opentype.js']
    },
    define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        'process.env': '{}'
    },
    build: {
        target: 'es2022',
        sourcemap: true,
        chunkSizeWarningLimit: 900,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (!id.includes('node_modules')) return;
                    if (id.includes('three-bvh-csg') || id.includes('three-mesh-bvh')) return 'csg-vendor';
                    if (id.includes('/node_modules/three/')) return 'three-vendor';
                    if (id.includes('/node_modules/gifenc/')) return 'gif-vendor';
                    if (id.includes('/node_modules/opentype.js/')) return 'opentype-vendor';
                    return 'vendor';
                }
            }
        }
    }
});