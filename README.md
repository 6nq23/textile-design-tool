# Textile Design Tool

# Advanced Textile Design Tool

A professional-grade, browser-based CAD (Computer-Aided Design) application built specifically for the textile, fashion, and weaving industry. 

This tool bridges the gap between messy, real-world inputs (hand-drawn sketches or smartphone photos of physical fabric) and the mathematically perfect, flat-color bitmaps required by industrial looms and software like NedGraphics.

![Textile Tool UI](ui-preview.jpg) *(Placeholder for UI screenshot)*

## 🚀 Features

### 1. Zero-Backend Architecture
Everything runs 100% locally on your machine. No data is sent to the cloud, ensuring absolute privacy for your designs. It utilizes **OpenCV.js** (WebAssembly compiled C++) to run heavy matrix math algorithms directly in the browser at near-native speeds.

### 2. Sketch Pre-processing & Segmentation (CV Tab)
Designed to convert hand-drawn pencil/ink sketches into closed vector-like regions.
* **Edge Detection:** Canny, Sobel, and Adaptive Threshold algorithms to find ink lines.
* **Morphological Closing:** Mathematically detects tiny breaks in hand-drawn lines and "bridges" them so color doesn't leak out during filling.
* **Watershed / Connected Components:** Calculates the topography of the sketch to identify distinct enclosed regions (e.g., separating a collar from a sleeve).

### 3. Fabric Photo Processing (Reduce Tab)
Designed to convert smartphone photos of physical fabric/embroidery into flat CAD files.
* **Illumination Correction:** Estimates shadows and folds, mathematically dividing them out for flat lighting.
* **Bilateral Filtering:** An edge-preserving blur. Smooths away the noisy weave/texture of the fabric while keeping the sharp edges of the embroidery threads intact.
* **K-Means Clustering:** Analyzes millions of pixel colors and forces every pixel into exactly *N* solid, flat colors.
* **Pixelation (Grid Snap):** Snaps fluid shapes into a strict block grid, simulating the warp and weft of woven threads.

### 4. GrabCut Extraction
Interactive foreground extraction using Gaussian Mixture Models. Draw a box around a garment and paint hints (foreground/background) to instantly cut clothing out of complex backgrounds (like mannequins or rooms).

### 5. Pixel & Region Editor
* **Live Updates:** Moving any slider waits 300ms and instantly recalculates the math pipeline.
* **Global Fast Fill:** Instantly maps the detected edges, background, and garment parts to exactly 3 distinct flat colors.
* **Region Paint:** Click any detected segment to instantly fill it with the active color.
* **OpenCV Flood Fill:** A lightning-fast, C++ backed bucket-fill tool for manual touch-ups.
* **Texture Mapping:** Upload a seamless pattern (like plaid) and mathematically mask it inside a specific garment segment, respecting scale and opacity.

### 6. Professional Export
* **.BMP (24-bit/32-bit):** Uncompressed, mathematically pure bitmaps. Required by industrial looms and CAD software.
* **.PNG:** For sharing on the web or with clients.
* **.SVG:** Converts mathematical contours into scalable Bezier curves for editing in Adobe Illustrator.

---

## 🛠️ Installation & Usage

Because WebAssembly requires strict security headers (`Cross-Origin-Opener-Policy`) to unlock multi-threading speeds, the tool must be served via a local web server.

1. **Install Dependencies:**
   Make sure you have [Node.js](https://nodejs.org/) installed, then run:
   ```bash
   npm install
   ```

2. **Start the Local Server:**
   ```bash
   npm start
   ```

3. **Open the Tool:**
   Open your browser and navigate to:
   `http://localhost:3000`

## ⌨️ Keyboard Shortcuts
* `Ctrl + Z`: Undo
* `Ctrl + Y`: Redo
* `Ctrl + B`: Toggle Sidebars (Full-screen canvas mode)
* `1, 2, 3, 4`: Switch Canvas Views (Original, Edges, Segments, Colorized)
* `Middle-Click / Space + Drag`: Pan Canvas
* `Mouse Wheel`: Zoom to Cursor

## File Structure

- `index.html` - The main application view and UI structure.
- `styles.css` - Custom CSS styling for the interface.
- `app.js` - UI logic, event handling, canvas rendering, and user interactions.
- `cv-pipeline.js` - Wrapper class around OpenCV.js functions. Handles preprocessing, edge detection, and connected components.
- `bmp-encoder.js` - A standalone, pure JS encoder that converts ImageData into a binary BMP file buffer.

## Browser Support

Works in all modern browsers (Chrome, Edge, Firefox, Safari) that support WebAssembly and HTML5 Canvas.
