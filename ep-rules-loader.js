/* Enhanced Patrol COA/Waiver rule engine, loader v2.0
   Rules reference stable semantic keys. Forms declare window.EP_CHECK_KEYS mapping
   key -> check id. Renumbering a form cannot silently break the matrix: an unmapped
   key is reported as unmapped, never as a pass and never as a spurious failure. */
(function () {
  'use strict';

  var RULES_URL = '/coa-waiver-rules.json';
  var LEGACY_STORE = 'ep-sa-v4';
  var ruleset = null;

  /* Partial map for the legacy React form. The legacy form does not contain a check
     for every key the certificate requires; unmapped keys surface in the report. */
  var LEGACY_MAP = {
    'air.class': 'airspace-0',
    'air.3mile.identified': 'airspace-2',
    'air.3mile.notified': 'airspace-3',
    'air.tfr': 'airspace-4',
    'air.notam': 'airspace-5',
    'air.sua': 'airspace-7',
    'doc.siteselection': 'airspace-10',
    'prop.boundaries': 'property-0',
    'prop.access': 'property-1',
    'prop.notification': 'property-2',
    'prop.poc': 'property-3',
    'shield.features': 'shielding-0',
    'shield.measured': 'shielding-1',
    'ground.launch': 'ground-0',
    'ground.emergencylz': 'ground-6',
    'ground.mitigations': 'ground-16',
    'obs.route': 'obstacle-0',
    'obs.wires': 'obstacle-5',
    'geo.contains': 'geofence-0',
    'geo.perimeter': 'geofence-1',
    'geo.rthAltitude': 'geofence-3',
    'geo.noDeviation': 'geofence-4',
    'geo.conformance': 'geofence-7',
    'path.waypoints': 'flightpath-0',
    'path.containment': 'flightpath-1',
    'path.emergency': 'flightpath-4',
    'doc.fra': 'notification-1',
    'risk.level': 'risk-0',
    'risk.mitigations': 'risk-1',
    'risk.unresolved': 'risk-2',
    'risk.triggers': 'risk-4'
  };

  function keyMap() {
    return (typeof window !== 'undefined' && window.EP_CHECK_KEYS) ? window.EP_CHECK_KEYS : LEGACY_MAP;
  }
  function readLegacy() {
    try { return JSON.parse(localStorage.getItem(LEGACY_STORE) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function str(v) { return String(v === undefined || v === null ? '' : v).trim(); }
  function numOf(v) { var n = parseFloat(v); return isNaN(n) ? null : n; }
  function esc(v) {
    return String(v === undefined || v === null ? '' : v).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  /* ---- test evaluation -------------------------------------------------
     Returns true (satisfied), false (not satisfied), or the string 'unmapped'. */
  function evalTest(t, data, unmapped) {
    if (!t || !t.type) return true;
    var F = data.fields || {}, C = data.checks || {}, P = data.photos || {};
    var rows = data.c2rows || [];
    var v, n, i, r;

    switch (t.type) {
      case 'fieldPresent':      return str(F[t.field]) !== '';
      case 'fieldEquals':       return str(F[t.field]) === str(t.value);
      case 'fieldNotEquals':    return str(F[t.field]) !== str(t.value);
      case 'fieldIn':           return (t.values || []).map(str).indexOf(str(F[t.field])) >= 0;
      case 'fieldNotIn':        return (t.values || []).map(str).indexOf(str(F[t.field])) < 0;
      case 'fieldContains':     return str(F[t.field]).indexOf(str(t.contains)) >= 0;
      case 'numberAtMost':      n = numOf(F[t.field]); return n === null ? false : n <= t.value;
      case 'numberAtLeast':     n = numOf(F[t.field]); return n === null ? false : n >= t.value;
      case 'numberGreaterThan': n = numOf(F[t.field]); return n === null ? false : n > t.value;
      case 'locationPresent':   return !!(str(F.mapAddress) || str(F.mapLat) || str(F.mapLng));
      case 'photoPresent':      return !!(P[t.photo] && P[t.photo].length);

      case 'checkDone':
        var id = keyMap()[t.key];
        if (!id) { if (unmapped && unmapped.indexOf(t.key) < 0) unmapped.push(t.key); return 'unmapped'; }
        return C[id] === 'checked' || C[id] === 'na';

      case 'anyOf':
        var sawUnmapped = false;
        for (i = 0; i < (t.of || []).length; i++) {
          r = evalTest(t.of[i], data, unmapped);
          if (r === true) return true;
          if (r === 'unmapped') sawUnmapped = true;
        }
        return sawUnmapped ? 'unmapped' : false;

      case 'allOf':
        var allUnmapped = false;
        for (i = 0; i < (t.of || []).length; i++) {
          r = evalTest(t.of[i], data, unmapped);
          if (r === false) return false;
          if (r === 'unmapped') allUnmapped = true;
        }
        return allUnmapped ? 'unmapped' : true;

      /* C2 segment designation tests */
      case 'c2AllSegmentsDesignated':
        v = rows.filter(function (x) { return str(x.segment) || str(x.designation); });
        if (!v.length) return false;
        return v.every(function (x) { return str(x.designation) !== ''; });
      case 'c2NoRedSegments':
        return !rows.some(function (x) { return str(x.designation) === 'red'; });
      case 'c2NoYellowUnexplained':
        return !rows.some(function (x) { return str(x.designation) === 'yellow' && str(x.observations) === ''; });
      case 'c2HasYellow':
        return rows.some(function (x) { return str(x.designation) === 'yellow'; });

      default: return true;
    }
  }

  /* ---- evaluation ------------------------------------------------------ */
  function evaluate(data) {
    if (!ruleset) return null;
    var failed = [], review = [], unmappedKeys = [], unmappedRules = [], actions = [], conds = [], skipped = 0;

    (ruleset.rules || []).forEach(function (rule) {
      if (rule.when) {
        var w = evalTest(rule.when, data, unmappedKeys);
        if (w !== true) { skipped++; return; }
      }
      var res = evalTest(rule.test, data, unmappedKeys);
      if (res === true) return;
      var item = { id: rule.id, reason: rule.failReason || rule.label || rule.id,
                   category: rule.category || 'Rule', provision: rule.provision || '' };
      if (res === 'unmapped') { unmappedRules.push(item); return; }
      if (rule.severity === 'needsProgramReview') review.push(item); else failed.push(item);
      if (rule.correctiveAction) actions.push(rule.correctiveAction);
    });

    (ruleset.conditions || []).forEach(function (c) {
      if (!c.when || evalTest(c.when, data, null) === true) conds.push(c.text);
    });

    var D = ruleset.decisions;
    var decision = failed.length ? D.notApproved
                 : (review.length || unmappedRules.length) ? D.needsProgramReview
                 : D.approvedWithConditions;

    return { decision: decision, failed: failed, review: review,
             unmappedRules: unmappedRules, unmappedKeys: unmappedKeys,
             skipped: skipped, actions: dedupe(actions), conditions: dedupe(conds),
             version: ruleset.version, basis: ruleset.basis, openItems: ruleset.openItems || [] };
  }
  function dedupe(a) { var s = {}, o = []; a.forEach(function (x) { if (!s[x]) { s[x] = 1; o.push(x); } }); return o; }

  /* ---- rendering ------------------------------------------------------- */
  function render(panel, data) {
    var r = evaluate(data);
    if (!panel || !r) return;
    var approved = r.decision === ruleset.decisions.approvedWithConditions;
    panel.setAttribute('data-decision', approved ? 'conditional' : (r.failed.length ? 'not-approved' : 'review'));

    var h = '<div class="ep-waiver-decision-head"><span>COA/Waiver Determination</span><strong>' + esc(r.decision) + '</strong></div><div class="ep-waiver-decision-body">';
    if (approved) h += '<h4>Approval Basis</h4><p>No blocking deficiency was detected against rule matrix version ' + esc(r.version) + '.</p>';

    function list(title, items, withProv) {
      if (!items.length) return '';
      return '<h4>' + title + '</h4><ul>' + items.map(function (x) {
        return '<li><strong>' + esc(x.id) + '</strong>' + (withProv && x.provision ? ' [' + esc(x.provision) + ']' : '') + ': ' + esc(x.reason) + '</li>';
      }).join('') + '</ul>';
    }
    h += list('Reasons Not Approved', r.failed, true);
    h += list('Needs Program Review', r.review, true);

    if (r.unmappedRules.length) {
      h += '<h4>Cannot Be Evaluated</h4><p>These rules reference checks this form does not declare. The form and the rule matrix are out of sync. Do not treat this assessment as complete.</p><ul>' +
        r.unmappedRules.map(function (x) { return '<li><strong>' + esc(x.id) + '</strong>' + (x.provision ? ' [' + esc(x.provision) + ']' : '') + ': ' + esc(x.reason) + '</li>'; }).join('') +
        '</ul><p class="ep-rule-version">Unmapped keys: ' + esc(r.unmappedKeys.join(', ')) + '</p>';
    }
    if (r.actions.length) h += '<h4>Corrective Actions</h4><ul>' + r.actions.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    h += '<h4>Operating Conditions</h4><ul>' + r.conditions.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
    if (r.openItems.length) {
      h += '<h4>Unresolved Certificate Items</h4><ul>' + r.openItems.map(function (o) {
        return '<li><strong>' + esc(o.provision) + '</strong>: ' + esc(o.issue) + ' ' + esc(o.handling) + '</li>';
      }).join('') + '</ul>';
    }
    h += '<p class="ep-rule-version">Rule matrix version ' + esc(r.version) + '. ' + esc(r.basis) + '</p></div>';
    panel.innerHTML = h;
  }

  /* ---- legacy auto-wire ------------------------------------------------ */
  function upgradeButton() {
    var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
    var b = btns.filter(function (x) { return /Run COA\/Waiver Determination/i.test(x.textContent || ''); })[0];
    if (!b || b.getAttribute('data-rules-loader') === 'v2') return;
    b.setAttribute('data-rules-loader', 'v2');
    b.addEventListener('click', function (e) {
      if (!ruleset) return;
      e.preventDefault(); e.stopImmediatePropagation();
      render(document.getElementById('ep-waiver-decision-panel'), readLegacy());
    }, true);
  }

  function init(cb) {
    fetch(RULES_URL, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !Array.isArray(j.rules)) return;
        ruleset = j; upgradeButton();
        if (cb) cb(j);
      })
      .catch(function () {});
  }

  window.EPRules = {
    load: init,
    evaluate: function (data) { return evaluate(data); },
    render: render,
    get ruleset() { return ruleset; }
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('click', upgradeButton, true);
    window.addEventListener('load', function () { init(); window.setTimeout(upgradeButton, 1000); });
    window.setTimeout(function () { init(); upgradeButton(); }, 1200);
  }
})();
