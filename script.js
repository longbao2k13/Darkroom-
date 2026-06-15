(() => {
  'use strict';

  const els = {
    fileInput: document.getElementById('fileInput'),
    beforeCanvas: document.getElementById('beforeCanvas'),
    afterCanvas: document.getElementById('afterCanvas'),
    previewWrap: document.getElementById('previewWrap'),
    metaText: document.getElementById('metaText'),

    btnReset: document.getElementById('btnReset'),
    btnBeforeAfter: document.getElementById('btnBeforeAfter'),
    btnDownload: document.getElementById('btnDownload'),

    // Crop
    cropRatio: document.getElementById('cropRatio'),
    cropZoom: document.getElementById('cropZoom'),
    btnRotateLeft: document.getElementById('btnRotateLeft'),
    btnRotateRight: document.getElementById('btnRotateRight'),
    btnApplyCrop: document.getElementById('btnApplyCrop'),

    sliders: {
      exposure: document.getElementById('exposure'),
      contrast: document.getElementById('contrast'),
      brightness: document.getElementById('brightness'),
      saturation: document.getElementById('saturation'),
      globalHue: document.getElementById('globalHue'),
      temperature: document.getElementById('temperature'),
      tint: document.getElementById('tint'),
      highlights: document.getElementById('highlights'),
      shadows: document.getElementById('shadows'),
      whites: document.getElementById('whites'),
      blacks: document.getElementById('blacks'),
      sharpness: document.getElementById('sharpness'),
      dehaze: document.getElementById('dehaze')
    },
    valueLabels: {
      exposure: document.getElementById('vExposure'),
      contrast: document.getElementById('vContrast'),
      brightness: document.getElementById('vBrightness'),
      saturation: document.getElementById('vSaturation'),
      globalHue: document.getElementById('vHue'),
      temperature: document.getElementById('vTemp'),
      tint: document.getElementById('vTint'),
      highlights: document.getElementById('vHighlights'),
      shadows: document.getElementById('vShadows'),
      whites: document.getElementById('vWhites'),
      blacks: document.getElementById('vBlacks'),
      sharpness: document.getElementById('vSharpness'),
      dehaze: document.getElementById('vDehaze')
    }
  };

  const hslGrid = document.getElementById('hslGrid');

  const COLORS = [
    { key: 'red', label: 'Red', swatch: '#ff4b4b', center: 0 },
    { key: 'orange', label: 'Orange', swatch: '#ff8a3d', center: 30 },
    { key: 'yellow', label: 'Yellow', swatch: '#ffd24a', center: 60 },
    { key: 'green', label: 'Green', swatch: '#49e47a', center: 120 },
    { key: 'aqua', label: 'Aqua', swatch: '#3de6e6', center: 180 },
    { key: 'blue', label: 'Blue', swatch: '#4c82ff', center: 220 },
    { key: 'purple', label: 'Purple', swatch: '#9c5cff', center: 270 },
    { key: 'magenta', label: 'Magenta', swatch: '#ff4fb6', center: 315 }
  ];

  const state = {
    loaded: false,
    // source image and original
    srcCanvas: document.createElement('canvas'),
    srcCtx: null,
    originalImageData: null,
    // processed
    processedImageData: null,

    // preview mapping
    viewW: 0,
    viewH: 0,

    // before/after
    showBefore: false,

    // crop/rotate
    rotation: 0, // degrees
    cropApplied: false,
    // crop selection (center crop)
    cropBox: null,
    // adjustments
    adjustments: {
      exposure: 0,
      contrast: 0,
      brightness: 0,
      saturation: 0,
      globalHue: 0,
      temperature: 0,
      tint: 0,
      highlights: 0,
      shadows: 0,
      whites: 0,
      blacks: 0,
      sharpness: 0,
      dehaze: 0,
      hsl: Object.fromEntries(COLORS.map(c => [
        c.key,
        { hue: 0, saturation: 0, luminance: 0 }
      ]))
    },

    renderQueued: false
  };

  function clamp01(x){ return x < 0 ? 0 : x > 1 ? 1 : x; }
  function clamp255(x){ return x < 0 ? 0 : x > 255 ? 255 : x; }

  function getStepPrecision(step){
    const s = String(step);
    if (s.includes('e-')){
      // e.g. 1e-3
      const m = s.split('e-');
      return m[1] ? parseInt(m[1], 10) : 6;
    }
    const idx = s.indexOf('.');
    if (idx === -1) return 0;
    return Math.min(10, s.length - idx - 1);
  }

  function snapToStep(value, min, step){
    const v = Number(value);
    const s = Number(step);
    if (!isFinite(v) || !isFinite(s) || s === 0) return v;
    const snapped = min + Math.round((v - min) / s) * s;
    const prec = getStepPrecision(s);
    return Number(snapped.toFixed(prec));
  }

  function clampToRangeAndStep(value, el){
    const min = parseFloat(el.min ?? '0');
    const max = parseFloat(el.max ?? '0');
    const step = parseFloat(el.step ?? '1');
    let v = Number(value);
    if (!isFinite(v)) return parseFloat(el.value);
    if (v < min) v = min;
    if (v > max) v = max;
    v = snapToStep(v, min, step);
    // final clamp for fp issues
    if (v < min) v = min;
    if (v > max) v = max;
    return v;
  }


  function lerp(a,b,t){ return a + (b-a)*t; }

  function wrapHueDeg(deg){
    let d = deg % 360;
    if (d < 0) d += 360;
    return d;
  }

  function rgbToHsl(r,g,b){
    // r,g,b in [0..1]
    const max = Math.max(r,g,b);
    const min = Math.min(r,g,b);
    const l = (max + min) / 2;
    const d = max - min;
    let h = 0;
    let s = 0;
    if (d !== 0){
      s = d / (1 - Math.abs(2*l - 1));
      switch(max){
        case r: h = ((g - b) / d) % 6; break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h *= 60;
      if (h < 0) h += 360;
    }
    return {h,s,l};
  }

  function hslToRgb(h,s,l){
    h = wrapHueDeg(h);
    const c = (1 - Math.abs(2*l - 1)) * s;
    const x = c * (1 - Math.abs(((h/60) % 2) - 1));
    const m = l - c/2;
    let r1=0,g1=0,b1=0;
    if (h < 60){ r1=c; g1=x; b1=0; }
    else if (h < 120){ r1=x; g1=c; b1=0; }
    else if (h < 180){ r1=0; g1=c; b1=x; }
    else if (h < 240){ r1=0; g1=x; b1=c; }
    else if (h < 300){ r1=x; g1=0; b1=c; }
    else { r1=c; g1=0; b1=x; }
    return {r:r1+m,g:g1+m,b:b1+m};
  }

  function computeCropBox(imgW, imgH){
    const ratio = els.cropRatio.value;
    let targetAR = null;
    if (ratio !== 'free'){
      const [a,b] = ratio.split(':').map(Number);
      if (a && b) targetAR = a/b;
    }
    const zoom = parseFloat(els.cropZoom.value) || 1;

    // start with full image size
    let w = imgW;
    let h = imgH;

    if (targetAR){
      // adjust w/h to fit target aspect while staying within original
      const currentAR = imgW / imgH;
      if (currentAR > targetAR){
        // too wide -> reduce width
        w = Math.floor(imgH * targetAR);
      } else {
        // too tall -> reduce height
        h = Math.floor(imgW / targetAR);
      }
    }

    // apply zoom: zoom > 1 means tighter crop
    const z = Math.max(1, zoom);
    w = Math.floor(w / z);
    h = Math.floor(h / z);

    // center crop box
    const x = Math.floor((imgW - w) / 2);
    const y = Math.floor((imgH - h) / 2);
    return {x,y,w,h};
  }

  function rotateSrcDataToNewCanvas(){
    // Rotates the srcCanvas pixels into a new canvas based on state.rotation.
    const src = state.srcCanvas;
    const deg = state.rotation % 360;
    const rot = ((deg % 360) + 360) % 360;
    if (rot === 0) return src;

    const out = document.createElement('canvas');
    const outCtx = out.getContext('2d', { willReadFrequently: true });

    const w = src.width, h = src.height;
    if (rot === 90 || rot === 270){
      out.width = h;
      out.height = w;
    } else {
      out.width = w;
      out.height = h;
    }

    outCtx.save();
    outCtx.translate(out.width/2, out.height/2);
    outCtx.rotate(rot * Math.PI/180);
    outCtx.drawImage(src, -w/2, -h/2);
    outCtx.restore();

    return out;
  }

  function downscaleIfNeeded(canvas, maxSide = 2200){
    const w = canvas.width, h = canvas.height;
    const max = Math.max(w,h);
    if (max <= maxSide) return canvas;
    const s = maxSide / max;
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(w*s));
    out.height = Math.max(1, Math.round(h*s));
    const ctx = out.getContext('2d');
    ctx.drawImage(canvas, 0,0,out.width,out.height);
    return out;
  }

  function render(){
    if (!state.loaded) return;
    if (state.renderQueued) return;
    state.renderQueued = true;

    requestAnimationFrame(() => {
      state.renderQueued = false;
      const start = performance.now();

      const srcRotated = rotateSrcDataToNewCanvas();
      let srcForAdjust = srcRotated;

      // Cropping is applied only when user hits Apply Crop.
      // Before that, use whole rotated image.
      if (state.cropApplied && state.cropBox){
        const b = state.cropBox;
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = b.w;
        cropCanvas.height = b.h;
        const cctx = cropCanvas.getContext('2d');
        cctx.drawImage(srcRotated, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
        srcForAdjust = cropCanvas;
      }

      const w = srcForAdjust.width, h = srcForAdjust.height;
      const ctx = state.afterCanvasCtx || (state.afterCanvasCtx = els.afterCanvas.getContext('2d', { willReadFrequently: true }));
      const bctx = state.beforeCanvasCtx || (state.beforeCanvasCtx = els.beforeCanvas.getContext('2d', { willReadFrequently: true }));

      // Ensure canvas sizes match image aspect within preview area
      els.beforeCanvas.width = w;
      els.beforeCanvas.height = h;
      els.afterCanvas.width = w;
      els.afterCanvas.height = h;

      // Draw base (before)
      if (!state.originalImageDataForCurrent || state.lastBeforeKey !== getBeforeKey(srcForAdjust)){
        bctx.clearRect(0,0,w,h);
        bctx.drawImage(srcForAdjust, 0,0);
        state.originalImageDataForCurrent = bctx.getImageData(0,0,w,h);
        state.lastBeforeKey = getBeforeKey(srcForAdjust);
      }

      // Start from original image data
      const srcData = state.originalImageDataForCurrent;
      let img = new Uint8ClampedArray(srcData.data);

      const a = state.adjustments;

      // Exposure / Contrast / Brightness / Highlights / Shadows / Blacks/Whites
      const tExposure = a.exposure;
      const tContrast = a.contrast / 100;
      const tBrightness = a.brightness / 100;

      const tHigh = a.highlights / 100;
      const tShadow = a.shadows / 100;
      const tWhites = a.whites / 100;
      const tBlacks = a.blacks / 100;

      const doToneCurve = (v) => {
        // v in [0..1]

        // Exposure (approx with power)
        if (tExposure !== 0){
          const ev = Math.pow(2, tExposure);
          v = clamp01(v * ev);
        }

        // Whites / Blacks (level-like)
        if (tWhites !== 0){
          // increase whites lifts top end
          const wLift = tWhites * 0.25;
          v = v + (1 - v) * wLift;
          v = clamp01(v);
        }
        if (tBlacks !== 0){
          // increase blacks deepens bottom end
          const bLift = (-tBlacks) * 0.25; // note sign: positive blacks -> deeper
          v = v - v * bLift;
          v = clamp01(v);
        }

        // Contrast (pivot at 0.5)
        if (tContrast !== 0){
          const c = tContrast * 1.6;
          const pivot = 0.5;
          v = clamp01((v - pivot) * (1 + c) + pivot);
        }

        // Highlights (brighten/darken the top)
        if (tHigh !== 0){
          const m = v*v*(3-2*v); // smoothstep-ish weighting
          // positive highlights moves v up more aggressively near top
          v = v + m * tHigh * (1 - v) * 0.55;
          v = clamp01(v);
        }

        // Shadows
        if (tShadow !== 0){
          const m = (1 - v); // stronger in dark areas
          const wgt = m*m*(3-2*m);
          v = v - wgt * tShadow * v * 0.55;
          v = clamp01(v);
        }

        // Brightness (linear)
        if (tBrightness !== 0){
          v = clamp01(v + tBrightness * 0.35);
        }

        return v;
      };

      const doSaturationHue = (r,g,b) => {
        let {h,l,s} = rgbToHsl(r,g,b);

        // global hue rotate
        if (a.globalHue !== 0){
          h = wrapHueDeg(h + a.globalHue);
        }

        // global saturation
        if (a.saturation !== 0){
          const ds = a.saturation / 100;
          s = clamp01(s * (1 + ds));
        }

        // temperature/tint in HSL terms are complex; approximate in RGB after HSL.
        const rgb = hslToRgb(h,s,l);
        let rr = rgb.r, gg = rgb.g, bb = rgb.b;

        // Temperature: warmer (+) -> more red, less blue; cooler (-) opposite
        if (a.temperature !== 0){
          const k = a.temperature / 100; // [-1..1]
          rr = clamp01(rr + k * 0.10);
          bb = clamp01(bb - k * 0.10);
        }
        // Tint: magenta/green shift approximation (positive -> magenta)
        if (a.tint !== 0){
          const k = a.tint / 100;
          rr = clamp01(rr + k * 0.06);
          gg = clamp01(gg - k * 0.06);
          bb = clamp01(bb + k * 0.02);
        }

        return {r:rr,g:gg,b:bb};
      };

      // Dehaze: locally enhance contrast on luminance using a cheap blur.
      const dehazeAmt = a.dehaze / 100; // [-1..1]

      let rgba = img;

      // Tone & saturation pass
      for (let i=0;i<rgba.length;i+=4){
        const r = rgba[i]/255;
        const g = rgba[i+1]/255;
        const b = rgba[i+2]/255;

        // luminance for tone curve
        const lum = (0.2126*r + 0.7152*g + 0.0722*b);
        let v = doToneCurve(lum);

        // Preserve chroma by scaling RGB by ratio v/lum
        let scale = lum > 1e-6 ? (v / lum) : 0;
        let rr = r * scale;
        let gg = g * scale;
        let bb = b * scale;

        // Clamp before HSL adjustments
        rr = clamp01(rr); gg = clamp01(gg); bb = clamp01(bb);

        const rgb2 = doSaturationHue(rr,gg,bb);
        rgba[i] = Math.round(rgb2.r*255);
        rgba[i+1] = Math.round(rgb2.g*255);
        rgba[i+2] = Math.round(rgb2.b*255);
        // alpha untouched
      }

      // HSL Color Mixer (per hue bucket)
      const hasHsl = COLORS.some(c => {
        const v = a.hsl[c.key];
        return v && (v.hue !== 0 || v.saturation !== 0 || v.luminance !== 0);
      });

      if (hasHsl){
        // Smooth weights around each color center (wrap-aware)
        const bucketWidth = 42; // degrees half-width
        const bucketFalloff = 1.7;

        // Precompute active settings
        const settings = COLORS.map(c => ({
          key: c.key,
          center: c.center,
          cfg: a.hsl[c.key]
        }));

        for (let i=0;i<rgba.length;i+=4){
          let r = rgba[i]/255;
          let g = rgba[i+1]/255;
          let b = rgba[i+2]/255;

          let {h,s,l} = rgbToHsl(r,g,b);

          // Compute weights and apply weighted adjustments.
          let totalW = 0;
          let dHue = 0;
          let dSat = 0;
          let dLum = 0;

          for (const st of settings){
            const cfg = st.cfg;
            if (!cfg) continue;
            if (cfg.hue === 0 && cfg.saturation === 0 && cfg.luminance === 0) continue;

            // circular distance
            let dh = Math.abs(h - st.center);
            dh = Math.min(dh, 360 - dh);

            // weight within bucket
            if (dh <= bucketWidth){
              const t = 1 - (dh / bucketWidth);
              const wgt = Math.pow(t, bucketFalloff);
              totalW += wgt;
              dHue += wgt * cfg.hue;
              dSat += wgt * cfg.saturation;
              dLum += wgt * cfg.luminance;
            }
          }

          if (totalW > 1e-6){
            // Saturation & luminance adjustments are in [-100..100] scaled.
            h = wrapHueDeg(h + (dHue / totalW));
            s = clamp01(s * (1 + (dSat / totalW) / 100));
            // Luminance: apply as offset in linear lightness
            l = clamp01(l + (dLum / totalW) / 100 * 0.25);

            const rgb3 = hslToRgb(h,s,l);
            rgba[i] = Math.round(rgb3.r*255);
            rgba[i+1] = Math.round(rgb3.g*255);
            rgba[i+2] = Math.round(rgb3.b*255);
          }
        }
      }

      // Dehaze pass
      if (dehazeAmt !== 0){
        // Cheap box blur for local luminance
        const w = els.afterCanvas.width, h = els.afterCanvas.height;
        const tmp = new Float32Array(w*h);
        const out = new Uint8ClampedArray(rgba);

        for (let i=0, p=0; i<rgba.length; i+=4, p++){
          const r = rgba[i]/255, g = rgba[i+1]/255, b = rgba[i+2]/255;
          tmp[p] = 0.2126*r + 0.7152*g + 0.0722*b;
        }

        const r = Math.max(1, Math.round(2 + Math.abs(dehazeAmt)*4));
        const blur = new Float32Array(w*h);

        // box blur using separable pass (approx)
        // horizontal
        const horiz = new Float32Array(w*h);
        for (let y=0;y<h;y++){
          let sum = 0;
          let count = 0;
          for (let x=-r;x<=r;x++){
            const xx = x;
            if (xx>=0 && xx<w){ sum += tmp[y*w+xx]; count++; }
          }
          for (let x=0;x<w;x++){
            blur[y*w+x] = sum / count;
            // slide
            const xRemove = x - r;
            const xAdd = x + r + 1;
            if (xRemove>=0){ sum -= tmp[y*w+xRemove]; count--; }
            if (xAdd<w){ sum += tmp[y*w+xAdd]; count++; }
          }
        }

        // vertical
        const blur2 = new Float32Array(w*h);
        for (let x=0;x<w;x++){
          let sum = 0;
          let count = 0;
          for (let y=-r;y<=r;y++){
            const yy = y;
            if (yy>=0 && yy<h){ sum += blur[yy*w+x]; count++; }
          }
          for (let y=0;y<h;y++){
            blur2[y*w+x] = sum / count;
            const yRemove = y - r;
            const yAdd = y + r + 1;
            if (yRemove>=0){ sum -= blur[yRemove*w+x]; count--; }
            if (yAdd<h){ sum += blur[yAdd*w+x]; count++; }
          }
        }

        // Enhance local contrast: gain based on (l - blur)
        const amt = dehazeAmt * 0.8;
        for (let p=0, i=0; p<w*h; p++, i+=4){
          const l = tmp[p];
          const lb = blur2[p];
          const diff = l - lb;

          // center around 0.5
          const factor = 1 + amt * (diff * 2.5);

          const rr = clamp01((rgba[i]/255) * factor);
          const gg = clamp01((rgba[i+1]/255) * factor);
          const bb = clamp01((rgba[i+2]/255) * factor);

          out[i] = Math.round(rr*255);
          out[i+1] = Math.round(gg*255);
          out[i+2] = Math.round(bb*255);
        }

        rgba = out;
      }

      // Sharpness (unsharp mask)
      const sharp = a.sharpness / 100;
      if (sharp !== 0){
        const w = els.afterCanvas.width, h = els.afterCanvas.height;
        const rad = Math.max(0.5, Math.abs(sharp) * 1.8);
        const R = Math.max(1, Math.round(rad));

        // simple box blur on luminance then apply to RGB
        const lum = new Float32Array(w*h);
        for (let i=0,p=0; i<rgba.length; i+=4,p++){
          const r = rgba[i]/255, g = rgba[i+1]/255, b = rgba[i+2]/255;
          lum[p] = 0.2126*r + 0.7152*g + 0.0722*b;
        }

        const blur = new Float32Array(w*h);
        // horizontal box
        for (let y=0;y<h;y++){
          let sum=0, count=0;
          for (let x=-R;x<=R;x++){
            const xx=x;
            if (xx>=0 && xx<w){ sum += lum[y*w+xx]; count++; }
          }
          for (let x=0;x<w;x++){
            blur[y*w+x] = sum / count;
            const xRemove=x-R;
            const xAdd=x+R+1;
            if (xRemove>=0){ sum -= lum[y*w+xRemove]; count--; }
            if (xAdd<w){ sum += lum[y*w+xAdd]; count++; }
          }
        }
        // vertical box
        const blur2 = new Float32Array(w*h);
        for (let x=0;x<w;x++){
          let sum=0, count=0;
          for (let y=-R;y<=R;y++){
            const yy=y;
            if (yy>=0 && yy<h){ sum += blur[yy*w+x]; count++; }
          }
          for (let y=0;y<h;y++){
            blur2[y*w+x] = sum / count;
            const yRemove=y-R;
            const yAdd=y+R+1;
            if (yRemove>=0){ sum -= blur[yRemove*w+x]; count--; }
            if (yAdd<h){ sum += blur[yAdd*w+x]; count++; }
          }
        }

        const amount = sharp * 0.85;
        const out = new Uint8ClampedArray(rgba);
        for (let p=0, i=0; p<w*h; p++, i+=4){
          const l = lum[p];
          const b = blur2[p];
          const diff = l - b;
          const factor = 1 + amount * diff * 2.7;
          out[i] = Math.round(clamp01((rgba[i]/255) * factor) * 255);
          out[i+1] = Math.round(clamp01((rgba[i+1]/255) * factor) * 255);
          out[i+2] = Math.round(clamp01((rgba[i+2]/255) * factor) * 255);
        }
        rgba = out;
      }

      // Render to after canvas
      const imgOut = new ImageData(rgba, els.afterCanvas.width, els.afterCanvas.height);
      ctx.putImageData(imgOut,0,0);

      // before/after visibility
      els.beforeCanvas.style.opacity = state.showBefore ? '1' : '0';
      els.afterCanvas.style.opacity = state.showBefore ? '0' : '1';

      const ms = performance.now() - start;
      if (state.loaded){
        els.metaText.textContent = `Editing • ${els.afterCanvas.width}×${els.afterCanvas.height} • ${ms.toFixed(0)} ms`;
      }

      // ensure crop box is computed for current rotated resolution when apply crop not yet computed
      if (state.cropApplied){
        // keep cropBox valid (it refers to rotated canvas coordinates)
      }
    });
  }

  function getBeforeKey(canvas){
    // Key based on size + rotation/crop flags to invalidate cached originalImageDataForCurrent.
    return `${canvas.width}x${canvas.height}|rot=${state.rotation}|crop=${state.cropApplied?1:0}|zoom=${els.cropZoom.value}|ratio=${els.cropRatio.value}`;
  }

  function scheduleRender(){
    if (!state.loaded) return;
    render();
  }

  function bindSlider(id, onChange){
    const el = els.sliders[id];
    if (!el) return;
    const label = els.valueLabels[id];
    const numEl = document.getElementById(`${id}_num`);

    const fmt = (v) => {
      if (id === 'exposure') return Number(v).toFixed(2);
      if (id === 'contrast' || id === 'brightness' || id === 'saturation' || id === 'globalHue' || id === 'temperature' || id === 'tint' || id === 'highlights' || id === 'shadows' || id === 'whites' || id === 'blacks' || id === 'sharpness' || id === 'dehaze'){
        if (id === 'globalHue') return `${Number(v).toFixed(0)}°`;
        return Number(v).toFixed(1);
      }
      return v;
    };

    const syncFromSlider = () => {
      const v = clampToRangeAndStep(el.value, el);
      el.value = String(v);
      if (numEl){
        numEl.value = String(v);
      }
      if (label) label.textContent = fmt(v);
      if (onChange) onChange();
      scheduleRender();
    };

    const syncFromNumber = () => {
      if (!numEl) return;
      const v = clampToRangeAndStep(numEl.value, el);
      numEl.value = String(v);
      el.value = String(v);
      if (label) label.textContent = fmt(v);
      if (onChange) onChange();
      scheduleRender();
    };

    // init number constraints
    if (numEl){
      numEl.min = el.min;
      numEl.max = el.max;
      numEl.step = el.step;

      // Prefer showing typed value exactly; clamp/snap on input.
      // Initialize after handlers are wired.
      el.addEventListener('input', syncFromSlider);
      numEl.addEventListener('input', syncFromNumber);
      // Also sync on change to catch 'enter' / blur.
      numEl.addEventListener('change', syncFromNumber);
    } else {
      el.addEventListener('input', syncFromSlider);
    }

    // initialize
    const initV = clampToRangeAndStep(el.value, el);
    el.value = String(initV);
    if (numEl) numEl.value = String(initV);
    if (label) label.textContent = fmt(initV);
    if (onChange) onChange();
  }


  function initHslGrid(){
    for (const c of COLORS){
      const card = document.createElement('div');
      card.className = 'hsl-card';
      card.style.setProperty('--swatch', c.swatch);

      const head = document.createElement('div');
      head.className = 'hsl-head';
      head.innerHTML = `<div class="hsl-label">${c.label}</div><div class="hsl-swatch" aria-hidden="true"></div>`;
      card.appendChild(head);

      // Hue
      card.appendChild(makeHslRow(c.key,'hue','Hue','vHue'));
      // Saturation
      card.appendChild(makeHslRow(c.key,'saturation','Sat','vSat'));
      // Luminance
      card.appendChild(makeHslRow(c.key,'luminance','Lum','vLum'));

      hslGrid.appendChild(card);
    }
  }

  function makeHslRow(colorKey, fieldKey, label, shortId){
    const row = document.createElement('div');
    row.className = 'hsl-row';
    const min = -100;
    const max = 100;
    const step = 0.1;

    row.innerHTML = `
      <div class="hsl-row__top">
        <span>${label}</span>
        <span class="hsl-row__val" data-val-for="${colorKey}-${fieldKey}">0</span>
      </div>
      <div class="control__pair control__pair--hsl">
        <input class="slider" type="range" min="${min}" max="${max}" step="${step}" value="0" data-hsl="${colorKey}" data-field="${fieldKey}" />
        <input class="numberInput numberInput--hsl" type="number" min="${min}" max="${max}" step="${step}" value="0" data-hsl-num="${colorKey}" data-field-num="${fieldKey}" />
      </div>
    `;

    const slider = row.querySelector('input.slider');
    const numEl = row.querySelector('input.numberInput');

    const updateVal = () => {
      const cfg = state.adjustments.hsl[colorKey];
      const v = parseFloat(slider.value);
      cfg[fieldKey] = v;

      const val = row.querySelector('[data-val-for]');
      if (val){
        const shown = fieldKey === 'hue' ? `${v.toFixed(0)}°` : `${v.toFixed(1)}`;
        val.textContent = shown;
      }
      scheduleRender();
    };

    const syncFromSlider = () => {
      const v = clampToRangeAndStep(slider.value, slider);
      slider.value = String(v);
      numEl.value = String(v);
      updateVal();
    };

    const syncFromNumber = () => {
      const v = clampToRangeAndStep(numEl.value, slider);
      numEl.value = String(v);
      slider.value = String(v);
      updateVal();
    };

    slider.addEventListener('input', syncFromSlider);
    numEl.addEventListener('input', syncFromNumber);
    numEl.addEventListener('change', syncFromNumber);

    // init label
    const val = row.querySelector('[data-val-for]');
    if (val){
      val.textContent = fieldKey === 'hue' ? '0°' : '0';
    }

    // connect initial state
    state.adjustments.hsl[colorKey][fieldKey] = 0;
    // ensure UI starts clamped (and updates label)
    syncFromSlider();

    return row;
  }



  function wireControls(){
    bindSlider('exposure');
    bindSlider('contrast');
    bindSlider('brightness');
    bindSlider('saturation');
    bindSlider('globalHue');
    bindSlider('temperature');
    bindSlider('tint');
    bindSlider('highlights');
    bindSlider('shadows');
    bindSlider('whites');
    bindSlider('blacks');
    bindSlider('sharpness');
    bindSlider('dehaze');

    const sliderIds = Object.keys(els.sliders);
    for (const key of sliderIds){
      const el = els.sliders[key];
      el.addEventListener('input', () => {
        state.adjustments[key] = parseFloat(el.value);
      }, { passive: true });
    }

    // crop zoom label
    const zoomLabel = document.querySelector('[data-for="cropZoom"]');
    const updateZoomLabel = () => {
      if (zoomLabel){
        zoomLabel.textContent = `${parseFloat(els.cropZoom.value).toFixed(2)}×`;
      }
    };
    els.cropZoom.addEventListener('input', () => {
      updateZoomLabel();
    });
    updateZoomLabel();

    els.btnRotateLeft.addEventListener('click', () => {
      state.rotation -= 90;
      state.cropApplied = false;
      scheduleRender();
    });
    els.btnRotateRight.addEventListener('click', () => {
      state.rotation += 90;
      state.cropApplied = false;
      scheduleRender();
    });

    els.btnApplyCrop.addEventListener('click', () => {
      const srcRotated = rotateSrcDataToNewCanvas();
      state.cropBox = computeCropBox(srcRotated.width, srcRotated.height);
      state.cropApplied = true;
      scheduleRender();
    });

    els.btnBeforeAfter.addEventListener('click', () => {
      state.showBefore = !state.showBefore;
      // draw before if needed
      els.beforeCanvas.style.opacity = state.showBefore ? '1' : '0';
      els.afterCanvas.style.opacity = state.showBefore ? '0' : '1';
      if (state.loaded) els.metaText.textContent = state.showBefore ? 'Before' : 'Editing';
    });

    els.btnReset.addEventListener('click', () => {
      // Reset all sliders
      for (const [k, el] of Object.entries(els.sliders)){
        el.value = '0';
        state.adjustments[k] = 0;
      }
      els.cropRatio.value = '16:9';
      els.cropZoom.value = '1';
      const zlab = document.querySelector('[data-for="cropZoom"]');
      if (zlab) zlab.textContent = '1.00×';

      for (const c of COLORS){
        for (const f of ['hue','saturation','luminance']){
          state.adjustments.hsl[c.key][f] = 0;
        }
      }
      // reset UI of hsl sliders
      document.querySelectorAll('[data-hsl]').forEach((input) => { input.value = '0'; });
      document.querySelectorAll('.hsl-row__val').forEach((v) => {
        const t = v.getAttribute('data-val-for') || '';
        if (t.includes('-hue')) v.textContent = '0°';
        else v.textContent = '0';
      });

      state.rotation = 0;
      state.cropApplied = false;
      state.cropBox = null;
      state.showBefore = false;
      els.beforeCanvas.style.opacity = '0';
      els.afterCanvas.style.opacity = '1';

      if (state.loaded) els.metaText.textContent = 'Reset • ready';
      scheduleRender();
    });

    els.btnDownload.addEventListener('click', () => {
      if (!state.loaded) return;
      // Ensure latest render
      render();

      // Use output canvas (afterCanvas) and export.
      const link = document.createElement('a');
      const safeName = (state.fileName ? state.fileName.replace(/\.[a-z0-9]+$/i,'') : 'edited');
      link.download = `${safeName}.png`;
      link.href = els.afterCanvas.toDataURL('image/png');
      link.click();
    });
  }

  function loadFile(file){
    if (!file) return;

    const url = URL.createObjectURL(file);
    state.fileName = file.name;
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);

      // Setup source
      const src = document.createElement('canvas');
      const ctx = src.getContext('2d', { willReadFrequently: true });

      // Downscale for performance
      const temp = document.createElement('canvas');
      temp.width = img.naturalWidth;
      temp.height = img.naturalHeight;
      const tctx = temp.getContext('2d');
      tctx.drawImage(img,0,0);
      const ds = downscaleIfNeeded(temp, 2200);

      src.width = ds.width;
      src.height = ds.height;
      ctx.drawImage(ds,0,0);

      state.srcCanvas = src;
      state.srcCtx = ctx;
      state.loaded = true;
      state.rotation = 0;
      state.cropApplied = false;
      state.cropBox = null;
      state.showBefore = false;
      els.beforeCanvas.style.opacity = '0';
      els.afterCanvas.style.opacity = '1';

      state.originalImageDataForCurrent = null;
      state.lastBeforeKey = null;

      // Reset meta
      els.metaText.textContent = `Loaded • ${src.width}×${src.height}`;

      // Ensure cache cleared
      scheduleRender();
    };
    img.onerror = () => {
      els.metaText.textContent = 'Failed to load image.';
    };
    img.src = url;
  }

  // Wire upload
  els.fileInput.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    // Reset HSL UI to current state (if any)
    loadFile(f);
  });

  // Initialize HSL grid and defaults
  initHslGrid();
  wireControls();

  // Keep crop preview accurate on resize
  const ro = new ResizeObserver(() => {
    // canvases use intrinsic size; no need for scaling calculations.
    // Trigger a re-render to update cached image sizing text.
    if (state.loaded) scheduleRender();
  });
  ro.observe(els.previewWrap);

  // Initial render placeholder
  els.beforeCanvas.style.opacity = '0';
  els.afterCanvas.style.opacity = '1';
  els.metaText.textContent = 'Upload an image to begin.';
})();

