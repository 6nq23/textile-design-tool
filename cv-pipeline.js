/**
 * cv-pipeline.js
 * Wraps OpenCV.js operations for Textile Design Tool
 */

class CVPipeline {
    constructor() {
        this.ready = false;
        // Wait for OpenCV.js to be ready
        if (typeof cv !== 'undefined' && cv.getBuildInformation) {
            this.ready = true;
        } else {
            window.Module = {
                onRuntimeInitialized: () => {
                    this.ready = true;
                    if (this.onReady) this.onReady();
                }
            };
        }
    }

    processImage(imageData, params) {
        if (!this.ready) throw new Error("OpenCV not ready yet.");

        let src = cv.matFromImageData(imageData);
        
        // 1. Preprocessing
        let preprocessed = this.applyPreprocessing(src, params);
        
        // 2. Edge Detection
        let edges = this.applyEdgeDetection(preprocessed, params);
        
        // 3. Segmentation
        let segmentation = this.applySegmentation(edges, params);
        
        // Cleanup
        src.delete();
        preprocessed.delete();
        edges.delete();
        
        return segmentation; // { regionMap (Array), regions (Array of Objects), edgeImgData (ImageData) }
    }

    applyPreprocessing(src, params) {
        let dst = new cv.Mat();
        
        // Grayscale conversion
        cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY, 0);
        
        // Contrast enhancement
        if (params.contrast) {
            try {
                cv.equalizeHist(dst, dst);
            } catch (e) {
                console.warn("EqualizeHist failed", e);
            }
        }
        
        // Noise reduction (Gaussian Blur)
        let blurRadius = parseInt(params.blurRadius);
        if (isNaN(blurRadius)) blurRadius = 2;
        if (blurRadius > 0) {
            let ksize = 2 * blurRadius + 1;
            cv.GaussianBlur(dst, dst, new cv.Size(ksize, ksize), 0, 0, cv.BORDER_DEFAULT);
        }
        
        // Sharpening
        if (params.sharpen) {
            let sharpened = new cv.Mat();
            cv.GaussianBlur(dst, sharpened, new cv.Size(0, 0), 3);
            cv.addWeighted(dst, 1.5, sharpened, -0.5, 0, dst);
            sharpened.delete();
        }
        
