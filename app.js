document.addEventListener("DOMContentLoaded",()=>{
const pipeline=new CVPipeline();
let imgData=null,origImage=new Image(),segData=null,activeColor="#ef4444";
let zoom=1,panX=0,panY=0,isPanning=false,lastPan={x:0,y:0};
let activeTool="pencil",brushSize=1,fillTolerance=15;
let undoStack=[],redoStack=[];
let isDrawing=false;
let patternImage=null;
let selectedRegionId=null;

// GrabCut state
let gcMode='rect'; // 'rect','fg','bg'
let gcRect=null,gcMask=null,gcBrushSize=8;
let gcIsDrawing=false,gcStartX=0,gcStartY=0;
let gcExtractedImageData=null;

// Tab switching
window.switchTab=function(tab){
  document.getElementById('cvControls').style.display=tab==='cv'?'flex':'none';
  document.getElementById('grabcutControls').style.display=tab==='grabcut'?'flex':'none';
  document.getElementById('reduceControls').style.display=tab==='reduce'?'flex':'none';
  document.getElementById('pixelControls').style.display=tab==='pixel'?'flex':'none';
  document.getElementById('tabCV').classList.toggle('active',tab==='cv');
  document.getElementById('tabGrabCut').classList.toggle('active',tab==='grabcut');
  document.getElementById('tabReduce').classList.toggle('active',tab==='reduce');
  document.getElementById('tabPixel').classList.toggle('active',tab==='pixel');

  // Show/hide grabcut canvas
  const gcCanvas=document.getElementById('grabcutCanvas');
  if(tab==='grabcut'&&imgData){
    gcCanvas.classList.remove('hidden');
    gcCanvas.width=imgData.width;gcCanvas.height=imgData.height;
    gcCanvas.style.width=ui.mainCanvas.style.width;
    gcCanvas.style.height=ui.mainCanvas.style.height;
  } else {
    gcCanvas.classList.add('hidden');
  }
};

const ui={
  overlay:document.getElementById('loadingOverlay'),
  uploadOverlay:document.getElementById('uploadOverlay'),
  dropZone:document.getElementById('dropZone'),
  fileInput:document.getElementById('fileInput'),
  btnBrowse:document.getElementById('btnBrowse'),
  btnCamera:document.getElementById('btnCamera'),
  cameraVideo:document.getElementById('cameraVideo'),
  cameraControls:document.getElementById('cameraControls'),
  btnCapture:document.getElementById('btnCapture'),
  btnCancelCamera:document.getElementById('btnCancelCamera'),
  mainCanvas:document.getElementById('mainCanvas'),
  edgeCanvas:document.getElementById('edgeCanvas'),
  segmentCanvas:document.getElementById('segmentCanvas'),
  previewCanvas:document.getElementById('previewCanvas'),
  reducedCanvas:document.getElementById('reducedCanvas'),
  gridCanvas:document.getElementById('gridCanvas'),
  grabcutCanvas:document.getElementById('grabcutCanvas'),
  canvasWrapper:document.getElementById('canvasWrapper'),
  canvasContainer:document.getElementById('canvasContainer'),
  btnProcess:document.getElementById('btnProcess'),
  viewToggles:document.getElementById('viewToggles'),
  regionList:document.getElementById('regionList'),
  regionCount:document.getElementById('regionCount'),
  activeColorPicker:document.getElementById('activeColorPicker'),
  colorSwatches:document.getElementById('colorSwatches'),
  toast:document.getElementById('toast'),
  btnExportBMP:document.getElementById('btnExportBMP'),
  btnExportPNG:document.getElementById('btnExportPNG'),
  btnExportSVG:document.getElementById('btnExportSVG'),
  exportBpp:document.getElementById('exportBpp'),
  paramBlendMode:document.getElementById('paramBlendMode'),
  paramEdgeAlgo:document.getElementById('paramEdgeAlgo'),
  paramSegMethod:document.getElementById('paramSegMethod'),
  pixelCoords:document.getElementById('pixelCoords'),
  paramZoom:document.getElementById('paramZoom'),
  valZoom:document.getElementById('valZoom'),
  paramBrushSize:document.getElementById('paramBrushSize'),
  valBrushSize:document.getElementById('valBrushSize'),
  paramFillTolerance:document.getElementById('paramFillTolerance'),
  valFillTolerance:document.getElementById('valFillTolerance'),
  btnUndo:document.getElementById('btnUndo'),
  btnRedo:document.getElementById('btnRedo'),
  btnReset:document.getElementById('btnReset'),
  patternFileInput:document.getElementById('patternFileInput'),
  btnUploadPattern:document.getElementById('btnUploadPattern'),
  patternPreview:document.getElementById('patternPreview'),
  paramPatternScale:document.getElementById('paramPatternScale'),
  paramPatternOpacity:document.getElementById('paramPatternOpacity'),
  btnApplyPattern:document.getElementById('btnApplyPattern'),
  btnClearPattern:document.getElementById('btnClearPattern'),
  btnRunReduce:document.getElementById('btnRunReduce'),
  reducedPalette:document.getElementById('reducedPalette'),
  btnFillAll:document.getElementById('btnFillAll'),
  btnApplyGlobalColors:document.getElementById('btnApplyGlobalColors'),
  globalEdgeColor:document.getElementById('globalEdgeColor'),
  globalBgColor:document.getElementById('globalBgColor'),
  globalFillColor:document.getElementById('globalFillColor'),
};

// OpenCV readiness
const chk=setInterval(()=>{if(pipeline.ready){clearInterval(chk);ui.overlay.style.display='none';}},100);
pipeline.onReady=()=>ui.overlay.style.display='none';

// Toast
function toast(msg,err=false){
  ui.toast.textContent=msg;
  ui.toast.className='toast show'+(err?' error':'');
  setTimeout(()=>ui.toast.className='toast',3000);
}

// Hex to rgb
function hex2rgb(h){return{r:parseInt(h.slice(1,3),16),g:parseInt(h.slice(3,5),16),b:parseInt(h.slice(5,7),16)};}

// Preset swatches — curated textile design palette
['#ffffff','#000000','#ef4444','#f97316','#f59e0b','#84cc16','#10b981','#06b6d4','#3b82f6','#6366f1','#8b5cf6','#d946ef','#f43f5e','#57534e','#78716c','#be185d','#1e3a8a','#14532d','#7c2d12','#fbbf24','#a3e635','#2dd4bf','#38bdf8','#c4b5fd','#fda4af','#d4d4d8'].forEach(c=>{
  const s=document.createElement('div');
  s.className='swatch';s.style.backgroundColor=c;
  s.onclick=()=>{ui.activeColorPicker.value=c;activeColor=c;};
  ui.colorSwatches.appendChild(s);
});

ui.activeColorPicker.oninput=e=>activeColor=e.target.value;

// Debounce helpers for live updates
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}
const liveRunPipeline = debounce(() => { if (imgData) runPipeline(false); }, 300);
const liveRunReduce = debounce(() => { if (imgData) ui.btnRunReduce.click(); }, 300);

// Sliders
document.querySelectorAll('input[type="range"]').forEach(sl=>{
  sl.addEventListener('input',e=>{
    const v=document.getElementById('val'+e.target.id.replace('param',''));
    if(v)v.textContent=e.target.value;
    // Live update
    if(e.target.closest('#cvControls')) liveRunPipeline();
    if(e.target.closest('#reduceControls')) liveRunReduce();
  });
});

// Checkboxes and selects for live update
['paramContrast','paramSharpen','paramEdgeAlgo','paramSegMethod','paramHough'].forEach(id=>{
  const el = document.getElementById(id);
  if(el) el.addEventListener('change', liveRunPipeline);
});
['paramFixLighting','paramBilateral','paramPixelate'].forEach(id=>{
  const el = document.getElementById(id);
  if(el) el.addEventListener('change', liveRunReduce);
});

// Algo toggle
ui.paramEdgeAlgo.addEventListener('change', e=>{
  document.getElementById('cannyControls').style.display=e.target.value==='canny'?'block':'none';
  document.getElementById('adaptiveControls').style.display=e.target.value==='adaptive'?'block':'none';
});

// Hough toggle
document.getElementById('paramHough').addEventListener('change', e=>{
  document.getElementById('houghControls').style.display=e.target.checked?'block':'none';
});

// Segmentation method toggle
ui.paramSegMethod.addEventListener('change', e=>{
  document.getElementById('watershedControls').style.display=e.target.value==='watershed'?'block':'none';
});

// Brush/fill/zoom sliders
ui.paramBrushSize.oninput=e=>{brushSize=+e.target.value;ui.valBrushSize.textContent=brushSize;};
ui.paramFillTolerance.oninput=e=>{fillTolerance=+e.target.value;ui.valFillTolerance.textContent=fillTolerance;};
ui.paramZoom.oninput=e=>{zoom=+e.target.value/100;ui.valZoom.textContent=e.target.value;applyZoom();};

// Active tool handling
const tools={'toolPencil':'pencil','toolRegion':'region','toolFill':'fill','toolEraser':'eraser','toolPicker':'picker','toolPan':'pan'};
document.querySelectorAll('.pixel-tool').forEach(t=>{
  t.onclick=e=>{
    document.querySelectorAll('.pixel-tool').forEach(b=>b.classList.remove('active'));
    e.currentTarget.classList.add('active');
    activeTool=tools[e.currentTarget.id];
    ui.previewCanvas.style.cursor=activeTool==='pan'?'grab':(activeTool==='picker'?'crosshair':'crosshair');
  };
});

// File input
ui.btnBrowse.onclick=()=>ui.fileInput.click();
ui.fileInput.onchange=()=>handleFile(ui.fileInput.files[0]);

// Drag & drop
ui.dropZone.addEventListener('dragover',e=>{e.preventDefault();ui.dropZone.classList.add('dragover');});
ui.dropZone.addEventListener('dragleave',()=>ui.dropZone.classList.remove('dragover'));
ui.dropZone.addEventListener('drop',e=>{e.preventDefault();ui.dropZone.classList.remove('dragover');if(e.dataTransfer.files[0])handleFile(e.dataTransfer.files[0]);});

// Paste
document.addEventListener('paste',e=>{
  for(const item of(e.clipboardData||e.originalEvent.clipboardData).items){
    if(item.type.startsWith('image')){handleFile(item.getAsFile());break;}
  }
});

function handleFile(file){
  if(!file||!file.type.startsWith('image/')){toast('Please upload an image file.',true);return;}
  const r=new FileReader();
  r.onload=ev=>{origImage.onload=()=>{ui.uploadOverlay.style.display='none';processInput();};origImage.src=ev.target.result;};
  r.readAsDataURL(file);
}

// Camera
let camStream=null;
ui.btnCamera.onclick=async()=>{
  try{
    camStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
    ui.cameraVideo.srcObject=camStream;ui.cameraVideo.style.display='block';
    ui.dropZone.style.display='none';ui.cameraControls.style.display='flex';ui.cameraVideo.play();
  }catch{toast('Camera denied.',true);}
};
ui.btnCancelCamera.onclick=stopCam;
ui.btnCapture.onclick=()=>{
  if(!camStream)return;
  const c=document.createElement('canvas');c.width=ui.cameraVideo.videoWidth;c.height=ui.cameraVideo.videoHeight;
  c.getContext('2d').drawImage(ui.cameraVideo,0,0);
  origImage.onload=()=>{stopCam();ui.uploadOverlay.style.display='none';processInput();};
  origImage.src=c.toDataURL();
};
function stopCam(){if(camStream){camStream.getTracks().forEach(t=>t.stop());camStream=null;}
  ui.cameraVideo.style.display='none';ui.cameraControls.style.display='none';ui.dropZone.style.display='block';}

// Process
function processInput(){
  const max=+document.getElementById('paramMaxDim').value;
  let sc=1;
  if(origImage.width>max||origImage.height>max)sc=max/Math.max(origImage.width,origImage.height);
  const w=Math.round(origImage.width*sc),h=Math.round(origImage.height*sc);
  [ui.mainCanvas,ui.edgeCanvas,ui.segmentCanvas,ui.previewCanvas,ui.reducedCanvas,ui.gridCanvas].forEach(c=>{c.width=w;c.height=h;});
  const ctx=ui.mainCanvas.getContext('2d',{willReadFrequently:true});
  ctx.fillStyle='black';ctx.fillRect(0,0,w,h);ctx.drawImage(origImage,0,0,w,h);
  imgData=ctx.getImageData(0,0,w,h);
  fitZoom(); // Fit to screen ONLY when a new image is loaded
  runPipeline(true);
}

ui.btnProcess.onclick=()=>{if(imgData)runPipeline();};

function getParams(){
  return{
    blurRadius:document.getElementById('paramBlur').value,
    contrast:document.getElementById('paramContrast').checked,
    sharpen:document.getElementById('paramSharpen').checked,
    edgeAlgorithm:document.getElementById('paramEdgeAlgo').value,
    cannyLow:document.getElementById('paramCannyLow').value,
    cannyHigh:document.getElementById('paramCannyHigh').value,
    adaptiveBlockSize:document.getElementById('paramAdaptiveBlock').value,
    adaptiveC:document.getElementById('paramAdaptiveC').value,
    dilateIters:document.getElementById('paramDilate').value,
    closeKernelSize:document.getElementById('paramClose').value,
    despeckle:document.getElementById('paramDespeckle').value,
    minRegionSize:document.getElementById('paramMinRegion').value,
    segmentationMethod:document.getElementById('paramSegMethod').value,
    watershedThreshold:document.getElementById('paramWatershedThresh').value,
    contourSmoothing:document.getElementById('paramContourSmooth').value,
    hough:document.getElementById('paramHough').checked,
    houghThresh:document.getElementById('paramHoughThresh').value,
    houghMinLen:document.getElementById('paramHoughMinLen').value,
    houghMaxGap:document.getElementById('paramHoughMaxGap').value
  };
}

function runPipeline(isNewImage=false){
  if(!pipeline.ready){toast('CV not ready',true);return;}
  toast('Processing...');
  setTimeout(()=>{
    try{
      const sourceData=gcExtractedImageData||imgData;
      segData=pipeline.processImage(sourceData,getParams());
      ui.edgeCanvas.getContext('2d').putImageData(segData.edgeImgData,0,0);
      drawSegPreview();
      renderColored();
      buildRegionList();
      ui.regionCount.textContent=segData.regions.length;
      ui.viewToggles.style.display='flex';
      switchView('viewColored');
      const method=document.getElementById('paramSegMethod').value;
      const contourCount=segData.contours?segData.contours.length:0;
      toast(`Found ${segData.regions.length} regions, ${contourCount} contours (${method})`);
    }catch(err){console.error(err);toast('Error: '+(err.message||err),true);}
  },50);
}

function drawSegPreview(){
  const{width,height,regionMap,regions}=segData;
  const ctx=ui.segmentCanvas.getContext('2d');
  const id=ctx.createImageData(width,height);
  const d=id.data;
  const cols={};
  regions.forEach(r=>{
    const hsl=r.previewColor.match(/\d+(\.\d+)?/g);
    const h=+hsl[0]/360,s=+hsl[1]/100,l=+hsl[2]/100;
    const q=l<0.5?l*(1+s):l+s-l*s,p=2*l-q;
    function hue2rgb(t){if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;}
    cols[r.id]={r:Math.round(hue2rgb(h+1/3)*255),g:Math.round(hue2rgb(h)*255),b:Math.round(hue2rgb(h-1/3)*255)};
  });
  for(let i=0;i<width*height;i++){
    const id2=regionMap[i];const x=i*4;
    if(id2>0&&cols[id2]){d[x]=cols[id2].r;d[x+1]=cols[id2].g;d[x+2]=cols[id2].b;d[x+3]=255;}
  }
  ctx.putImageData(id,0,0);
}

function buildRegionList(){
  ui.regionList.innerHTML='';
  segData.regions.forEach(region=>{
    const item=document.createElement('div');item.className='region-item';item.id='ri'+region.id;
    const dot=document.createElement('div');dot.className='region-color';
    dot.style.backgroundColor=region.color||'transparent';
    if(!region.color)dot.style.background='repeating-conic-gradient(#555 0% 25%,#333 0% 50%) 0/8px 8px';
    const info=document.createElement('div');info.className='region-info';
    info.innerHTML=`<div class="region-id">${region.label}</div><div class="region-area">${region.area} px²</div>`;
    item.appendChild(dot);item.appendChild(info);
    item.onclick=()=>{
      saveUndo();
      region.color=activeColor;
      dot.style.background=activeColor;
      selectedRegionId=region.id;
      // Highlight selected
      document.querySelectorAll('.region-item').forEach(ri=>ri.classList.remove('active'));
      item.classList.add('active');
      renderColored();
    };
    ui.regionList.appendChild(item);
  });
}

// Undo/Redo
function saveUndo(){
  const ctx=ui.previewCanvas.getContext('2d');
  undoStack.push(ctx.getImageData(0,0,ui.previewCanvas.width,ui.previewCanvas.height));
  if(undoStack.length>40)undoStack.shift();
  redoStack=[];
}

ui.btnUndo.onclick=()=>{
  if(!undoStack.length)return;
  const ctx=ui.previewCanvas.getContext('2d');
  redoStack.push(ctx.getImageData(0,0,ui.previewCanvas.width,ui.previewCanvas.height));
  ctx.putImageData(undoStack.pop(),0,0);
};
ui.btnRedo.onclick=()=>{
  if(!redoStack.length)return;
  const ctx=ui.previewCanvas.getContext('2d');
  undoStack.push(ctx.getImageData(0,0,ui.previewCanvas.width,ui.previewCanvas.height));
  ctx.putImageData(redoStack.pop(),0,0);
};
ui.btnReset.onclick=()=>{if(confirm('Reset all work?')){undoStack=[];redoStack=[];gcExtractedImageData=null;gcMask=null;gcRect=null;if(imgData)processInput();}};
ui.btnFillAll.onclick=()=>{
  if(!segData)return;
  saveUndo();
  segData.regions.forEach(region=>{
    region.color=activeColor;
    const item=document.getElementById('ri'+region.id);
    if(item) item.querySelector('.region-color').style.background=activeColor;
  });
  renderColored();
  toast('All regions filled with '+activeColor);
};

ui.btnApplyGlobalColors.onclick=()=>{
  if(!segData)return;
  saveUndo();

  const edgeHex=ui.globalEdgeColor.value;
  const bgHex=ui.globalBgColor.value;
  const fillHex=ui.globalFillColor.value;

  // The background is usually the region containing pixel (0,0) or the largest area
  // Let's assume regionMap[0] is background.
  let bgId=segData.regionMap[0]||0;

  // Sometimes (0,0) is an edge. Find largest region touching the top border
  if(bgId===0){
    for(let i=0;i<segData.width;i++){
      if(segData.regionMap[i]>0){bgId=segData.regionMap[i];break;}
    }
  }

  segData.regions.forEach(region=>{
    region.color=(region.id===bgId)?bgHex:fillHex;
    const item=document.getElementById('ri'+region.id);
    if(item) item.querySelector('.region-color').style.background=region.color;
  });

  renderColored();
  toast('Global colors applied!');
};

document.addEventListener('keydown',e=>{
  if(e.ctrlKey&&e.key==='z')ui.btnUndo.click();
  if(e.ctrlKey&&e.key==='y')ui.btnRedo.click();
  if(e.ctrlKey&&e.key.toLowerCase()==='b'){
    e.preventDefault();
    const leftPanel=document.getElementById('leftPanel');
    const rightPanel=document.getElementById('rightPanel');
    const isHidden=leftPanel.style.display==='none';
    leftPanel.style.display=isHidden?'flex':'none';
    rightPanel.style.display=isHidden?'flex':'none';
  }
  if(e.key==='1')switchView('viewOriginal');
  if(e.key==='2')switchView('viewEdges');
  if(e.key==='3')switchView('viewRegions');
  if(e.key==='4')switchView('viewColored');
});

// Render colored
function renderColored(){
  if(!segData)return;
  const{width,height,regionMap,regions,edgeImgData}=segData;
  const ctx=ui.previewCanvas.getContext('2d');
  const id=ctx.createImageData(width,height);
  const d=id.data;
  const sourceImgData=gcExtractedImageData||imgData;
  const orig=sourceImgData.data;
  const ed=edgeImgData.data;
  const blend=ui.paramBlendMode.value;
  const edgeColorHex=ui.globalEdgeColor?ui.globalEdgeColor.value:'#000000';
  const edgeRGB=hex2rgb(edgeColorHex);
  const bgColorHex=ui.globalBgColor?ui.globalBgColor.value:'#ffffff';
  const bgRGB=hex2rgb(bgColorHex);
  const pc={};regions.forEach(r=>{if(r.color)pc[r.id]=hex2rgb(r.color);});
  for(let i=0;i<width*height;i++){
    const rid=regionMap[i];const x=i*4;
    if(ed[x]===255){d[x]=edgeRGB.r;d[x+1]=edgeRGB.g;d[x+2]=edgeRGB.b;d[x+3]=255;}
    else if(rid>0&&pc[rid]){
      const c=pc[rid];
      if(blend==='multiply'){const lu=(orig[x]*.299+orig[x+1]*.587+orig[x+2]*.114)/255;d[x]=Math.min(255,c.r*lu*1.5);d[x+1]=Math.min(255,c.g*lu*1.5);d[x+2]=Math.min(255,c.b*lu*1.5);}
      else{d[x]=c.r;d[x+1]=c.g;d[x+2]=c.b;}
      d[x+3]=255;
    }else{d[x]=bgRGB.r;d[x+1]=bgRGB.g;d[x+2]=bgRGB.b;d[x+3]=255;}
  }
  ctx.putImageData(id,0,0);
}

ui.paramBlendMode.onchange=renderColored;

// Views
const views={'viewOriginal':ui.mainCanvas,'viewEdges':ui.edgeCanvas,'viewRegions':ui.segmentCanvas,'viewColored':ui.previewCanvas,'viewReduced':ui.reducedCanvas};
function switchView(id){
  Object.values(views).forEach(c=>c.classList.add('hidden'));
  document.querySelectorAll('.view-toggles button').forEach(b=>b.classList.remove('active'));
  views[id].classList.remove('hidden');
  document.getElementById(id).classList.add('active');
}
document.querySelectorAll('.view-toggles button').forEach(b=>b.onclick=e=>switchView(e.target.id));

// Zoom
function applyZoom(){
  ui.canvasWrapper.style.transform=`scale(${zoom})`;
  if(zoom>=8)drawGrid();else ui.gridCanvas.classList.add('hidden');
}

function fitZoom(){
  if(!ui.previewCanvas.width)return;
  const cont=ui.canvasContainer;
  const zx=cont.clientWidth/ui.previewCanvas.width;
  const zy=cont.clientHeight/ui.previewCanvas.height;
  zoom=Math.min(zx,zy)*0.9;
  ui.paramZoom.value=Math.round(zoom*100);
  ui.valZoom.textContent=Math.round(zoom*100);
  applyZoom();
}

document.getElementById('btnZoomIn').onclick=()=>{zoomToCenter(1.5);};
document.getElementById('btnZoomOut').onclick=()=>{zoomToCenter(1/1.5);};
document.getElementById('btnZoomFit').onclick=fitZoom;

function zoomToCenter(factor){
  const container=ui.canvasContainer;
  const centerX=container.clientWidth/2;
  const centerY=container.clientHeight/2;
  const contentX=(container.scrollLeft+centerX)/zoom;
  const contentY=(container.scrollTop+centerY)/zoom;
  zoom=Math.max(0.1,Math.min(32,zoom*factor));
  ui.paramZoom.value=Math.round(zoom*100);
  ui.valZoom.textContent=Math.round(zoom*100);
  applyZoom();
  container.scrollLeft=contentX*zoom-centerX;
  container.scrollTop=contentY*zoom-centerY;
}

// Mouse wheel zoom — zoom to cursor position
ui.canvasContainer.addEventListener('wheel',e=>{
  e.preventDefault();
  const container=ui.canvasContainer;
  const rect=container.getBoundingClientRect();

  // Cursor position relative to the container viewport
  const mouseX=e.clientX-rect.left;
  const mouseY=e.clientY-rect.top;

  // The point in canvas-content space that is under the cursor
  const contentX=(container.scrollLeft+mouseX)/zoom;
  const contentY=(container.scrollTop+mouseY)/zoom;

  // Apply zoom
  const oldZoom=zoom;
  const delta=e.deltaY<0?1.15:1/1.15;
  zoom=Math.max(0.1,Math.min(32,zoom*delta));

  // Update UI
  ui.paramZoom.value=Math.round(zoom*100);
  ui.valZoom.textContent=Math.round(zoom*100);
  applyZoom();

  // Adjust scroll so the same content point stays under the cursor
  container.scrollLeft=contentX*zoom-mouseX;
  container.scrollTop=contentY*zoom-mouseY;
},{passive:false});

// Pixel grid overlay
function drawGrid(){
  const c=ui.gridCanvas;
  c.classList.remove('hidden');
  c.style.width=ui.previewCanvas.width+'px';c.style.height=ui.previewCanvas.height+'px';
  c.width=ui.previewCanvas.width;c.height=ui.previewCanvas.height;
  const ctx=c.getContext('2d');
  ctx.strokeStyle='rgba(0,0,0,0.5)';ctx.lineWidth=1/zoom;
  for(let x=0;x<=c.width;x++){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,c.height);ctx.stroke();}
  for(let y=0;y<=c.height;y++){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(c.width,y);ctx.stroke();}
}

