/* EP crew roster for name dropdowns (RPIC, Assessed by, C2 tester, approver).
   Names come from public.ep_roster(), which only answers signed-in admin, pilot and agp accounts,
   so no names are written into the page itself. Display format: first initial, last name (C. Frith).
   The last good list is kept on the device so dropdowns still work offline. */
(function () {
  var KEY = 'ep-roster-v1', LIST = null, P = null, SUBS = [];
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
  function fmt(full, email) {
    var n = String(full || '').replace(/"[^"]*"/g, ' ').replace(/\s+/g, ' ').trim();
    if (n) {
      var p = n.split(' ');
      return p.length > 1 ? p[0].charAt(0).toUpperCase() + '. ' + p[p.length - 1] : p[0];
    }
    var local = String(email || '').split('@')[0], q = local.split(/[._-]/).filter(Boolean);
    return q.length > 1 ? q[0].charAt(0).toUpperCase() + '. ' + cap(q[q.length - 1]) : cap(local);
  }
  function cached() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
  function load(sb, force) {
    if (P && !force) return P;
    if (!LIST) LIST = cached();
    if (!sb || !sb.rpc) { P = Promise.resolve(LIST || []); return P; }
    P = sb.rpc('ep_roster').then(function (r) {
      if (r.error || !Array.isArray(r.data)) return LIST || [];
      LIST = r.data.map(function (x) { return { email: x.email, role: x.role, name: fmt(x.full_name, x.email) }; })
        .sort(function (a, b) { return a.name.split(' ').pop().localeCompare(b.name.split(' ').pop()) || a.name.localeCompare(b.name); });
      try { localStorage.setItem(KEY, JSON.stringify(LIST)); } catch (e) {}
      SUBS.forEach(function (f) { try { f(LIST); } catch (e) {} });
      return LIST;
    }, function () { return LIST || []; });
    return P;
  }
  function list(roles) {
    var L = LIST || cached() || [];
    return roles ? L.filter(function (x) { return roles.indexOf(x.role) >= 0; }) : L;
  }
  function nameFor(email) {
    var e = String(email || '').toLowerCase(), m = list().filter(function (x) { return x.email.toLowerCase() === e; })[0];
    return m ? m.name : (email ? fmt('', email) : '');
  }
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  /* Options for a <select>. A saved value not on the roster (older free-text entries) stays selectable. */
  function optionsHTML(selected, roles) {
    var L = list(roles), sel = String(selected || ''), has = false;
    var o = L.map(function (x) { var on = x.name === sel; if (on) has = true; return '<option value="' + esc(x.name) + '"' + (on ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('');
    return '<option value="">Select</option>' + (sel && !has ? '<option value="' + esc(sel) + '" selected>' + esc(sel) + '</option>' : '') + o;
  }
  function onLoad(f) { SUBS.push(f); }
  window.EPRoster = { load: load, list: list, nameFor: nameFor, fmt: fmt, optionsHTML: optionsHTML, onLoad: onLoad };
})();
