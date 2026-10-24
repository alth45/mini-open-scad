import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        port: 5174,
        open: false
    },
    worker: {
        format: 'es'
    },
    resolve: {
        /* pastikan CSG & main app pakai instance THREE yang SAMA */
        dedupe: ['three', 'three-mesh-bvh'],
        alias: [
            /* dukung import 'three/addons/...' */
            { find: /^three\/addons\//, replacement: 'three/examples/jsm/' }
        ]
    },
    optimizeDeps: {
        include: ['three', 'three-mesh-bvh', 'three-bvh-csg']
    },
    build: {
        target: 'es2022',
        sourcemap: true
    }
});