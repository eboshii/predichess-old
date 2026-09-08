/**
 * eboshii instant-nav: Seamless zero-flicker client-side navigation
 * Keeps the WebGL background canvas permanently alive and uninterrupted across page transitions.
 * Features gentle, low-overhead background prefetching (idle queue + hover preload + in-memory cache).
 */
(function () {
  if (!window.history || !window.fetch || !window.DOMParser) return;

  // In-memory page cache and in-flight fetch registry
  const pageCache = new Map();
  const inFlightFetches = new Map();

  // Helper to test if a domain belongs to eboshii ecosystem
  function isEboshiiDomain(hostname) {
    return hostname === 'eboshii.github.io' || hostname === 'eboshii.dev' || hostname === window.location.hostname;
  }

  // Check if link is an internal page eligible for SPA routing
  function isEligibleLink(link) {
    if (!link) return false;
    const href = link.getAttribute('href');
    if (!href) return false;

    if (
      link.target === '_blank' ||
      href.startsWith('#') ||
      href.startsWith('mailto:') ||
      href.startsWith('tel:') ||
      href.toLowerCase().includes('paperclips') ||
      href.includes('itch.io')
    ) {
      return false;
    }

    try {
      const targetUrl = new URL(link.href, window.location.href);
      if (targetUrl.origin === window.location.origin) return true;
      if (isEboshiiDomain(targetUrl.hostname) && isEboshiiDomain(window.location.hostname)) {
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  // Respect user data-saver settings and slow connections
  function canBackgroundPrefetch() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
      if (conn.saveData) return false;
      if (['slow-2g', '2g'].includes(conn.effectiveType)) return false;
    }
    return true;
  }

  // Fetch and parse page content with deduplication and in-memory caching
  async function fetchPage(targetUrl, isHighPriority = false) {
    const key = targetUrl.pathname.replace(/\/+$/, '') || '/';

    if (pageCache.has(key)) {
      return pageCache.get(key);
    }

    if (inFlightFetches.has(key)) {
      return inFlightFetches.get(key);
    }

    const fetchPromise = (async () => {
      try {
        const fetchOpts = isHighPriority ? {} : { priority: 'low' };
        // Normalize fetch to current origin to avoid cross-origin CORS on GitHub Pages
        const fetchUrl = new URL(targetUrl.pathname + targetUrl.search, window.location.origin);
        const res = await fetch(fetchUrl.href, fetchOpts);
        if (!res.ok) return null;

        const html = await res.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const data = { html, doc };
        pageCache.set(key, data);
        return data;
      } catch (e) {
        return null;
      } finally {
        inFlightFetches.delete(key);
      }
    })();

    inFlightFetches.set(key, fetchPromise);
    return fetchPromise;
  }

  // Preload a single link gently
  function prefetchLink(link) {
    if (!isEligibleLink(link)) return;
    const targetUrl = new URL(link.href, window.location.href);
    const key = targetUrl.pathname.replace(/\/+$/, '') || '/';
    const currentKey = window.location.pathname.replace(/\/+$/, '') || '/';
    if (key === currentKey) return;

    fetchPage(targetUrl, false);
  }

  // Gentle idle-queue to prefetch primary nav tabs without starving the CPU or main thread
  function queueIdlePrefetches() {
    if (!canBackgroundPrefetch()) return;

    const navLinks = Array.from(document.querySelectorAll('.nav-links a, .site-title, .footer-stats-link'))
      .filter(isEligibleLink);

    const idleCallback = window.requestIdleCallback || (cb => setTimeout(cb, 500));

    let index = 0;
    function processNext() {
      if (index >= navLinks.length) return;
      const link = navLinks[index++];
      const targetUrl = new URL(link.href, window.location.href);
      const key = targetUrl.pathname.replace(/\/+$/, '') || '/';
      const currentKey = window.location.pathname.replace(/\/+$/, '') || '/';

      if (key !== currentKey && !pageCache.has(key)) {
        fetchPage(targetUrl, false).then(() => {
          // Stagger each prefetch by 400ms during browser idle periods
          setTimeout(() => {
            idleCallback(processNext);
          }, 400);
        });
      } else {
        idleCallback(processNext);
      }
    }

    // Allow the initial page rendering & WebGL background to stabilize first (1.5s delay)
    setTimeout(() => {
      idleCallback(processNext);
    }, 1500);
  }

  // Execute embedded scripts in swapped content
  function runScripts(container) {
    const scripts = container.querySelectorAll('script');
    scripts.forEach(oldScript => {
      const newScript = document.createElement('script');
      Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
      newScript.textContent = oldScript.textContent;
      oldScript.parentNode.replaceChild(newScript, oldScript);
    });
  }

  // Nav tabs that stay lit for a whole family of routes (dropdowns, collections)
  const NAV_GROUPS = {
    '/tools': ['/tools', '/pre-ipo', '/news'],
    '/games': ['/games'],
    '/blog': ['/blog', '/artificial-life', '/quant', '/travel']
  };

  // Update active state in navigation
  function updateNav(url) {
    document.querySelectorAll('.nav-links a').forEach(link => {
      const href = link.getAttribute('href');
      if (!href) return;

      const cleanHref = href.replace(/\/+$/, '');
      const cleanPath = url.pathname.replace(/\/+$/, '');
      const group = NAV_GROUPS[cleanHref];

      if (group) {
        if (group.some(p => cleanPath === p || cleanPath.startsWith(p + '/'))) {
          link.classList.add('active');
        } else {
          link.classList.remove('active');
        }
      } else if (cleanHref === cleanPath || (cleanHref && cleanPath.startsWith(cleanHref) && cleanHref !== '')) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    document.querySelectorAll('.footer-stats-link').forEach(footerLink => {
      const href = footerLink.getAttribute('href');
      if (href && url.pathname.includes(href.replace(/\/+$/, ''))) {
        footerLink.classList.add('active');
      } else {
        footerLink.classList.remove('active');
      }
    });
  }

  // On-demand lazy loader for MathJax
  function checkAndRenderMath(container) {
    const root = container || document.querySelector('main');
    if (!root) return;
    const text = root.textContent || '';
    const hasMath = text.includes('$') || text.includes('\\(') || root.querySelector('script[type^="math/tex"]');
    if (!hasMath) return;

    if (window.MathJax) {
      if (typeof window.MathJax.typesetPromise === 'function') {
        window.MathJax.typesetPromise([root]).catch(function (err) {
          console.error('MathJax typeset error:', err);
        });
      } else if (window.MathJax.startup && window.MathJax.startup.promise) {
        window.MathJax.startup.promise.then(function () {
          window.MathJax.typesetPromise([root]);
        });
      }
    } else if (!document.getElementById('mathjax-dynamic-script')) {
      window.MathJax = {
        tex: {
          inlineMath: [['$', '$'], ['\\(', '\\)']],
          displayMath: [['$$', '$$'], ['\\[', '\\]']],
          processEscapes: true
        },
        options: {
          renderActions: {
            findScript: [10, function (doc) {
              for (const node of document.querySelectorAll('script[type^="math/tex"]')) {
                const display = !!node.type.match(/mode=display/);
                const math = new doc.options.MathItem(node.textContent, doc.input[0], display);
                const textNode = document.createTextNode('');
                node.parentNode.replaceChild(textNode, node);
                math.start = {node: textNode, delim: '', n: 0};
                math.end = {node: textNode, delim: '', n: 0};
                doc.math.push(math);
              }
            }, '']
          }
        },
        svg: { fontCache: 'global' }
      };
      const script = document.createElement('script');
      script.id = 'mathjax-dynamic-script';
      script.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js';
      script.async = true;
      document.head.appendChild(script);
    }
  }

  // On-demand lazy loader for Mermaid
  function checkAndRenderMermaid(container) {
    const root = container || document.querySelector('main');
    if (!root) return;
    const mermaidCodes = root.querySelectorAll('.language-mermaid, pre code.language-mermaid, .mermaid');
    if (mermaidCodes.length === 0) return;

    function renderDiagrams() {
      root.querySelectorAll('.language-mermaid, pre code.language-mermaid').forEach(function (el) {
        if (el.dataset.mermaidProcessed) return;
        el.dataset.mermaidProcessed = 'true';
        const code = el.textContent;
        const div = document.createElement('div');
        div.className = 'mermaid';
        div.textContent = code;
        const pre = el.closest('pre');
        if (pre) {
          pre.parentNode.replaceChild(div, pre);
        } else {
          el.parentNode.replaceChild(div, el);
        }
      });
      if (window.mermaid) {
        window.mermaid.run({ nodes: root.querySelectorAll('.mermaid') });
      }
    }

    if (window.mermaid) {
      renderDiagrams();
    } else if (!document.getElementById('mermaid-dynamic-script')) {
      const script = document.createElement('script');
      script.id = 'mermaid-dynamic-script';
      script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js';
      script.onload = function () {
        window.mermaid.initialize({ startOnLoad: false, theme: 'default' });
        renderDiagrams();
      };
      document.head.appendChild(script);
    }
  }

  // Helper to dynamically load external scripts sequentially once
  function loadScriptOnce(id, src) {
    if (document.getElementById(id)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.id = id;
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function navigate(url, pushState = true) {
    try {
      const currentMain = document.querySelector('main');

      // 1. Cosmic Dither Dissolve Out (85ms)
      if (currentMain) {
        currentMain.classList.remove('dither-enter');
        currentMain.classList.add('dither-exit');
      }

      // Fetch or retrieve from cache in parallel with the 85ms dither animation
      const [pageData] = await Promise.all([
        fetchPage(url, true),
        currentMain ? new Promise(r => setTimeout(r, 85)) : Promise.resolve()
      ]);

      if (!pageData || !pageData.doc) {
        window.location.href = url.href;
        return;
      }

      const doc = pageData.doc;
      const newMain = doc.querySelector('main');
      if (!newMain || !currentMain) {
        window.location.href = url.href;
        return;
      }

      const isPredichessRoute = url.pathname.includes('/predichess');
      const wasPredichessRoute = window.location.pathname.includes('/predichess');

      // Cleanup if leaving Predichess
      if (wasPredichessRoute && !isPredichessRoute) {
        if (typeof window.cleanupPredichessApp === 'function') {
          window.cleanupPredichessApp();
        }
        const predCss = document.getElementById('predichess-css') || document.getElementById('predichess-stylesheet');
        if (predCss) predCss.disabled = true;
        const eboshiiCss = document.getElementById('eboshii-main-css');
        if (eboshiiCss) eboshiiCss.disabled = false;
      }

      // Update page title
      document.title = doc.title;

      // Update header if target page specifies a header
      const newHeader = doc.querySelector('header');
      const currentHeader = document.querySelector('header');
      if (newHeader && currentHeader) {
        currentHeader.className = newHeader.className;
        currentHeader.innerHTML = newHeader.innerHTML;
      }

      // Update footer if target page specifies a footer
      const newFooter = doc.querySelector('footer');
      const currentFooter = document.querySelector('footer');
      if (newFooter && currentFooter) {
        currentFooter.className = newFooter.className;
        currentFooter.innerHTML = newFooter.innerHTML;
      }

      // Update main class
      currentMain.className = newMain.className;

      // Swap main content without touching the WebGL canvas
      currentMain.innerHTML = newMain.innerHTML;

      // Toggle permanent Ko-fi host visibility without moving/reloading iframe
      const kofiHost = document.getElementById('global-kofi-host');
      const kofiIframe = document.getElementById('global-kofi-iframe');
      if (kofiHost) {
        const isTip = url.pathname.includes('/tip');
        if (isTip && kofiIframe && !kofiIframe.getAttribute('src') && kofiIframe.dataset.src) {
          kofiIframe.src = kofiIframe.dataset.src;
        }
        kofiHost.classList.toggle('active', isTip);
      }

      // Handle Predichess specific assets & initialization
      if (isPredichessRoute) {
        // Disable main site CSS so Predichess layout has full unconstrained space
        const eboshiiCss = document.getElementById('eboshii-main-css');
        if (eboshiiCss) eboshiiCss.disabled = true;

        // Ensure Predichess CSS is loaded and active
        let predCss = document.getElementById('predichess-css') || document.getElementById('predichess-stylesheet');
        if (!predCss) {
          predCss = document.createElement('link');
          predCss.id = 'predichess-css';
          predCss.rel = 'stylesheet';
          predCss.href = new URL('/predichess/styles.css', window.location.origin).href;
          document.head.appendChild(predCss);
        } else {
          predCss.disabled = false;
        }

        // Ensure MQTT and PeerJS scripts are loaded
        if (!window.mqtt) {
          await loadScriptOnce('script-mqtt', 'https://unpkg.com/mqtt@5.3.5/dist/mqtt.min.js');
        }
        if (!window.Peer) {
          await loadScriptOnce('script-peerjs', 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js');
        }

        // Initialize or re-mount Predichess application
        if (typeof window.initPredichessApp === 'function') {
          window.initPredichessApp();
        } else {
          const appJsUrl = new URL('/predichess/app.js', window.location.origin).href;
          await import(appJsUrl);
        }
      } else {
        // If moving to non-predichess page, ensure main css is active
        let eboshiiCss = document.getElementById('eboshii-main-css');
        if (!eboshiiCss) {
          const docCss = doc.querySelector('link[href*="main.css"]');
          if (docCss) {
            eboshiiCss = document.createElement('link');
            eboshiiCss.id = 'eboshii-main-css';
            eboshiiCss.rel = 'stylesheet';
            eboshiiCss.href = new URL(docCss.getAttribute('href'), url).href;
            document.head.appendChild(eboshiiCss);
          }
        } else {
          eboshiiCss.disabled = false;
        }
      }

      // Update nav highlights
      updateNav(url);

      if (pushState) {
        window.history.pushState({}, '', url.href);
      }

      // Scroll to top
      window.scrollTo({ top: 0, behavior: 'instant' });

      // Run any page-specific scripts (news search, stats expandable table, etc.)
      runScripts(currentMain);

      // Dynamic on-demand MathJax and Mermaid rendering
      checkAndRenderMath(currentMain);
      checkAndRenderMermaid(currentMain);

      // Trigger tracking on new route
      if (window.EboshiiTracker) {
        const key = window.EboshiiTracker.getRouteKey(url.pathname);
        if (key) {
          window.EboshiiTracker.recordHit(key);
        }
      }

      // 2. Cosmic Dither Crystallize In (130ms)
      currentMain.classList.remove('dither-exit');
      currentMain.classList.add('dither-enter');
      setTimeout(() => {
        currentMain.classList.remove('dither-enter');
      }, 130);

    } catch (e) {
      window.location.href = url.href;
    }
  }

  function checkKofiPreload(link) {
    if (!link) return;
    const href = link.getAttribute('href') || '';
    if (href.includes('/tip')) {
      const kofiIframe = document.getElementById('global-kofi-iframe');
      if (kofiIframe && !kofiIframe.getAttribute('src') && kofiIframe.dataset.src) {
        kofiIframe.src = kofiIframe.dataset.src;
      }
    }
  }

  // Hover & touch prefetching: triggers instant fetch right before click
  document.addEventListener('mouseover', e => {
    const link = e.target.closest('a');
    if (link) {
      checkKofiPreload(link);
      prefetchLink(link);
    }
  }, { passive: true });

  document.addEventListener('touchstart', e => {
    const link = e.target.closest('a');
    if (link) {
      checkKofiPreload(link);
      prefetchLink(link);
    }
  }, { passive: true });

  // Intercept internal link clicks
  document.addEventListener('click', e => {
    const link = e.target.closest('a');
    if (!link) return;

    if (!isEligibleLink(link)) return;

    const targetUrl = new URL(link.href, window.location.href);

    if (targetUrl.pathname === window.location.pathname && targetUrl.search === window.location.search) {
      return;
    }

    e.preventDefault();
    navigate(targetUrl, true);
  });

  // Handle browser back/forward buttons
  window.addEventListener('popstate', () => {
    navigate(new URL(window.location.href), false);
  });

  // Initialize gentle idle prefetching and check for math/mermaid on initial load
  function onInitialReady() {
    checkAndRenderMath();
    checkAndRenderMermaid();
    queueIdlePrefetches();
  }

  if (document.readyState === 'complete') {
    onInitialReady();
  } else {
    window.addEventListener('load', onInitialReady);
  }
})();
