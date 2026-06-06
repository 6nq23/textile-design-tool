# Textile Design Tool

A browser-based application for automatically segmenting and colorizing clothing sketches using classical Computer Vision techniques. No AI/ML is used, and everything runs entirely locally in your browser.

## Features

- **No Server/Backend:** Runs 100% in the browser.
- **Classical Computer Vision:** Powered by OpenCV.js (WebAssembly) for fast edge detection and connected component analysis.
- **Adjustable Parameters:** Every part of the processing pipeline can be customized via UI sliders.
- **Edge Algorithms:** Supports Canny, Sobel, and Adaptive Thresholding.
- **Custom BMP Encoder:** Implements a pure-JavaScript `.bmp` exporter from scratch (supports 24-bit RGB and 32-bit RGBA).
- **Responsive UI:** Dark theme, drag-and-drop support, camera capture, and quick view toggles.

## How to Run

1. Simply open `index.html` in any modern web browser.
   - *Note:* Because it fetches OpenCV.js from a CDN via WebAssembly, you need an active internet connection on the first load. 
   - No build step or local server is strictly required, although opening via a local server (e.g. `npx serve .` or Live Server) is recommended for best performance and avoiding CORS issues with local file loading in some strict browsers.

## Workflow

1. **Upload / Capture:** Drop an image of a clothing sketch, click to browse, or use the Camera button to take a picture.
2. **Pre-processing:** The app scales the image down and converts it to grayscale. Adjust the blur and contrast settings on the left panel to reduce noise.
3. **Edge Detection:** Choose an algorithm (Canny is default). Tweak the thresholds until you get clean, closed boundaries (view the "Edges" tab to see). Use the Dilation and Morphological Close sliders to close small gaps.
4. **Segmentation:** The system identifies distinct regions (connected components). Check the "Segments" tab. If there are too many small noise regions, increase the "Min Region Size".
5. **Colorization:** Pick a color from the palette on the right, and click on any region on the canvas (in the "Colorized" tab) to fill it. Change the blend mode to "Multiply" if you want to retain shading/texture from the original sketch.
6. **Export:** Choose your color depth and click "Export BMP" to save the raw Bitmap file, or "Export PNG" for a smaller web-friendly format.

## File Structure

- `index.html` - The main application view and UI structure.
- `styles.css` - Custom CSS styling for the interface.
- `app.js` - UI logic, event handling, canvas rendering, and user interactions.
- `cv-pipeline.js` - Wrapper class around OpenCV.js functions. Handles preprocessing, edge detection, and connected components.
- `bmp-encoder.js` - A standalone, pure JS encoder that converts ImageData into a binary BMP file buffer.

## Browser Support

Works in all modern browsers (Chrome, Edge, Firefox, Safari) that support WebAssembly and HTML5 Canvas.
