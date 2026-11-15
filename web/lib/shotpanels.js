// Find the tooltip cards in a game screenshot and turn each into a clean
// grey image for OCR. Pure functions on RGBA pixels (what a canvas gives), so
// the page and the tests share them. Nothing here touches the DOM or network.
//
// Why: the whole screen is art, buttons and chat banners, and OCR of all of it
// at once reads a gear tooltip badly. The tooltip itself is a light card;
// reading only that card is clean.

// A pixel of card paper: near white, or the warm cream of the rune and relic
// cards. A bright sky or a glow behind the cards is bluer than this and must
// not count, or it joins two cards into one.
const paper = (r, g, b) => (r >= 225 && g >= 225 && b >= 225) || (r >= 228 && g >= 215 && b >= 195 && r - b >= 10 && r - b <= 60);

// Light cards in the image, biggest first: [{ x, y, w, h }] in pixels.
// A card's coloured title bar sits above its light body, so each box is grown
// upward by `head` × its width to take the title in.
export function findPanels(rgba, w, h, { max = 4, head = 0.6 } = {}) {
  const c = Math.max(3, Math.round(w / 220)); // grid cell, in pixels
  const gw = Math.floor(w / c), gh = Math.floor(h / c);
  if (gw < 8 || gh < 8) return [];
  const light = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let n = 0, hit = 0;
      for (let y = gy * c; y < (gy + 1) * c; y += 2) {
        for (let x = gx * c; x < (gx + 1) * c; x += 2) {
          const p = (y * w + x) * 4;
          n++;
          if (paper(rgba[p], rgba[p + 1], rgba[p + 2])) hit++;
        }
      }
      light[gy * gw + gx] = hit * 2 >= n ? 1 : 0;
    }
  }
  // text lines cut a card into strips: close gaps of up to 2 cells down a column
  const closed = light.slice();
  for (let gx = 0; gx < gw; gx++) {
    for (let gy = 1; gy < gh - 1; gy++) {
      if (light[gy * gw + gx]) continue;
      // `up` from the closed grid: the cell above may itself be a gap just closed
      const up = closed[(gy - 1) * gw + gx], dn = light[(gy + 1) * gw + gx] || (gy + 2 < gh && light[(gy + 2) * gw + gx]);
      if (up && dn) closed[gy * gw + gx] = 1;
    }
  }
  const seen = new Uint8Array(gw * gh), out = [];
  const stack = [];
  for (let i = 0; i < closed.length; i++) {
    if (!closed[i] || seen[i]) continue;
    let x0 = gw, x1 = 0, y0 = gh, y1 = 0, cells = 0;
    stack.push(i); seen[i] = 1;
    while (stack.length) {
      const k = stack.pop(), kx = k % gw, ky = (k - kx) / gw;
      cells++;
      if (kx < x0) x0 = kx; if (kx > x1) x1 = kx; if (ky < y0) y0 = ky; if (ky > y1) y1 = ky;
      if (kx > 0 && closed[k - 1] && !seen[k - 1]) { seen[k - 1] = 1; stack.push(k - 1); }
      if (kx < gw - 1 && closed[k + 1] && !seen[k + 1]) { seen[k + 1] = 1; stack.push(k + 1); }
      if (ky > 0 && closed[k - gw] && !seen[k - gw]) { seen[k - gw] = 1; stack.push(k - gw); }
      if (ky < gh - 1 && closed[k + gw] && !seen[k + gw]) { seen[k + gw] = 1; stack.push(k + gw); }
    }
    // A list behind the card pokes out at its sides. On the card's empty rows
    // (between text lines) a card column is paper from top to bottom; a list
    // column is not (icons, gaps between its rows). Drop edge columns that fail.
    const rowFill = (gy) => { let n = 0; for (let gx = x0; gx <= x1; gx++) n += light[gy * gw + gx]; return n / (x1 - x0 + 1); };
    while (y1 - y0 > 4 && rowFill(y0) < 0.6) y0++;
    while (y1 - y0 > 4 && rowFill(y1) < 0.6) y1--;
    const mid0 = x0 + Math.floor((x1 - x0) * 0.3), mid1 = x1 - Math.floor((x1 - x0) * 0.3), blank = [];
    for (let gy = y0; gy <= y1; gy++) {
      let n = 0;
      for (let gx = mid0; gx <= mid1; gx++) n += light[gy * gw + gx];
      if (n >= (mid1 - mid0 + 1) * 0.9) blank.push(gy);
    }
    if (blank.length >= 4) {
      const colFill = (gx) => { let n = 0; for (const gy of blank) n += light[gy * gw + gx]; return n / blank.length; };
      while (x1 - x0 > 4 && colFill(x0) < 0.9) x0++;
      while (x1 - x0 > 4 && colFill(x1) < 0.9) x1--;
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (bw * c < w * 0.13 || bh * c < h * 0.25) continue; // too small to be a card
    if (cells < bw * bh * 0.55) continue; // not a filled box (clouds, a bright wall)
    out.push({ x: x0 * c, y: y0 * c, w: bw * c, h: bh * c, cells });
  }
  out.sort((a, b) => b.cells - a.cells);
  return out.slice(0, max).map(({ x, y, w: bw, h: bh }) => {
    const top = Math.max(0, Math.round(y - bw * head));
    return { x, y: top, w: Math.min(bw, w - x), h: Math.min(h - top, bh + (y - top)) };
  }).sort((a, b) => a.x - b.x);
}

