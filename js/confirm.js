// In-app confirm / prompt dialogs returning promises. Replaces window.confirm / window.prompt.
import { html, render, useState, useEffect, useRef } from '../vendor/preact.js';

let host, setReq;
function Host() {
  const [req, set] = useState(null); setReq = set;
  const ref = useRef();
  useEffect(() => { if (req && ref.current) { ref.current.focus(); if (ref.current.select) ref.current.select(); } }, [req]);
  if (!req) return null;
  const done = (v) => { set(null); req.resolve(v); };
  return html`<div class="modal-bg" onMouseDown=${(e) => e.target === e.currentTarget && done(req.kind === 'prompt' ? null : false)}>
    <div class="modal confirm" role="dialog" onKeyDown=${(e) => { if (e.key === 'Escape') done(req.kind === 'prompt' ? null : false); }}>
      <div class="modal-b" style="padding:22px 22px 6px">
        ${req.title && html`<h3 style="font-size:1rem;margin-bottom:6px">${req.title}</h3>`}
        ${req.message && html`<p class="small" style="color:var(--text-3);line-height:1.6">${req.message}</p>`}
        ${req.kind === 'prompt' && html`<input ref=${ref} type="text" value=${req.value || ''} placeholder=${req.placeholder || ''} style="margin-top:12px" onKeyDown=${(e) => { if (e.key === 'Enter') done(e.target.value); }} />`}
      </div>
      <div class="modal-f" style="border:0;padding-top:8px">
        <button class="btn ghost" onClick=${() => done(req.kind === 'prompt' ? null : false)}>取消</button>
        <button ref=${req.kind === 'prompt' ? null : ref} class=${'btn ' + (req.danger ? 'danger-solid' : 'primary')} onClick=${() => done(req.kind === 'prompt' ? (ref.current ? ref.current.value : '') : true)}>${req.ok || (req.danger ? '删除' : '确定')}</button>
      </div>
    </div>
  </div>`;
}
function ensure() { if (!host) { host = document.createElement('div'); host.id = 'confirm-host'; document.body.appendChild(host); render(html`<${Host} />`, host); } }
export function askConfirm(message, { title = '', ok = '', danger = true } = {}) { ensure(); return new Promise((resolve) => setReq({ kind: 'confirm', message, title, ok, danger, resolve })); }
export function askPrompt(message, value = '', { title = '', ok = '确定', placeholder = '' } = {}) { ensure(); return new Promise((resolve) => setReq({ kind: 'prompt', message, value, title, ok, placeholder, resolve })); }
