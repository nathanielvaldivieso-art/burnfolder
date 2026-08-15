/**
 * Light client-side video shrink before Mux upload (phones / big camera files).
 * Uses captureStream + MediaRecorder when available; otherwise returns the original file.
 */
(function (root) {
  'use strict';

  var SKIP_UNDER_BYTES = 10 * 1024 * 1024;
  var TARGET_HEIGHT = 720;
  var TARGET_BITRATE = 2500000;
  var MAX_DURATION_MS = 8 * 60 * 1000;

  function supported() {
    return !!(
      root.MediaRecorder &&
      root.HTMLVideoElement &&
      typeof root.HTMLVideoElement.prototype.captureStream === 'function'
    );
  }

  function pickMime() {
    var candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4'
    ];
    for (var i = 0; i < candidates.length; i += 1) {
      if (root.MediaRecorder.isTypeSupported && root.MediaRecorder.isTypeSupported(candidates[i])) {
        return candidates[i];
      }
    }
    return '';
  }

  function loadVideo(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.src = url;
      var cleaned = false;
      function cleanup() {
        if (cleaned) return;
        cleaned = true;
        URL.revokeObjectURL(url);
      }
      video.onloadedmetadata = function () {
        resolve({ video: video, cleanup: cleanup });
      };
      video.onerror = function () {
        cleanup();
        reject(new Error('could not read video'));
      };
    });
  }

  function compressFile(file, opts) {
    var options = opts || {};
    var onProgress = typeof options.onProgress === 'function' ? options.onProgress : function () {};

    if (!file || String(file.type || '').indexOf('video/') !== 0) {
      return Promise.resolve(file);
    }
    if (!supported()) return Promise.resolve(file);
    if ((file.size || 0) > 0 && file.size < SKIP_UNDER_BYTES) return Promise.resolve(file);

    var mime = pickMime();
    if (!mime) return Promise.resolve(file);

    return loadVideo(file).then(function (loaded) {
      var video = loaded.video;
      var durationMs = Math.min(
        MAX_DURATION_MS,
        Math.max(250, (video.duration || 0) * 1000 || MAX_DURATION_MS)
      );
      var height = video.videoHeight || TARGET_HEIGHT;
      var width = video.videoWidth || Math.round((TARGET_HEIGHT * 16) / 9);
      if (height > TARGET_HEIGHT && height > 0) {
        var scale = TARGET_HEIGHT / height;
        // Hint only — captureStream keeps source resolution; bitrate does the shrink.
        video.width = Math.max(2, Math.round(width * scale));
        video.height = TARGET_HEIGHT;
      }

      onProgress(0.02, 'compressing');

      return video
        .play()
        .catch(function () {
          /* autoplay may fail muted — still try recording from currentTime 0 */
        })
        .then(function () {
          video.currentTime = 0;
          var stream = video.captureStream();
          var chunks = [];
          var recorder;
          try {
            recorder = new MediaRecorder(stream, {
              mimeType: mime,
              videoBitsPerSecond: TARGET_BITRATE
            });
          } catch (err) {
            loaded.cleanup();
            video.pause();
            return file;
          }

          return new Promise(function (resolve) {
            var finished = false;
            function finish(result) {
              if (finished) return;
              finished = true;
              try {
                video.pause();
              } catch (e) {
                /* ignore */
              }
              loaded.cleanup();
              resolve(result);
            }

            recorder.ondataavailable = function (event) {
              if (event.data && event.data.size) chunks.push(event.data);
            };
            recorder.onerror = function () {
              finish(file);
            };
            recorder.onstop = function () {
              if (!chunks.length) {
                finish(file);
                return;
              }
              var blob = new Blob(chunks, { type: mime.split(';')[0] || 'video/webm' });
              if (!blob.size || blob.size >= file.size * 0.95) {
                finish(file);
                return;
              }
              var ext = mime.indexOf('mp4') >= 0 ? '.mp4' : '.webm';
              var base = String(file.name || 'clip').replace(/\.[^.]+$/, '');
              var out = new File([blob], base + ext, {
                type: blob.type,
                lastModified: Date.now()
              });
              onProgress(1, 'compressed');
              finish(out);
            };

            recorder.start(250);
            var startedAt = Date.now();
            var tick = root.setInterval(function () {
              var pct = Math.min(0.95, (Date.now() - startedAt) / durationMs);
              onProgress(pct, 'compressing');
              if (video.ended || Date.now() - startedAt >= durationMs + 1500) {
                root.clearInterval(tick);
                if (recorder.state !== 'inactive') recorder.stop();
              }
            }, 200);

            video.onended = function () {
              root.clearInterval(tick);
              if (recorder.state !== 'inactive') recorder.stop();
            };

            // Safety timeout
            root.setTimeout(function () {
              root.clearInterval(tick);
              if (recorder.state !== 'inactive') recorder.stop();
            }, durationMs + 4000);
          });
        });
    });
  }

  function compressIfNeeded(file, opts) {
    return compressFile(file, opts).catch(function () {
      return file;
    });
  }

  root.BurnfolderVideoCompress = {
    compressIfNeeded: compressIfNeeded,
    supported: supported
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
