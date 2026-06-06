document.addEventListener("DOMContentLoaded",()=>{
const pipeline=new CVPipeline();
let imgData=null,origImage=new Image(),segData=null,activeColor="#ef4444";
let zoom=1,panX=0,panY=0,isPanning=false,lastPan={x:0,y:0};
let activeTool="pencil",brushSize=1,fillTolerance=15;
let undoStack=[],redoStack=[];
let isDrawing=false;

// Tab switching
window.switchTab=function(tab){
  document.getElementById('cvControls').style.display=tab==='cv'?'flex':'none';
  document.getElementById('pixelControls').style.display=tab==='pixel'?'flex':'none';
  document.getElementById('tabCV').classList.toggle('active',tab==='cv');
  document.getElementById('tabPixel').classList.toggle('active',tab==='pixel');
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
  gridCanvas:document.getElementById('gridCanvas'),
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
  exportBpp:document.getElementById('exportBpp'),
  paramBlendMode:document.getElementById('paramBlendMode'),
  paramEdgeAlgo:document.getElementById('paramEdgeAlgo'),
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

// Preset swatches
['#ffffff','#000000','#ef4444','#f97316','#f59e0b','#84cc16','#10b981','#06b6d4','#3b82f6','#6366f1','#8b5cf6','#d946ef','#f43f5e','#57534e','#78716c','#be185d','#1e3a8a','#14532d'].forEach(c=>{
  const s=document.createElement('div');
  s.className='swatch';s.style.backgroundColor=c;
  s.onclick=()=>{ui.activeColorPicker.value=c;activeColor=c;};
  ui.colorSwatches.appendChild(s);
});

ui.activeColorPicker.oninput=e=>activeColor=e.target.value;

// Sliders
document.querySelectorAll('input[type="range"]').forEach(sl=>{
  sl.addEventListener('input',e=>{
    const v=document.getElementById('val'+e.target.id.replace('param',''));
    if(v)v.textContent=e.target.value;
  });
});

// Algo toggle
ui.paramEdgeAlgo.onchange=e=>{
  document.getElementById('cannyControls').style.display=e.target.value==='canny'?'block':'none';
  document.getElementById('adaptiveControls').style.display=e.target.value==='adaptive'?'block':'none';
};

// Brush/fill/zoom sliders
ui.paramBrushSize.oninput=e=>{brushSize=+e.target.value;ui.valBrushSize.textContent=brushSize;};
ui.paramFillTolerance.oninput=e=>{fillTolerance=+e.target.value;ui.valFillTolerance.textContent=fillTolerance;};
ui.paramZoom.oninput=e=>{zoom=+e.target.value/100;ui.valZoom.textContent=e.target.value;applyZoom();};

// Pixel tools
['Pencil','Fill','Eraser','Picker','Pan'].forEach(name=>{
  const btn=document.getElementById('tool'+name);
  if(btn)btn.onclick=()=>{
    activeTool=name.toLowerCase();
    document.querySelectorAll('.pixel-tool').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    ui.previewCanvas.style.cursor=activeTool==='pan'?'grab':activeTool==='picker'?'cell':'crosshair';
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
  [ui.mainCanvas,ui.edgeCanvas,ui.segmentCanvas,ui.previewCanvas,ui.gridCanvas].forEach(c=>{c.width=w;c.height=h;});
  const ctx=ui.mainCanvas.getContext('2d',{willReadFrequently:true});
  ctx.fillStyle='white';ctx.fillRect(0,0,w,h);ctx.drawImage(origImage,0,0,w,h);
  imgData=ctx.getImageData(0,0,w,h);
  runPipeline();
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
    minRegionSize:document.getElementById('paramMinRegion').value
  };
}

function runPipeline(){
  if(!pipeline.ready){toast('CV not ready',true);return;}
  toast('Processing...');
  setTimeout(()=>{
    try{
      segData=pipeline.processImage(imgData,getParams());
      ui.edgeCanvas.getContext('2d').putImageData(segData.edgeImgData,0,0);
      drawSegPreview();
      renderColored();
      buildRegionList();
      ui.regionCount.textContent=segData.regions.length;
      ui.viewToggles.style.display='flex';
      switchView('viewColored');
      toast(`Found ${segData.regions.length} regions`);
      // auto fit zoom
      fitZoom();
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
    item.onclick=()=>{saveUndo();region.color=activeColor;dot.style.background=activeColor;renderColored();};
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
ui.btnReset.onclick=()=>{if(confirm('Reset all work?')){undoStack=[];redoStack=[];if(imgData)processInput();}};
document.addEventListener('keydown',e=>{
  if(e.ctrlKey&&e.key==='z')ui.btnUndo.click();
  if(e.ctrlKey&&e.key==='y')ui.btnRedo.click();
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
  const orig=imgData.data;
  const ed=edgeImgData.data;
  const blend=ui.paramBlendMode.value;
  const pc={};regions.forEach(r=>{if(r.color)pc[r.id]=hex2rgb(r.color);});
  for(let i=0;i<width*height;i++){
    const rid=regionMap[i];const x=i*4;
    if(ed[x]===255){d[x]=0;d[x+1]=0;d[x+2]=0;d[x+3]=255;}
    else if(rid>0&&pc[rid]){
      const c=pc[rid];
      if(blend==='multiply'){const lu=(orig[x]*.299+orig[x+1]*.587+orig[x+2]*.114)/255;d[x]=Math.min(255,c.r*lu*1.5);d[x+1]=Math.min(255,c.g*lu*1.5);d[x+2]=Math.min(255,c.b*lu*1.5);}
      else{d[x]=c.r;d[x+1]=c.g;d[x+2]=c.b;}
      d[x+3]=255;
    }else{d[x]=255;d[x+1]=255;d[x+2]=255;d[x+3]=255;}
  }
  ctx.putImageData(id,0,0);
}

ui.paramBlendMode.onchange=renderColored;

// Views
const views={'viewOriginal':ui.mainCanvas,'viewEdges':ui.edgeCanvas,'viewRegions':ui.segmentCanvas,'viewColored':ui.previewCanvas};
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
  const w=ui.previewCanvas.width*zoom;const h=ui.previewCanvas.height*zoom;
  // show pixel grid when zoom >= 8
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

document.getElementById('btnZoomIn').onclick=()=>{zoom=Math.min(32,zoom*1.5);ui.paramZoom.value=Math.round(zoom*100);ui.valZoom.textContent=Math.round(zoom*100);applyZoom();};
document.getElementById('btnZoomOut').onclick=()=>{zoom=Math.max(0.1,zoom/1.5);ui.paramZoom.value=Math.round(zoom*100);ui.valZoom.textContent=Math.round(zoom*100);applyZoom();};
document.getElementById('btnZoomFit').onclick=fitZoom;

// Mouse wheel zoom
ui.canvasContainer.addEventListener('wheel',e=>{
  e.preventDefault();
  const delta=e.deltaY<0?1.15:1/1.15;
  zoom=Math.max(0.1,Math.min(32,zoom*delta));
  ui.paramZoom.value=Math.round(zoom*100);ui.valZoom.textContent=Math.round(zoom*100);applyZoom();
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
  const rect=ui.previewCanvas.getBoundingClientRect();
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
  if(activeTool==='fill'){saveUndo();floodFill(p);return;}
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
    ui.pixelCoords.innerHTML=`x: ${p.x}, y: ${p.y}<br>Color: rgb(${px[0]},${px[1]},${px[2]})`;
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

// Flood fill
function floodFill(start){
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

// Region click on canvas
ui.previewCanvas.addEventListener('click',e=>{
  if(!segData||activeTool!=='pencil'&&activeTool!=='fill')return;
  if(activeTool==='fill'){return;} // handled by mousedown
  // region fill on click in pencil mode if shift held
  if(e.shiftKey){
    const p=toPixel(e);
    const rid=segData.regionMap[p.y*segData.width+p.x];
    if(rid>0){const r=segData.regions.find(r=>r.id===rid);if(r){saveUndo();r.color=activeColor;renderColored();buildRegionList();}}
  }
});

// BMP export
ui.btnExportBMP.onclick=()=>{
  if(!ui.previewCanvas.width){toast('Nothing to export',true);return;}
  const ctx=ui.previewCanvas.getContext('2d');
  const id=ctx.getImageData(0,0,ui.previewCanvas.width,ui.previewCanvas.height);
  const bpp=+ui.exportBpp.value;
  try{
    const buf=encodeBMP(id,{bpp,bgColor:{r:255,g:255,b:255}});
    dlBlob(new Blob([buf],{type:'image/bmp'}),`design_${ts()}.bmp`);
    toast('BMP exported!');
  }catch(er){console.error(er);toast('BMP error: '+er.message,true);}
};

ui.btnExportPNG.onclick=()=>{
  if(!ui.previewCanvas.width){toast('Nothing to export',true);return;}
  ui.previewCanvas.toBlob(b=>dlBlob(b,`design_${ts()}.png`),'image/png');
};

function dlBlob(blob,name){
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;
  document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(a.href);
}
function ts(){const n=new Date();return`${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}_${String(n.getHours()).padStart(2,'0')}${String(n.getMinutes()).padStart(2,'0')}`;}
});