// Canvas to pixel coords
function toPixel(e){
  const wrapRect=ui.canvasWrapper.getBoundingClientRect();
  return{
    x:Math.floor((e.clientX-wrapRect.left)/zoom),
    y:Math.floor((e.clientY-wrapRect.top)/zoom)
  };
}

// Pixel drawing events on previewCanvas
ui.previewCanvas.addEventListener('mousedown',e=>{
  if(!segData)return;
  if(activeTool==='pan'){isPanning=true;lastPan={x:e.clientX,y:e.clientY};ui.previewCanvas.style.cursor='grabbing';return;}
  const p=toPixel(e);
  if(p.x<0||p.y<0||p.x>=ui.previewCanvas.width||p.y>=ui.previewCanvas.height)return;
  if(activeTool==='picker'){pickColor(p);return;}
  if(activeTool==='fill'){saveUndo();nativeFloodFill(p);return;}
  if(activeTool==='region'){
    const rid=segData.regionMap[p.y*segData.width+p.x];
    if(rid>0){
      saveUndo();
      const region=segData.regions.find(r=>r.id===rid);
      if(region) region.color=activeColor;
      const item=document.getElementById('ri'+rid);
      if(item) item.querySelector('.region-color').style.background=activeColor;
      renderColored();
    }
    return;
  }
  saveUndo();isDrawing=true;paintPixel(p);
});

