// ==UserScript==
// @name         Birthday Box
// @namespace    https://dsfp.soxbox.co/
// @version      1.1.2
// @description  Adds a "Birthday Box" report to Sox Box: children in each household with a birthday in the next N weeks.
// @match        https://dsfp.soxbox.co/*
// @grant        none
// @run-at       document-idle
// @homepageURL  https://github.com/todlarson/tampermonkey-soxbox
// @updateURL    https://raw.githubusercontent.com/todlarson/tampermonkey-soxbox/main/birthday-box.user.js
// @downloadURL  https://raw.githubusercontent.com/todlarson/tampermonkey-soxbox/main/birthday-box.user.js
// ==/UserScript==

/*
 * Recreates https://sites.google.com/dsfp.org/birthday-box/home inside Sox Box.
 * Instead of uploading a "Guest Data" CSV, it requests the same export from Sox Box
 * in the background (Reports > Guest > Guest Data) using the signed-in session.
 * Nothing is stored: the export is held in memory only while the report is built.
 *
 * Open it from Reports > TamperMonkey > Birthday Box, or go to /reports/guests/guests/#birthday-box
 */
(function () {
  'use strict';

  var ROUTE_PATH = '/reports/guests/guests/';
  var ROUTE_HASH = '#birthday-box';
  var EXPORT_URL = '/reports/guests/guests/export/';
  var EXPORT_COLS = ['clients.id as gid', 'clients.firstname', 'clients.lastname', 'clients.blackball', 'clients.othersHousehold'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  // ---------------------------------------------------------------- menu link
  // Reports > TamperMonkey » is shared: any other userscript can find #tm-reports-menu
  // (the submenu <ul>) and append its own items, so this creates it only if it's missing.
  function getTamperMonkeyMenu() {
    var existing = document.getElementById('tm-reports-menu');
    if (existing) return existing;

    // Use Reports > Guest » as the template so styles and menu behavior match.
    var guestData = document.querySelector('a[href="' + ROUTE_PATH + '"]');
    var guestGroup = guestData && guestData.closest('ul') && guestData.closest('ul').closest('li');
    if (!guestGroup) return null;

    var $ = window.jQuery;
    // jQuery's clone(true) keeps the Superfish hover handlers bound to the original.
    var group = $ ? $(guestGroup).clone(true)[0] : guestGroup.cloneNode(true);
    group.classList.remove('current');
    var label = group.querySelector('a');
    label.id = 'tm-reports-label';
    var labelText = Array.prototype.find.call(label.childNodes, function (n) { return n.nodeType === 3 && n.nodeValue.trim(); });
    var labelValue = '🐒 TamperMonkey'; // monkey emoji
    if (labelText) labelText.nodeValue = labelValue; else label.insertBefore(document.createTextNode(labelValue), label.firstChild);

    var submenu = group.querySelector('ul');
    submenu.id = 'tm-reports-menu';
    var itemTemplate = guestData.closest('li').cloneNode(true);
    itemTemplate.className = '';
    submenu.innerHTML = '';
    submenu.tmItemTemplate = itemTemplate;
    guestGroup.parentNode.appendChild(group);

    if (!$) {
      // No jQuery/Superfish to drive the clone: fall back to plain CSS hover.
      document.head.appendChild(el('style', { text: '#tm-reports-label + ul{display:none!important}' +
        'li:hover > #tm-reports-label + ul{display:block!important;visibility:visible!important}' }));
    }
    return submenu;
  }

  function addMenuLink() {
    if (document.getElementById('bb-menu-link')) return;
    var submenu = getTamperMonkeyMenu();
    if (!submenu) return;
    var template = submenu.tmItemTemplate || submenu.querySelector('li');
    var item = template ? template.cloneNode(true) : el('li', {}, [el('a')]);
    item.className = '';
    var a = item.querySelector('a');
    a.id = 'bb-menu-link';
    a.href = ROUTE_PATH + ROUTE_HASH;
    a.textContent = 'Birthday Box';
    submenu.appendChild(item);
  }

  // ---------------------------------------------------------------- CSV parsing
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
    var names = rows.shift() || [];
    return rows.map(function (r) {
      var o = {};
      names.forEach(function (n, k) { o[n] = r[k] !== undefined ? r[k] : ''; });
      return o;
    });
  }

  // Sox Box exports HTML-encoded text (e.g. "&amp;").
  var decoder = document.createElement('textarea');
  function decode(s) { decoder.innerHTML = s == null ? '' : String(s); return decoder.value.trim(); }

  // ---------------------------------------------------------------- dates
  function makeDate(y, m, d) {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return new Date(y, m - 1, d);
  }
  function parseDob(s) {
    if (!s) return null;
    s = String(s).trim();
    var m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})([T\s].*)?$/))) return makeDate(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(\s.*)?$/))) {
      var y = +m[3];
      if (m[3].length === 2) y += y < 70 ? 2000 : 1900;
      return makeDate(y, +m[1], +m[2]);
    }
    return null;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // ---------------------------------------------------------------- report logic
  // Same rules as the Google Sites / PHP Birthday Box:
  //  - skip guests "Blocked from Receiving Help"
  //  - look at every "living in home N" household member with a Date of Birth
  //  - include birthdays from today up to (today + weeks), born in or after eligibleYear
  //  - list as "Guest Name (Relationship - age)", grouped by date, youngest first
  // Differences: dates are ordered chronologically (so January follows December when the
  // window crosses New Year), and each entry also carries the child's name and a guest link.
  function buildReport(guests, weeks, eligibleYear, now) {
    now = now || new Date();
    var today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var limit = new Date(now.getTime()); limit.setDate(limit.getDate() + 7 * weeks);
    var todayMd = pad(now.getMonth() + 1) + pad(now.getDate());
    var byDate = {};

    guests.forEach(function (g) {
      if (decode(g['Blocked from Receiving Help']) === 'Yes') return;
      var parent = (decode(g['First Name']) + ' ' + decode(g['Last Name'])).trim();
      var members = {};
      Object.keys(g).forEach(function (k) {
        if (k.indexOf('living in home') === -1 || g[k] === '') return;
        var num = k.replace(/[^0-9]/g, '');
        var field = k.replace('living in home', '').replace(/[0-9]/g, '').trim();
        (members[num] = members[num] || {})[field] = decode(g[k]);
      });

      Object.keys(members).forEach(function (num) {
        var d = members[num];
        var dob = parseDob(d['Date of Birth']);
        if (!dob) return;
        var year = dob.getFullYear(), month = dob.getMonth() + 1, day = dob.getDate();
        if (year < eligibleYear) return;
        var age = now.getFullYear() - year - ((pad(month) + pad(day)) > todayMd ? 1 : 0);
        [now.getFullYear(), now.getFullYear() + 1].forEach(function (cy) {
          var bd = new Date(cy, month - 1, day);
          if (bd < limit && bd >= today0) {
            var key = cy + '-' + pad(month) + '-' + pad(day);
            (byDate[key] = byDate[key] || []).push({
              guestId: g['Guest ID'],
              parent: parent,
              child: d['Name'] || '',
              relationship: d['Relationship'] || '',
              age: age,
              birthYear: year,
              turning: cy - year
            });
          }
        });
      });
    });

    return Object.keys(byDate).sort().map(function (key) {
      var p = key.split('-');
      var date = new Date(+p[0], +p[1] - 1, +p[2]);
      var items = byDate[key].sort(function (a, b) { return b.birthYear - a.birthYear; });
      return { date: date, label: MONTHS[date.getMonth()] + ' ' + date.getDate(), items: items };
    });
  }

  function fetchGuests() {
    var body = new URLSearchParams();
    body.append('config', '0');
    body.append('Condition', '1');
    EXPORT_COLS.forEach(function (c) { body.append('exportCols[]', c); });
    body.append('action', 'Export');
    return fetch(EXPORT_URL, { method: 'POST', body: body, credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('Guest Data export failed (HTTP ' + r.status + ')');
        return r.text();
      })
      .then(function (text) {
        if (/^\s*</.test(text)) throw new Error('Guest Data export returned a web page instead of CSV. Are you still logged in?');
        var guests = parseCsv(text);
        if (guests.length && !('Blocked from Receiving Help' in guests[0])) throw new Error('Guest Data export is missing expected columns.');
        return guests;
      });
  }

  // ---------------------------------------------------------------- page
  var CSS = [
    '#bb h2{margin-bottom:.5em}',
    '#bb .bb-form p{margin:.6em 0}',
    '#bb .bb-form input[type=number]{width:70px;font-size:15px;margin-right:6px}',
    '#bb .bb-hint{color:#666;font-style:italic}',
    '#bb .bb-err{color:#b00020;font-weight:bold}',
    '#bb .bb-day{margin:1em 0 .2em;font-weight:bold}',
    '#bb ul.bb-list{margin:0 0 .5em 1.5em;list-style:disc}',
    '#bb ul.bb-list li{margin:.15em 0}',
    '#bb .bb-child{color:#555}',
    '#bb .bb-actions{margin:1em 0}',
    '@media print{body *{visibility:hidden}#bb,#bb *{visibility:visible}#bb{position:absolute;left:0;top:0;width:100%}' +
      '#bb .bb-form,#bb .bb-actions{display:none}#bb a{color:inherit;text-decoration:none}}'
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

  function renderResults(out, report, weeks) {
    out.innerHTML = '';
    var total = report.reduce(function (n, d) { return n + d.items.length; }, 0);
    out.appendChild(el('h2', { text: 'Birthdays in the next ' + weeks + ' week' + (weeks === 1 ? '' : 's') }));
    out.appendChild(el('p', { class: 'bb-hint', text: total + ' birthday' + (total === 1 ? '' : 's') + ' as of ' + new Date().toLocaleDateString() }));
    if (!total) { out.appendChild(el('p', { text: 'No birthdays found in this range.' })); return; }

    report.forEach(function (day) {
      out.appendChild(el('p', { class: 'bb-day' }, [day.label + ': ']));
      out.appendChild(el('ul', { class: 'bb-list' }, day.items.map(function (i) {
        var name = i.guestId
          ? el('a', { href: '/manage/guest/view/' + encodeURIComponent(i.guestId) + '/', target: '_blank', text: i.parent })
          : document.createTextNode(i.parent);
        return el('li', {}, [
          name,
          ' (' + i.relationship + ' - ' + i.age + ')',
          i.child ? el('span', { class: 'bb-child', text: ' — ' + i.child + ', turning ' + i.turning }) : null
        ]);
      })));
    });
  }

  function renderPage() {
    var wrapper = document.querySelector('#page > .wrapper') || document.getElementById('page');
    if (!wrapper || document.getElementById('bb')) return;
    document.title = 'Birthday Box FoodBank Manager';
    var heading = Array.prototype.find.call(document.querySelectorAll('h1'), function (h) { return h.textContent.trim() === 'Export Guest Data'; });
    if (heading) { heading.setAttribute('data-bb-title', heading.textContent); heading.textContent = 'Birthday Box'; }

    if (!document.getElementById('bb-style')) {
      document.head.appendChild(el('style', { id: 'bb-style', text: CSS }));
    }
    var current = document.querySelector('a[href="' + ROUTE_PATH + '"]');
    if (current) current.closest('li').classList.remove('current');

    var thisYear = new Date().getFullYear();
    var weeksIn = el('input', { type: 'number', id: 'bb-weeks', value: '3', min: '0', max: '52' });
    var yearIn = el('input', { type: 'number', id: 'bb-year', value: String(thisYear - 12), min: '1990', max: String(thisYear) });
    var submit = el('input', { type: 'submit', value: 'Run Report', class: 'btn btn-blue' });
    var form = el('form', { class: 'bb-form' }, [
      el('p', {}, [weeksIn, 'How many weeks from today do you need to view?']),
      el('p', {}, [yearIn, 'What is the earliest birth year that qualifies a child for a birthday box? (four digit year)']),
      el('p', {}, [submit])
    ]);
    var printBtn = el('button', { type: 'button', text: 'Print' });
    var actions = el('div', { class: 'bb-actions', style: 'display:none' }, [printBtn]);
    var out = el('div', { id: 'bb-out' });

    var section = el('section', { id: 'bb', class: 'column width8 first' }, [
      el('h2', { text: 'Birthday Box' }),
      el('p', { class: 'bb-hint', text: 'Uses current Guest Data from Sox Box. Nothing is downloaded or stored.' }),
      form, actions, out
    ]);

    Array.prototype.forEach.call(wrapper.children, function (c) { c.style.display = 'none'; c.setAttribute('data-bb-hidden', ''); });
    wrapper.insertBefore(section, wrapper.firstChild);

    printBtn.addEventListener('click', function () { window.print(); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var weeks = Math.max(0, parseInt(weeksIn.value, 10) || 0);
      var year = parseInt(yearIn.value, 10) || 0;
      submit.disabled = true;
      actions.style.display = 'none';
      out.innerHTML = '';
      out.appendChild(el('p', { text: 'Loading Guest Data…' }));
      fetchGuests()
        .then(function (guests) {
          renderResults(out, buildReport(guests, weeks, year), weeks);
          actions.style.display = '';
        })
        .catch(function (err) {
          out.innerHTML = '';
          out.appendChild(el('p', { class: 'bb-err', text: 'ERROR: ' + err.message }));
        })
        .then(function () { submit.disabled = false; });
    });
  }

  function unrenderPage() {
    var bb = document.getElementById('bb');
    if (!bb) return;
    bb.remove();
    var heading = document.querySelector('h1[data-bb-title]');
    if (heading) { heading.textContent = heading.getAttribute('data-bb-title'); heading.removeAttribute('data-bb-title'); }
    document.querySelectorAll('[data-bb-hidden]').forEach(function (c) { c.style.display = ''; c.removeAttribute('data-bb-hidden'); });
  }

  function route() {
    if (location.pathname === ROUTE_PATH && location.hash === ROUTE_HASH) renderPage();
    else unrenderPage();
  }

  // Lets tests load the report logic in Node without a page.
  if (typeof module !== 'undefined' && module.exports) { module.exports = { parseCsv: parseCsv, buildReport: buildReport }; return; }

  addMenuLink();
  route();
  window.addEventListener('hashchange', route);
})();
