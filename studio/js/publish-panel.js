(function () {
  'use strict';

  function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(value);
    }
    const temp = document.createElement('textarea');
    temp.value = value;
    temp.style.position = 'fixed';
    temp.style.left = '-9999px';
    document.body.appendChild(temp);
    temp.focus();
    temp.select();
    document.execCommand('copy');
    temp.remove();
    return Promise.resolve();
  }

  function downloadFile(name, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function readEditorOutputs() {
    return {
      date: String(document.getElementById('entryDate') && document.getElementById('entryDate').value || '').trim(),
      entriesJsSnippet: (document.getElementById('entryDataOutput') && document.getElementById('entryDataOutput').value) || '',
      entryHtml: (document.getElementById('entryHtmlOutput') && document.getElementById('entryHtmlOutput').value) || '',
      songsJsSnippet: (document.getElementById('songsEntryOutput') && document.getElementById('songsEntryOutput').value) || '',
      journalJsLine: (document.getElementById('journalEntryOutput') && document.getElementById('journalEntryOutput').value) || ''
    };
  }

  function getFunctionsBase() {
    const cfg = window.BurnfolderStudioConfig || {};
    if (cfg.muxApiBase) return String(cfg.muxApiBase).replace(/\/$/, '');
    const host = location.hostname;
    const isLocalDevServer =
      (host === 'localhost' || host === '127.0.0.1') && location.port && location.port !== '8888';
    if (isLocalDevServer) return 'http://localhost:8888/.netlify/functions';
    return '/.netlify/functions';
  }

  function gatherEntryPayload() {
    const dateEl = document.getElementById('entryDate');
    const date = dateEl ? String(dateEl.value || '').trim() : '';
    const api = window.burnfolderEntryEditorApi;
    if (api && typeof api.getPublishPayload === 'function') {
      return api.getPublishPayload();
    }
    if (api && typeof api.getBlocks === 'function') {
      return { date: date, blocks: api.getBlocks() };
    }
    return { date: date, blocks: [] };
  }

  window.initBurnfolderPublishPanel = function (opts) {
    const els = {
      entries: document.getElementById('publishEntriesSnippet'),
      html: document.getElementById('publishHtmlSnippet'),
      journal: document.getElementById('publishJournalSnippet'),
      songs: document.getElementById('publishSongsSnippet'),
      checklist: document.getElementById('publishChecklist'),
      refreshBtn: document.getElementById('publishRefreshBtn'),
      zipBtn: document.getElementById('publishDownloadZipBtn'),
      markBtn: document.getElementById('publishMarkPublishedBtn'),
      liveBtn: document.getElementById('publishLiveBtn')
    };

    function setStatus(msg) {
      if (opts.onStatus) opts.onStatus(msg);
    }

    function buildChecklist(date) {
      const publishUrl = 'https://burnfolder.com/' + date + '.html';
      return [
        'merge entries.js snippet for "' + date + '"',
        'save ' + date + '.html shell (body renders from entries.js)',
        'songs.js / journalEntries derive from entries.js automatically',
        'copy any IMAGES/ files into repo root if needed',
        'deploy burnfolder.com on Netlify',
        'confirm ' + publishUrl + ' loads on production',
        'newsletter: GitHub Action emails subscribers after deploy'
      ];
    }

    function refreshArtifacts() {
      if (window.burnfolderEntryEditorApi && window.burnfolderEntryEditorApi.refresh) {
        window.burnfolderEntryEditorApi.refresh();
      } else {
        const refreshBtn = document.getElementById('refreshPreviewBtn');
        if (refreshBtn) refreshBtn.click();
      }

      const bundle = readEditorOutputs();
      if (!bundle.date) {
        setStatus('set a date / filename key first');
        return;
      }

      if (els.entries) els.entries.value = bundle.entriesJsSnippet;
      if (els.html) els.html.value = bundle.entryHtml;
      if (els.journal) els.journal.value = bundle.journalJsLine;
      if (els.songs) els.songs.value = bundle.songsJsSnippet;

      els.checklist.innerHTML = '';
      buildChecklist(bundle.date).forEach(function (line, index) {
        const li = document.createElement('li');
        const label = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.id = 'publish-check-' + index;
        label.htmlFor = box.id;
        label.appendChild(box);
        label.append(' ' + line);
        li.appendChild(label);
        els.checklist.appendChild(li);
      });

      window.__burnfolderPublishArtifacts = Object.assign({}, bundle, {
        publishUrl: 'https://burnfolder.com/' + bundle.date + '.html'
      });
      setStatus('publish preview for ' + bundle.date);
    }

    document.querySelectorAll('[data-publish-copy]').forEach(function (button) {
      button.addEventListener('click', function () {
        const target = document.getElementById(button.dataset.publishCopy);
        if (!target) return;
        copyText(target.value).then(function () { setStatus('copied'); });
      });
    });

    if (els.refreshBtn) els.refreshBtn.addEventListener('click', refreshArtifacts);

    function collectImagePaths(bundle) {
      const text = [
        bundle.entryHtml,
        bundle.entriesJsSnippet,
        bundle.songsJsSnippet
      ].join('\n');
      const matches = text.match(/IMAGES\/[a-zA-Z0-9._-]+/g) || [];
      return Array.from(new Set(matches));
    }

    function downloadCloudAssetsForPaths() {
      return Promise.resolve(0);
    }

    if (els.zipBtn) els.zipBtn.addEventListener('click', function () {
      refreshArtifacts();
      const bundle = window.__burnfolderPublishArtifacts;
      if (!bundle || !bundle.date) return;

      const imagePaths = collectImagePaths(bundle);
      const readme = [
        'burnfolder publish bundle (v0 — manual git commit)',
        '',
        'date: ' + bundle.date,
        'public url: ' + bundle.publishUrl,
        '',
        'copy each file into the burnfolder.com repo, then deploy Netlify.',
        '',
        imagePaths.length
          ? 'image paths in this entry — copy files into repo:\n' + imagePaths.map(function (p) { return '  ' + p; }).join('\n')
          : 'no IMAGES/ paths detected in this entry.'
      ].join('\n');

      downloadFile('README-publish.txt', readme, 'text/plain');
      downloadFile(bundle.date + '.html', bundle.entryHtml, 'text/html');
      downloadFile('entries-snippet.txt', bundle.entriesJsSnippet, 'text/plain');
      downloadFile('journal-line.txt', bundle.journalJsLine, 'text/plain');
      downloadFile('songs-snippet.txt', bundle.songsJsSnippet, 'text/plain');

      downloadCloudAssetsForPaths(imagePaths).then(function (count) {
        if (count) setStatus('downloaded publish files + ' + count + ' cloud file(s)');
        else setStatus('downloaded publish files');
      });
    });

    if (els.markBtn) els.markBtn.addEventListener('click', function () {
      if (opts.onMarkPublished) {
        Promise.resolve(opts.onMarkPublished()).catch(function (e) {
          setStatus(e.message || 'could not mark published');
        });
      }
    });

    function requestPublish(payload, republish) {
      const authReady =
        window.BurnfolderStudioAuth && window.BurnfolderStudioAuth.whenReady
          ? window.BurnfolderStudioAuth.whenReady()
          : Promise.resolve();

      return authReady.then(function () {
        return fetch(getFunctionsBase() + '/studio-publish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: payload.date,
            blocks: payload.blocks,
            assets: payload.assets || [],
            republish: republish === true
          })
        });
      }).then(function (res) {
        return res.json().catch(function () {
          return {};
        }).then(function (data) {
          return { ok: res.ok, status: res.status, data: data };
        });
      });
    }

    function flushBeforePublish() {
      const tasks = [];
      if (window.burnfolderStudio && typeof window.burnfolderStudio.flushDraft === 'function') {
        tasks.push(window.burnfolderStudio.flushDraft());
      }
      if (window.BurnfolderCloudState && typeof window.BurnfolderCloudState.flush === 'function') {
        tasks.push(window.BurnfolderCloudState.flush('drafts'));
      }
      return Promise.all(tasks);
    }

    function collectPublishAssets(blocks) {
      if (window.BurnfolderAssetCloud && typeof window.BurnfolderAssetCloud.collectPublishAssets === 'function') {
        return window.BurnfolderAssetCloud.collectPublishAssets(blocks);
      }
      return Promise.resolve([]);
    }

    function waitForLivePage(url, dateKey) {
      const target = url || ('https://burnfolder.com/' + dateKey + '.html');
      const attempts = 24;
      let delay = 2500;

      function probe(left) {
        return fetch(target, { method: 'GET', cache: 'no-store', mode: 'cors' })
          .then(function (res) {
            if (res.ok) return target;
            if (left <= 1) throw new Error('deploy still in progress — check ' + target + ' in a minute');
            return new Promise(function (resolve) {
              window.setTimeout(resolve, delay);
            }).then(function () {
              return probe(left - 1);
            });
          })
          .catch(function (err) {
            if (left <= 1) throw err;
            return new Promise(function (resolve) {
              window.setTimeout(resolve, delay);
            }).then(function () {
              return probe(left - 1);
            });
          });
      }

      return probe(attempts);
    }

    function publishLive() {
      refreshArtifacts();
      const payload = gatherEntryPayload();
      if (!payload.date) {
        setStatus('set a date / filename key first');
        return;
      }
      if (!payload.blocks || !payload.blocks.length) {
        setStatus('add at least one block to the entry');
        return;
      }

      const confirmMsg =
        'Publish "' +
        payload.date +
        '" to burnfolder.com?\n\n' +
        'This commits to GitHub, deploys the site, and emails subscribers.';

      if (!window.confirm(confirmMsg)) return;

      if (els.liveBtn) {
        els.liveBtn.disabled = true;
        els.liveBtn.textContent = 'publishing…';
      }
      setStatus('publishing ' + payload.date + '…');

      flushBeforePublish()
        .then(function () {
          return collectPublishAssets(payload.blocks);
        })
        .then(function (assets) {
          return requestPublish(Object.assign({}, payload, { assets: assets }), false);
        })
        .then(function (result) {
          if (!result.ok && result.status === 409) {
            const msg = (result.data && result.data.message) || 'An entry for this date already exists.';
            if (
              !window.confirm(
                msg + '\n\nReplace the live entry with this draft? Subscribers are not re-emailed on republish.'
              )
            ) {
              throw new Error('publish cancelled');
            }
            setStatus('republishing ' + payload.date + '…');
            return collectPublishAssets(payload.blocks).then(function (assets) {
              return requestPublish(Object.assign({}, payload, { assets: assets }), true);
            });
          }
          return result;
        })
        .then(function (result) {
          if (!result.ok) {
            throw new Error((result.data && result.data.message) || 'Publish failed (' + result.status + ')');
          }
          const publishUrl = (result.data && result.data.publishUrl) || ('https://burnfolder.com/' + payload.date + '.html');
          setStatus('committed — waiting for deploy…');
          return waitForLivePage(publishUrl, payload.date).then(function (liveUrl) {
            setStatus('live — ' + liveUrl);
            if (opts.onPublishLive) {
              return Promise.resolve(opts.onPublishLive(result.data));
            }
          });
        })
        .catch(function (err) {
          if (err && err.message === 'publish cancelled') {
            setStatus('publish cancelled');
            return;
          }
          setStatus(err.message || 'publish failed');
        })
        .finally(function () {
          if (els.liveBtn) {
            els.liveBtn.disabled = false;
            els.liveBtn.textContent = 'publish';
          }
        });
    }

    if (els.liveBtn) els.liveBtn.addEventListener('click', publishLive);

    function applyPublishRoleGate() {
      const auth = window.BurnfolderStudioAuth;
      if (auth && auth.canPublish && !auth.canPublish() && els.liveBtn) {
        els.liveBtn.hidden = true;
      }
    }
    if (window.BurnfolderStudioAuth && window.BurnfolderStudioAuth.whenReady) {
      window.BurnfolderStudioAuth.whenReady().then(applyPublishRoleGate);
    } else {
      applyPublishRoleGate();
    }

    window.setTimeout(refreshArtifacts, 800);

    const dateInput = document.getElementById('entryDate');
    if (dateInput) {
      dateInput.addEventListener('input', function () {
        window.clearTimeout(refreshArtifacts.timer);
        refreshArtifacts.timer = window.setTimeout(refreshArtifacts, 500);
      });
    }
  };
})();