ui.previewCanvas.addEventListener('mousemove',e=>{
  if(isPanning){
    ui.canvasContainer.scrollLeft-=(e.clientX-lastPan.x);
    ui.canvasContainer.scrollTop-=(e.clientY-lastPan.y);
    lastPan={x:e.clientX,y:e.clientY};return;
  }
  if(!segData)return;
  const p=toPixel(e);
  // Show coords
  if(p.x>=0&&p.y>=0&&p.x<ui.previewCanvas.width&&p.y<ui.previewCanvas.height){
    const ctx=ui.previewCanvas.getContext('2d');
    const px=ctx.getImageData(p.x,p.y,1,1).data;
    const rid=segData.regionMap[p.y*segData.width+p.x];
    ui.pixelCoords.innerHTML=`x: ${p.x}, y: ${p.y}<br>Color: rgb(${px[0]},${px[1]},${px[2]})<br>Region: ${rid||'none'}`;
  }
  if(isDrawing)(activeTool==='pencil'||activeTool==='eraser')&&paintPixel(p);
});

document.addEventListener('mouseup',()=>{isDrawing=false;isPanning=false;if(ui.previewCanvas)ui.previewCanvas.style.cursor=activeTool==='pan'?'grab':'crosshair';});

function paintPixel(p){
  const ctx=ui.previewCanvas.getContext('2d');
  const c=activeTool==='eraser'?'#ffffff':activeColor;
  const rgb=hex2rgb(c);
  ctx.fillStyle=`rgb(${rgb.r},${rgb.g},${rgb.b})`;
  ctx.fillRect(p.x-Math.floor(brushSize/2),p.y-Math.floor(brushSize/2),brushSize,brushSize);
}

