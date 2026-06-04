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

  window.initBurnfolderPublishPanel = function (opts) {
    const els = {
      entries: document.getElementById('publishEntriesSnippet'),
      html: document.getElementById('publishHtmlSnippet'),
      journal: document.getElementById('publishJournalSnippet'),
      songs: document.getElementById('publishSongsSnippet'),
      checklist: document.getElementById('publishChecklist'),
      refreshBtn: document.getElementById('publishRefreshBtn'),
      zipBtn: document.getElementById('publishDownloadZipBtn'),
      markBtn: document.getElementById('publishMarkPublishedBtn')
    };

    function setStatus(msg) {
      if (opts.onStatus) opts.onStatus(msg);
    }

    function buildChecklist(date) {
      const publishUrl = 'https://burnfolder.com/' + date + '.html';
      return [
        'merge entries.js snippet for "' + date + '"',
        'save ' + date + '.html to repo root',
        'update window.journalEntries in songs.js (newest first)',
        'deploy burnfolder.com on Netlify',
        'confirm ' + date + '.html loads on production',
        'newsletter: GitHub Action emails subscribers with ' + publishUrl
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
