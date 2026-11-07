(function () {
  var VESTO_KEY = 'vpk_93cf9b950d43873cf990fcef56eb174b';
  var ATTRIBUTION_URL = 'https://backend-production-7a466.up.railway.app/api/public/meta/attribution?key=' + encodeURIComponent(VESTO_KEY);
  var NEXT_SELLER_URL = '/api/next-seller';
  var FALLBACK_MSG = "Vim do site, e gostaria de comprar no atacado!";
  var busy = false;

  function buildRef() {
    var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    var suffix = '';
    for (var i = 0; i < 8; i++) suffix += chars.charAt(Math.floor(Math.random() * chars.length));
    return 'vst_' + suffix;
  }

  function getCookie(name) {
    try {
      var m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : null;
    } catch (_) {
      return null;
    }
  }

  function readStoredMeta() {
    try { return JSON.parse(sessionStorage.getItem('vesto_meta') || '{}'); } catch (_) { return {}; }
  }

  function fbclidFromFbc(fbc) {
    if (!fbc) return null;
    var parts = String(fbc).split('.');
    if (parts.length >= 4 && parts[0] === 'fb') return parts.slice(3).join('.') || null;
    return null;
  }

  /** No clique: lê URL + cookies de novo (sessionStorage do load costuma chegar sem _fbp no In-App). */
  function captureMetaAtClick() {
    var stored = readStoredMeta();
    var params = new URLSearchParams(location.search || '');
    var fbclid = params.get('fbclid') || stored.fbclid || null;
    var fbp = getCookie('_fbp') || stored.fbp || null;
    var fbc = getCookie('_fbc') || stored.fbc || null;
    if (!fbclid) fbclid = fbclidFromFbc(fbc);
    // Se a URL trouxe fbclid novo, remonta fbc — cookie antigo de outro clique quebra a atribuição.
    if (fbclid && (!fbc || fbclidFromFbc(fbc) !== fbclid)) {
      fbc = 'fb.1.' + Date.now() + '.' + fbclid;
      try {
        document.cookie = '_fbc=' + encodeURIComponent(fbc) + '; path=/; max-age=7776000; SameSite=Lax';
      } catch (_) {}
    }
    var meta = {
      fbclid: fbclid || null,
      fbc: fbc || null,
      fbp: fbp || null,
      clickAt: Date.now(),
      pageUrl: location.href,
      userAgent: navigator.userAgent || '',
      utm_source: params.get('utm_source') || stored.utm_source || '',
      utm_medium: params.get('utm_medium') || stored.utm_medium || '',
      utm_campaign: params.get('utm_campaign') || stored.utm_campaign || '',
      utm_content: params.get('utm_content') || stored.utm_content || '',
      utm_term: params.get('utm_term') || stored.utm_term || '',
    };
    try { sessionStorage.setItem('vesto_meta', JSON.stringify(meta)); } catch (_) {}
    return meta;
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function attributionBody(meta, ref, contactEventId) {
    return JSON.stringify({
      vestoPublicKey: VESTO_KEY,
      ref: ref,
      contactEventId: contactEventId,
      fbclid: meta.fbclid || null,
      fbc: meta.fbc || null,
      fbp: meta.fbp || null,
      clickAt: meta.clickAt,
      pageUrl: meta.pageUrl,
      userAgent: meta.userAgent,
      utm_source: meta.utm_source || '',
      utm_medium: meta.utm_medium || '',
      utm_campaign: meta.utm_campaign || '',
      utm_content: meta.utm_content || '',
      utm_term: meta.utm_term || '',
    });
  }

  function sendAttribution(meta, ref, contactEventId) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 8000) : null;
    return fetch(ATTRIBUTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Vesto-Key': VESTO_KEY },
      body: attributionBody(meta, ref, contactEventId),
      credentials: 'omit',
      keepalive: true,
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (res) {
        if (!res.ok) throw new Error('vesto_attribution_' + res.status);
        return res.json();
      })
      .catch(function () { return null; })
      .finally(function () { if (timer) clearTimeout(timer); });
  }

  function nextSeller() {
    return fetch(NEXT_SELLER_URL, { method: 'GET', cache: 'no-store', credentials: 'omit' })
      .then(function (res) {
        if (!res.ok) throw new Error('next_seller_' + res.status);
        return res.json();
      });
  }

  function openWhatsApp(phone, message) {
    window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(message || FALLBACK_MSG), '_blank', 'noopener,noreferrer');
  }

  document.addEventListener('click', function (e) {
    var btn = e.target && e.target.closest && e.target.closest('[data-vesto-whatsapp]');
    if (!btn || busy) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    busy = true;
    var meta = captureMetaAtClick();
    var ref = buildRef();
    var contactEventId = 'vst_contact_' + ref.toLowerCase();
    try { sessionStorage.setItem('vesto_ref', ref); } catch (_) {}
    try { sessionStorage.setItem('vesto_contact_event_id', contactEventId); } catch (_) {}
    if (typeof fbq === 'function') {
      fbq('track', 'Contact', {}, { eventID: contactEventId });
    }
    var attributionWait = Promise.race([
      sendAttribution(meta, ref, contactEventId),
      wait(2500),
    ]);
    Promise.all([nextSeller(), attributionWait])
      .then(function (results) {
        var seller = results[0] || {};
        var phone = seller.phone ? String(seller.phone) : '';
        if (!phone) return;
        openWhatsApp(phone, seller.message || FALLBACK_MSG);
      })
      .catch(function (err) {
        console.error('[Vesto] Não foi possível obter o próximo vendedor.', err);
      })
      .finally(function () { busy = false; });
  }, true);
})();