function pickColor(p){
  const ctx=ui.previewCanvas.getContext('2d');
  const px=ctx.getImageData(p.x,p.y,1,1).data;
  const hex='#'+[px[0],px[1],px[2]].map(v=>v.toString(16).padStart(2,'0')).join('');
  activeColor=hex;ui.activeColorPicker.value=hex;
  toast('Color picked: '+hex);
}

// ─────────────────────────────────────────────────────────
// OPENCV-NATIVE FLOOD FILL (replaces old JS flood fill)
// ─────────────────────────────────────────────────────────
function nativeFloodFill(start){
  if(!pipeline.ready){toast('CV engine not ready',true);return;}
  try{
    const ctx=ui.previewCanvas.getContext('2d');
    const currentImgData=ctx.getImageData(0,0,ui.previewCanvas.width,ui.previewCanvas.height);
    const fillRgb=hex2rgb(activeColor);
    const result=pipeline.nativeFloodFill(currentImgData,start.x,start.y,fillRgb,fillTolerance);
    ctx.putImageData(result,0,0);
  }catch(err){
    console.warn('OpenCV floodFill failed, falling back to JS:',err);
    jsFloodFill(start);
  }
}

// Fallback JS flood fill (in case OpenCV floodFill fails on edge cases)
function jsFloodFill(start){
  const ctx=ui.previewCanvas.getContext('2d');
  const w=ui.previewCanvas.width,h=ui.previewCanvas.height;
  const id=ctx.getImageData(0,0,w,h);
  const d=id.data;
  const si=(start.y*w+start.x)*4;
  const sr=d[si],sg=d[si+1],sb=d[si+2];
  const nr=hex2rgb(activeColor);
  if(sr===nr.r&&sg===nr.g&&sb===nr.b)return;
  const tol=fillTolerance;
  function match(i){return Math.abs(d[i]-sr)<=tol&&Math.abs(d[i+1]-sg)<=tol&&Math.abs(d[i+2]-sb)<=tol;}
  const visited=new Uint8Array(w*h);
  const queue=[start.x+start.y*w];visited[start.x+start.y*w]=1;
  while(queue.length){
    const cur=queue.pop();const x=cur%w,y=Math.floor(cur/w);const i=cur*4;
    d[i]=nr.r;d[i+1]=nr.g;d[i+2]=nr.b;d[i+3]=255;
    const neighbors=[[x-1,y],[x+1,y],[x,y-1],[x,y+1]];
    for(const[nx,ny]of neighbors){
      if(nx<0||ny<0||nx>=w||ny>=h)continue;
      const ni=ny*w+nx;if(visited[ni])continue;visited[ni]=1;
      if(match(ni*4))queue.push(ni);
    }
  }
  ctx.putImageData(id,0,0);
}

