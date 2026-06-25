(function () {
  'use strict';

  var I18N = {"en":{"Network Drive":"Network Drive","Mount your TCloud as a network drive on your computer.":"Mount your TCloud as a network drive on your computer.","TCloud can't open a network share from inside the browser, so this extension pairs with a tiny bridge you run yourself. The bridge speaks WebDAV to your operating system and talks to TCloud on your behalf — every OS can mount a WebDAV drive natively, with no extra software.":"TCloud can't open a network share from inside the browser, so this extension pairs with a tiny bridge you run yourself. The bridge speaks WebDAV to your operating system and talks to TCloud on your behalf — every OS can mount a WebDAV drive natively, with no extra software.","Bridge host":"Bridge host","Bridge port":"Bridge port","1 · Run the bridge":"1 · Run the bridge","Run this where the bridge should live — your Raspberry Pi is perfect. It needs Node.js 18+ and no extra packages.":"Run this where the bridge should live — your Raspberry Pi is perfect. It needs Node.js 18+ and no extra packages.","Download the bridge":"Download the bridge","2 · Mount the drive":"2 · Mount the drive","Windows":"Windows","macOS":"macOS","Linux":"Linux","rclone":"rclone","On Windows, allow Basic auth over HTTP once (see the README) or the drive won't connect.":"On Windows, allow Basic auth over HTTP once (see the README) or the drive won't connect.","Why WebDAV and not SMB?":"Why WebDAV and not SMB?","SMB needs the full Samba protocol stack, a privileged port and per-OS credential quirks. WebDAV is plain HTTP, maps cleanly onto TCloud's file API, and Windows, macOS, Linux and phones all mount it out of the box.":"SMB needs the full Samba protocol stack, a privileged port and per-OS credential quirks. WebDAV is plain HTTP, maps cleanly onto TCloud's file API, and Windows, macOS, Linux and phones all mount it out of the box.","Copy":"Copy","Copied!":"Copied!","Could not download the bridge.":"Could not download the bridge.","Keep the bridge on your local network and protect it with a password — it serves your decrypted files.":"Keep the bridge on your local network and protect it with a password — it serves your decrypted files."},"it":{"Network Drive":"Unità di rete","Mount your TCloud as a network drive on your computer.":"Monta il tuo TCloud come unità di rete sul computer.","TCloud can't open a network share from inside the browser, so this extension pairs with a tiny bridge you run yourself. The bridge speaks WebDAV to your operating system and talks to TCloud on your behalf — every OS can mount a WebDAV drive natively, with no extra software.":"TCloud non può aprire una condivisione di rete dall'interno del browser, quindi questa estensione si affianca a un piccolo bridge che avvii tu stesso. Il bridge comunica in WebDAV con il tuo sistema operativo e dialoga con TCloud per tuo conto — ogni sistema operativo può montare un'unità WebDAV in modo nativo, senza software aggiuntivo.","Bridge host":"Host del bridge","Bridge port":"Porta del bridge","1 · Run the bridge":"1 · Avvia il bridge","Run this where the bridge should live — your Raspberry Pi is perfect. It needs Node.js 18+ and no extra packages.":"Esegui questo comando dove vuoi che risieda il bridge — il tuo Raspberry Pi è perfetto. Richiede Node.js 18+ e nessun pacchetto aggiuntivo.","Download the bridge":"Scarica il bridge","2 · Mount the drive":"2 · Monta l'unità","Windows":"Windows","macOS":"macOS","Linux":"Linux","rclone":"rclone","On Windows, allow Basic auth over HTTP once (see the README) or the drive won't connect.":"Su Windows, abilita una volta l'autenticazione Basic su HTTP (vedi il README) o l'unità non si connetterà.","Why WebDAV and not SMB?":"Perché WebDAV e non SMB?","SMB needs the full Samba protocol stack, a privileged port and per-OS credential quirks. WebDAV is plain HTTP, maps cleanly onto TCloud's file API, and Windows, macOS, Linux and phones all mount it out of the box.":"SMB richiede l'intero stack del protocollo Samba, una porta privilegiata e gestioni delle credenziali diverse per ogni sistema operativo. WebDAV è semplice HTTP, si integra in modo pulito con l'API dei file di TCloud, e Windows, macOS, Linux e telefoni lo montano tutti senza configurazioni.","Copy":"Copia","Copied!":"Copiato!","Could not download the bridge.":"Impossibile scaricare il bridge.","Keep the bridge on your local network and protect it with a password — it serves your decrypted files.":"Mantieni il bridge sulla tua rete locale e proteggilo con una password — distribuisce i tuoi file decifrati."}};

  var lang = 'en';
  try { lang = localStorage.getItem('tcloud_lang') || 'en'; } catch (e) {}
  var STRINGS = I18N[lang] || I18N.en || {};
  function et(key) { return (STRINGS && STRINGS[key]) || (I18N.en && I18N.en[key]) || key; }

  function repoBase() {
    if (extension && extension.repo && extension.ref) {
      return 'https://github.com/' + extension.repo + '/blob/' + extension.ref;
    }
    return null;
  }

  function serverOrigin() {
    try { return location.origin; } catch (e) { return 'https://your-tcloud'; }
  }

  function runCommand(serverUrl, host, port) {
    return 'TCLOUD_URL="' + serverUrl + '" \\\n' +
      'TCLOUD_USER="your-username" TCLOUD_PASS="your-password" \\\n' +
      'BRIDGE_USER="tcloud" BRIDGE_PASS="choose-a-password" \\\n' +
      'BRIDGE_HOST="' + host + '" BRIDGE_PORT="' + port + '" \\\n' +
      'node tcloud-webdav-bridge.js';
  }

  function mountCommands(host, port) {
    var url = 'http://' + host + ':' + port + '/';
    return {
      windows: 'net use * "\\\\' + host + '@' + port + '\\DavWWWRoot" /user:tcloud *',
      macos: 'Finder \u2192 Go \u2192 Connect to Server (\u2318K)\n' + url + '\nUser: tcloud   Password: your BRIDGE_PASS',
      linux: 'sudo mount -t davfs ' + url + ' /mnt/tcloud\n# user: tcloud   password: your BRIDGE_PASS',
      rclone: 'rclone config create tcloud webdav url=' + url + ' vendor=other user=tcloud\nrclone mount tcloud: /mnt/tcloud --vfs-cache-mode writes'
    };
  }

  var INPUT_STYLE = 'width:100%;padding:8px 10px;border-radius:8px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font-size:14px;box-sizing:border-box';

  function codeBlock(api, id, text) {
    return '<div style="position:relative">' +
      '<pre id="' + id + '" style="background:rgba(127,127,127,.12);border-radius:8px;padding:14px 16px;padding-right:74px;overflow:auto;white-space:pre-wrap;word-break:break-word;margin:0;font-size:13px;line-height:1.45">' + api.esc(text) + '</pre>' +
      '<button data-copy="' + id + '" class="modal-btn" style="position:absolute;top:8px;right:8px;padding:2px 10px;font-size:12px">' + api.esc(et('Copy')) + '</button>' +
      '</div>';
  }

  function tab(api, key, label, active) {
    return '<button data-tab="' + key + '" class="modal-btn' + (active ? ' primary' : '') + '">' + api.esc(label) + '</button>';
  }

  function downloadBridge(api) {
    var base = repoBase();
    if (base) { window.open(base + '/bridge/tcloud-webdav-bridge.js', '_blank'); }
    else { api.toast(et('Could not download the bridge.')); }
  }

  function bind(api, origin) {
    var hostEl = document.getElementById('nd-host');
    var portEl = document.getElementById('nd-port');
    var runEl = document.getElementById('nd-run');
    var mountEl = document.getElementById('nd-mount');
    var winNote = document.getElementById('nd-win-note');
    var os = 'windows';

    function refresh() {
      var host = (hostEl && hostEl.value.trim()) || '127.0.0.1';
      var port = (portEl && portEl.value.trim()) || '4819';
      if (runEl) runEl.textContent = runCommand(origin, host, port);
      var m = mountCommands(host, port);
      if (mountEl) mountEl.textContent = m[os] || m.windows;
      if (winNote) winNote.style.display = os === 'windows' ? '' : 'none';
    }

    if (hostEl) hostEl.oninput = refresh;
    if (portEl) portEl.oninput = refresh;

    var tabs = document.querySelectorAll('[data-tab]');
    for (var i = 0; i < tabs.length; i++) {
      (function (btn) {
        btn.onclick = function () {
          os = btn.getAttribute('data-tab');
          for (var j = 0; j < tabs.length; j++) tabs[j].classList.remove('primary');
          btn.classList.add('primary');
          refresh();
        };
      })(tabs[i]);
    }

    var copyBtns = document.querySelectorAll('[data-copy]');
    for (var k = 0; k < copyBtns.length; k++) {
      (function (btn) {
        btn.onclick = async function () {
          var el = document.getElementById(btn.getAttribute('data-copy'));
          if (!el) return;
          try { await navigator.clipboard.writeText(el.textContent); } catch (e) {}
          var prev = btn.textContent;
          btn.textContent = et('Copied!');
          setTimeout(function () { btn.textContent = prev; }, 1200);
        };
      })(copyBtns[k]);
    }

    var dl = document.getElementById('nd-dl');
    if (dl) dl.onclick = function () { downloadBridge(api); };

    refresh();
  }

  function page(api) {
    api.setBreadcrumb(et('Network Drive'));
    var origin = serverOrigin();
    var host = '127.0.0.1';
    var port = '4819';
    var m = mountCommands(host, port);

    var html =
      '<div style="padding:24px;max-width:760px;line-height:1.5">' +
        '<h2 style="margin:0 0 6px">' + api.esc(et('Network Drive')) + '</h2>' +
        '<p style="opacity:.85;margin:0 0 16px">' + api.esc(et('Mount your TCloud as a network drive on your computer.')) + '</p>' +

        '<p style="opacity:.8;margin:0 0 18px">' + api.esc(et("TCloud can't open a network share from inside the browser, so this extension pairs with a tiny bridge you run yourself. The bridge speaks WebDAV to your operating system and talks to TCloud on your behalf \u2014 every OS can mount a WebDAV drive natively, with no extra software.")) + '</p>' +

        '<div style="display:flex;gap:14px;flex-wrap:wrap;margin:0 0 6px">' +
          '<label style="flex:1;min-width:220px">' +
            '<div style="opacity:.7;font-size:13px;margin-bottom:4px">' + api.esc(et('Bridge host')) + '</div>' +
            '<input id="nd-host" value="' + host + '" style="' + INPUT_STYLE + '" />' +
          '</label>' +
          '<label style="width:130px">' +
            '<div style="opacity:.7;font-size:13px;margin-bottom:4px">' + api.esc(et('Bridge port')) + '</div>' +
            '<input id="nd-port" value="' + port + '" style="' + INPUT_STYLE + '" />' +
          '</label>' +
        '</div>' +

        '<h3 style="margin:22px 0 6px">' + api.esc(et('1 \u00b7 Run the bridge')) + '</h3>' +
        '<p style="opacity:.8;margin:0 0 8px">' + api.esc(et('Run this where the bridge should live \u2014 your Raspberry Pi is perfect. It needs Node.js 18+ and no extra packages.')) + '</p>' +
        codeBlock(api, 'nd-run', runCommand(origin, host, port)) +
        '<div style="margin:10px 0 0"><button id="nd-dl" class="modal-btn">' + api.esc(et('Download the bridge')) + '</button></div>' +

        '<h3 style="margin:26px 0 6px">' + api.esc(et('2 \u00b7 Mount the drive')) + '</h3>' +
        '<div id="nd-tabs" style="display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px">' +
          tab(api, 'windows', et('Windows'), true) +
          tab(api, 'macos', et('macOS'), false) +
          tab(api, 'linux', et('Linux'), false) +
          tab(api, 'rclone', et('rclone'), false) +
        '</div>' +
        codeBlock(api, 'nd-mount', m.windows) +
        '<p id="nd-win-note" style="opacity:.7;font-size:13px;margin:8px 0 0">' + api.esc(et("On Windows, allow Basic auth over HTTP once (see the README) or the drive won't connect.")) + '</p>' +

        '<h3 style="margin:28px 0 6px">' + api.esc(et('Why WebDAV and not SMB?')) + '</h3>' +
        '<p style="opacity:.8;margin:0 0 16px">' + api.esc(et("SMB needs the full Samba protocol stack, a privileged port and per-OS credential quirks. WebDAV is plain HTTP, maps cleanly onto TCloud's file API, and Windows, macOS, Linux and phones all mount it out of the box.")) + '</p>' +
        '<p style="opacity:.7;font-size:13px;margin:0">\uD83D\uDD12 ' + api.esc(et('Keep the bridge on your local network and protect it with a password \u2014 it serves your decrypted files.')) + '</p>' +
      '</div>';

    api.setContent(html);
    bind(api, origin);
  }

  TCloudExt.registerNav({
    id: 'network-drive',
    label: et('Network Drive'),
    emoji: '\uD83D\uDDC2\uFE0F',
    onClick: function (api) { page(api); }
  });
})();
