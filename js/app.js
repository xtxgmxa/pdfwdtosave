import { getDocument, GlobalWorkerOptions } from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.min.mjs';
import Tesseract from 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.esm.min.js';
import { zipSync } from 'https://cdn.jsdelivr.net/npm/fflate@0.8.3/esm/browser.js';
import { PDFDocument } from 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.esm.min.js';
import { extractTitle, isStrongTitle } from './title.js';

GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.worker.min.mjs';

const TITLE_BANDS = [
  { left: 0.1, top: 0.28, width: 0.8, height: 0.2 },
  { left: 0.1, top: 0.16, width: 0.8, height: 0.2 },
  { left: 0.1, top: 0.42, width: 0.8, height: 0.2 },
  { left: 0.08, top: 0.12, width: 0.84, height: 0.55 },
];

const fileInput = document.querySelector('#file-input');
const dropzone = document.querySelector('#dropzone');
const formatSelect = document.querySelector('#format');
const statusEl = document.querySelector('#status');
const resultsEl = document.querySelector('#results');
const listEl = document.querySelector('#list');
const countEl = document.querySelector('#result-count');
const clearBtn = document.querySelector('#clear');
const downloadBtn = document.querySelector('#download-all');

const items = [];
let workerPromise = null;
let busy = false;
let token = 0;

fileInput.addEventListener('change', () => {
  takeFiles(fileInput.files);
  fileInput.value = '';
});

dropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropzone.classList.add('hot');
});

dropzone.addEventListener('dragleave', () => dropzone.classList.remove('hot'));

dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropzone.classList.remove('hot');
  takeFiles(event.dataTransfer.files);
});

clearBtn.addEventListener('click', reset);
downloadBtn.addEventListener('click', downloadAll);
formatSelect.addEventListener('change', refreshNames);

function setStatus(text) {
  statusEl.textContent = text;
}

function reset() {
  token += 1;
  for (const item of items) {
    if (item.thumbUrl) URL.revokeObjectURL(item.thumbUrl);
  }
  items.length = 0;
  listEl.innerHTML = '';
  resultsEl.hidden = true;
  countEl.textContent = '辨識結果';
  busy = false;
  downloadBtn.disabled = false;
  setStatus('已清空。可以再丟入下一批。');
}

async function takeFiles(fileList) {
  const files = [...fileList].filter((file) => /pdf|image\/(jpeg|png|webp)/i.test(file.type) || /\.(pdf|jpe?g|png|webp)$/i.test(file.name));
  if (!files.length || busy) {
    if (!files.length) setStatus('請丟入 PDF 或 JPG、PNG 圖片。');
    return;
  }

  busy = true;
  downloadBtn.disabled = true;
  const run = ++token;
  try {
    await ensureWorker((message) => {
      if (run === token) setStatus(message);
    });
    for (let index = 0; index < files.length; index += 1) {
      if (run !== token) return;
      setStatus(`正在讀取 ${index + 1} / ${files.length}：${files[index].name}`);
      try {
        await processFile(files[index], run, index, files.length);
      } catch (error) {
        console.error(error);
        addItem({
          sourceName: files[index].name,
          pageLabel: '無法讀取',
          blob: null,
          title: '',
          raw: '',
          error: error.message || String(error),
          sourceBytes: null,
          pageIndex: 0,
          isPdf: false,
        });
      }
    }
    if (run === token) {
      const named = items.filter((item) => item.title).length;
      setStatus(`完成 ${items.length} 頁，讀到比賽標題 ${named} 頁。請核對後再下載。`);
    }
  } catch (error) {
    console.error(error);
    if (run === token) setStatus(`處理中斷：${error.message || error}`);
  } finally {
    if (run === token) {
      busy = false;
      downloadBtn.disabled = false;
    }
  }
}

async function ensureWorker(onStatus) {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker('chi_tra', 1, {
      logger(message) {
        if (!onStatus) return;
        if (message.status === 'loading language traineddata') {
          onStatus('第一次使用，正在下載中文辨識資料…');
        }
      },
    }).then(async (worker) => {
      await worker.setParameters({
        tessedit_pageseg_mode: '6',
        user_defined_dpi: '300',
      });
      return worker;
    });
  }
  return workerPromise;
}