// Region click on canvas (Shift + click to fill region)
ui.previewCanvas.addEventListener('click',e=>{
  if(!segData||activeTool!=='pencil'&&activeTool!=='fill')return;
  if(activeTool==='fill'){return;} // handled by mousedown
  if(e.shiftKey){
    const p=toPixel(e);
    const rid=segData.regionMap[p.y*segData.width+p.x];
    if(rid>0){const r=segData.regions.find(r=>r.id===rid);if(r){saveUndo();r.color=activeColor;selectedRegionId=rid;renderColored();buildRegionList();}}
  }
});


// ─────────────────────────────────────────────────────────
// GRABCUT INTERACTIVE SEGMENTATION
// ─────────────────────────────────────────────────────────
const gcCanvas=ui.grabcutCanvas;

// GrabCut tool selection
['gcToolRect','gcToolFG','gcToolBG'].forEach(id=>{
  const btn=document.getElementById(id);
  if(!btn)return;
  btn.onclick=()=>{
    document.querySelectorAll('.grabcut-tool').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    if(id==='gcToolRect')gcMode='rect';
    else if(id==='gcToolFG')gcMode='fg';
    else gcMode='bg';
  };
});

document.getElementById('paramGCBrush').oninput=e=>{
  gcBrushSize=+e.target.value;
  document.getElementById('valGCBrush').textContent=gcBrushSize;
};

