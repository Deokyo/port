(() => {
  'use strict';
  const base = new URL('../', document.currentScript.src);
  const pages = ["index.html", "projects/landing-pages/cases/agradecimento-rog-experimental/index.html", "projects/landing-pages/cases/agradecimento/index.html", "projects/landing-pages/cases/auditoria/index.html", "projects/landing-pages/cases/bpo-folha/index.html", "projects/landing-pages/cases/bpo/index.html", "projects/landing-pages/cases/contas-a-receber/index.html", "projects/landing-pages/cases/demo-conformidade/index.html", "projects/landing-pages/cases/demo-satisfacao/index.html", "projects/landing-pages/cases/gestao-contabil/index.html", "projects/landing-pages/cases/principal-cwb/index.html", "projects/landing-pages/cases/rog-e/index.html", "projects/landing-pages/cases/workshop-a/index.html", "projects/landing-pages/cases/workshop-b/index.html", "projects/landing-pages/index.html", "projects/programa-win/index.html", "projects/project-atlas/index.html", "projects/prumo/index.html"];
  const i18n = window.portfolioI18n;
  const cache = new Map();
  let active = pageKey(new URL(location.href));
  let sequence = 0;
  let controller;
  function pageKey(url) {
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return null;
    let path = url.pathname.slice(base.pathname.length);
    if (!path || path.endsWith('/')) path += 'index.html';
    return pages.includes(path) ? path : null;
  }
  function normalizeLinks(root, url) {
    root.querySelectorAll('a[href],img[src],image[href],iframe[src],source[src],video[src],video[poster]').forEach(node => {
      for (const attr of ['href', 'src', 'poster']) {
        if (node.hasAttribute(attr)) node.setAttribute(attr, new URL(node.getAttribute(attr), url).href);
      }
      if (node.localName === 'a') {
        const destination = new URL(node.href);
        if (pageKey(destination)) {
          destination.searchParams.set('lang', i18n.language);
          node.href = destination.href;
        } else if (destination.origin === base.origin && (/\/demo\//.test(destination.pathname) || /\.(md|txt)$/.test(destination.pathname))) {
          node.target = '_blank';
          node.rel = 'noopener noreferrer';
          if (/\/demo\//.test(destination.pathname)) node.setAttribute('aria-label', i18n.t('Explorar a página (abre em nova aba)'));
        }
      }
    });
  }
  function headSnapshot(doc) {
    const meta = {};
    for (const selector of ['meta[name="description"]', 'meta[property="og:title"]', 'meta[property="og:description"]', 'meta[property="og:url"]', 'meta[property="og:image"]', 'meta[property="og:type"]']) {
      const node = doc.querySelector(selector);
      if (node) meta[selector] = i18n.attributeSource(node, 'content');
    }
    return { title: i18n.textSource(doc.querySelector('title').firstChild), meta, canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute('href') };
  }
  function setHead(snapshot) {
    document.title = snapshot.title;
    document.querySelectorAll('meta[name="description"],meta[property^="og:"]').forEach(node => {
      const attr = node.hasAttribute('name') ? 'name' : 'property';
      const selector = 'meta[' + attr + '="' + node.getAttribute(attr) + '"]';
      if (!Object.hasOwn(snapshot.meta, selector)) node.remove();
    });
    for (const [selector, value] of Object.entries(snapshot.meta)) {
      let node = document.querySelector(selector);
      if (!node) {
        node = document.createElement('meta');
        const match = selector.match(/\[(name|property)="([^"]+)"\]/);
        node.setAttribute(match[1], match[2]);
        document.head.append(node);
      }
      node.setAttribute('content', value);
    }
    if (snapshot.canonical) document.querySelector('link[rel="canonical"]').href = snapshot.canonical;
    i18n.forget(document.head);
  }
  normalizeLinks(document.body, new URL(location.href));
  cache.set(active, {main: document.querySelector('main'), footer: document.querySelector('.site-footer'), head: headSnapshot(document)});
  const status = document.createElement('div');
  status.className = 'navigation-status';
  status.setAttribute('role', 'status');
  document.body.append(status);
  history.scrollRestoration = 'manual';
  history.replaceState({...history.state, portfolio: true, scroll: {x: scrollX, y: scrollY}}, '', location.href);
  function scrollToDestination(url, position) {
    if (position) { window.scrollTo({left: position.x, top: position.y, behavior: 'instant'}); return; }
    let target;
    try { target = url.hash && document.getElementById(decodeURIComponent(url.hash.slice(1))); } catch (_) {}
    if (target) target.scrollIntoView({behavior: 'instant'});
    else window.scrollTo({top: 0, left: 0, behavior: 'instant'});
  }
  async function navigate(url, options = {}) {
    const key = pageKey(url);
    if (!key) return;
    const serial = ++sequence;
    if (controller) controller.abort();
    controller = new AbortController();
    const currentMain = document.querySelector('main');
    if (!options.pop) {
      history.replaceState({...history.state, portfolio: true, scroll: {x: scrollX, y: scrollY}}, '', location.href);
    }
    status.textContent = i18n.t('Carregando página…');
    currentMain.setAttribute('aria-busy', 'true');
    try {
      let next = cache.get(key);
      if (!next) {
        const sourceURL = new URL(key, base);
        sourceURL.searchParams.set('v', 'results-1');
        const response = await fetch(sourceURL, {signal: controller.signal});
        if (!response.ok) throw new Error('Page unavailable');
        const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
        const main = doc.querySelector('main');
        if (!main) throw new Error('Missing page content');
        normalizeLinks(main, new URL(key, base));
        next = {main: document.importNode(main, true), footer: document.importNode(doc.querySelector('.site-footer'), true), head: headSnapshot(doc)};
        normalizeLinks(next.footer, new URL(key, base));
        cache.set(key, next);
      }
      if (serial !== sequence) return;
      if (key !== active) {
        currentMain.replaceWith(next.main);
        document.querySelector('.site-footer').replaceWith(next.footer);
        active = key;
        setHead(next.head);
      }
      url.searchParams.set('lang', i18n.language);
      if (!options.pop) history.pushState({portfolio: true}, '', url);
      else history.replaceState(history.state, '', url);
      i18n.translate();
      document.dispatchEvent(new Event('portfolio:languagechange'));
      window.portfolioSetupPage();
      next.main.focus({preventScroll: true});
      scrollToDestination(url, options.state?.scroll);
      status.textContent = i18n.t('Página carregada');
    } catch (error) {
      if (error.name !== 'AbortError' && serial === sequence) location.assign(url.href);
    } finally {
      if (serial === sequence) document.querySelector('main').removeAttribute('aria-busy');
    }
  }
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
    const url = new URL(link.href);
    if (!pageKey(url)) return;
    event.preventDefault();
    navigate(url);
  });
  document.addEventListener('portfolio:languagechange', () => normalizeLinks(document.body, new URL(location.href)));
  i18n.translate();
  window.addEventListener('popstate', event => navigate(new URL(location.href), {pop: true, state: event.state}));
})();
