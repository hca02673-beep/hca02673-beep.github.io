/**
 * パンセノート 体験機 — アプリケーションロジック
 *
 * 製品版 (panseenote/js/app.js) の派生版。
 * ・ライセンス認証／規約承認モーダル → 削除
 * ・起動時に DB が空なら demo-data/{set}.json を自動投入
 * ・「最初からやり直す」ボタンで DB クリア＋再投入
 * ・ウェルカムモーダルで操作ガイドを表示
 */
(function () {
  "use strict";

  var C  = window.PANSEE_CONFIG;
  var db = window.PanseeDB;
  var voice = window.PanseeVoice;
  var norm = window.panseeNormalize;

  function $(sel) {
    return document.querySelector(sel);
  }

  /* ──────────────────────────────────────────
     アプリ状態
  ────────────────────────────────────────── */
  var state = {
    idb: null,
    license: null,
    settings: null,
    searchQuery: "",
    voiceRegisterMode: false,
    voicePreviewEntry: null,
    voiceRegisterMetaMsg: "",
    voiceSearchMsg: "",
    draft: null,
    openMemoIds: new Set(),
  };

  /* ──────────────────────────────────────────
     Toast
  ────────────────────────────────────────── */
  function toast(msg) {
    var el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    window.clearTimeout(toast._t);
    toast._t = window.setTimeout(function () {
      el.classList.remove("show");
    }, 3200);
  }

  /* ──────────────────────────────────────────
     登録上限インライン警告
  ────────────────────────────────────────── */
  function setEntryLimitInlineWarning(msg) {
    var el = $("#entry-limit-warning-inline");
    if (!el) return;
    var text = String(msg || "").trim();
    el.textContent = text;
    el.hidden = text === "";
  }

  function updateEntryLimitInlineWarning(entryCount) {
    var limit = Number(state.license && state.license.itemLimit);
    if (!isFinite(limit) || limit <= 0) {
      setEntryLimitInlineWarning("");
      return;
    }
    if (entryCount >= limit) {
      setEntryLimitInlineWarning(
        "体験機の登録上限（" + limit + "件）です。製品版（試用版・無料）は100件まで登録できます"
      );
      return;
    }
    setEntryLimitInlineWarning("");
  }

  /* ──────────────────────────────────────────
     音声登録モード meta メッセージ
  ────────────────────────────────────────── */
  function setVoiceRegisterMeta(msg) {
    state.voiceRegisterMetaMsg = msg || "";
  }

  function startVoiceRegisterSingleRowMode() {
    state.voiceRegisterMode = true;
    state.voicePreviewEntry = null;
    state.voiceRegisterMetaMsg = "";
    state.searchQuery = "";
    if ($("#manual-search")) {
      $("#manual-search").value = "";
    }
    return saveSearchQueryToSettings("").then(function () {
      return refreshCount().then(function () {
        return renderTable();
      });
    });
  }

  /* ──────────────────────────────────────────
     ソート・検索
  ────────────────────────────────────────── */
  function sortEntries(rows) {
    return rows.slice().sort(function (a, b) {
      var ua = String(a.updatedAt || a.createdAt || "");
      var ub = String(b.updatedAt || b.createdAt || "");
      if (ua === ub) return String(b.id).localeCompare(String(a.id));
      return ub.localeCompare(ua);
    });
  }

  function applySearch(rows, q) {
    var qq = norm(q);
    if (!qq) {
      return { matches: [], total: rows.length, capped: false, emptyQuery: true };
    }
    var all = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var tn = r.titleNormalized || norm(r.title);
      if (tn.indexOf(qq) >= 0) all.push(r);
    }
    var total = all.length;
    var capped = total > C.MAX_SEARCH_DISPLAY;
    var matches = capped ? all.slice(0, C.MAX_SEARCH_DISPLAY) : all;
    return { matches: matches, total: total, capped: capped, emptyQuery: false };
  }

  function saveSearchQueryToSettings(q) {
    var nextQ = String(q || "");
    if (!state.idb) return Promise.resolve();
    if (!state.settings) return Promise.resolve();
    if (String(state.settings.lastSearchQuery || "") === nextQ) return Promise.resolve();
    return db.updateSettings(state.idb, { lastSearchQuery: nextQ }).then(function (s) {
      state.settings = s;
    });
  }

  function formatIsoDisplay(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  }

  /* ──────────────────────────────────────────
     プラン表示（体験版固定）
  ────────────────────────────────────────── */
  function formatPlanLabelForSummary(lic) {
    var name = lic && lic.planName ? String(lic.planName).trim() : "体験版";
    if (name.indexOf("プラン") >= 0 || name.indexOf("版") >= 0) return name;
    return name + "プラン";
  }

  function formatPlanShortEn(lic) {
    var code = lic && lic.planCode ? String(lic.planCode).trim().toLowerCase() : "demo";
    var map = { trial: "Trial", demo: "Demo", basic: "Basic", standard: "Standard", premium: "Premium" };
    if (map[code]) return map[code];
    return code.charAt(0).toUpperCase() + code.slice(1);
  }

  function isNarrowLayoutViewport() {
    return (
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(max-width: 640px)").matches
    );
  }

  function isPhoneViewport() {
    return (
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(max-width: 479px)").matches
    );
  }

  function parseCountFromSummaryText(text) {
    var t = String(text || "");
    var m1 = t.match(/^(\d+)件登録済/);
    if (m1) return Number(m1[1]);
    var m2 = t.match(/登録\s+(\d+)/);
    if (m2) return Number(m2[1]);
    return 0;
  }

  function updatePlanSummaryLine(entryCount) {
    var el = $("#plan-summary-line");
    if (!el) return;
    var lic = state.license || {};
    var limit = Number(lic.itemLimit);
    if (!isFinite(limit) || limit < 0) limit = C.DEFAULT_ITEM_LIMIT;
    var n;
    if (entryCount != null && !isNaN(Number(entryCount))) {
      n = Number(entryCount);
    } else {
      n = parseCountFromSummaryText(el.textContent);
    }
    if (isNarrowLayoutViewport()) {
      el.textContent =
        "登録 " + n + "／上限" + limit + "件（" + formatPlanShortEn(lic) + "）";
    } else {
      var label = formatPlanLabelForSummary(lic);
      el.textContent = n + "件登録済／上限" + limit + "件（" + label + "）";
    }
    var elSp = $("#plan-summary-line-sp");
    if (elSp) {
      if (isPhoneViewport()) {
        elSp.innerHTML =
          '<span class="ps-j">登録</span>' + n +
          '<span class="ps-j">／</span>' + limit +
          '<span class="ps-j">件</span>（' + formatPlanShortEn(lic) + '）';
      } else {
        elSp.textContent = "登録 " + n + "／上限" + limit + "件（" + formatPlanShortEn(lic) + "）";
      }
    }
  }

  function updatePlanBar() {
    updatePlanSummaryLine();
  }

  function refreshCount() {
    return db.countEntries(state.idb).then(function (n) {
      updatePlanSummaryLine(n);
      updateEntryLimitInlineWarning(n);
      return n;
    });
  }

  /* ──────────────────────────────────────────
     検索メタ表示
  ────────────────────────────────────────── */
  function renderSearchMeta(result) {
    var el = $("#search-meta");
    if (!el) return;
    var q = state.searchQuery.trim();
    if (!q) {
      el.classList.add("has-result");
      if (state.voiceSearchMsg) {
        el.textContent = state.voiceSearchMsg;
      } else if (result.total > 0) {
        el.textContent = "検索語を入力して検索してください。検索語は短くするのがコツです";
      } else {
        el.textContent = "登録はまだありません。";
      }
      return;
    }
    var parts = [];
    parts.push("「" + q + "」で検索");
    parts.push("— 該当 " + result.total + " 件");
    if (result.capped) {
      parts.push("（検索結果が多いため先頭50件のみ表示。検索語を追加して絞り込んでください）");
    } else if (result.total === 0) {
      parts.push("（ヒットなし）");
    }
    el.textContent = parts.join(" ");
    el.classList.add("has-result");
  }

  /* ──────────────────────────────────────────
     テーブル行 HTML
  ────────────────────────────────────────── */
  function rowHtml(entry, isDraft) {
    var id = entry.id ? String(entry.id) : "";
    var dr = isDraft ? ' data-draft="1"' : "";
    var titleEsc = escapeAttr(entry.title || "");
    var bookEsc = escapeAttr(entry.book || "");
    var pageEsc = escapeAttr(entry.page || "");
    var memoEsc = escapeAttr(entry.memo || "");
    var dateLabel = entry.createdAt || "—";

    var mainTr =
      "<tr" +
      dr +
      (id ? ' data-id="' + escapeAttr(id) + '"' : "") +
      ">" +
      '<td class="col-title"><input class="inline" type="text" maxlength="' +
      C.MAX_TITLE_LENGTH +
      '" data-field="title" value="' +
      titleEsc +
      '" title="' + titleEsc + '" /></td>' +
      '<td class="col-book"><input class="inline inline-num" type="text" inputmode="numeric" maxlength="3" data-field="book" value="' +
      bookEsc +
      '" /></td>' +
      '<td class="col-page"><input class="inline inline-num" type="text" inputmode="numeric" maxlength="3" data-field="page" value="' +
      pageEsc +
      '" /></td>' +
      '<td class="readonly col-date">' +
      escapeHtml(dateLabel) +
      "</td>" +
      '<td class="actions col-actions">' +
      '<button type="button" class="sm row-memo btn-memo">メモ</button>' +
      '<button type="button" class="sm row-save btn-action-green">登録</button>' +
      (isDraft
        ? '<button type="button" class="sm row-delete btn-action-delete" disabled>削除</button>'
        : '<button type="button" class="sm row-delete btn-action-delete">削除</button>') +
      '<input type="hidden" data-field="memo" value="' + memoEsc + '" />' +
      "</td>" +
      "</tr>";

    var memoTr =
      '<tr class="memo-row"' +
      (id ? ' data-for="' + escapeAttr(id) + '"' : "") +
      " hidden>" +
      '<td colspan="5" class="memo-cell">' +
      '<textarea class="memo-textarea" rows="2" maxlength="500" placeholder="メモを入力（保存ボタンで確定）...">' +
      escapeHtml(entry.memo || "") +
      "</textarea>" +
      "</td>" +
      "</tr>";

    return mainTr + memoTr;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/`/g, "&#96;");
  }

  function readRowFromTr(tr) {
    var inputs = tr.querySelectorAll("input[data-field]");
    var o = { title: "", book: "", page: "", memo: "" };
    for (var i = 0; i < inputs.length; i++) {
      var inp = inputs[i];
      var f = inp.getAttribute("data-field");
      if (f === "title" || f === "book" || f === "page" || f === "memo") {
        o[f] = inp.value;
      }
    }
    return o;
  }

  function closeSettingsIfOpen() {
    /* 体験機には設定パネルなし */
  }

  /* ──────────────────────────────────────────
     テーブル描画
  ────────────────────────────────────────── */
  function renderTable() {
    return db.getAllEntries(state.idb).then(function (rows) {
      rows = sortEntries(rows);
      var res = applySearch(rows, state.searchQuery);
      var body = $("#entries-body");
      body.innerHTML = "";

      if (state.voiceRegisterMode) {
        if (state.draft) {
          var dv = state.draft;
          body.insertAdjacentHTML(
            "afterbegin",
            rowHtml(
              {
                id: dv.id || "",
                title: dv.title,
                book: dv.book,
                page: dv.page,
                memo: dv.memo || "",
                createdAt: "（未保存）",
              },
              true
            )
          );
        } else if (state.voicePreviewEntry) {
          body.insertAdjacentHTML("afterbegin", rowHtml(state.voicePreviewEntry, false));
        }
        var metaEl = $("#search-meta");
        if (metaEl) {
          var vmsg = state.voiceRegisterMetaMsg || "";
          if (vmsg) {
            metaEl.textContent = vmsg;
            metaEl.classList.add("has-result");
          } else {
            metaEl.textContent = "音声認識しています。";
            metaEl.classList.add("has-result");
          }
        }
        wireTableHandlers();
        restoreOpenMemoRows();
        return refreshCount();
      }

      for (var i = 0; i < res.matches.length; i++) {
        body.insertAdjacentHTML("beforeend", rowHtml(res.matches[i], false));
      }

      renderSearchMeta(res);
      wireTableHandlers();
      restoreOpenMemoRows();
      return refreshCount();
    });
  }

  /* ──────────────────────────────────────────
     メモ行 開閉
  ────────────────────────────────────────── */
  function bindMemoTextarea(ta, hiddenMemoInput) {
    if (!ta || !hiddenMemoInput) return;
    ta.value = hiddenMemoInput.value;
    ta.oninput = function () {
      hiddenMemoInput.value = ta.value;
      ta.title = ta.value;
    };
  }

  function onToggleMemo(tr, btn) {
    var memoTr = tr.nextElementSibling;
    if (!memoTr || !memoTr.classList.contains("memo-row")) return;
    var hiddenMemoInput = tr.querySelector("input[data-field='memo']");
    var entryId = tr.getAttribute("data-id") || "";
    var isHidden = memoTr.hasAttribute("hidden");

    if (isHidden) {
      memoTr.removeAttribute("hidden");
      bindMemoTextarea(memoTr.querySelector("textarea.memo-textarea"), hiddenMemoInput);
      if (btn) btn.classList.add("memo-active");
      if (entryId) state.openMemoIds.add(entryId);
    } else {
      var ta2 = memoTr.querySelector("textarea.memo-textarea");
      if (ta2 && hiddenMemoInput) hiddenMemoInput.value = ta2.value;
      memoTr.setAttribute("hidden", "");
      if (btn) btn.classList.remove("memo-active");
      if (entryId) state.openMemoIds.delete(entryId);
    }
  }

  function restoreOpenMemoRows() {
    if (!state.openMemoIds || state.openMemoIds.size === 0) return;
    var body = $("#entries-body");
    if (!body) return;
    state.openMemoIds.forEach(function (id) {
      var tr = body.querySelector('tr[data-id="' + id.replace(/"/g, '\\"') + '"]');
      if (!tr) return;
      var memoTr = tr.nextElementSibling;
      if (!memoTr || !memoTr.classList.contains("memo-row")) return;
      var hiddenMemoInput = tr.querySelector("input[data-field='memo']");
      var btn = tr.querySelector("button.row-memo");
      memoTr.removeAttribute("hidden");
      bindMemoTextarea(memoTr.querySelector("textarea.memo-textarea"), hiddenMemoInput);
      if (btn) btn.classList.add("memo-active");
    });
  }

  function wireTableHandlers() {
    var body = $("#entries-body");
    body.onclick = function (ev) {
      var t = ev.target;
      if (!(t instanceof HTMLElement)) return;
      var tr = t.closest("tr");
      if (!tr || !body.contains(tr)) return;
      if (tr.classList.contains("memo-row")) return;

      if (t.classList.contains("row-save")) {
        onSaveRow(tr);
      } else if (t.classList.contains("row-delete")) {
        onDeleteRow(tr);
      } else if (t.classList.contains("row-memo")) {
        onToggleMemo(tr, t);
      }
    };
  }

  /* ──────────────────────────────────────────
     行操作（保存・削除）
  ────────────────────────────────────────── */
  function onSaveRow(tr) {
    var draft = tr.getAttribute("data-draft") === "1";
    var vals = readRowFromTr(tr);
    if (!window.confirm("編集内容を保存しますか？")) return;

    if (draft) {
      return refreshCount().then(function (n) {
        if (n >= Number(state.license.itemLimit)) {
          window.alert(
            "体験機の登録上限（" + state.license.itemLimit + "件）に達しています。保存できません。"
          );
          setEntryLimitInlineWarning(
            "体験機の登録上限（" + state.license.itemLimit + "件）に達しているため保存できません。"
          );
          return;
        }
        var entry = db.buildNewEntry(vals.title, vals.book, vals.page, vals.memo);
        return db.putEntry(state.idb, entry).then(function () {
          state.draft = null;
          if (state.voiceRegisterMode) state.voicePreviewEntry = entry;
          toast("編集内容を保存しました。重要情報がある場合は、重要情報部分を手動で削除してください。");
          return renderTable();
        });
      });
    }

    var id = tr.getAttribute("data-id");
    if (!id) return;
    return db.getAllEntries(state.idb).then(function (rows) {
      var prev = null;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].id === id) { prev = rows[i]; break; }
      }
      if (!prev) return;
      var next = db.patchEntry(prev, vals);
      return db.putEntry(state.idb, next).then(function () {
        if (state.voiceRegisterMode && state.voicePreviewEntry && state.voicePreviewEntry.id === id) {
          state.voicePreviewEntry = next;
        }
        toast("編集内容を保存しました。重要情報がある場合は、重要情報部分を手動で削除してください。");
        return renderTable();
      });
    });
  }

  function onDeleteRow(tr) {
    var draft = tr.getAttribute("data-draft") === "1";
    if (draft) {
      if (!window.confirm("この行を破棄しますか？")) return;
      state.draft = null;
      return renderTable();
    }
    var id = tr.getAttribute("data-id");
    if (!id) return;
    if (!window.confirm("この登録を削除しますか？")) return;
    return db.deleteEntry(state.idb, id).then(function () {
      toast("削除しました。");
      return renderTable();
    });
  }

  /* ──────────────────────────────────────────
     検索
  ────────────────────────────────────────── */
  function runSearch() {
    state.voiceRegisterMode = false;
    state.voicePreviewEntry = null;
    state.draft = null;
    state.voiceRegisterMetaMsg = "";
    state.voiceSearchMsg = "";
    state.searchQuery = $("#manual-search").value || "";
    return saveSearchQueryToSettings(state.searchQuery).then(function () {
      return renderTable();
    });
  }

  /* ──────────────────────────────────────────
     音声検索
  ────────────────────────────────────────── */
  function onVoiceSearch() {
    if (!voice.isSpeechSupported()) {
      state.voiceRegisterMode = false;
      state.voicePreviewEntry = null;
      state.draft = null;
      state.voiceRegisterMetaMsg = "";
      state.voiceSearchMsg = "このブラウザでは音声認識を利用できません。手動検索をご利用ください。";
      state.searchQuery = "";
      if ($("#manual-search")) $("#manual-search").value = "";
      return saveSearchQueryToSettings("").then(function () {
        return renderTable();
      });
    }
    return voice.recognizeOnce().then(function (text) {
      state.voiceRegisterMode = false;
      state.voicePreviewEntry = null;
      state.draft = null;
      state.voiceRegisterMetaMsg = "";
      state.voiceSearchMsg = "";
      if (!text.trim()) {
        state.voiceSearchMsg = "音声認識がタイムアウト（10秒）しました。手動検索もご利用可能です";
      }
      $("#manual-search").value = text;
      state.searchQuery = text;
      return saveSearchQueryToSettings(state.searchQuery).then(function () {
        return renderTable().then(function () {
          if (!text.trim()) toast("音声認識がタイムアウトしました。");
        });
      });
    });
  }

  /* ──────────────────────────────────────────
     音声登録
  ────────────────────────────────────────── */
  function onVoiceRegister() {
    var PARSE_FAIL_MSG = "音声認識失敗（「○\"冊目\"○\"ページ\" サービス名」または「\"メモ\" サービス名」と発話）。手動で登録ができます。";

    if (!voice.isSpeechSupported()) {
      state.voiceRegisterMode = true;
      state.voicePreviewEntry = null;
      state.voiceRegisterMetaMsg = "このブラウザでは音声認識を利用できません。手動での登録をご利用ください。";
      state.voiceSearchMsg = "";
      state.searchQuery = "";
      state.draft = { title: "", book: "", page: "", memo: "" };
      if ($("#manual-search")) $("#manual-search").value = "";
      return saveSearchQueryToSettings("").then(function () {
        return refreshCount().then(function () {
          return renderTable();
        });
      });
    }

    return refreshCount().then(function (n) {
      var atLimit = n >= Number(state.license.itemLimit);
      if (atLimit) {
        state.voiceRegisterMode = false;
        state.voicePreviewEntry = null;
        state.draft = null;
        state.voiceRegisterMetaMsg = "";
        state.searchQuery = "";
        if ($("#manual-search")) $("#manual-search").value = "";
        setEntryLimitInlineWarning(
          "体験機の登録上限（" + state.license.itemLimit + "件）です。製品版（試用版・無料）は100件まで登録できます"
        );
        return saveSearchQueryToSettings("").then(function () {
          return renderTable();
        });
      }

      return startVoiceRegisterSingleRowMode().then(function () {
        return voice.recognizeOnce();
      }).then(function (text) {
        state.draft = null;
        state.voicePreviewEntry = null;

        if (!text.trim()) {
          setVoiceRegisterMeta("音声認識がタイムアウト（10秒）しました。手動で登録ができます。");
          return renderTable();
        }

        var parsed = voice.parseRegisterTranscript(text);

        if (!parsed.ok) {
          state.draft = { title: "", book: "", page: "", memo: "" };
          setVoiceRegisterMeta(PARSE_FAIL_MSG);
          return renderTable();
        }

        if (!parsed.title.trim()) {
          state.draft = { title: "", book: parsed.book, page: parsed.page, memo: "" };
          setVoiceRegisterMeta(PARSE_FAIL_MSG);
          return renderTable();
        }

        var entry = db.buildNewEntry(parsed.title, parsed.book, parsed.page, "");
        return db.putEntry(state.idb, entry).then(function () {
          state.voicePreviewEntry = entry;
          var msg = parsed.isMemo
            ? "音声メモ（冊・ページは空欄）を登録しました。手動で修正登録ができます。"
            : "音声から登録しました。手動で修正登録ができます。";
          setVoiceRegisterMeta(msg);
          toast("音声登録内容を保存しました。重要情報がある場合は、重要情報部分を手動で削除してください。");
          return renderTable();
        });
      }).catch(function () {
        state.draft = { title: "", book: "", page: "", memo: "" };
        state.voicePreviewEntry = null;
        setVoiceRegisterMeta("音声認識がタイムアウト（10秒）しました。手動で登録ができます。");
        return renderTable();
      });
    });
  }

  /* ──────────────────────────────────────────
     エクスポート / インポート
  ────────────────────────────────────────── */
  function onExport() {
    return db.getAllEntries(state.idb).then(function (rows) {
      rows = sortEntries(rows);
      var payload = {
        app: C.APP_ID,
        version: C.EXPORT_JSON_VERSION,
        exportedAt: new Date().toISOString(),
        planCode: "demo",
        itemLimit: C.DEFAULT_ITEM_LIMIT,
        items: rows.map(function (e) {
          return {
            title: e.title,
            book: e.book,
            page: e.page,
            memo: e.memo || "",
            createdAt: e.createdAt,
            updatedAt: e.updatedAt,
          };
        }),
      };
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      var name = "panseenote-demo-backup-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(function () { URL.revokeObjectURL(a.href); }, 500);

      var iso = new Date().toISOString();
      return db.updateSettings(state.idb, { lastBackupAt: iso }).then(function (s) {
        state.settings = s;
        toast("バックアップファイルを保存しました。");
      });
    });
  }

  function onImportFile(file) {
    if (!file) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsText(file, "utf-8");
    })
      .then(function (text) {
        var data;
        try { data = JSON.parse(text); } catch (e) {
          window.alert("バックアップファイルの形式が正しくありません。");
          return;
        }
        if (!data || data.app !== C.APP_ID || !Array.isArray(data.items)) {
          window.alert("バックアップファイルの形式が正しくありません。");
          return;
        }
        var items = data.items;
        var limit = C.DEFAULT_ITEM_LIMIT;
        var truncated = items.length > limit;
        var slice = items.slice(0, limit);

        return db.clearEntries(state.idb).then(function () {
          var chain = Promise.resolve();
          for (var i = 0; i < slice.length; i++) {
            (function (item) {
              chain = chain.then(function () {
                var e = db.buildNewEntry(item.title, item.book, item.page, item.memo || "");
                if (item.createdAt) e.createdAt = String(item.createdAt);
                if (item.updatedAt) e.updatedAt = String(item.updatedAt);
                e.titleNormalized = norm(e.title);
                return db.putEntry(state.idb, e);
              });
            })(slice[i]);
          }
          return chain.then(function () {
            state.draft = null;
            state.searchQuery = $("#manual-search").value || "";
            return saveSearchQueryToSettings(state.searchQuery).then(function () {
              return renderTable().then(function () {
                if (truncated) {
                  window.alert(
                    "体験機の登録上限を超えるため、先頭から取り込める分のみ登録しました。"
                  );
                } else {
                  window.alert("バックアップファイルを読み込みました。既存データは置き換えられました。");
                }
              });
            });
          });
        });
      })
      .catch(function () {
        window.alert("バックアップファイルの読み込みに失敗しました。");
      });
  }

  /* ──────────────────────────────────────────
     体験機: seed データ読込
  ────────────────────────────────────────── */
  function loadDemoSeed() {
    var params = new URLSearchParams(window.location.search);
    var set = params.get("set") || C.DEMO_DEFAULT_SET;
    var url = "demo-data/" + encodeURIComponent(set) + ".json";

    return fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error("seed fetch failed: " + r.status);
        return r.json();
      })
      .then(function (data) {
        if (!data || !Array.isArray(data.items)) return;
        var chain = Promise.resolve();
        for (var i = 0; i < data.items.length; i++) {
          (function (item) {
            chain = chain.then(function () {
              var e = db.buildNewEntry(
                String(item.title || ""),
                String(item.book || ""),
                String(item.page || ""),
                String(item.memo || "")
              );
              return db.putEntry(state.idb, e);
            });
          })(data.items[i]);
        }
        return chain;
      })
      .catch(function (err) {
        console.warn("[Demo] seed load failed:", err);
      });
  }

  /* ──────────────────────────────────────────
     体験機: ウェルカムモーダル
  ────────────────────────────────────────── */
  function showDemoWelcomeModal() {
    var overlay = $("#demo-welcome-modal");
    var btn = $("#btn-demo-welcome-close");
    if (!overlay || !btn) return;
    overlay.removeAttribute("hidden");
    btn.onclick = function () {
      overlay.setAttribute("hidden", "");
    };
  }

  /* ──────────────────────────────────────────
     体験機: 最初からやり直す
  ────────────────────────────────────────── */
  function onDemoReset() {
    if (!window.confirm(
      "体験データをリセットして最初からやり直しますか？\n手動で登録した内容も含め、すべて消去されます。"
    )) return;

    state.draft = null;
    state.searchQuery = "";
    state.voiceRegisterMode = false;
    state.voicePreviewEntry = null;
    state.voiceRegisterMetaMsg = "";
    state.voiceSearchMsg = "";
    state.openMemoIds = new Set();
    if ($("#manual-search")) $("#manual-search").value = "";

    db.clearEntries(state.idb)
      .then(function () {
        return saveSearchQueryToSettings("");
      })
      .then(function () {
        return loadDemoSeed();
      })
      .then(function () {
        return renderTable();
      })
      .then(function () {
        showDemoWelcomeModal();
      })
      .catch(function (e) {
        console.error(e);
        window.alert("リセットに失敗しました。");
      });
  }

  /* ──────────────────────────────────────────
     初期化
  ────────────────────────────────────────── */
  function init() {
    $("#btn-export").addEventListener("click", function () { onExport(); });
    $("#btn-import-trigger").addEventListener("click", function () {
      $("#import-file").click();
    });
    $("#import-file").addEventListener("change", function () {
      var f = $("#import-file").files && $("#import-file").files[0];
      var p = onImportFile(f);
      if (p && p.finally) {
        p.finally(function () { $("#import-file").value = ""; });
      } else {
        $("#import-file").value = "";
      }
    });
    $("#btn-search").addEventListener("click", function () { runSearch(); });
    $("#manual-search").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); runSearch(); }
    });
    $("#btn-voice-search").addEventListener("click", function () { onVoiceSearch(); });
    $("#btn-voice-register").addEventListener("click", function () { onVoiceRegister(); });
    $("#btn-demo-reset").addEventListener("click", function () { onDemoReset(); });

    var layoutResizeTimer = null;
    function onViewportLayoutChange() { updatePlanSummaryLine(); }
    window.addEventListener("resize", function () {
      window.clearTimeout(layoutResizeTimer);
      layoutResizeTimer = window.setTimeout(onViewportLayoutChange, 120);
    });
    if (typeof window !== "undefined" && window.matchMedia) {
      var narrowMq = window.matchMedia("(max-width: 640px)");
      if (narrowMq.addEventListener) {
        narrowMq.addEventListener("change", onViewportLayoutChange);
      } else if (narrowMq.addListener) {
        narrowMq.addListener(onViewportLayoutChange);
      }
      var phoneMq = window.matchMedia("(max-width: 479px)");
      if (phoneMq.addEventListener) {
        phoneMq.addEventListener("change", onViewportLayoutChange);
      } else if (phoneMq.addListener) {
        phoneMq.addListener(onViewportLayoutChange);
      }
    }

    return db.openDb()
      .then(function (idb) {
        state.idb = idb;
        return db.ensureSeedDocs(idb);
      })
      .then(function () {
        return db.getSettings(state.idb);
      })
      .then(function (settings) {
        state.settings = settings;
        state.license = {
          itemLimit: C.DEFAULT_ITEM_LIMIT,
          planCode: C.DEFAULT_PLAN_CODE,
          planName: C.DEFAULT_PLAN_NAME,
        };
        state.searchQuery = String((state.settings && state.settings.lastSearchQuery) || "");
        if ($("#manual-search")) $("#manual-search").value = state.searchQuery;
        updatePlanBar();
        return db.countEntries(state.idb);
      })
      .then(function (count) {
        if (count === 0) {
          return loadDemoSeed()
            .then(function () { return renderTable(); })
            .then(function () { showDemoWelcomeModal(); });
        }
        return renderTable();
      })
      .catch(function (e) {
        console.error(e);
        window.alert(
          "データベースを初期化できませんでした。プライベートブラウズやストレージ制限を確認してください。"
        );
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