gcCanvas.addEventListener('mousedown',e=>{
  if(!imgData)return;
  const rect=gcCanvas.getBoundingClientRect();
  const x=Math.floor((e.clientX-rect.left)*(gcCanvas.width/rect.width));
  const y=Math.floor((e.clientY-rect.top)*(gcCanvas.height/rect.height));

  if(gcMode==='rect'){
    gcStartX=x;gcStartY=y;gcIsDrawing=true;
  } else {
    // FG/BG brush
    gcIsDrawing=true;
    if(!gcMask)gcMask=new Uint8Array(imgData.width*imgData.height).fill(2); // probable bg
    paintGCMask(x,y);
  }
});

gcCanvas.addEventListener('mousemove',e=>{
  if(!gcIsDrawing)return;
  const rect=gcCanvas.getBoundingClientRect();
  const x=Math.floor((e.clientX-rect.left)*(gcCanvas.width/rect.width));
  const y=Math.floor((e.clientY-rect.top)*(gcCanvas.height/rect.height));

  if(gcMode==='rect'){
    drawGCRect(x,y);
  } else {
    paintGCMask(x,y);
  }
});

gcCanvas.addEventListener('mouseup',e=>{
  if(!gcIsDrawing)return;
  gcIsDrawing=false;
  if(gcMode==='rect'){
    const rect=gcCanvas.getBoundingClientRect();
    const x=Math.floor((e.clientX-rect.left)*(gcCanvas.width/rect.width));
    const y=Math.floor((e.clientY-rect.top)*(gcCanvas.height/rect.height));
    gcRect={
      x:Math.min(gcStartX,x),
      y:Math.min(gcStartY,y),
      width:Math.abs(x-gcStartX),
      height:Math.abs(y-gcStartY)
    };
    drawGCRect(x,y);
  }
});

function drawGCRect(curX,curY){
  const ctx=gcCanvas.getContext('2d');
  ctx.clearRect(0,0,gcCanvas.width,gcCanvas.height);
  // Redraw mask strokes
  redrawGCMaskOverlay(ctx);
  // Draw rectangle
  const rx=Math.min(gcStartX,curX),ry=Math.min(gcStartY,curY);
  const rw=Math.abs(curX-gcStartX),rh=Math.abs(curY-gcStartY);
  ctx.strokeStyle='#6366f1';ctx.lineWidth=2;ctx.setLineDash([6,3]);
  ctx.strokeRect(rx,ry,rw,rh);
  ctx.setLineDash([]);
  // Dim outside
  ctx.fillStyle='rgba(0,0,0,0.4)';
  ctx.fillRect(0,0,gcCanvas.width,ry);
  ctx.fillRect(0,ry,rx,rh);
  ctx.fillRect(rx+rw,ry,gcCanvas.width-rx-rw,rh);
  ctx.fillRect(0,ry+rh,gcCanvas.width,gcCanvas.height-ry-rh);
}

