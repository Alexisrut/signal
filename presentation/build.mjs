/**
 * Сборка презентации из модели слайдов в два формата.
 *
 *   PPTX — pptxgenjs, редактируемый файл для PowerPoint.
 *   PDF  — верстка тех же примитивов в HTML и печать headless-браузером.
 *
 * Оба рендерера читают одну модель (deck.mjs), поэтому файлы не расходятся.
 *
 *   node presentation/build.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

import { slides, CANVAS, C, HERE } from './deck.mjs';

const require = createRequire(import.meta.url);
const PptxGenJS = require('pptxgenjs');

const PPTX = path.join(HERE, 'signal-monitor.pptx');
const PDF = path.join(HERE, 'signal-monitor.pdf');
const HTML = path.join(HERE, 'deck.html');

/* ---------------------------------- PPTX ------------------------------------- */

function buildPptx() {
  const pres = new PptxGenJS();
  pres.defineLayout({ name: 'DECK', width: CANVAS.w, height: CANVAS.h });
  pres.layout = 'DECK';
  pres.title = 'Система мониторинга сигналов';

  for (const model of slides) {
    const s = pres.addSlide();
    s.background = { path: model.background };

    for (const b of model.blocks) {
      if (b.t === 'card') {
        s.addShape(pres.ShapeType.roundRect, {
          x: b.x, y: b.y, w: b.w, h: b.h, rectRadius: b.radius,
          fill: { color: b.fill }, line: { color: b.line, width: 1 },
          shadow: { type: 'outer', color: '000000', blur: 14, offset: 4, angle: 90, opacity: 0.4 },
        });
      } else if (b.t === 'circle') {
        s.addShape(pres.ShapeType.ellipse, {
          x: b.x, y: b.y, w: b.d, h: b.d,
          fill: { color: b.color }, line: { color: b.color, width: 0 },
        });
      } else if (b.t === 'image') {
        s.addImage({ path: b.src, x: b.x, y: b.y, w: b.w, h: b.h });
      } else if (b.t === 'text') {
        s.addText(b.value, {
          x: b.x, y: b.y, w: b.w, h: b.h,
          fontFace: b.font, fontSize: b.size, bold: Boolean(b.bold), italic: Boolean(b.italic),
          color: b.color, align: b.align ?? 'left', valign: b.valign ?? 'top', margin: 0,
          ...(b.lineHeight ? { lineSpacingMultiple: b.lineHeight } : {}),
          ...(b.charSpacing ? { charSpacing: b.charSpacing } : {}),
        });
      }
    }

    if (model.notes) s.addNotes(model.notes);
  }

  return pres.writeFile({ fileName: PPTX });
}

/* ----------------------------------- HTML ------------------------------------ */

const PX = 96; // один дюйм модели = 96 пикселей страницы
const px = (inches) => `${(inches * PX).toFixed(2)}px`;
const pt = (size) => `${(size * (PX / 72)).toFixed(2)}px`;

const escapeHtml = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function blockHtml(b) {
  const base = `left:${px(b.x)};top:${px(b.y)}`;

  if (b.t === 'card') {
    return `<div class="b card" style="${base};width:${px(b.w)};height:${px(b.h)};` +
      `background:#${b.fill};border:1px solid #${b.line};border-radius:${px(b.radius)}"></div>`;
  }

  if (b.t === 'circle') {
    return `<div class="b" style="${base};width:${px(b.d)};height:${px(b.d)};` +
      `background:#${b.color};border-radius:50%"></div>`;
  }

  if (b.t === 'image') {
    const data = fs.readFileSync(b.src).toString('base64');
    return `<img class="b" style="${base};width:${px(b.w)};height:${px(b.h)};object-fit:cover;` +
      `border-radius:6px" src="data:image/png;base64,${data}">`;
  }

  const align = b.align ?? 'left';
  const valign = b.valign ?? 'top';
  const justify = valign === 'middle' ? 'center' : valign === 'bottom' ? 'flex-end' : 'flex-start';

  return `<div class="b text" style="${base};width:${px(b.w)};height:${px(b.h)};` +
    `font-family:'${b.font}',Arial,sans-serif;font-size:${pt(b.size)};` +
    `font-weight:${b.bold ? 700 : 400};font-style:${b.italic ? 'italic' : 'normal'};` +
    `color:#${b.color};text-align:${align};justify-content:${justify};` +
    `line-height:${b.lineHeight ?? 1.2};` +
    `${b.charSpacing ? `letter-spacing:${(b.charSpacing / 72) * PX}px;` : ''}">` +
    `<span>${escapeHtml(b.value).replace(/\n/g, '<br>')}</span></div>`;
}

function buildHtml() {
  const pages = slides
    .map((model) => {
      const bg = fs.readFileSync(model.background).toString('base64');
      return `<section class="slide" style="background-image:url(data:image/png;base64,${bg})">` +
        model.blocks.map(blockHtml).join('') +
        `</section>`;
    })
    .join('\n');

  const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>Система мониторинга сигналов</title>
<style>
  @page { size: ${CANVAS.w}in ${CANVAS.h}in; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #${C.bg}; -webkit-font-smoothing: antialiased; }
  .slide {
    position: relative; width: ${px(CANVAS.w)}; height: ${px(CANVAS.h)};
    overflow: hidden; background-size: cover; background-position: center;
    page-break-after: always; break-after: page;
  }
  .slide:last-child { page-break-after: auto; break-after: auto; }
  .b { position: absolute; }
  .card { box-shadow: 0 6px 18px rgba(0,0,0,.42); }
  .text { display: flex; flex-direction: column; }
  .text > span { display: block; width: 100%; }
</style></head><body>
${pages}
</body></html>`;

  fs.writeFileSync(HTML, html);
  return HTML;
}

/* ------------------------------- PDF и превью -------------------------------- */

async function buildPdf() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  await page.goto(`file://${HTML}`, { waitUntil: 'load' });
  await page.waitForTimeout(600);

  await page.pdf({
    path: PDF,
    width: `${CANVAS.w}in`,
    height: `${CANVAS.h}in`,
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });

  // Превью для визуальной проверки — по кадру на слайд.
  const previewDir = path.join(HERE, 'preview');
  fs.rmSync(previewDir, { recursive: true, force: true });
  fs.mkdirSync(previewDir, { recursive: true });

  await page.setViewportSize({ width: Math.round(CANVAS.w * PX), height: Math.round(CANVAS.h * PX) });
  for (let i = 0; i < slides.length; i += 1) {
    const target = await page.locator('.slide').nth(i);
    await target.screenshot({ path: path.join(previewDir, `slide-${String(i + 1).padStart(2, '0')}.png`) });
  }

  await browser.close();
}

await buildPptx();
buildHtml();
await buildPdf();

console.log(`  PPTX: ${PPTX}`);
console.log(`  PDF:  ${PDF}`);
console.log(`  Слайдов: ${slides.length}`);
