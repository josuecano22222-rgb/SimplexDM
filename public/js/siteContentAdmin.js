(() => {
  const API = '/api/site-content';

  const $ = (id) => document.getElementById(id);
  const editor = $('jsonEditor');
  const status = $('status');
  const reloadBtn = $('reloadBtn');
  const saveBtn = $('saveBtn');

  function setStatus(msg) {
    if (status) status.textContent = msg;
  }

  async function load() {
    setStatus('Loading…');
    const res = await fetch(API, { cache: 'no-store' });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Load failed (${res.status})\n${text}`);
    }
    const json = await res.json();
    editor.value = JSON.stringify(json, null, 2);
    setStatus('Loaded.');
  }

  async function save() {
    let parsed;
    try {
      parsed = JSON.parse(editor.value || '{}');
    } catch (err) {
      setStatus(`Invalid JSON:\n${err.message}`);
      return;
    }

    setStatus('Saving…');
    const res = await fetch(API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed)
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Save failed (${res.status})\n${text}`);
    }

    const out = await res.json().catch(() => ({}));
    setStatus(`Saved.\n${out.path ? `Path: ${out.path}` : ''}`.trim());
  }

  function wire() {
    reloadBtn?.addEventListener('click', () => load().catch((e) => setStatus(String(e.message || e))));
    saveBtn?.addEventListener('click', () => save().catch((e) => setStatus(String(e.message || e))));
  }

  wire();
  load().catch((e) => setStatus(String(e.message || e)));
})();