function paintGCMask(x,y){
  if(!gcMask)return;
  const w=imgData.width,h=imgData.height;
  const val=gcMode==='fg'?1:0; // 1 = definite FG, 0 = definite BG
  const r=Math.floor(gcBrushSize/2);
  for(let dy=-r;dy<=r;dy++){
    for(let dx=-r;dx<=r;dx++){
      const px=x+dx,py=y+dy;
      if(px>=0&&py>=0&&px<w&&py<h){
        gcMask[py*w+px]=val;
      }
    }
  }
  // Visual feedback
  const ctx=gcCanvas.getContext('2d');
  ctx.fillStyle=gcMode==='fg'?'rgba(16,185,129,0.5)':'rgba(239,68,68,0.5)';
  ctx.beginPath();
  ctx.arc(x,y,gcBrushSize/2,0,Math.PI*2);
  ctx.fill();
}

function redrawGCMaskOverlay(ctx){
  if(!gcMask||!imgData)return;
  const w=imgData.width,h=imgData.height;
  for(let y=0;y<h;y+=2){
    for(let x=0;x<w;x+=2){
      const v=gcMask[y*w+x];
      if(v===1){ctx.fillStyle='rgba(16,185,129,0.3)';ctx.fillRect(x,y,2,2);}
      else if(v===0){ctx.fillStyle='rgba(239,68,68,0.3)';ctx.fillRect(x,y,2,2);}
    }
  }
}

document.getElementById('btnRunGrabCut').onclick=()=>{
  if(!imgData||!pipeline.ready){toast('Load an image first',true);return;}
  if(!gcRect&&!gcMask){toast('Draw a rectangle or paint FG/BG marks first',true);return;}
  toast('Running GrabCut...');
  setTimeout(()=>{
    try{
      let result;
      if(gcMask){
        result=pipeline.runGrabCut(imgData,gcRect||{x:0,y:0,width:imgData.width,height:imgData.height},gcMask,'mask');
      } else {
        result=pipeline.runGrabCut(imgData,gcRect,null,'rect');
      }
      gcExtractedImageData=result.imageData;
      gcMask=result.mask;
      // Show on main canvas
      ui.mainCanvas.getContext('2d').putImageData(gcExtractedImageData,0,0);
      toast('GrabCut complete! Click "Apply & Continue" to run pipeline.');
    }catch(err){console.error(err);toast('GrabCut error: '+(err.message||err),true);}
  },50);
};

document.getElementById('btnApplyGrabCut').onclick=()=>{
  if(!gcExtractedImageData){toast('Run GrabCut first',true);return;}
  // Hide grabcut canvas and switch to CV tab
  gcCanvas.classList.add('hidden');
  switchTab('cv');
  toast('GrabCut applied! Now run the CV pipeline.');
};

document.getElementById('btnClearGrabCut').onclick=()=>{
  gcExtractedImageData=null;gcMask=null;gcRect=null;
  const ctx=gcCanvas.getContext('2d');
  ctx.clearRect(0,0,gcCanvas.width,gcCanvas.height);
  if(imgData)ui.mainCanvas.getContext('2d').putImageData(imgData,0,0);
  toast('GrabCut cleared');
};


// ─────────────────────────────────────────────────────────
// TEXTURE / PATTERN OVERLAY
// ─────────────────────────────────────────────────────────
ui.btnUploadPattern.onclick=()=>ui.patternFileInput.click();

ui.patternFileInput.onchange=()=>{
  const file=ui.patternFileInput.files[0];
  if(!file||!file.type.startsWith('image/')){toast('Select an image file',true);return;}
  const reader=new FileReader();
  reader.onload=ev=>{
    const img=new Image();
    img.onload=()=>{
      patternImage=img;
      // Show preview
      const pc=ui.patternPreview;
      pc.style.display='block';
      const pctx=pc.getContext('2d');
      pctx.clearRect(0,0,60,60);
      pctx.drawImage(img,0,0,60,60);
      toast('Pattern loaded');
    };
    img.src=ev.target.result;
  };
  reader.readAsDataURL(file);
};

ui.btnApplyPattern.onclick=()=>{
  if(!patternImage){toast('Upload a pattern image first',true);return;}
  if(!segData){toast('Run the pipeline first',true);return;}
  if(!selectedRegionId){toast('Click a region in the list to select it first',true);return;}

  saveUndo();

  const region=segData.regions.find(r=>r.id===selectedRegionId);
  if(!region){toast('Region not found',true);return;}

  const scale=parseFloat(ui.paramPatternScale.value)||1.0;
  const opacity=(parseFloat(ui.paramPatternOpacity.value)||80)/100;
  const{width,height,regionMap}=segData;
  const ctx=ui.previewCanvas.getContext('2d');
  const currentData=ctx.getImageData(0,0,width,height);
  const d=currentData.data;

  // Create a tiled pattern canvas
  const tw=Math.round(patternImage.width*scale);
  const th=Math.round(patternImage.height*scale);
  const patCanvas=document.createElement('canvas');
  patCanvas.width=width;patCanvas.height=height;
  const patCtx=patCanvas.getContext('2d');

  // Tile the pattern
  for(let y=0;y<height;y+=th){
    for(let x=0;x<width;x+=tw){
      patCtx.drawImage(patternImage,x,y,tw,th);
    }
  }

  const patData=patCtx.getImageData(0,0,width,height).data;

  // Apply pattern only to the selected region
  for(let i=0;i<width*height;i++){
    if(regionMap[i]===selectedRegionId){
      const idx=i*4;
      // Blend pattern with existing pixel
      d[idx]=Math.round(d[idx]*(1-opacity)+patData[idx]*opacity);
      d[idx+1]=Math.round(d[idx+1]*(1-opacity)+patData[idx+1]*opacity);
      d[idx+2]=Math.round(d[idx+2]*(1-opacity)+patData[idx+2]*opacity);
    }
  }

  ctx.putImageData(currentData,0,0);
  toast(`Pattern applied to ${region.label}`);
};

