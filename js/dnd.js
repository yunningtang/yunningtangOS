// Tiny drag-and-drop helpers over HTML5 DnD with a typed payload.
let payload = null;
export function dragProps(type, data, extra = {}) {
  return {
    draggable: true,
    onDragStart: (e) => { payload = { type, data }; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', type + ':' + (data.id || '')); } catch {} e.currentTarget.classList.add('dragging'); extra.onStart && extra.onStart(e); },
    onDragEnd: (e) => { e.currentTarget.classList.remove('dragging'); payload = null; document.querySelectorAll('.drop-over,.drop-before,.drop-after').forEach((el) => el.classList.remove('drop-over', 'drop-before', 'drop-after')); extra.onEnd && extra.onEnd(e); },
  };
}
export function current() { return payload; }
export function dropProps(types, onDrop, opts = {}) {
  const accepts = () => payload && (Array.isArray(types) ? types.includes(payload.type) : types === payload.type);
  return {
    onDragOver: (e) => { if (!accepts()) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const el = e.currentTarget; if (opts.position) { const r = el.getBoundingClientRect(); const after = (opts.horizontal ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2); el.classList.toggle('drop-before', !after); el.classList.toggle('drop-after', after); } else el.classList.add('drop-over'); },
    onDragLeave: (e) => { const el = e.currentTarget; if (el.contains(e.relatedTarget)) return; el.classList.remove('drop-over', 'drop-before', 'drop-after'); },
    onDrop: (e) => { if (!accepts()) return; e.preventDefault(); e.stopPropagation(); const el = e.currentTarget; const after = el.classList.contains('drop-after'); el.classList.remove('drop-over', 'drop-before', 'drop-after'); const p = payload; payload = null; onDrop(p.data, { after, event: e }); },
  };
}