async function processFile(file, run, fileIndex, fileCount) {
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocument({ data: bytes.slice(0) }).promise;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      if (run !== token) return;
      setStatus(`正在辨識 ${file.name} 第 ${pageNumber} / ${pdf.numPages} 頁（檔案 ${fileIndex + 1} / ${fileCount}）`);
      const page = await pdf.getPage(pageNumber);
      const canvas = await renderPdfPage(page);
      const found = await readTitle(canvas);
      if (run !== token) return;
      pushItem({
        sourceName: file.name,
        pageLabel: pdf.numPages > 1 ? `第 ${pageNumber} 頁` : '單頁',
        canvas,
        title: found.title,
        raw: found.raw,
        sourceBytes: bytes,
        pageIndex: pageNumber - 1,
        isPdf: true,
      });
    }
    return;
  }

  setStatus(`正在辨識 ${file.name}（${fileIndex + 1} / ${fileCount}）`);
  const canvas = await renderImageFile(file);
  const found = isWideStrip(canvas) ? await readOriginal(file, '7') : await readTitle(canvas);
  if (run !== token) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  pushItem({
    sourceName: file.name,
    pageLabel: '圖片',
    canvas,
    title: found.title,
    raw: found.raw,
    sourceBytes: bytes,
    pageIndex: 0,
    isPdf: false,
  });
}

function pushItem(draft) {
  const blob = canvasToJpeg(draft.canvas);
  addItem({ ...draft, blob, error: '' });
}

function addItem(draft) {
  items.push({
    id: `${Date.now()}-${items.length}`,
    sourceName: draft.sourceName,
    pageLabel: draft.pageLabel,
    thumbUrl: draft.blob ? URL.createObjectURL(draft.blob) : '',
    blob: draft.blob,
    title: draft.title,
    raw: draft.raw,
    error: draft.error || '',
    sourceBytes: draft.sourceBytes,
    pageIndex: draft.pageIndex,
    isPdf: draft.isPdf,
  });
  appendCard(items[items.length - 1]);
  refreshNames();
}

async function readOriginal(file, mode) {
  const worker = await ensureWorker();
  await worker.setParameters({
    tessedit_pageseg_mode: mode,
    user_defined_dpi: '300',
  });
  const result = await worker.recognize(file);
  const raw = result.data.text || '';
  return { title: extractTitle(raw), raw: raw.trim() };
}

async function readTitle(canvas) {
  const worker = await ensureWorker();
  const strip = isWideStrip(canvas);
  const regions = strip ? [null] : TITLE_BANDS;
  let best = { title: '', raw: '' };

  for (const band of regions) {
    await worker.setParameters({
      tessedit_pageseg_mode: strip || !band ? '7' : '6',
      user_defined_dpi: '300',
    });
    const view = band ? crop(canvas, band) : pad(canvas, false);
    const result = await worker.recognize(view);
    const raw = result.data.text || '';
    const title = extractTitle(raw);
    if (isStrongTitle(title) || (title && !best.title)) {
      best = { title, raw: raw.trim() };
    }
    if (isStrongTitle(title)) break;
  }
  return best;
}

function isWideStrip(canvas) {
  return canvas.width / canvas.height >= 3.2;
}

async function renderPdfPage(page) {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(3, 2200 / base.width) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas;
}

function renderImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const strip = image.width / image.height >= 3.2;
  const scale = strip ? 1 : Math.max(1, Math.min(2, 1800 / image.width));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`無法讀取圖片 ${file.name}`));
    };
    image.src = url;
  });
}

function crop(source, band) {
  const x = Math.round(source.width * band.left);
  const y = Math.round(source.height * band.top);
  const width = Math.round(source.width * band.width);
  const height = Math.round(source.height * band.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(source, x, y, width, height, 0, 0, width, height);
  return pad(canvas);
}

function pad(source, enhance = true) {
  const padded = document.createElement('canvas');
  const margin = 28;
  padded.width = source.width + margin * 2;
  padded.height = source.height + margin * 2;
  const context = padded.getContext('2d', { willReadFrequently: true });
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, padded.width, padded.height);
  context.drawImage(source, margin, margin);
  if (enhance) stretchContrast(context, padded.width, padded.height);
  return enhance ? scaleForOcr(padded) : padded;
}

function stretchContrast(context, width, height) {
  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const gray = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
    data[i] = data[i + 1] = data[i + 2] = gray;
    if (gray < min) min = gray;
    if (gray > max) max = gray;
  }
  const span = Math.max(1, max - min);
  for (let i = 0; i < data.length; i += 4) {
    const value = ((data[i] - min) * 255) / span;
    data[i] = data[i + 1] = data[i + 2] = value;
  }
  context.putImageData(image, 0, 0);
}

function scaleForOcr(source) {
  const heightScale = source.height < 150 ? 150 / source.height : 1;
  const widthScale = source.width < 900 ? 900 / source.width : 1;
  const scale = Math.min(3, Math.max(heightScale, widthScale));
  if (scale <= 1.05) return source;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function canvasToJpeg(canvas) {
  const output = document.createElement('canvas');
  const scale = Math.min(1, 2000 / canvas.width);
  output.width = Math.max(1, Math.round(canvas.width * scale));
  output.height = Math.max(1, Math.round(canvas.height * scale));
  output.getContext('2d').drawImage(canvas, 0, 0, output.width, output.height);
  const url = output.toDataURL('image/jpeg', 0.9);
  const [, body] = url.split(',');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'image/jpeg' });
}

