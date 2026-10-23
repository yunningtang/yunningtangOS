// Attachments (PDFs and other files) live in IndexedDB, not in the JSON document: blobs are big and
// the document is synced as one file. Each record: { id, name, type, size, blob, created, synced }.
// When a GitHub sync target is configured the blob is also pushed to assets/<id> in the data repo,
// and fetched from there on another device the first time it is needed.
import { uid } from './util.js';

const DB = 'ytos-files', STORE = 'files';
let dbp;
function db() {
  dbp = dbp || new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
function tx(mode, fn) {
  return db().then((d) => new Promise((res, rej) => { const t = d.transaction(STORE, mode); const req = fn(t.objectStore(STORE)); t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error); }));
}

export const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B');
export const isPdf = (f) => f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name || ''));

export async function saveFile(file) {
  const rec = { id: uid(), name: file.name || 'file', type: file.type || 'application/octet-stream', size: file.size, blob: file, created: new Date().toISOString(), synced: false };
  await tx('readwrite', (s) => s.put(rec));
  return rec;
}
export async function getFile(id) { try { return await tx('readonly', (s) => s.get(id)); } catch { return null; } }
export async function listFiles() { try { return (await tx('readonly', (s) => s.getAll())) || []; } catch { return []; } }
export async function deleteFile(id) { return tx('readwrite', (s) => s.delete(id)); }
export async function markSynced(id) { const r = await getFile(id); if (r) { r.synced = true; await tx('readwrite', (s) => s.put(r)); } }
export async function putRemote(id, name, type, blob) { const rec = { id, name, type, size: blob.size, blob, created: new Date().toISOString(), synced: true }; await tx('readwrite', (s) => s.put(rec)); return rec; }

// object URLs are cached per id so previews don't leak
const urls = new Map();
export async function fileUrl(id) {
  if (urls.has(id)) return urls.get(id);
  const r = await getFile(id); if (!r) return null;
  const u = URL.createObjectURL(r.blob); urls.set(id, u); return u;
}
export function forgetUrl(id) { const u = urls.get(id); if (u) { URL.revokeObjectURL(u); urls.delete(id); } }

export function blobToBase64(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(blob); });
}
export function base64ToBlob(b64, type) {
  const bin = atob(b64.replace(/\n/g, '')); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}
