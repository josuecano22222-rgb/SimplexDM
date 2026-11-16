(() => {
  const DEFAULT_API = '/api/site-content';

  async function fetchSiteContent() {
    const res = await fetch(DEFAULT_API, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load site content (${res.status})`);
    return await res.json();
  }

  function setText(el, value) {
    if (!el) return;
    el.textContent = typeof value === 'string' ? value : '';
  }

  function setAttr(el, name, value) {
    if (!el) return;
    if (value === undefined || value === null || value === '') {
      el.removeAttribute(name);
      return;
    }
    el.setAttribute(name, String(value));
  }

  function renderCesiumInspired(sectionData) {
    const root = document.getElementById('cesiumInspiredSection');
    if (!root || !sectionData) return;

    setText(root.querySelector('[data-sc="cesiumInspired.title"]'), sectionData.title);
    setText(root.querySelector('[data-sc="cesiumInspired.subtitle"]'), sectionData.subtitle);

    const cardsHost = root.querySelector('[data-sc="cesiumInspired.cards"]');
    if (cardsHost) {
      cardsHost.innerHTML = '';
      const cards = Array.isArray(sectionData.cards) ? sectionData.cards : [];
      for (const card of cards) {
        const el = document.createElement('article');
        el.className = 'ci-card';
        el.innerHTML = `
          <div class="ci-card-media">
            <img class="ci-card-img" loading="lazy" decoding="async" />
          </div>
          <div class="ci-card-body">
            <div class="ci-card-eyebrow"></div>
            <h4 class="ci-card-title"></h4>
            <p class="ci-card-text"></p>
          </div>
        `;

        setText(el.querySelector('.ci-card-eyebrow'), card.eyebrow || '');
        setText(el.querySelector('.ci-card-title'), card.title || '');
        setText(el.querySelector('.ci-card-text'), card.body || '');
        setAttr(el.querySelector('.ci-card-img'), 'src', card?.image?.src || '');
        setAttr(el.querySelector('.ci-card-img'), 'alt', card?.image?.alt || card.title || '');
        cardsHost.appendChild(el);
      }
    }

    const mesh = sectionData.meshTriangles;
    const meshHost = root.querySelector('[data-sc="cesiumInspired.mesh"]');
    if (meshHost && mesh) {
      setText(meshHost.querySelector('[data-sc="cesiumInspired.mesh.title"]'), mesh.title);
      setText(meshHost.querySelector('[data-sc="cesiumInspired.mesh.body"]'), mesh.body);
      setAttr(meshHost.querySelector('img'), 'src', mesh?.image?.src || '');
      setAttr(meshHost.querySelector('img'), 'alt', mesh?.image?.alt || mesh.title || '');
    }
  }

  function wireAdminShortcut() {
    const url = new URL(window.location.href);
    const showAdmin = url.searchParams.get('admin') === '1';
    const el = document.getElementById('adminLink');
    if (!el) return;
    el.style.display = showAdmin ? 'inline-flex' : 'none';
  }

  async function init() {
    wireAdminShortcut();
    try {
      const content = await fetchSiteContent();
      renderCesiumInspired(content.cesiumInspired);
    } catch (err) {
      // Keep the landing page functional even if content fails to load.
      console.warn(err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