// One box of the screenshot as a grey image, `scale` times bigger, where text
// is dark and whatever is behind it is light, whichever way round the game drew
// it (dark text on the card, white text on a coloured badge or title bar,
// orange text on a pale box).
// How: around each pixel, in a window about one text line high, the colour most
// pixels share is the background (text is the smaller part). A pixel far from
// that background colour is ink.
// Returns { data: Uint8ClampedArray (one byte per pixel), width, height }.
export function inkImage(rgba, w, h, box, scale = 3) {
  const bx = Math.max(0, Math.round(box.x)), by = Math.max(0, Math.round(box.y));
  const bw = Math.min(w - bx, Math.round(box.w)), bh = Math.min(h - by, Math.round(box.h));
  const W = bw + 1, size = W * (bh + 1);
  let r = 1; // half the window, set before each use
  // summed-area table of value(pixel index in the box); whole numbers fit an Int32Array, half the memory
  const table = (value, Type = Int32Array) => {
    const t = new Type(size);
    for (let y = 0; y < bh; y++) {
      let row = 0;
      for (let x = 0; x < bw; x++) {
        row += value(y * bw + x);
        t[(y + 1) * W + x + 1] = t[y * W + x + 1] + row;
      }
    }
    return t;
  };
  const boxSum = (t, x, y) => {
    const x0 = Math.max(0, x - r), x1 = Math.min(bw, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(bh, y + r + 1);
    return t[y1 * W + x1] - t[y0 * W + x1] - t[y1 * W + x0] + t[y0 * W + x0];
  };
  const area = (x, y) => (Math.min(bw, x + r + 1) - Math.max(0, x - r)) * (Math.min(bh, y + r + 1) - Math.max(0, y - r));
  // the box's own copy of the colours
  const px = new Uint8ClampedArray(bw * bh * 3);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const p = ((by + y) * w + bx + x) * 4, q = (y * bw + x) * 3;
      px[q] = rgba[p]; px[q + 1] = rgba[p + 1]; px[q + 2] = rgba[p + 2];
    }
  }
  // 0. A small solid badge with white text ("lv.16" after Refine Lv.) is too
  // small a patch for step 2 to tell its text from its background, so turn it
  // the usual way round first: badge colour to paper, the light text in it to
  // dark. A badge is a strongly coloured blob about one text line high and
  // wider than tall; coloured text is thin strokes and the title bar is far
  // bigger, so neither is touched.
  const vivid = new Uint8Array(bw * bh);
  for (let i = 0, q = 0; i < vivid.length; i++, q += 3) {
    const hi = Math.max(px[q], px[q + 1], px[q + 2]), lo = Math.min(px[q], px[q + 1], px[q + 2]);
    vivid[i] = hi - lo > 70 && lo < 190 ? 1 : 0;
  }
  const mark = new Int32Array(bw * bh), stack = [];
  for (let start = 0, id = 0; start < vivid.length; start++) {
    if (!vivid[start] || mark[start]) continue;
    id++;
    let x0 = bw, x1 = 0, y0 = bh, y1 = 0, n = 0;
    stack.push(start); mark[start] = id;
    while (stack.length) {
      const k = stack.pop(), kx = k % bw, ky = (k - kx) / bw;
      n++;
      if (kx < x0) x0 = kx; if (kx > x1) x1 = kx; if (ky < y0) y0 = ky; if (ky > y1) y1 = ky;
      if (kx > 0 && vivid[k - 1] && !mark[k - 1]) { mark[k - 1] = id; stack.push(k - 1); }
      if (kx < bw - 1 && vivid[k + 1] && !mark[k + 1]) { mark[k + 1] = id; stack.push(k + 1); }
      if (ky > 0 && vivid[k - bw] && !mark[k - bw]) { mark[k - bw] = id; stack.push(k - bw); }
      if (ky < bh - 1 && vivid[k + bw] && !mark[k + bw]) { mark[k + bw] = id; stack.push(k + bw); }
    }
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
    if (ch < h * 0.015 || ch > h * 0.05 || cw < ch * 1.3 || cw > ch * 7 || n < cw * ch * 0.4) continue;
    for (let y = y0; y <= y1; y++) {
      let lx = -1, rx = -1; // the badge's own first and last pixel on this row
      for (let x = x0; x <= x1; x++) if (mark[y * bw + x] === id) { if (lx < 0) lx = x; rx = x; }
      for (let x = lx; lx >= 0 && x <= rx; x++) {
        const q = (y * bw + x) * 3, lo = Math.min(px[q], px[q + 1], px[q + 2]);
        px[q] = px[q + 1] = px[q + 2] = 255 * (1 - Math.min(1, Math.max(0, (lo - 150) / 90)));
      }
    }
  }
  r = Math.max(4, Math.round(w / 220));
  // 1. distance of each pixel from the plain average colour around it
  const all = [0, 1, 2].map((k) => table((i) => px[i * 3 + k]));
  const far = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const q = (y * bw + x) * 3, n = area(x, y);
      const d0 = px[q] - boxSum(all[0], x, y) / n, d1 = px[q + 1] - boxSum(all[1], x, y) / n, d2 = px[q + 2] - boxSum(all[2], x, y) / n;
      far[y * bw + x] = Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2);
    }
  }
  // 2. the background is the average of the pixels that sit closer than usual to that average
  const farSum = table((i) => far[i], Float64Array);
  const calm = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) calm[y * bw + x] = far[y * bw + x] <= boxSum(farSum, x, y) / area(x, y) ? 1 : 0;
  const calmN = table((i) => calm[i]);
  const calmC = [0, 1, 2].map((k) => table((i) => (calm[i] ? px[i * 3 + k] : 0)));
  const ink = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const q = (y * bw + x) * 3, n = boxSum(calmN, x, y) || 1;
      const d0 = px[q] - boxSum(calmC[0], x, y) / n, d1 = px[q + 1] - boxSum(calmC[1], x, y) / n, d2 = px[q + 2] - boxSum(calmC[2], x, y) / n;
      ink[y * bw + x] = Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2);
    }
  }
  const ow = Math.round(bw * scale), oh = Math.round(bh * scale), data = new Uint8ClampedArray(ow * oh);
  for (let y = 0; y < oh; y++) {
    const sy = Math.min(bh - 1, y / scale), iy = Math.floor(sy), jy = Math.min(bh - 1, iy + 1), fy = sy - iy;
    for (let x = 0; x < ow; x++) {
      const sx = Math.min(bw - 1, x / scale), ix = Math.floor(sx), jx = Math.min(bw - 1, ix + 1), fx = sx - ix;
      const v = ink[iy * bw + ix] * (1 - fx) * (1 - fy) + ink[iy * bw + jx] * fx * (1 - fy) + ink[jy * bw + ix] * (1 - fx) * fy + ink[jy * bw + jx] * fx * fy;
      data[y * ow + x] = 255 - Math.min(255, Math.max(0, (v - 30) * 2)); // under 30 is paper, over ~155 is full ink
    }
  }
  return { data, width: ow, height: oh };
}