        return dst;
    }

    applyEdgeDetection(src, params) {
        let edges = new cv.Mat();
        
        let algo = params.edgeAlgorithm || 'canny';
        if (algo === 'canny') {
            let lowThresh = parseInt(params.cannyLow) || 50;
            let highThresh = parseInt(params.cannyHigh) || 150;
            cv.Canny(src, edges, lowThresh, highThresh, 3, false);
        } else if (algo === 'sobel') {
            let grad_x = new cv.Mat();
            let grad_y = new cv.Mat();
            let abs_grad_x = new cv.Mat();
            let abs_grad_y = new cv.Mat();
            
            cv.Sobel(src, grad_x, cv.CV_16S, 1, 0, 3, 1, 0, cv.BORDER_DEFAULT);
            cv.Sobel(src, grad_y, cv.CV_16S, 0, 1, 3, 1, 0, cv.BORDER_DEFAULT);
            
            cv.convertScaleAbs(grad_x, abs_grad_x, 1, 0);
            cv.convertScaleAbs(grad_y, abs_grad_y, 1, 0);
            
            cv.addWeighted(abs_grad_x, 0.5, abs_grad_y, 0.5, 0, edges);
            
            // Binarize
            cv.threshold(edges, edges, parseInt(params.cannyLow) || 50, 255, cv.THRESH_BINARY);
            
            grad_x.delete(); grad_y.delete(); abs_grad_x.delete(); abs_grad_y.delete();
        } else if (algo === 'adaptive') {
            let blockSize = parseInt(params.adaptiveBlockSize) || 11;
            if (blockSize % 2 === 0) blockSize += 1;
            let c = parseInt(params.adaptiveC) || 2;
            cv.adaptiveThreshold(src, edges, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, blockSize, c);
        }
        
        // Edge Dilation
        let dilateIters = parseInt(params.dilateIters);
        if (isNaN(dilateIters)) dilateIters = 1;
        if (dilateIters > 0) {
            let M = cv.Mat.ones(3, 3, cv.CV_8U);
            cv.dilate(edges, edges, M, new cv.Point(-1, -1), dilateIters, cv.BORDER_CONSTANT, cv.morphologyDefaultBorderValue());
            M.delete();
        }
        
        // Edge Closing (Morphological Close)
        let closeKernel = parseInt(params.closeKernelSize);
        if (isNaN(closeKernel)) closeKernel = 3;
        if (closeKernel > 0) {
            let size = closeKernel;
            if (size % 2 === 0) size += 1;
            let M = cv.Mat.ones(size, size, cv.CV_8U);
            cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, M);
            M.delete();
        }
        
        return edges;
    }

    applySegmentation(edges, params) {
        // 4a. Invert Edge Map (make edges black, fillable areas white)
        let inverted = new cv.Mat();
        cv.bitwise_not(edges, inverted);
        
        // 4b. Connected Components
        let labels = new cv.Mat();
        let stats = new cv.Mat();
        let centroids = new cv.Mat();
        let numComponents = cv.connectedComponentsWithStats(inverted, labels, stats, centroids, 4, cv.CV_32S);
        
        inverted.delete();
        
        // 4c. Filter Regions by Size
        let minRegionSize = parseInt(params.minRegionSize) || 500;
        let regions = [];
        
        let width = labels.cols;
        let height = labels.rows;
        
        // We will store mapping from original label to new sequential ID
        // 0 is always background/edges
        let labelMap = new Array(numComponents).fill(0);
        let currentId = 1;
        
        let statsData = stats.data32S;
        let centroidsData = centroids.data64F;
        let statsCols = stats.cols;

        for (let i = 1; i < numComponents; i++) { // Skip 0 (edges)
            let area = statsData[i * statsCols + 4]; // 4 = cv.CC_STAT_AREA
            if (area >= minRegionSize) {
                let left = statsData[i * statsCols + 0]; // 0 = cv.CC_STAT_LEFT
                let top = statsData[i * statsCols + 1]; // 1 = cv.CC_STAT_TOP
                let w = statsData[i * statsCols + 2]; // 2 = cv.CC_STAT_WIDTH
                let h = statsData[i * statsCols + 3]; // 3 = cv.CC_STAT_HEIGHT
                
                labelMap[i] = currentId;
                regions.push({
                    id: currentId,
                    originalLabel: i,
                    area: area,
                    boundingBox: { left, top, width: w, height: h },
                    centroid: { x: centroidsData[i * 2 + 0], y: centroidsData[i * 2 + 1] },
                    color: null,
                    label: `Region ${currentId}`,
                    // Visual color for the segmentation preview
                    previewColor: `hsl(${Math.random() * 360}, 70%, 60%)`
                });
                currentId++;
            }
        }
        
        // Build flat region map Uint16Array for quick lookup
        let regionMap = new Uint16Array(width * height);
        let labelsData = labels.data32S; // Int32Array
        
        for (let i = 0; i < labelsData.length; i++) {
            let label = labelsData[i];
            if (label > 0 && labelMap[label] > 0) {
                regionMap[i] = labelMap[label];
            } else {
                regionMap[i] = 0; // edge or too small (noise)
            }
        }
        
        labels.delete();
        stats.delete();
        centroids.delete();
        
        // Create an ImageData for the edge map so we can show it
        let edgeImgData = new ImageData(new Uint8ClampedArray(width * height * 4), width, height);
        let edgesData = edges.data;
        for (let i = 0; i < width * height; i++) {
            let val = edgesData[i];
            let idx = i * 4;
            edgeImgData.data[idx] = val;
            edgeImgData.data[idx+1] = val;
            edgeImgData.data[idx+2] = val;
            edgeImgData.data[idx+3] = 255;
        }

        return {
            regionMap,
            regions,
            edgeImgData,
            width,
            height
        };
    }
}
