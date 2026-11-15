import { test } from "node:test";
import assert from "node:assert/strict";
import { findPanels, inkImage } from "../web/lib/shotpanels.js";

// A screenshot painted by hand: RGBA bytes, like a canvas gives.
function picture(w, h, bg = [40, 30, 45]) {
  const px = new Uint8ClampedArray(w * h * 4);
  const rect = (x0, y0, x1, y1, [r, g, b]) => {
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) px.set([r, g, b, 255], (y * w + x) * 4);
  };
  rect(0, 0, w, h, bg);
  return { px, w, h, rect };
}
const PAPER = [252, 249, 246], INK = [50, 60, 90], RED = [200, 95, 85], BLUE = [107, 140, 231];
// lines of "text": dashes of ink, 2 px thick
function textLines(pic, x0, x1, y0, y1, colour = INK) {
  for (let y = y0; y < y1; y += 14) for (let x = x0; x < x1; x += 9) pic.rect(x, y, x + 6, y + 2, colour);
}
const at = (img, x, y) => img.data[y * img.width + x];

test("a tooltip card and the panel beside it are found as two boxes", () => {
  const pic = picture(660, 300);
  pic.rect(156, 8, 297, 82, RED); // the card's coloured title bar
  pic.rect(156, 82, 297, 290, PAPER); // its light body
  textLines(pic, 166, 280, 96, 280);
  pic.rect(410, 40, 588, 288, [245, 242, 239]); // the Enhance panel
  textLines(pic, 430, 560, 70, 270);
  const boxes = findPanels(pic.px, pic.w, pic.h);
  assert.equal(boxes.length, 2);
  const [card, panel] = boxes; // left to right
  assert.ok(Math.abs(card.x - 156) <= 6 && Math.abs(card.x + card.w - 297) <= 6, JSON.stringify(card));
  assert.ok(card.y <= 8, "the box grows up over the title bar"); // 0.6 x its width above the body
  assert.ok(card.y + card.h >= 284);
  assert.ok(Math.abs(panel.x - 410) <= 6 && Math.abs(panel.x + panel.w - 588) <= 6, JSON.stringify(panel));
});

test("a bright sky behind the cards does not join them into one", () => {
  const pic = picture(660, 300, [150, 190, 240]);
  pic.rect(250, 60, 420, 260, [208, 224, 251]); // a pale blue glow between the two cards
  pic.rect(156, 82, 297, 290, PAPER);
  pic.rect(410, 40, 588, 288, PAPER);
  const boxes = findPanels(pic.px, pic.w, pic.h);
  assert.equal(boxes.length, 2);
  assert.ok(boxes[0].x + boxes[0].w <= 305 && boxes[1].x >= 404);
});

test("a list poking out beside the card is cut off", () => {
  const pic = picture(660, 300);
  pic.rect(156, 82, 297, 290, PAPER);
  textLines(pic, 166, 280, 96, 280);
  for (let y = 60; y < 290; y += 46) { pic.rect(129, y, 156, y + 34, PAPER); pic.rect(132, y + 4, 153, y + 30, RED); } // list rows with icons, left of the card
  const [card] = findPanels(pic.px, pic.w, pic.h);
  assert.ok(card.x >= 150, JSON.stringify(card));
});

test("a small light patch is not a card", () => {
  const pic = picture(660, 300);
  pic.rect(20, 20, 70, 60, PAPER); // a button
  pic.rect(300, 100, 330, 290, PAPER); // a thin strip
  assert.deepEqual(findPanels(pic.px, pic.w, pic.h), []);
});

test("text comes out dark on light whichever way round the game drew it", () => {
  const pic = picture(660, 300);
  pic.rect(156, 82, 297, 290, PAPER);
  pic.rect(170, 100, 230, 103, INK); // dark text on the card
  pic.rect(170, 130, 230, 133, [230, 140, 60]); // orange text on the card
  pic.rect(200, 160, 250, 176, BLUE); // a badge...
  pic.rect(206, 167, 244, 169, [255, 255, 255]); // ...with white text
  const box = { x: 156, y: 82, w: 141, h: 208 }, scale = 2;
  const img = inkImage(pic.px, pic.w, pic.h, box, scale);
  assert.equal(img.width, 282);
  assert.equal(img.height, 416);
  const spot = (x, y) => at(img, Math.round((x - box.x) * scale), Math.round((y - box.y) * scale));
  assert.ok(spot(260, 240) > 235, "empty paper is white");
  assert.ok(spot(200, 101.5) < 60, "dark text is dark");
  assert.ok(spot(200, 131.5) < 110, "orange text is dark enough to read");
  assert.ok(spot(225, 168) < 60, "white text on the badge turns dark");
  assert.ok(spot(225, 163) > 200, "the badge itself turns to paper");
});
