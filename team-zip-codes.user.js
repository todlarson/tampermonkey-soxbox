// ==UserScript==
// @name         Team Zip Codes
// @namespace    https://dsfp.soxbox.co/
// @version      1.0.1
// @description  Adds a "Team Zip Codes" report to Sox Box: a pie chart of how many team members live in each zip code.
// @match        https://dsfp.soxbox.co/*
// @grant        none
// @run-at       document-idle
// @homepageURL  https://github.com/todlarson/tampermonkey-soxbox
// @updateURL    https://raw.githubusercontent.com/todlarson/tampermonkey-soxbox/main/team-zip-codes.user.js
// @downloadURL  https://raw.githubusercontent.com/todlarson/tampermonkey-soxbox/main/team-zip-codes.user.js
// ==/UserScript==

/*
 * Requests the "Team Export" report (Reports > Team > Team Export) in the background with the
 * signed-in session, counts team members per zip code, and shows a pie chart plus a full table.
 * Nothing is stored: the export is held in memory only while the report is built.
 *
 * Open it from Reports > TamperMonkey > Team Zip Codes, or go to /reports/team/team-export/#team-zip-codes
 */
(function () {
  'use strict';

  var ROUTE_PATH = '/reports/team/team-export/';
  var ROUTE_HASH = '#team-zip-codes';
  var EXPORT_URL = '/reports/team/team-export/export/';
  var EXPORT_COLS = ['volunteers.id', 'volunteers.zipcode', 'volunteers.blackball'];
  var MENU_TEMPLATE_LINK = '/reports/guests/guests/'; // Reports > Guest > Guest Data: template for the shared menu
  var TOP_SLICES = 7; // biggest zips get their own slice; the rest fold into "Other"

  // Validated categorical palette (fixed order, never cycled) + neutral gray for "Other".
  var COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'];
  var OTHER_COLOR = '#a3a29c';

  // ---------------------------------------------------------------- shared TamperMonkey menu
  // Reports > TamperMonkey » is shared by all scripts in this repo: find #tm-reports-menu or create it.
  function getTamperMonkeyMenu() {
    var existing = document.getElementById('tm-reports-menu');
    if (existing) return existing;

    var templateLink = document.querySelector('a[href="' + MENU_TEMPLATE_LINK + '"]');
    var templateGroup = templateLink && templateLink.closest('ul') && templateLink.closest('ul').closest('li');
    if (!templateGroup) return null;

    var $ = window.jQuery;
    // jQuery's clone(true) keeps the Superfish hover handlers bound to the original.
    var group = $ ? $(templateGroup).clone(true)[0] : templateGroup.cloneNode(true);
    group.classList.remove('current');
    var label = group.querySelector('a');
    label.id = 'tm-reports-label';
    var labelText = Array.prototype.find.call(label.childNodes, function (n) { return n.nodeType === 3 && n.nodeValue.trim(); });
    // Monkey-face emoji, enlarged so it stays visible on the dark gray menu.
    var icon = el('span', { 'aria-hidden': 'true', style: 'font-size:16px;line-height:1;vertical-align:-2px', text: '🐵' });
    var name = document.createTextNode(' TamperMonkey');
    if (labelText) label.replaceChild(name, labelText); else label.insertBefore(name, label.firstChild);
    label.insertBefore(icon, name);

    var submenu = group.querySelector('ul');
    submenu.id = 'tm-reports-menu';
    var itemTemplate = templateLink.closest('li').cloneNode(true);
    itemTemplate.className = '';
    submenu.innerHTML = '';
    submenu.tmItemTemplate = itemTemplate;
    templateGroup.parentNode.appendChild(group);

    if (!$) {
      document.head.appendChild(el('style', { text: '#tm-reports-label + ul{display:none!important}' +
        'li:hover > #tm-reports-label + ul{display:block!important;visibility:visible!important}' }));
    }
    return submenu;
  }

  function addMenuLink() {
    if (document.getElementById('tzc-menu-link')) return;
    var submenu = getTamperMonkeyMenu();
    if (!submenu) return;
    var template = submenu.tmItemTemplate || submenu.querySelector('li');
    var item = template ? template.cloneNode(true) : el('li', {}, [el('a')]);
    item.className = '';
    var a = item.querySelector('a');
    a.id = 'tzc-menu-link';
    a.href = ROUTE_PATH + ROUTE_HASH;
    a.textContent = 'Team Zip Codes';
    submenu.appendChild(item);
  }

  // ---------------------------------------------------------------- data
  function parseCsv(text) {
    var rows = [], row = [], field = '', q = false, i = 0, c;
    text = text.replace(/^﻿/, '');
    while (i < text.length) {
      c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else { q = false; }
        } else { field += c; }
      } else if (c === '"') { q = true; }
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else { field += c; }
      i++;
    }
    row.push(field); rows.push(row);
    rows = rows.filter(function (r) { return r.join('').trim() !== ''; });
    var names = (rows.shift() || []).map(function (n) { return n.trim(); }); // Team Export pads " Volunteer ID"
    return rows.map(function (r) {
      var o = {};
      names.forEach(function (n, k) { o[n] = r[k] !== undefined ? r[k] : ''; });
      return o;
    });
  }

  // Normalize to a 5-digit ZIP: ZIP+4 -> first 5, 4 digits -> restore the dropped leading zero.
  function normalizeZip(raw) {
    var s = String(raw || '').trim();
    if (!s) return '(no zip)';
    var digits = s.replace(/\D/g, '');
    if (/^\d{5}(-?\d{4})?$/.test(s)) return digits.slice(0, 5);
    if (/^\d{4}$/.test(s)) return '0' + s;
    return '(invalid zip)';
  }

  function countByZip(members, includeBanned) {
    var counts = {}, total = 0;
    members.forEach(function (m) {
      if (!includeBanned && String(m['Banned from Volunteering']).trim() === 'Yes') return;
      var zip = normalizeZip(m['Physical Zip']);
      counts[zip] = (counts[zip] || 0) + 1;
      total++;
    });
    var rows = Object.keys(counts).map(function (zip) { return { zip: zip, count: counts[zip] }; })
      .sort(function (a, b) { return b.count - a.count || a.zip.localeCompare(b.zip); });
    return { rows: rows, total: total };
  }

  // Top N real zips get a slice; everything else (including no/invalid zip) folds into "Other".
  function toSlices(rows) {
    var real = rows.filter(function (r) { return /^\d{5}$/.test(r.zip); });
    var top = real.slice(0, TOP_SLICES);
    var topZips = top.map(function (r) { return r.zip; });
    var slices = top.map(function (r, i) { return { label: r.zip, count: r.count, color: COLORS[i] }; });
    var rest = rows.filter(function (r) { return topZips.indexOf(r.zip) === -1; });
    var otherCount = rest.reduce(function (n, r) { return n + r.count; }, 0);
    if (otherCount) slices.push({ label: 'Other (' + rest.length + ' zip' + (rest.length === 1 ? '' : 's') + ')', count: otherCount, color: OTHER_COLOR });
    return slices;
  }

  function fetchTeam() {
    var body = new URLSearchParams();
    body.append('Condition', '1');
    EXPORT_COLS.forEach(function (c) { body.append('exportCols[]', c); });
    body.append('action', 'Export');
    return fetch(EXPORT_URL, { method: 'POST', body: body, credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('Team Export failed (HTTP ' + r.status + ')');
        return r.text();
      })
      .then(function (text) {
        if (/^\s*</.test(text)) throw new Error('Team Export returned a web page instead of CSV. Are you still logged in?');
        var members = parseCsv(text);
        if (members.length && !('Physical Zip' in members[0])) throw new Error('Team Export is missing the Physical Zip column.');
        return members;
      });
  }

  // ---------------------------------------------------------------- page
  var CSS = [
    '#tzc h2{margin-bottom:.5em}',
    '#tzc .tzc-hint{color:#666;font-style:italic}',
    '#tzc .tzc-err{color:#b00020;font-weight:bold}',
    '#tzc .tzc-form p{margin:.6em 0}',
    '#tzc .tzc-chart{display:flex;flex-wrap:wrap;gap:24px;align-items:center;margin:1em 0}',
    '#tzc .tzc-pie{width:280px;height:280px;flex:none}',
    '#tzc .tzc-pie path{stroke:#fff;stroke-width:2;cursor:default}',
    '#tzc .tzc-pie path.tzc-dim{opacity:.35}',
    '#tzc .tzc-legend{border-collapse:collapse;font-size:13px}',
    '#tzc .tzc-legend td{padding:3px 8px 3px 0;color:#222}',
    '#tzc .tzc-legend td.tzc-num{text-align:right;font-variant-numeric:tabular-nums}',
    '#tzc .tzc-legend td.tzc-pct{text-align:right;color:#666;font-variant-numeric:tabular-nums}',
    '#tzc .tzc-legend tr:hover td{background:#f2f2f0}',
    '#tzc .tzc-swatch{display:inline-block;width:12px;height:12px;border-radius:3px;vertical-align:-1px}',
    '#tzc .tzc-tip{position:fixed;pointer-events:none;background:#fff;border:1px solid #ccc;border-radius:6px;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.15);padding:6px 10px;font-size:12px;color:#222;display:none;z-index:1000}',
    '#tzc .tzc-tip strong{display:block;margin-bottom:2px}',
    '#tzc table.tzc-all{border-collapse:collapse;margin-top:.5em;font-size:13px;min-width:360px}',
    '#tzc table.tzc-all th{text-align:left;border-bottom:1px solid #ccc;padding:4px 8px 4px 0;color:#444}',
    '#tzc table.tzc-all td{border-bottom:1px solid #eee;padding:3px 8px 3px 0}',
    '#tzc table.tzc-all td.tzc-num{text-align:right;font-variant-numeric:tabular-nums}',
    '#tzc .tzc-bar{display:inline-block;height:8px;border-radius:0 4px 4px 0;background:#2a78d6;vertical-align:middle}',
    '#tzc details{margin-top:1em}',
    '#tzc summary{cursor:pointer;font-weight:bold}',
    '@media print{body *{visibility:hidden}#tzc,#tzc *{visibility:visible}#tzc{position:absolute;left:0;top:0;width:100%}' +
      '#tzc .tzc-form,#tzc .tzc-actions{display:none}}'
  ].join('\n');

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'class') e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function svg(tag, attrs) {
    var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }
  function pct(n, total) { return total ? (100 * n / total).toFixed(1) + '%' : '0%'; }
  function fmt(n) { return n.toLocaleString(); }

  function arcPath(cx, cy, r, start, end) {
    if (end - start >= Math.PI * 2 - 1e-9) { // single full slice
      return 'M' + (cx - r) + ',' + cy + 'a' + r + ',' + r + ' 0 1,0 ' + (2 * r) + ',0a' + r + ',' + r + ' 0 1,0 ' + (-2 * r) + ',0Z';
    }
    var x1 = cx + r * Math.sin(start), y1 = cy - r * Math.cos(start);
    var x2 = cx + r * Math.sin(end), y2 = cy - r * Math.cos(end);
    return 'M' + cx + ',' + cy + 'L' + x1 + ',' + y1 + 'A' + r + ',' + r + ' 0 ' + (end - start > Math.PI ? 1 : 0) + ',1 ' + x2 + ',' + y2 + 'Z';
  }

  function renderPie(slices, total, tip) {
    var size = 280, r = 136, c = size / 2, angle = 0;
    var root = svg('svg', { class: 'tzc-pie', viewBox: '0 0 ' + size + ' ' + size, role: 'img',
      'aria-label': 'Pie chart of team members by zip code' });
    var paths = slices.map(function (s, i) {
      var sweep = total ? (s.count / total) * Math.PI * 2 : 0;
      var p = svg('path', { d: arcPath(c, c, r, angle, angle + sweep), fill: s.color, 'data-i': i });
      angle += sweep;
      root.appendChild(p);
      return p;
    });
    function highlight(i) { paths.forEach(function (p, k) { p.classList.toggle('tzc-dim', i !== null && k !== i); }); }
    paths.forEach(function (p, i) {
      p.addEventListener('mousemove', function (e) {
        var s = slices[i];
        tip.innerHTML = '';
        tip.appendChild(el('strong', { text: s.label }));
        tip.appendChild(document.createTextNode(fmt(s.count) + ' team member' + (s.count === 1 ? '' : 's') + ' · ' + pct(s.count, total)));
        tip.style.display = 'block';
        tip.style.left = (e.clientX + 14) + 'px';
        tip.style.top = (e.clientY + 14) + 'px';
        highlight(i);
      });
      p.addEventListener('mouseleave', function () { tip.style.display = 'none'; highlight(null); });
    });
    return { node: root, highlight: highlight };
  }

  function renderResults(out, members, includeBanned) {
    out.innerHTML = '';
    var data = countByZip(members, includeBanned);
    var slices = toSlices(data.rows);
    var realZips = data.rows.filter(function (r) { return /^\d{5}$/.test(r.zip); }).length;

    out.appendChild(el('h2', { text: 'Team members by zip code' }));
    out.appendChild(el('p', { class: 'tzc-hint', text: fmt(data.total) + ' team members in ' + realZips + ' zip codes, as of ' +
      new Date().toLocaleDateString() + '. The ' + Math.min(TOP_SLICES, realZips) + ' largest zips have their own slice.' }));
    if (!data.total) { out.appendChild(el('p', { text: 'No team members found.' })); return; }

    var tip = el('div', { class: 'tzc-tip', role: 'tooltip' });
    var pie = renderPie(slices, data.total, tip);
    var legend = el('table', { class: 'tzc-legend' }, [el('tbody', {}, slices.map(function (s, i) {
      var tr = el('tr', {}, [
        el('td', {}, [el('span', { class: 'tzc-swatch', style: 'background:' + s.color })]),
        el('td', { text: s.label }),
        el('td', { class: 'tzc-num', text: fmt(s.count) }),
        el('td', { class: 'tzc-pct', text: pct(s.count, data.total) })
      ]);
      tr.addEventListener('mouseenter', function () { pie.highlight(i); });
      tr.addEventListener('mouseleave', function () { pie.highlight(null); });
      return tr;
    }))]);
    out.appendChild(el('div', { class: 'tzc-chart' }, [pie.node, legend]));
    out.appendChild(tip);

    // Every zip, ranked, with a thin bar for exact comparison.
    var max = data.rows[0].count;
    var table = el('table', { class: 'tzc-all' }, [
      el('thead', {}, [el('tr', {}, [el('th', { text: 'Zip code' }), el('th', { text: 'Team members', style: 'text-align:right' }),
        el('th', { text: 'Share', style: 'text-align:right' }), el('th', { text: '' })])]),
      el('tbody', {}, data.rows.map(function (r) {
        return el('tr', {}, [
          el('td', { text: r.zip }),
          el('td', { class: 'tzc-num', text: fmt(r.count) }),
          el('td', { class: 'tzc-num', text: pct(r.count, data.total) }),
          el('td', {}, [el('span', { class: 'tzc-bar', style: 'width:' + Math.max(2, Math.round(160 * r.count / max)) + 'px' })])
        ]);
      }))
    ]);
    out.appendChild(el('details', {}, [el('summary', { text: 'All ' + data.rows.length + ' zip codes' }), table]));
  }

  function renderPage() {
    var wrapper = document.querySelector('#page > .wrapper') || document.getElementById('page');
    if (!wrapper || document.getElementById('tzc')) return;
    document.title = 'Team Zip Codes FoodBank Manager';
    var heading = Array.prototype.find.call(document.querySelectorAll('h1'), function (h) { return h.textContent.trim() === 'Export Team Data'; });
    if (heading) { heading.setAttribute('data-tzc-title', heading.textContent); heading.textContent = 'Team Zip Codes'; }
    if (!document.getElementById('tzc-style')) document.head.appendChild(el('style', { id: 'tzc-style', text: CSS }));

    var banned = el('input', { type: 'checkbox', id: 'tzc-banned' });
    var bannedNote = el('span', { class: 'tzc-hint' });
    var submit = el('input', { type: 'submit', value: 'Run Report', class: 'btn btn-blue' });
    var form = el('form', { class: 'tzc-form' }, [
      el('p', {}, [banned, ' ', el('label', { for: 'tzc-banned', text: 'Include team members banned from volunteering' }),
        bannedNote]),
      el('p', {}, [submit])
    ]);
    var printBtn = el('button', { type: 'button', text: 'Print' });
    var actions = el('div', { class: 'tzc-actions', style: 'display:none;margin:1em 0' }, [printBtn]);
    var out = el('div', { id: 'tzc-out' });
    var section = el('section', { id: 'tzc', class: 'column width8 first' }, [
      el('h2', { text: 'Team Zip Codes' }),
      el('p', { class: 'tzc-hint', text: 'Uses current Team Export data from Sox Box. Nothing is downloaded or stored.' }),
      form, actions, out
    ]);

    Array.prototype.forEach.call(wrapper.children, function (c) {
      if (c.contains(heading)) return;
      c.style.display = 'none'; c.setAttribute('data-tzc-hidden', '');
    });
    wrapper.appendChild(section);

    var members = null; // cached for this page view only, so toggling the checkbox doesn't refetch
    function run() {
      submit.disabled = true;
      actions.style.display = 'none';
      out.innerHTML = '';
      out.appendChild(el('p', { text: 'Loading Team Export…' }));
      (members ? Promise.resolve(members) : fetchTeam())
        .then(function (m) {
          members = m;
          // Show how many are banned, so it's clear why the checkbox may change nothing.
          var n = m.filter(function (x) { return String(x['Banned from Volunteering']).trim() === 'Yes'; }).length;
          bannedNote.textContent = ' (' + (n ? fmt(n) : 'none') + ' currently banned)';
          renderResults(out, m, banned.checked);
          actions.style.display = '';
        })
        .catch(function (err) { out.innerHTML = ''; out.appendChild(el('p', { class: 'tzc-err', text: 'ERROR: ' + err.message })); })
        .then(function () { submit.disabled = false; });
    }
    printBtn.addEventListener('click', function () { window.print(); });
    form.addEventListener('submit', function (e) { e.preventDefault(); run(); });
    banned.addEventListener('change', function () { if (members) run(); });
    run();
  }

  function unrenderPage() {
    var section = document.getElementById('tzc');
    if (!section) return;
    section.remove();
    var heading = document.querySelector('[data-tzc-title]');
    if (heading) { heading.textContent = heading.getAttribute('data-tzc-title'); heading.removeAttribute('data-tzc-title'); }
    document.querySelectorAll('[data-tzc-hidden]').forEach(function (c) { c.style.display = ''; c.removeAttribute('data-tzc-hidden'); });
  }

  function route() {
    if (location.pathname === ROUTE_PATH && location.hash === ROUTE_HASH) renderPage();
    else unrenderPage();
  }

  // Lets tests load the report logic in Node without a page.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseCsv: parseCsv, normalizeZip: normalizeZip, countByZip: countByZip, toSlices: toSlices };
    return;
  }

  addMenuLink();
  route();
  window.addEventListener('hashchange', route);
})();
