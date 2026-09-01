/**
 * NEXUS Intelligence Widget — drop-in embed for any site.
 * Usage: <script src="https://tracker.aitradepulse.com/nexus-widget.js" data-target="#nexus-widget" data-theme="dark"></script>
 */
(function () {
  'use strict';

  var API = 'https://tracker.aitradepulse.com/api/v1/conviction';
  var HOMEPAGE = 'https://tracker.aitradepulse.com';

  // Resolve config from the <script> tag that loaded us
  var scripts = document.getElementsByTagName('script');
  var self = scripts[scripts.length - 1];
  var targetSel = (self && self.getAttribute('data-target')) || '#nexus-widget';
  var theme = (self && self.getAttribute('data-theme')) || 'dark';

  var THEMES = {
    dark: {
      bg: '#080b0f',
      panel: '#0e1217',
      raised: '#141a20',
      border: '#1e2328',
      borderDim: '#2a3038',
      primary: '#e6edf3',
      secondary: '#9aa4b2',
      muted: '#6b7280',
      bull: '#26d07c',
      bear: '#ef4444',
      wait: '#f59e0b',
      vivid: '#5eead4',
      textOnBadge: '#ffffff',
    },
    light: {
      bg: '#ffffff',
      panel: '#f6f8fa',
      raised: '#eef1f5',
      border: '#d0d7de',
      borderDim: '#afb8c1',
      primary: '#1f2328',
      secondary: '#57606a',
      muted: '#6e7781',
      bull: '#1a7f37',
      bear: '#cf222e',
      wait: '#9a6700',
      vivid: '#0da57e',
      textOnBadge: '#ffffff',
    },
  };

  function css(str) {
    var s = document.createElement('style');
    s.textContent = str;
    document.head.appendChild(s);
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (attrs.hasOwnProperty(k)) {
          if (k === 'style') node.setAttribute('style', attrs[k]);
          else if (k === 'class') node.className = attrs[k];
          else node.setAttribute(k, attrs[k]);
        }
      }
    }
    if (children != null) {
      if (typeof children === 'string') node.textContent = children;
      else if (Array.isArray(children)) {
        for (var i = 0; i < children.length; i++) {
          var c = children[i];
          if (c && c.nodeType) node.appendChild(c);
        }
      }
    }
    return node;
  }

  function fmtTime(iso) {
    try {
      var d = new Date(iso);
      var hh = String(d.getHours()).padStart(2, '0');
      var mm = String(d.getMinutes()).padStart(2, '0');
      return hh + ':' + mm;
    } catch (e) {
      return '';
    }
  }

  function actionColor(action, t) {
    if (action === 'BUY') return t.bull;
    if (action === 'SELL') return t.bear;
    return t.wait;
  }

  function actionBg(action, t) {
    var c = actionColor(action, t);
    return c;
  }

  // Scoped class prefix to avoid leaking into host page
  var PFX = 'nxg-';
  var containerId = PFX + 'w-' + Math.random().toString(36).slice(2, 8);

  function buildStyles(t) {
    var set = [
      '#' + containerId + '{all:initial;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;',
      'box-sizing:border-box;display:block;max-width:360px;width:100%;background:' + t.bg +
      ';border:1px solid ' + t.border + ';border-radius:12px;overflow:hidden;color:' + t.primary + ';line-height:1.4;}',
      '#' + containerId + ' *,#' + containerId + ' *::before,#' + containerId + ' *::after{box-sizing:border-box;}',
      '#' + containerId + ' .nxg-hdr{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;',
      'border-bottom:1px solid ' + t.border + ';}',
      '#' + containerId + ' .nxg-hdr strong{font-size:13px;letter-spacing:.3px;color:' + t.vivid + ';}',
      '#' + containerId + ' .nxg-hdr .nxg-ts{font-size:10px;color:' + t.muted + ';}',
      '#' + containerId + ' .nxg-list{list-style:none;margin:0;padding:0;}',
      '#' + containerId + ' .nxg-row{display:flex;align-items:center;gap:8px;padding:8px 12px;',
      'border-bottom:1px solid ' + t.borderDim + ';}',
      '#' + containerId + ' .nxg-row:last-child{border-bottom:none;}',
      '#' + containerId + ' .nxg-sym{font-weight:700;font-size:12px;min-width:52px;color:' + t.primary + ';}',
      '#' + containerId + ' .nxg-barwrap{flex:1;height:6px;background:' + t.raised + ';border-radius:3px;overflow:hidden;}',
      '#' + containerId + ' .nxg-bar{height:100%;border-radius:3px;transition:width .4s;}',
      '#' + containerId + ' .nxg-badge{font-size:9px;font-weight:700;padding:2px 6px;border-radius:4px;',
      'text-transform:uppercase;letter-spacing:.4px;min-width:34px;text-align:center;color:' + t.textOnBadge + ';}',
      '#' + containerId + ' .nxg-chg{font-size:11px;font-variant-numeric:tabular-nums;min-width:48px;text-align:right;color:' + t.secondary + ';}',
      '#' + containerId + ' .nxg-chg.nxg-up{color:' + t.bull + ';}',
      '#' + containerId + ' .nxg-chg.nxg-dn{color:' + t.bear + ';}',
      '#' + containerId + ' .nxg-ftr{padding:8px 12px;text-align:center;border-top:1px solid ' + t.border + ';}',
      '#' + containerId + ' .nxg-ftr a{color:' + t.vivid + ';font-size:11px;text-decoration:none;font-weight:600;}',
      '#' + containerId + ' .nxg-ftr a:hover{text-decoration:underline;}',
      '#' + containerId + ' .nxg-err{padding:14px 12px;text-align:center;font-size:12px;color:' + t.muted + ';}',
    ];
    return set.join('\n');
  }

  function renderLoading(t) {
    var root = document.getElementById(containerId);
    if (!root) return;
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'nxg-hdr' }, [
      el('strong', {}, 'NEXUS Intelligence'),
    ]));
    root.appendChild(el('div', { class: 'nxg-err' }, 'Signals loading…'));
  }

  function renderError(t) {
    var root = document.getElementById(containerId);
    if (!root) return;
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'nxg-hdr' }, [
      el('strong', {}, 'NEXUS Intelligence'),
    ]));
    root.appendChild(
      el('div', { class: 'nxg-err' }, 'Temporarily unavailable — check back shortly.')
    );
    root.appendChild(
      el('div', { class: 'nxg-ftr' }, [
        el('a', { href: HOMEPAGE, target: '_blank', rel: 'noopener' }, 'Powered by NEXUS'),
      ])
    );
  }

  function render(items, generatedIso, t) {
    var root = document.getElementById(containerId);
    if (!root) return;
    root.innerHTML = '';

    var hdr = el('div', { class: 'nxg-hdr' }, [
      el('strong', {}, 'NEXUS Intelligence'),
      el('span', { class: 'nxg-ts' }, fmtTime(generatedIso)),
    ]);

    var list = el('ul', { class: 'nxg-list' });
    var top = items.slice(0, 5);
    for (var i = 0; i < top.length; i++) {
      var it = top[i];
      var score = Math.max(0, Math.min(100, it.conviction || 0));
      var barColor = actionColor(it.action, t);
      var chg = it.changePct || 0;
      var chgClass = chg > 0 ? 'nxg-up' : chg < 0 ? 'nxg-dn' : '';
      var chgText = (chg > 0 ? '+' : '') + chg.toFixed(2) + '%';

      var barInner = el('div', {
        class: 'nxg-bar',
        style: 'width:' + score + '%;background:' + barColor + ';',
      });
      var barWrap = el('div', { class: 'nxg-barwrap' }, [barInner]);

      var badge = el('span', {
        class: 'nxg-badge',
        style: 'background:' + actionBg(it.action, t) + ';',
      }, it.action || 'WAIT');

      var chgEl = el('span', { class: 'nxg-chg ' + chgClass }, chgText);

      var row = el('li', { class: 'nxg-row' }, [
        el('span', { class: 'nxg-sym' }, it.symbol || ''),
        barWrap,
        badge,
        chgEl,
      ]);
      list.appendChild(row);
    }

    var ftr = el('div', { class: 'nxg-ftr' }, [
      el('a', { href: HOMEPAGE, target: '_blank', rel: 'noopener' }, 'Powered by NEXUS'),
    ]);

    root.appendChild(hdr);
    root.appendChild(list);
    root.appendChild(ftr);
  }

  function flatten(data) {
    if (!data || !data.markets) return [];
    var all = [];
    for (var i = 0; i < data.markets.length; i++) {
      var m = data.markets[i];
      if (m && m.items) {
        for (var j = 0; j < m.items.length; j++) {
          all.push(m.items[j]);
        }
      }
    }
    all.sort(function (a, b) { return (b.conviction || 0) - (a.conviction || 0); });
    return all;
  }

  function load() {
    var t = THEMES[theme] || THEMES.dark;
    css(buildStyles(t));
    renderLoading(t);

    var xhr = new XMLHttpRequest();
    xhr.open('GET', API, true);
    xhr.timeout = 12000;
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            var json = JSON.parse(xhr.responseText);
            var data = json.data;
            var items = flatten(data);
            render(items, data && data.generated, t);
          } catch (e) {
            renderError(t);
          }
        } else {
          renderError(t);
        }
      }
    };
    xhr.ontimeout = function () { renderError(t); };
    xhr.onerror = function () { renderError(t); };
    xhr.send();
  }

  function destroy() {
    var root = document.getElementById(containerId);
    if (root && root.parentNode) root.parentNode.removeChild(root);
  }

  // Public API
  window.NexusWidget = { destroy: destroy };

  // Mount target
  var target = document.querySelector(targetSel);
  if (!target) {
    // Create a fallback element at the script position
    target = el('div', { id: containerId });
    if (self && self.parentNode) {
      self.parentNode.insertBefore(target, self.nextSibling);
    } else {
      document.body.appendChild(target);
    }
  } else {
    target.id = containerId;
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    load();
  } else {
    if (document.addEventListener) {
      document.addEventListener('DOMContentLoaded', load);
    } else {
      window.attachEvent('onload', load);
    }
  }
})();
