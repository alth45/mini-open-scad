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
        include: ['three', 'three-mesh-bvh', 'three-bvh-csg']
    },
    build: {
        target: 'es2022',
        sourcemap: true,

        /* three.js minified ~600kB, wajar; naikkan batas ke 900kB */
        chunkSizeWarningLimit: 900,

        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (!id.includes('node_modules')) return;

                    /* CSG engine + dep mesh-bvh → chunk sendiri */
                    if (id.includes('three-bvh-csg') || id.includes('three-mesh-bvh')) {
                        return 'csg-vendor';
                    }
                    /* three core + addons (orbit controls, STL loader, dll) */
                    if (id.includes('/node_modules/three/')) {
                        return 'three-vendor';
                    }
                    /* GIF encoder */
                    if (id.includes('/node_modules/gifenc/')) {
                        return 'gif-vendor';
                    }
                    /* sisanya */
                    return 'vendor';
                }
            }
        }
    }
});