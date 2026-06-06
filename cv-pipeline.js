/**
 * cv-pipeline.js
 * Wraps OpenCV.js operations for Textile Design Tool
 * Advanced Classical CV — No AI/ML
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

    /**
     * Main entry: runs full pipeline and returns segmentation data.
     */
    processImage(imageData, params) {
        if (!this.ready) throw new Error("OpenCV not ready yet.");

        let src = cv.matFromImageData(imageData);

        // 1. Preprocessing
        let preprocessed = this.applyPreprocessing(src, params);

        // 2. Edge Detection
        let edges = this.applyEdgeDetection(preprocessed, params);

        // 3. Segmentation (Connected Components or Watershed)
        let segMethod = params.segmentationMethod || 'connectedComponents';
        let segmentation;

        if (segMethod === 'watershed') {
            segmentation = this.applyWatershedSegmentation(src, edges, params);
        } else {
            segmentation = this.applySegmentation(edges, params);
        }

        // 4. Contour extraction & smoothing
        segmentation.contours = this.extractContours(edges, params);

        // Cleanup
        src.delete();
        preprocessed.delete();
        edges.delete();

        return segmentation;
    }

    // ─────────────────────────────────────────────────────────
    // PREPROCESSING
    // ─────────────────────────────────────────────────────────
    applyPreprocessing(src, params) {
        let dst = new cv.Mat();

        // Grayscale conversion
        cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY, 0);

        // Contrast enhancement (CLAHE-style via equalizeHist)
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

    // ─────────────────────────────────────────────────────────
    // EDGE DETECTION
    // ─────────────────────────────────────────────────────────
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

        // Remove Small Details (Despeckle)
        let despeckle = parseInt(params.despeckle);
        if (despeckle && despeckle > 0) {
            let contours = new cv.MatVector();
            let hierarchy = new cv.Mat();
            cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
            let eraseColor = new cv.Scalar(0);
            for (let i = 0; i < contours.size(); ++i) {
                let contour = contours.get(i);
                let arcLen = cv.arcLength(contour, false); // Length of the line/edge
                if (arcLen < despeckle) {
                    cv.drawContours(edges, contours, i, eraseColor, -1, cv.LINE_8, hierarchy, 0);
                    // Also draw with thickness to ensure it's fully erased
                    cv.drawContours(edges, contours, i, eraseColor, 2, cv.LINE_8, hierarchy, 0);
                }
                contour.delete();
            }
            contours.delete();
            hierarchy.delete();
        }

        // Geometric Lines (Hough Transform)
        if (params.hough) {
            let lines = new cv.Mat();
            let thresh = parseInt(params.houghThresh) || 50;
            let minLineLen = parseInt(params.houghMinLen) || 30;
            let maxGap = parseInt(params.houghMaxGap) || 10;
            
            // HoughLinesP(image, lines, rho, theta, threshold, minLineLength, maxLineGap)
            cv.HoughLinesP(edges, lines, 1, Math.PI / 180, thresh, minLineLen, maxGap);
            
            // Create a brand new blank edge map
            let geometricEdges = cv.Mat.zeros(edges.rows, edges.cols, cv.CV_8UC1);
            let color = new cv.Scalar(255);
            
            // Draw perfectly straight structural lines
            for (let i = 0; i < lines.rows; ++i) {
                let x1 = lines.data32S[i * 4];
                let y1 = lines.data32S[i * 4 + 1];
                let x2 = lines.data32S[i * 4 + 2];
                let y2 = lines.data32S[i * 4 + 3];
                cv.line(geometricEdges, new cv.Point(x1, y1), new cv.Point(x2, y2), color, 1, cv.LINE_8, 0);
            }
            
            lines.delete();
            edges.delete();
            edges = geometricEdges;
        }

        return edges;
    }

    // ─────────────────────────────────────────────────────────
    // SEGMENTATION — Connected Components (Original)
    // ─────────────────────────────────────────────────────────
    applySegmentation(edges, params) {
        let inverted = new cv.Mat();
        cv.bitwise_not(edges, inverted);

        let labels = new cv.Mat();
        let stats = new cv.Mat();
        let centroids = new cv.Mat();
        let numComponents = cv.connectedComponentsWithStats(inverted, labels, stats, centroids, 4, cv.CV_32S);

        inverted.delete();

        let minRegionSize = parseInt(params.minRegionSize) || 500;
        let regions = [];

        let width = labels.cols;
        let height = labels.rows;

        let labelMap = new Array(numComponents).fill(0);
        let currentId = 1;

        let statsData = stats.data32S;
        let centroidsData = centroids.data64F;
        let statsCols = stats.cols;

        for (let i = 1; i < numComponents; i++) {
            let area = statsData[i * statsCols + 4];
            if (area >= minRegionSize) {
                let left = statsData[i * statsCols + 0];
                let top = statsData[i * statsCols + 1];
                let w = statsData[i * statsCols + 2];
                let h = statsData[i * statsCols + 3];

                labelMap[i] = currentId;
                regions.push({
                    id: currentId,
                    originalLabel: i,
                    area: area,
                    boundingBox: { left, top, width: w, height: h },
                    centroid: { x: centroidsData[i * 2 + 0], y: centroidsData[i * 2 + 1] },
                    color: null,
                    label: `Region ${currentId}`,
                    previewColor: `hsl(${Math.random() * 360}, 70%, 60%)`
                });
                currentId++;
            }
        }

        let regionMap = new Uint16Array(width * height);
        let labelsData = labels.data32S;

        for (let i = 0; i < labelsData.length; i++) {
            let label = labelsData[i];
            if (label > 0 && labelMap[label] > 0) {
                regionMap[i] = labelMap[label];
            } else {
                regionMap[i] = 0;
            }
        }

        labels.delete();
        stats.delete();
        centroids.delete();

        // Create an ImageData for the edge map
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

    // ─────────────────────────────────────────────────────────
    // SEGMENTATION — Watershed (Advanced)
    // ─────────────────────────────────────────────────────────
    applyWatershedSegmentation(srcRGBA, edges, params) {
        let width = edges.cols;
        let height = edges.rows;
        let minRegionSize = parseInt(params.minRegionSize) || 500;

        // 1. Invert edges to get foreground
        let inverted = new cv.Mat();
        cv.bitwise_not(edges, inverted);

        // 2. Distance Transform — gives "sure foreground" markers
        let dist = new cv.Mat();
        cv.distanceTransform(inverted, dist, cv.DIST_L2, 5);

        // 3. Normalize and threshold to find sure foreground
        let sureFg = new cv.Mat();
        cv.normalize(dist, dist, 0, 1, cv.NORM_MINMAX);
        let distThreshold = parseFloat(params.watershedThreshold) || 0.4;
        cv.threshold(dist, sureFg, distThreshold, 255, cv.THRESH_BINARY);
        sureFg.convertTo(sureFg, cv.CV_8U);

        // 4. Sure background via dilation
        let sureBg = new cv.Mat();
        let kernel = cv.Mat.ones(3, 3, cv.CV_8U);
        cv.dilate(inverted, sureBg, kernel, new cv.Point(-1, -1), 3);

        // 5. Unknown region = sureBg - sureFg
        let unknown = new cv.Mat();
        cv.subtract(sureBg, sureFg, unknown);

        // 6. Label markers using connected components on sure foreground
        let markers = new cv.Mat();
        let markerStats = new cv.Mat();
        let markerCentroids = new cv.Mat();
        let numMarkers = cv.connectedComponentsWithStats(sureFg, markers, markerStats, markerCentroids, 4, cv.CV_32S);

        // 7. Add 1 to all labels so background is 1 instead of 0
        let ones = cv.Mat.ones(markers.rows, markers.cols, markers.type());
        cv.add(markers, ones, markers);
        ones.delete();

        // 8. Mark unknown region as 0 (to be determined by watershed)
        let unknownData = unknown.data;
        let markerData = markers.data32S;
        for (let i = 0; i < unknownData.length; i++) {
            if (unknownData[i] === 255) {
                markerData[i] = 0;
            }
        }

        // 9. Run Watershed on the original color image
        let src3 = new cv.Mat();
        cv.cvtColor(srcRGBA, src3, cv.COLOR_RGBA2RGB);
        cv.watershed(src3, markers);
        src3.delete();

        // 10. Build region data from watershed markers
        // Watershed labels: -1 = boundary, 1 = background, 2+ = regions
        let markerResult = markers.data32S;
        let regionAreas = {};
        let regionBounds = {};

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                let idx = y * width + x;
                let label = markerResult[idx];
                if (label > 1) { // skip background (1) and boundary (-1)
                    if (!regionAreas[label]) {
                        regionAreas[label] = 0;
                        regionBounds[label] = { minX: x, minY: y, maxX: x, maxY: y, sumX: 0, sumY: 0 };
                    }
                    regionAreas[label]++;
                    let b = regionBounds[label];
                    b.minX = Math.min(b.minX, x);
                    b.minY = Math.min(b.minY, y);
                    b.maxX = Math.max(b.maxX, x);
                    b.maxY = Math.max(b.maxY, y);
                    b.sumX += x;
                    b.sumY += y;
                }
            }
        }

        // 11. Filter by minRegionSize and re-label sequentially
        let regions = [];
        let labelRemap = {};
        let currentId = 1;

        for (let label of Object.keys(regionAreas).map(Number).sort((a, b) => a - b)) {
            let area = regionAreas[label];
            if (area >= minRegionSize) {
                let b = regionBounds[label];
                labelRemap[label] = currentId;
                regions.push({
                    id: currentId,
                    originalLabel: label,
                    area: area,
                    boundingBox: { left: b.minX, top: b.minY, width: b.maxX - b.minX + 1, height: b.maxY - b.minY + 1 },
                    centroid: { x: b.sumX / area, y: b.sumY / area },
                    color: null,
                    label: `Region ${currentId}`,
                    previewColor: `hsl(${Math.random() * 360}, 70%, 60%)`
                });
                currentId++;
            }
        }

        // 12. Build flat region map
        let regionMap = new Uint16Array(width * height);
        for (let i = 0; i < markerResult.length; i++) {
            let label = markerResult[i];
            if (label > 1 && labelRemap[label]) {
                regionMap[i] = labelRemap[label];
            }
        }

        // Edge image data
        let edgeImgData = new ImageData(new Uint8ClampedArray(width * height * 4), width, height);
        // Watershed boundaries (-1) shown as white edges
        for (let i = 0; i < width * height; i++) {
            let idx = i * 4;
            if (markerResult[i] === -1) {
                edgeImgData.data[idx] = 255;
                edgeImgData.data[idx + 1] = 255;
                edgeImgData.data[idx + 2] = 255;
            }
            edgeImgData.data[idx + 3] = 255;
        }

        // Cleanup
        inverted.delete(); dist.delete(); sureFg.delete();
        sureBg.delete(); kernel.delete(); unknown.delete();
        markers.delete(); markerStats.delete(); markerCentroids.delete();

        return { regionMap, regions, edgeImgData, width, height };
    }

    // ─────────────────────────────────────────────────────────
    // GRABCUT — Interactive Foreground Extraction
    // ─────────────────────────────────────────────────────────
    runGrabCut(imageData, rect, maskData, mode) {
        if (!this.ready) throw new Error("OpenCV not ready yet.");

        let src = cv.matFromImageData(imageData);
        let src3 = new cv.Mat();
        cv.cvtColor(src, src3, cv.COLOR_RGBA2RGB);

        let mask = new cv.Mat(src3.rows, src3.cols, cv.CV_8UC1, new cv.Scalar(cv.GC_BGD));
        let bgdModel = new cv.Mat();
        let fgdModel = new cv.Mat();

        if (mode === 'rect') {
            // Init with rectangle
            let cvRect = new cv.Rect(rect.x, rect.y, rect.width, rect.height);
            cv.grabCut(src3, mask, cvRect, bgdModel, fgdModel, 5, cv.GC_INIT_WITH_RECT);
        } else if (mode === 'mask' && maskData) {
            // Refine with user-painted mask
            // maskData is a Uint8Array of same dimensions with values:
            // 0 = definitely background, 1 = definitely foreground, 2 = probable bg, 3 = probable fg
            let userMask = cv.matFromArray(src3.rows, src3.cols, cv.CV_8UC1, maskData);
            cv.grabCut(src3, userMask, new cv.Rect(), bgdModel, fgdModel, 3, cv.GC_INIT_WITH_MASK);
            mask.delete();
            mask = userMask;
        }

        // Create binary mask: foreground = 255
        let result = new cv.Mat();
        let fgMask = new cv.Mat();

        // Foreground where mask is GC_FGD (1) or GC_PR_FGD (3)
        for (let i = 0; i < mask.data.length; i++) {
            mask.data[i] = (mask.data[i] === cv.GC_FGD || mask.data[i] === cv.GC_PR_FGD) ? 255 : 0;
        }

        // Apply mask to original
        cv.bitwise_and(src3, src3, result, mask);

        // Convert result to ImageData
        let rgba = new cv.Mat();
        cv.cvtColor(result, rgba, cv.COLOR_RGB2RGBA);
        let outputData = new ImageData(new Uint8ClampedArray(rgba.data), src3.cols, src3.rows);

        // Return mask data for further processing
        let maskOutput = new Uint8Array(mask.data);

        src.delete(); src3.delete(); mask.delete();
        bgdModel.delete(); fgdModel.delete();
        result.delete(); rgba.delete();

        return { imageData: outputData, mask: maskOutput };
    }

    // ─────────────────────────────────────────────────────────
    // CONTOUR DETECTION & SMOOTHING
    // ─────────────────────────────────────────────────────────
    extractContours(edges, params) {
        let epsilon = parseFloat(params.contourSmoothing) || 2.0;

        let contours = new cv.MatVector();
        let hierarchy = new cv.Mat();
        cv.findContours(edges, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);

        let result = [];
        for (let i = 0; i < contours.size(); i++) {
            let contour = contours.get(i);
            let area = cv.contourArea(contour);

            // Skip tiny noise contours
            if (area < 20) {
                contour.delete();
                continue;
            }

            // Smooth contour with approxPolyDP
            let smoothed = new cv.Mat();
            cv.approxPolyDP(contour, smoothed, epsilon, true);

            // Extract points
            let points = [];
            for (let j = 0; j < smoothed.rows; j++) {
                points.push({
                    x: smoothed.data32S[j * 2],
                    y: smoothed.data32S[j * 2 + 1]
                });
            }

            // Get hierarchy info: [next, prev, firstChild, parent]
            let hIdx = i * 4;
            let parentIdx = hierarchy.data32S[hIdx + 3];

            result.push({
                points: points,
                area: area,
                isHole: parentIdx >= 0,
                parentIndex: parentIdx,
                originalIndex: i
            });

            smoothed.delete();
            contour.delete();
        }

        contours.delete();
        hierarchy.delete();

        return result;
    }


    // ─────────────────────────────────────────────────────────
    // OPENCV-NATIVE FLOOD FILL
    // ─────────────────────────────────────────────────────────
    nativeFloodFill(imageData, seedX, seedY, fillColor, tolerance) {
        let src = cv.matFromImageData(imageData);

        // floodFill needs a mask 2px larger than source
        let mask = new cv.Mat.zeros(src.rows + 2, src.cols + 2, cv.CV_8UC1);

        let seedPoint = new cv.Point(seedX, seedY);
        let newVal = new cv.Scalar(fillColor.r, fillColor.g, fillColor.b, 255);
        let loDiff = new cv.Scalar(tolerance, tolerance, tolerance, 0);
        let upDiff = new cv.Scalar(tolerance, tolerance, tolerance, 0);

        // 4-connectivity, fill with the new value
        cv.floodFill(src, mask, seedPoint, newVal, null, loDiff, upDiff, 4);

        // Convert back to ImageData
        let outputData = new ImageData(new Uint8ClampedArray(src.data), src.cols, src.rows);

        mask.delete();
        src.delete();

        return outputData;
    }

    // ─────────────────────────────────────────────────────────
    // BILATERAL FILTER — Removes fabric texture, preserves edges
    // ─────────────────────────────────────────────────────────
    applyBilateralFilter(imageData, diameter, sigmaColor, sigmaSpace) {
        if (!this.ready) throw new Error("OpenCV not ready yet.");

        let src = cv.matFromImageData(imageData);
        let src3 = new cv.Mat();
        cv.cvtColor(src, src3, cv.COLOR_RGBA2RGB);

        let dst = new cv.Mat();
        // bilateralFilter(src, dst, d, sigmaColor, sigmaSpace)
        // d = diameter of pixel neighborhood. -1 = auto from sigmaSpace
        cv.bilateralFilter(src3, dst, diameter, sigmaColor, sigmaSpace, cv.BORDER_DEFAULT);

        let rgba = new cv.Mat();
        cv.cvtColor(dst, rgba, cv.COLOR_RGB2RGBA);
        let outputData = new ImageData(new Uint8ClampedArray(rgba.data), rgba.cols, rgba.rows);

        src.delete(); src3.delete(); dst.delete(); rgba.delete();
        return outputData;
    }

    // ─────────────────────────────────────────────────────────
    // ILLUMINATION CORRECTION — Removes shadows and uneven lighting
    // ─────────────────────────────────────────────────────────
    correctIllumination(imageData, kernelSize) {
        if (!this.ready) throw new Error("OpenCV not ready yet.");

        let src = cv.matFromImageData(imageData);
        let gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

        // Method: Division-based background estimation
        // 1. Heavily blur to estimate background illumination
        let ksize = kernelSize;
        if (ksize % 2 === 0) ksize += 1;
        let bg = new cv.Mat();
        cv.GaussianBlur(gray, bg, new cv.Size(ksize, ksize), 0);

        // 2. Divide original by background: result = (gray * 255) / bg
        //    This normalizes out the uneven lighting
        let result = new cv.Mat(gray.rows, gray.cols, cv.CV_8UC1);
        let grayData = gray.data;
        let bgData = bg.data;
        let resData = result.data;

        for (let i = 0; i < grayData.length; i++) {
            let val = bgData[i] === 0 ? 255 : Math.round((grayData[i] / bgData[i]) * 255);
            resData[i] = Math.min(255, Math.max(0, val));
        }

        // Convert back to RGBA
        let rgba = new cv.Mat();
        cv.cvtColor(result, rgba, cv.COLOR_GRAY2RGBA);
        let outputData = new ImageData(new Uint8ClampedArray(rgba.data), rgba.cols, rgba.rows);

        src.delete(); gray.delete(); bg.delete(); result.delete(); rgba.delete();
        return outputData;
    }

    // ─────────────────────────────────────────────────────────
    // K-MEANS COLOR REDUCTION — Reduces image to N flat colors
    // ─────────────────────────────────────────────────────────
    kmeansColorReduce(imageData, numColors, iterations) {
        if (!this.ready) throw new Error("OpenCV not ready yet.");

        let src = cv.matFromImageData(imageData);
        let src3 = new cv.Mat();
        cv.cvtColor(src, src3, cv.COLOR_RGBA2RGB);

        // Reshape to Nx3 float32 for kmeans
        let samples = new cv.Mat(src3.rows * src3.cols, 3, cv.CV_32F);
        let srcData = src3.data;
        let samplesData = samples.data32F;

        for (let i = 0; i < src3.rows * src3.cols; i++) {
            samplesData[i * 3] = srcData[i * 3];       // R
            samplesData[i * 3 + 1] = srcData[i * 3 + 1]; // G
            samplesData[i * 3 + 2] = srcData[i * 3 + 2]; // B
        }

        // Run K-Means
        let labels = new cv.Mat();
        let centers = new cv.Mat();
        let criteria = new cv.TermCriteria(cv.TermCriteria_EPS + cv.TermCriteria_MAX_ITER, iterations, 0.5);
        cv.kmeans(samples, numColors, labels, criteria, 3, cv.KMEANS_PP_CENTERS, centers);

        // Reconstruct image from cluster centers
        let labelsData = labels.data32S;
        let centersData = centers.data32F;

        let outputRGBA = new Uint8ClampedArray(src.rows * src.cols * 4);
        let palette = []; // Store the palette for display

        for (let c = 0; c < numColors; c++) {
            palette.push({
                r: Math.round(centersData[c * 3]),
                g: Math.round(centersData[c * 3 + 1]),
                b: Math.round(centersData[c * 3 + 2])
            });
        }

        for (let i = 0; i < labelsData.length; i++) {
            let cluster = labelsData[i];
            let color = palette[cluster];
            outputRGBA[i * 4] = color.r;
            outputRGBA[i * 4 + 1] = color.g;
            outputRGBA[i * 4 + 2] = color.b;
            outputRGBA[i * 4 + 3] = 255;
        }

        let outputData = new ImageData(outputRGBA, src.cols, src.rows);

        src.delete(); src3.delete(); samples.delete();
        labels.delete(); centers.delete();

        return { imageData: outputData, palette: palette };
    }

    // ─────────────────────────────────────────────────────────
    // PIXELATION — Snap design to a grid (for weaving/knitting)
    // ─────────────────────────────────────────────────────────
    pixelate(imageData, pixelSize) {
        if (!this.ready) throw new Error("OpenCV not ready yet.");

        let src = cv.matFromImageData(imageData);
        let small = new cv.Mat();
        let dst = new cv.Mat();

        let newW = Math.max(1, Math.round(src.cols / pixelSize));
        let newH = Math.max(1, Math.round(src.rows / pixelSize));

        // Downscale with INTER_AREA (best for decimation)
        cv.resize(src, small, new cv.Size(newW, newH), 0, 0, cv.INTER_AREA);

        // Upscale back with INTER_NEAREST (blocky/pixelated)
        cv.resize(small, dst, new cv.Size(src.cols, src.rows), 0, 0, cv.INTER_NEAREST);

        let outputData = new ImageData(new Uint8ClampedArray(dst.data), dst.cols, dst.rows);

        src.delete(); small.delete(); dst.delete();
        return outputData;
    }
}

