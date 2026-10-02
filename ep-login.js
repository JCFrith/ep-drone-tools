/* EP shared sign-in. One look for every EP drone tool sign-in, matching the AAR platform:
   ENHANCED PATROL wordmark, the tool name under it, a card with Email, Password (show/hide eye),
   an error line, a gold Sign in button and Forgot password (the AAR reset flow, same accounts).
   EPLogin.html(o) returns the markup. EPLogin.mount(el, o) renders it and wires the submit.
   Every password field on the page gets the eye toggle, including ones added later. */
(function () {
  'use strict';
  var FORGOT = 'https://enhanced-patrol-aar.vercel.app/forgot-password';
  var EYE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  var CSS =
    '.epl-wrap{display:flex;align-items:center;justify-content:center;min-height:calc(100vh - 140px);padding:24px 16px;}' +
    '.epl-wrap.epl-over{min-height:0;padding:0;width:100%;}' +
    '.epl{width:100%;max-width:384px;font-family:"Montserrat",-apple-system,BlinkMacSystemFont,sans-serif;color:#fff;text-align:left;}' +
    '.epl-head{text-align:center;margin-bottom:28px;}' +
    '.epl-brand{display:inline-block;border-bottom:2px solid #FCC00E;padding-bottom:8px;margin-bottom:8px;font-family:"Bebas Neue",sans-serif;font-size:2.25rem;letter-spacing:.06em;line-height:1;color:#fff;}' +
    '.epl-tool{font-size:.875rem;color:#9A9A9A;margin:0;}' +
    '.epl-card{background:#0f2233;border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:24px;box-shadow:0 20px 25px -5px rgba(0,0,0,.35);}' +
    '.epl-card h1{font-family:"Montserrat",sans-serif;font-size:1.125rem;font-weight:600;letter-spacing:0;text-transform:none;color:#fff;margin:0 0 6px;}' +
    '.epl-note{font-size:.8rem;color:#9A9A9A;line-height:1.5;margin:0 0 4px;}' +
    '.epl-form{display:flex;flex-direction:column;gap:16px;margin-top:18px;}' +
    '.epl-f{display:flex;flex-direction:column;gap:6px;font-size:.875rem;color:#9A9A9A;text-transform:none;letter-spacing:0;font-weight:400;}' +
    '.epl .epl-f input{width:100% !important;height:auto !important;box-sizing:border-box;border-radius:6px !important;border:1px solid rgba(255,255,255,.1) !important;background:#091520 !important;padding:10px 12px !important;color:#fff !important;font-family:inherit !important;font-size:.95rem !important;letter-spacing:0 !important;text-transform:none !important;box-shadow:none !important;outline:none;margin:0 !important;}' +
    '.epl .epl-f input:focus{border-color:#00A2E9 !important;}' +
    '.epl .epl-f > span:first-child{font-size:.875rem;color:#9A9A9A;font-weight:400;letter-spacing:0;text-transform:none;}' +
    '.epl-pw{position:relative;display:block;}' +
    '.epl .epl-pw input{padding-right:44px !important;}' +
    '.epl-eye{position:absolute;right:4px;top:50%;transform:translateY(-50%);width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:transparent;border:0;border-radius:5px;color:#9A9A9A;cursor:pointer;padding:0;margin:0;}' +
    '.epl-eye:hover{color:#fff;} .epl-eye:focus-visible{outline:2px solid #00A2E9;outline-offset:1px;}' +
    '.epl-err{border-radius:6px;border:1px solid rgba(239,68,68,.3);background:rgba(239,68,68,.1);padding:8px 12px;font-size:.875rem;color:#fca5a5;text-align:left;margin:0;min-height:0;}' +
    '.epl-err:empty{display:none;}' +
    '.epl-btn{margin-top:8px;width:100%;border:0;border-radius:6px;background:#FCC00E;color:#0B1923;padding:11px 16px;font:inherit;font-size:.95rem;font-weight:600;letter-spacing:0;text-transform:none;cursor:pointer;transition:filter .15s;}' +
    '.epl-btn:hover{filter:brightness(.95);} .epl-btn:disabled{opacity:.6;cursor:default;}' +
    '.epl-links{display:flex;justify-content:center;gap:18px;flex-wrap:wrap;}' +
    '.epl-link{background:none;border:0;padding:0;font:inherit;font-size:.875rem;color:#9A9A9A;text-decoration:none;cursor:pointer;}' +
    '.epl-link:hover{color:#fff;}';

  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function injectCss() {
    if (document.getElementById('epl-css')) return;
    var s = document.createElement('style'); s.id = 'epl-css'; s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  function eyeBtn() { return '<button type="button" class="epl-eye" aria-label="Show password" title="Show password">' + EYE + '</button>'; }

  /* o: { tool, note, ids:{email,pw,btn,err}, onclick (attribute string), cancel (attribute string), overlay (bool) } */
  function html(o) {
    o = o || {}; var ids = o.ids || {};
    return '<div class="epl-wrap' + (o.overlay ? ' epl-over' : '') + '"><div class="epl">' +
      '<div class="epl-head"><div class="epl-brand">ENHANCED PATROL</div><p class="epl-tool">' + esc(o.tool || 'Drone Tools') + '</p></div>' +
      '<div class="epl-card"><h1>' + esc(o.title || 'Sign in') + '</h1>' + (o.note ? '<p class="epl-note">' + esc(o.note) + '</p>' : '') +
      '<div class="epl-form">' +
      '<label class="epl-f"><span>Email</span><input id="' + esc(ids.email || 'eplEmail') + '" type="email" autocomplete="username" autocapitalize="off" spellcheck="false"></label>' +
      '<label class="epl-f"><span>Password</span><span class="epl-pw"><input id="' + esc(ids.pw || 'eplPass') + '" type="password" autocomplete="current-password">' + eyeBtn() + '</span></label>' +
      '<p class="epl-err" id="' + esc(ids.err || 'eplErr') + '" role="alert"></p>' +
      '<button type="button" class="epl-btn" id="' + esc(ids.btn || 'eplBtn') + '"' + (o.onclick ? ' onclick="' + esc(o.onclick) + '"' : '') + '>Sign in</button>' +
      '<div class="epl-links">' + (o.cancel ? '<button type="button" class="epl-link" onclick="' + esc(o.cancel) + '">Cancel</button>' : '') +
      '<a class="epl-link" href="' + FORGOT + '" target="_blank" rel="noopener">Forgot password?</a></div>' +
      '</div></div></div></div>';
  }

  /* o.onSignIn(email, password) returns a Promise of an error message, or null on success. */
  function mount(el, o) {
    injectCss();
    o = o || {};
    el.innerHTML = html(o);
    var em = document.getElementById('eplEmail'), pw = document.getElementById('eplPass'),
        btn = document.getElementById('eplBtn'), err = document.getElementById('eplErr');
    function go() {
      var e = em.value.trim(), p = pw.value;
      if (!e || !p) { err.textContent = 'Enter your email and password.'; return; }
      err.textContent = ''; btn.disabled = true; btn.textContent = 'Signing in...';
      Promise.resolve().then(function () { return o.onSignIn(e, p); }).catch(function () {
        return 'Could not reach the server. Check your connection and try again.';
      }).then(function (msg) {
        if (!document.body.contains(btn)) return;
        btn.disabled = false; btn.textContent = 'Sign in';
        if (msg) err.textContent = msg;
      });
    }
    btn.addEventListener('click', go);
    [em, pw].forEach(function (x) { x.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); go(); } }); });
    setTimeout(function () { try { em.focus(); } catch (e) {} }, 30);
  }

  /* Eye toggle for every password field, wherever it came from. */
  function wrap(inp) {
    if (inp.dataset.eplEye || inp.closest('.epl-pw')) { inp.dataset.eplEye = '1'; return; }
    inp.dataset.eplEye = '1';
    var box = document.createElement('span'); box.className = 'epl-pw';
    inp.parentNode.insertBefore(box, inp); box.appendChild(inp);
    box.insertAdjacentHTML('beforeend', eyeBtn());
  }
  function scan(root) { (root.querySelectorAll ? root : document).querySelectorAll('input[type=password]').forEach(wrap); }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('.epl-eye'); if (!b) return;
    ev.preventDefault();
    var inp = b.parentNode.querySelector('input'); if (!inp) return;
    var show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    b.innerHTML = show ? EYE_OFF : EYE;
    b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    b.title = show ? 'Hide password' : 'Show password';
    inp.focus();
  });
  function start() {
    injectCss(); scan(document);
    new MutationObserver(function (ms) { ms.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) { if (n.matches && n.matches('input[type=password]')) wrap(n); else scan(n); } }); }); })
      .observe(document.documentElement, { childList: true, subtree: true });
  }
  injectCss();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  window.EPLogin = { html: html, mount: mount, css: injectCss };
})();
