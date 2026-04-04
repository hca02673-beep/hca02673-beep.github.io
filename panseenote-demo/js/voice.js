/**
 * Web Speech API + 終了ビープ + 音声登録用パース（仕様 7, 11）
 */
(function (global) {
  "use strict";

  var C = global.PANSEE_CONFIG;

  function getSpeechRecognitionCtor() {
    return (
      global.SpeechRecognition ||
      global.webkitSpeechRecognition ||
      null
    );
  }

  function isSpeechSupported() {
    return !!getSpeechRecognitionCtor();
  }

  /**
   * 音声認識フェーズ終了の合図（成功失敗に依存しない）
   */
  function playEndBeep() {
    try {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return;
      var ctx = new AC();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.value = 0.08;
      osc.connect(gain);
      gain.connect(ctx.destination);
      var t0 = ctx.currentTime;
      osc.start(t0);
      osc.stop(t0 + 0.12);
      window.setTimeout(function () {
        try {
          ctx.close();
        } catch (e) {}
      }, 400);
    } catch (e) {
      /* ビープ不可環境は無視 */
    }
  }

  /**
   * @returns {Promise<string>} 認識テキスト（空の場合あり）
   */
  function recognizeOnce() {
    var Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      return Promise.resolve("");
    }
    return new Promise(function (resolve) {
      var rec = new Ctor();
      rec.lang = C.SPEECH_LANG;
      rec.continuous = false;
      rec.interimResults = false;
      var settled = false;
      var timer = global.setTimeout(function () {
        if (settled) return;
        settled = true;
        try {
          rec.stop();
        } catch (e) {}
        resolve("");
      }, C.SPEECH_TIMEOUT_MS);

      function finish(text) {
        if (settled) return;
        settled = true;
        global.clearTimeout(timer);
        resolve(text || "");
      }

      var bestText = "";

      rec.onerror = function () {
        finish(bestText);
      };
      rec.onresult = function (ev) {
        if (!ev.results || !ev.results.length) return;
        var last = ev.results[ev.results.length - 1];
        if (!last || !last[0]) return;
        bestText = last[0].transcript || "";
      };
      rec.onend = function () {
        finish(bestText);
      };

      try {
        rec.start();
      } catch (e) {
        finish("");
      }
    }).then(function (text) {
      playEndBeep();
      return text;
    });
  }

  /**
   * 仕様形式A: （数字）冊目（数字）ページ（見出し）
   * 仕様形式B: メモ（見出し）→ book/page は空欄
   * @param {string} transcript
   * @returns {{ ok: boolean, book: string, page: string, title: string, isMemo: boolean }}
   */
  function parseRegisterTranscript(transcript) {
    var raw = transcript == null ? "" : String(transcript).trim();
    if (!raw) {
      return { ok: false, book: "", page: "", title: "", isMemo: false };
    }
    // 形式B: 「メモ＋名前」
    var memoRe = /^メモ\s+(.+)$/;
    var memoM = raw.match(memoRe);
    if (memoM) {
      var memoTitle = (memoM[1] || "").trim();
      if (memoTitle) {
        return { ok: true, book: "", page: "", title: memoTitle, isMemo: true };
      }
    }
    // 形式A: 「○冊目○ページ名前」
    var re = /^(\d+)\s*冊目\s*(\d+)\s*ページ\s*(.*)$/;
    var m = raw.match(re);
    if (!m) {
      return { ok: false, book: "", page: "", title: "", isMemo: false };
    }
    var book = m[1];
    var page = m[2];
    var title = (m[3] || "").trim();
    return { ok: true, book: book, page: page, title: title, isMemo: false };
  }

  global.PANSEE_voice = {
    isSpeechSupported: isSpeechSupported,
    recognizeOnce: recognizeOnce,
    parseRegisterTranscript: parseRegisterTranscript,
    playEndBeep: playEndBeep,
  };
})(typeof window !== "undefined" ? window : globalThis);