ui.btnClearPattern.onclick=()=>{
  patternImage=null;
  ui.patternPreview.style.display='none';
  toast('Pattern cleared');
};


// ─────────────────────────────────────────────────────────
// COLOR REDUCTION PIPELINE
// ─────────────────────────────────────────────────────────
let reducedImageData=null;

ui.btnRunReduce.onclick=()=>{
  if(!imgData||!pipeline.ready){toast('Load an image first',true);return;}
  toast('Running color reduction...');
  setTimeout(()=>{
    try{
      let currentData=gcExtractedImageData||imgData;

      // Step 1: Illumination Correction
      if(document.getElementById('paramFixLighting').checked){
        const kernelSize=parseInt(document.getElementById('paramLightKernel').value)||51;
        currentData=pipeline.correctIllumination(currentData,kernelSize);
        toast('Illumination corrected...');
      }

      // Step 2: Bilateral Filter
      if(document.getElementById('paramBilateral').checked){
        const d=parseInt(document.getElementById('paramBilateralD').value)||9;
        const sc=parseInt(document.getElementById('paramSigmaColor').value)||75;
        const ss=parseInt(document.getElementById('paramSigmaSpace').value)||75;
        currentData=pipeline.applyBilateralFilter(currentData,d,sc,ss);
        toast('Bilateral filter applied...');
      }

      // Step 3: K-Means Color Reduction
      const numColors=parseInt(document.getElementById('paramNumColors').value)||3;
      const iterations=parseInt(document.getElementById('paramKmeansIter').value)||10;
      const kResult=pipeline.kmeansColorReduce(currentData,numColors,iterations);
      currentData=kResult.imageData;

      // Step 4: Pixelation
      if(document.getElementById('paramPixelate').checked){
        const pixSize=parseInt(document.getElementById('paramPixelSize').value)||4;
        currentData=pipeline.pixelate(currentData,pixSize);
      }

      // Put result on reducedCanvas
      reducedImageData=currentData;
      ui.reducedCanvas.getContext('2d').putImageData(currentData,0,0);

      // Show the reduced view
      ui.viewToggles.style.display='flex';
      switchView('viewReduced');

      // Display palette swatches
      displayReducedPalette(kResult.palette);

      toast(`Reduced to ${numColors} colors successfully!`);
    }catch(err){console.error(err);toast('Reduction error: '+(err.message||err),true);}
  },50);
};

function displayReducedPalette(palette){
  const container=ui.reducedPalette;
  container.innerHTML='<div class="section-label" style="margin-bottom:0.4rem;">Detected Palette</div>';
  const row=document.createElement('div');
  row.style.cssText='display:flex;gap:0.4rem;flex-wrap:wrap;';
  palette.forEach((c,i)=>{
    const hex='#'+[c.r,c.g,c.b].map(v=>v.toString(16).padStart(2,'0')).join('');
    const swatch=document.createElement('div');
    swatch.style.cssText=`width:32px;height:32px;border-radius:6px;background:${hex};border:2px solid rgba(255,255,255,0.2);cursor:pointer;position:relative;`;
    swatch.title=`Color ${i+1}: ${hex}`;
    swatch.onclick=()=>{activeColor=hex;ui.activeColorPicker.value=hex;toast('Color picked: '+hex);};
    row.appendChild(swatch);
  });
  container.appendChild(row);
}

// Export from reduced canvas (BMP/PNG)
const origBMPHandler=ui.btnExportBMP.onclick;
ui.btnExportBMP.onclick=()=>{
  // If reduced view is active, export from reducedCanvas
  const activeView=document.querySelector('.view-toggles button.active');
  if(activeView&&activeView.id==='viewReduced'&&reducedImageData){
    const bpp=+ui.exportBpp.value;
    try{
      const buf=encodeBMP(reducedImageData,{bpp,bgColor:{r:255,g:255,b:255}});
      dlBlob(new Blob([buf],{type:'image/bmp'}),`design_reduced_${ts()}.bmp`);
      toast('Reduced BMP exported!');
    }catch(er){console.error(er);toast('BMP error: '+er.message,true);}
  } else {
    // Default: export from previewCanvas
    if(!ui.previewCanvas.width){toast('Nothing to export',true);return;}
    const ctx=ui.previewCanvas.getContext('2d');
    const id=ctx.getImageData(0,0,ui.previewCanvas.width,ui.previewCanvas.height);
    const bpp=+ui.exportBpp.value;
    try{
      const buf=encodeBMP(id,{bpp,bgColor:{r:255,g:255,b:255}});
      dlBlob(new Blob([buf],{type:'image/bmp'}),`design_${ts()}.bmp`);
      toast('BMP exported!');
    }catch(er){console.error(er);toast('BMP error: '+er.message,true);}
  }
};

ui.btnExportPNG.onclick=()=>{
  const activeView=document.querySelector('.view-toggles button.active');
  if(activeView&&activeView.id==='viewReduced'&&reducedImageData){
    ui.reducedCanvas.toBlob(b=>dlBlob(b,`design_reduced_${ts()}.png`),'image/png');
    toast('Reduced PNG exported!');
  } else {
    if(!ui.previewCanvas.width){toast('Nothing to export',true);return;}
    ui.previewCanvas.toBlob(b=>dlBlob(b,`design_${ts()}.png`),'image/png');
    toast('PNG exported!');
  }
};

ui.btnExportSVG.onclick=()=>{
  if(!segData){toast('Run the pipeline first',true);return;}
  try{
    const svgStr=exportSVG(segData,segData.width,segData.height);
    downloadSVG(svgStr,`design_${ts()}.svg`);
    toast('SVG exported!');
  }catch(err){console.error(err);toast('SVG error: '+(err.message||err),true);}
};

function dlBlob(blob,name){
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;
  document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(a.href);
}
function ts(){const n=new Date();return`${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}_${String(n.getHours()).padStart(2,'0')}${String(n.getMinutes()).padStart(2,'0')}`;}
});
