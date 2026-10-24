import { GIFEncoder, quantize, applyPalette } from 'gifenc';

/**
 * Encoder GIF streaming — panggil addFrame() per frame,
 * finish() di akhir untuk bytes.
 */
export function createGifEncoder() {
    const gif = GIFEncoder();
    return {
        addFrame(imageData, { delay = 50 } = {}) {
            const { data, width, height } = imageData;
            const palette = quantize(data, 256);
            const index = applyPalette(data, palette);
            gif.writeFrame(index, width, height, { palette, delay });
        },
        finish() {
            gif.finish();
            return gif.bytes();
        }
    };
}