function safeStem(value) {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/^\.+/, '').trim().slice(0, 80);
}

function fallbackStem(item) {
  const original = item.sourceName.replace(/\.[^.]+$/, '');
  return safeStem(`未辨識_${original}`) || '未辨識標題';
}

function stems() {
  const counts = new Map();
  return items.map((item) => {
    const base = safeStem(item.title) || fallbackStem(item);
    const seen = counts.get(base) || 0;
    counts.set(base, seen + 1);
    return seen === 0 ? base : `${base}_${seen + 1}`;
  });
}

function extension() {
  return formatSelect.value === 'pdf' ? '.pdf' : '.jpg';
}

function appendCard(item) {
  resultsEl.hidden = false;
  countEl.textContent = `辨識結果 ${items.length} 頁`;

  const card = document.createElement('li');
  card.className = 'card';

  const image = document.createElement('img');
  image.className = 'thumb';
  image.alt = '';
  if (item.thumbUrl) image.src = item.thumbUrl;

  const body = document.createElement('div');
  const heading = document.createElement('h3');
  heading.textContent = `${item.sourceName} · ${item.pageLabel}`;

  const input = document.createElement('input');
  input.className = 'title-input';
  input.value = item.title;
  input.placeholder = '沒讀到比賽標題，請自行輸入';
  input.setAttribute('aria-label', `${item.sourceName} 的比賽標題`);
  input.addEventListener('input', () => {
    item.title = input.value.trim();
    refreshNames();
  });

  const fileName = document.createElement('p');
  fileName.className = 'file-name';
  fileName.innerHTML = '存成 <span></span>';

  const raw = document.createElement('p');
  raw.className = item.error ? 'raw missing' : 'raw';
  if (item.error) raw.textContent = item.error;
  else if (item.raw) raw.textContent = `辨識原文：${item.raw.replace(/\s+/g, ' ')}`;
  else raw.textContent = '這頁沒有讀到「○○年……賽」這種比賽標題。';

  const actions = document.createElement('div');
  actions.className = 'card-actions';
  const save = document.createElement('button');
  save.type = 'button';
  save.textContent = '下載這一頁';
  save.disabled = !item.blob;
  save.addEventListener('click', () => {
    const index = items.indexOf(item);
    downloadOne(item, `${stems()[index]}${extension()}`);
  });
  actions.append(save);

  body.append(heading, input, fileName, raw, actions);
  card.append(image, body);
  listEl.append(card);
}

function refreshNames() {
  const names = stems();
  const ext = extension();
  [...listEl.children].forEach((card, index) => {
    const slot = card.querySelector('.file-name span');
    if (slot) slot.textContent = `${names[index]}${ext}`;
  });
}

async function downloadOne(item, filename) {
  const blob = await outputBlob(item);
  saveBlob(blob, filename);
}

async function downloadAll() {
  if (!items.length || busy) return;
  downloadBtn.disabled = true;
  setStatus('正在打包…');
  try {
    const names = stems();
    const ext = extension();
    const files = {};
    let saved = 0;
    for (let index = 0; index < items.length; index += 1) {
      if (!items[index].blob) continue;
      const blob = await outputBlob(items[index]);
      files[`${names[index]}${ext}`] = new Uint8Array(await blob.arrayBuffer());
      saved += 1;
    }
    if (!saved) throw new Error('沒有可下載的頁面');
    const zipped = zipSync(files, { level: 6 });
    const stamp = new Date().toISOString().slice(0, 10);
    saveBlob(new Blob([zipped], { type: 'application/zip' }), `比賽標題_${stamp}.zip`);
    setStatus(`已下載 ${saved} 個檔案。`);
  } catch (error) {
    console.error(error);
    setStatus(`下載失敗：${error.message || error}`);
  } finally {
    downloadBtn.disabled = false;
  }
}

async function outputBlob(item) {
  if (formatSelect.value === 'jpg') return item.blob;
  if (item.isPdf) {
    const source = await PDFDocument.load(item.sourceBytes);
    const next = await PDFDocument.create();
    const [page] = await next.copyPages(source, [item.pageIndex]);
    next.addPage(page);
    next.setTitle(item.title || item.sourceName);
    return new Blob([await next.save()], { type: 'application/pdf' });
  }
  const pdf = await PDFDocument.create();
  const image = await pdf.embedJpg(new Uint8Array(await item.blob.arrayBuffer()));
  const page = pdf.addPage([image.width, image.height]);
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  pdf.setTitle(item.title || item.sourceName);
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