// The plain way (grey, more contrast, dark-on-light): what the stats reader
// uses on the whole screen. Kept here so a card can be read both ways.
export function greyImage(rgba, w, h, box, scale = 3) {
  const bx = Math.max(0, Math.round(box.x)), by = Math.max(0, Math.round(box.y));
  const bw = Math.min(w - bx, Math.round(box.w)), bh = Math.min(h - by, Math.round(box.h));
  const lum = new Float32Array(bw * bh);
  let sum = 0;
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const p = ((by + y) * w + bx + x) * 4;
      sum += lum[y * bw + x] = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
    }
  }
  const invert = sum / (bw * bh) < 128;
  const ow = Math.round(bw * scale), oh = Math.round(bh * scale), data = new Uint8ClampedArray(ow * oh);
  for (let y = 0; y < oh; y++) {
    const sy = Math.min(bh - 1, y / scale), iy = Math.floor(sy), jy = Math.min(bh - 1, iy + 1), fy = sy - iy;
    for (let x = 0; x < ow; x++) {
      const sx = Math.min(bw - 1, x / scale), ix = Math.floor(sx), jx = Math.min(bw - 1, ix + 1), fx = sx - ix;
      let v = lum[iy * bw + ix] * (1 - fx) * (1 - fy) + lum[iy * bw + jx] * fx * (1 - fy) + lum[jy * bw + ix] * (1 - fx) * fy + lum[jy * bw + jx] * fx * fy;
      if (invert) v = 255 - v;
      data[y * ow + x] = (v - 128) * 1.6 + 128;
    }
  }
  return { data, width: ow, height: oh };
}
