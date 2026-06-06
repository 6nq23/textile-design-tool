/**
 * bmp-encoder.js — Pure JS BMP encoder
 * Produces valid 24-bit or 32-bit BMP files compatible with
 * Windows Paint, GIMP, Photoshop, and all standard viewers.
 */
function encodeBMP(imageData, opts = {}) {
    const { width, height, data } = imageData;
    const bpp = opts.bpp === 32 ? 32 : 24;
    const bytesPerPx = bpp / 8;
    const bg = opts.bgColor || { r: 255, g: 255, b: 255 };

    // Row size must be padded to 4-byte boundary
    const rowBytes = Math.floor((width * bpp + 31) / 32) * 4;
    const pixelDataSize = rowBytes * height;
    const fileSize = 54 + pixelDataSize;

    const buf = new ArrayBuffer(fileSize);
    const v = new DataView(buf);

    // --- File Header (14 bytes) ---
    v.setUint8(0, 0x42);              // 'B'
    v.setUint8(1, 0x4D);              // 'M'
    v.setUint32(2, fileSize, true);   // file size
    v.setUint32(6, 0, true);          // reserved
    v.setUint32(10, 54, true);        // pixel data offset

    // --- DIB Header / BITMAPINFOHEADER (40 bytes) ---
    v.setUint32(14, 40, true);        // header size
    v.setInt32(18, width, true);      // width
    v.setInt32(22, height, true);     // height (positive = bottom-up, standard)
    v.setUint16(26, 1, true);         // color planes
    v.setUint16(28, bpp, true);       // bits per pixel
    v.setUint32(30, 0, true);         // compression = BI_RGB (none)
    v.setUint32(34, pixelDataSize, true); // image size
    v.setUint32(38, 2835, true);      // X pix/meter (~72 DPI)
    v.setUint32(42, 2835, true);      // Y pix/meter (~72 DPI)
    v.setUint32(46, 0, true);         // colors in table
    v.setUint32(50, 0, true);         // important colors

    // --- Pixel Data ---
    // BMP stores rows bottom-up, pixels in BGR(A) order
    let offset = 54;
    const rowPad = rowBytes - width * bytesPerPx;

    for (let y = height - 1; y >= 0; y--) {
        for (let x = 0; x < width; x++) {
            const src = (y * width + x) * 4;
            let r = data[src], g = data[src + 1], b = data[src + 2], a = data[src + 3];

            // Composite against background for 24-bit
            if (bpp === 24 && a < 255) {
                const f = a / 255;
                r = Math.round(r * f + bg.r * (1 - f));
                g = Math.round(g * f + bg.g * (1 - f));
                b = Math.round(b * f + bg.b * (1 - f));
            }

            v.setUint8(offset++, b); // BMP = BGR
            v.setUint8(offset++, g);
            v.setUint8(offset++, r);
            if (bpp === 32) v.setUint8(offset++, a);
        }
        // Row padding
        for (let p = 0; p < rowPad; p++) v.setUint8(offset++, 0);
    }

    return buf;
}
