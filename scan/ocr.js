/**
 * One local Tesseract worker, created on the first read and reused.
 * Cancelling terminates that worker. The next read creates another.
 * Text output only: hOCR/TSV are off so we do less work and do not
 * surface the library's character scores.
 */
import { needsCodePass } from './engine.js';

function abortError() {
  const err = new Error('cancelled');
  err.name = 'AbortError';
  return err;
}

export function createSession(factory) {
  if (typeof factory !== 'function') throw new Error('factory');
  let workerPromise = null;
  let chain = Promise.resolve();
  const progress = { fn: () => {} };

  function terminate() {
    const pending = workerPromise;
    workerPromise = null;
    if (!pending) return;
    pending.then((worker) => {
      try {
        if (worker && typeof worker.terminate === 'function') worker.terminate();
      } catch {
        /* The worker is already gone. */
      }
    }).catch(() => {});
  }

  function obtain() {
    if (!workerPromise) {
      const job = Promise.resolve().then(() => factory(progress));
      workerPromise = job;
      job.catch(() => {
        if (workerPromise === job) workerPromise = null;
      });
    }
    return workerPromise;
  }

  function read(image, { signal, onProgress, rectangle, psm } = {}) {
    const job = chain.then(() => runRead(image, { signal, onProgress, rectangle, psm }));
    chain = job.then(() => {}, () => {});
    return job;
  }

  async function runRead(image, { signal, onProgress, rectangle, psm }) {
    if (signal?.aborted) throw abortError();
    progress.fn = typeof onProgress === 'function' ? onProgress : () => {};
    const worker = await obtain();
    if (signal?.aborted) {
      terminate();
      throw abortError();
    }
    const opts = {};
    if (psm) opts.tessedit_pageseg_mode = String(psm);
    if (rectangle) opts.rectangle = rectangle;
    let settled = false;
    let recognized;
    try {
      recognized = worker.recognize(
        image,
        opts,
        { text: true, blocks: false, hocr: false, tsv: false, box: false, unlv: false, osd: false },
      );
    } catch (err) {
      progress.fn = () => {};
      throw err;
    }
    try {
      const outcome = await new Promise((resolve, reject) => {
        const finish = (fn, value) => {
          if (settled) return;
          settled = true;
          if (signal) signal.removeEventListener('abort', onAbort);
          fn(value);
        };
        const onAbort = () => {
          terminate();
          finish(reject, abortError());
        };
        if (signal) {
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener('abort', onAbort, { once: true });
        }
        Promise.resolve(recognized).then(
          (value) => finish(resolve, value),
          (err) => finish(reject, err),
        );
      });
      if (signal?.aborted) throw abortError();
      const text = outcome && outcome.data && typeof outcome.data.text === 'string' ? outcome.data.text : '';
      return text;
    } finally {
      progress.fn = () => {};
    }
  }

  return { read, terminate };
}

export async function readCardImage(session, canvas, opts = {}) {
  const first = await session.read(canvas, { ...opts, psm: '6' });
  if (opts.signal?.aborted) throw abortError();
  const height = canvas && canvas.height;
  if (!needsCodePass(first) || !(height >= 80)) return first;
  const top = Math.floor(height * 0.68);
  const second = await session.read(canvas, {
    ...opts,
    psm: '7',
    rectangle: {
      left: 0,
      top,
      width: canvas.width,
      height: height - top,
    },
  });
  return `${first}\n${second}`;
}

function pickCreateWorker(mod) {
  if (mod && typeof mod.createWorker === 'function') return mod.createWorker;
  if (mod && mod.default && typeof mod.default.createWorker === 'function') return mod.default.createWorker;
  return null;
}

async function realFactory(progress) {
  const mod = await import('./vendor/tesseract.esm.min.js');
  const createWorker = pickCreateWorker(mod);
  if (!createWorker) throw new Error('Local text reader failed to load.');
  const worker = await createWorker('eng', 1, {
    workerPath: new URL('./vendor/worker.min.js', import.meta.url).href,
    corePath: new URL('./vendor/core/', import.meta.url).href,
    langPath: new URL('./vendor/lang/', import.meta.url).href,
    workerBlobURL: false,
    gzip: true,
    logger: (message) => progress.fn(message),
    errorHandler: () => {},
  });
  return worker;
}

export function openReader() {
  return createSession(realFactory);
}
