const pdfBase=new URL('../../assets/vendor/pdfjs/',import.meta.url);

export async function loadReferencePdf(file) {
  const pdfjs=await import(new URL('pdf.mjs',pdfBase).href);
  pdfjs.GlobalWorkerOptions.workerSrc=new URL('pdf.worker.mjs',pdfBase).href;
  const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,
    cMapUrl:new URL('cmaps/',pdfBase).href,cMapPacked:true,standardFontDataUrl:new URL('standard_fonts/',pdfBase).href,
    wasmUrl:new URL('wasm/',pdfBase).href});
  try { return await task.promise; } catch(error) { await task.destroy();throw error; }
}

export async function renderReferencePdfPage(pdf, pageNumber) {
  if (!Number.isInteger(pageNumber) || pageNumber<1 || pageNumber>pdf.numPages) throw new Error('Choose a valid PDF page.');
  const page=await pdf.getPage(pageNumber), original=page.getViewport({scale:1});
  const scale=Math.min(2,4096/Math.max(original.width,original.height),Math.sqrt(16000000/(original.width*original.height)));
  const viewport=page.getViewport({scale}),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.floor(viewport.width));canvas.height=Math.max(1,Math.floor(viewport.height));
  await page.render({canvasContext:canvas.getContext('2d'),viewport,background:'rgb(255,255,255)'}).promise;
  return {image:canvas.toDataURL('image/png'),naturalWidth:canvas.width,naturalHeight:canvas.height};
}

export async function readReferencePng(file) {
  const image=await new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('The image could not be read.'));reader.readAsDataURL(file);
  });
  const decoded=new Image();decoded.src=image;await decoded.decode();
  if (!(decoded.naturalWidth>0 && decoded.naturalHeight>0)) throw new Error('The PNG has no image content.');
  return {image,naturalWidth:decoded.naturalWidth,naturalHeight:decoded.naturalHeight};
}
