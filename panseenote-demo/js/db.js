/**
 * IndexedDB 層（entries / license / settings）
 * 将来 Step 6: license の更新・API連携をここに集約しやすい構造
 */
(function (global) {
  "use strict";

  var C = global.PANSEE_CONFIG;
  var norm = global.PANSEE_normalizeForSearch;

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(C.DB_NAME, C.DB_VERSION);
      req.onerror = function () {
        reject(req.error);
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onupgradeneeded = function (ev) {
        var db = ev.target.result;
        if (!db.objectStoreNames.contains(C.STORES.ENTRIES)) {
          db.createObjectStore(C.STORES.ENTRIES, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(C.STORES.LICENSE)) {
          db.createObjectStore(C.STORES.LICENSE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(C.STORES.SETTINGS)) {
          db.createObjectStore(C.STORES.SETTINGS, { keyPath: "id" });
        }
      };
    });
  }

  function defaultLicenseDoc() {
    return {
      id: C.LICENSE_DOC_ID,
      licenseKey: "",
      planCode: C.DEFAULT_PLAN_CODE,
      planName: C.DEFAULT_PLAN_NAME,
      itemLimit: C.DEFAULT_ITEM_LIMIT,
      licenseStatus: "trial_offline",
      activatedAt: "",
      lastCheckedAt: "",
      nextCheckAfter: "",
      warningMessage: "",
    };
  }

  /**
   * 旧データ互換・欠損フィールド補完
   * @param {object|null|undefined} lic
   */
  function normalizeLicenseDoc(lic) {
    var d = lic ? Object.assign({}, lic) : defaultLicenseDoc();
    if (d.nextCheckAfter === undefined || d.nextCheckAfter === null) {
      d.nextCheckAfter = "";
    }
    if (d.warningMessage === undefined) d.warningMessage = "";
    return d;
  }

  function defaultSettingsDoc() {
    return {
      id: C.SETTINGS_DOC_ID,
      lastBackupAt: "",
      lastSearchQuery: "",
      appVersion: C.APP_VERSION,
      termsAcceptedAt: "",
      termsVersion: "",
    };
  }

  /**
   * 旧データ互換・欠損フィールド補完
   * @param {object|null|undefined} s
   */
  function normalizeSettingsDoc(s) {
    var d = s ? Object.assign({}, s) : defaultSettingsDoc();
    if (d.lastBackupAt === undefined || d.lastBackupAt === null) d.lastBackupAt = "";
    if (d.lastSearchQuery === undefined || d.lastSearchQuery === null) d.lastSearchQuery = "";
    if (d.appVersion === undefined || d.appVersion === null) d.appVersion = C.APP_VERSION;
    if (d.termsAcceptedAt === undefined || d.termsAcceptedAt === null) d.termsAcceptedAt = "";
    if (d.termsVersion === undefined || d.termsVersion === null) d.termsVersion = "";
    return d;
  }

  /**
   * @param {IDBDatabase} db
   */
  function ensureSeedDocs(db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(
        [C.STORES.LICENSE, C.STORES.SETTINGS],
        "readwrite"
      );
      var licStore = tx.objectStore(C.STORES.LICENSE);
      var setStore = tx.objectStore(C.STORES.SETTINGS);

      var licGet = licStore.get(C.LICENSE_DOC_ID);
      licGet.onsuccess = function () {
        if (!licGet.result) {
          licStore.add(defaultLicenseDoc());
        }
      };
      licGet.onerror = function () {
        reject(licGet.error);
      };

      var setGet = setStore.get(C.SETTINGS_DOC_ID);
      setGet.onsuccess = function () {
        if (!setGet.result) {
          setStore.add(defaultSettingsDoc());
        }
      };
      setGet.onerror = function () {
        reject(setGet.error);
      };

      tx.oncomplete = function () {
        resolve();
      };
      tx.onerror = function () {
        reject(tx.error);
      };
    });
  }

  /**
   * @param {IDBDatabase} db
   * @returns {Promise<object>}
   */
  function getLicense(db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction([C.STORES.LICENSE], "readonly");
      var req = tx.objectStore(C.STORES.LICENSE).get(C.LICENSE_DOC_ID);
      req.onsuccess = function () {
        resolve(normalizeLicenseDoc(req.result || defaultLicenseDoc()));
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
  }

  /**
   * @param {IDBDatabase} db
   * @param {object} doc
   */
  function putLicense(db, doc) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction([C.STORES.LICENSE], "readwrite");
      tx.objectStore(C.STORES.LICENSE).put(doc);
      tx.oncomplete = function () {
        resolve(doc);
      };
      tx.onerror = function () {
        reject(tx.error);
      };
    });
  }

  /**
   * ライセンスキー未保存の試用のみ itemLimit を DEFAULT に補正（旧検証用の大きな上限など）
   * キー保存済みはサーバー返却値を維持
   * @param {IDBDatabase} db
   */
  function syncTrialItemLimitWithConfig(db) {
    return getLicense(db).then(function (lic) {
      if (!lic) return lic;
      if (lic.licenseKey && String(lic.licenseKey).trim() !== "") {
        return lic;
      }
      if (lic.planCode !== C.DEFAULT_PLAN_CODE) return lic;
      if (lic.itemLimit === C.DEFAULT_ITEM_LIMIT) return lic;
      lic.itemLimit = C.DEFAULT_ITEM_LIMIT;
      return putLicense(db, lic);
    });
  }

  /**
   * @param {IDBDatabase} db
   * @returns {Promise<object>}
   */
  function getSettings(db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction([C.STORES.SETTINGS], "readonly");
      var req = tx.objectStore(C.STORES.SETTINGS).get(C.SETTINGS_DOC_ID);
      req.onsuccess = function () {
        resolve(normalizeSettingsDoc(req.result || defaultSettingsDoc()));
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
  }

  /**
   * @param {IDBDatabase} db
   * @param {Partial<object>} patch
   */
  function updateSettings(db, patch) {
    return getSettings(db).then(function (cur) {
      var next = Object.assign({}, cur, patch, { id: C.SETTINGS_DOC_ID });
      return new Promise(function (resolve, reject) {
        var tx = db.transaction([C.STORES.SETTINGS], "readwrite");
        tx.objectStore(C.STORES.SETTINGS).put(next);
        tx.oncomplete = function () {
          resolve(next);
        };
        tx.onerror = function () {
          reject(tx.error);
        };
      });
    });
  }

  /**
   * @param {IDBDatabase} db
   * @returns {Promise<object[]>}
   */
  function getAllEntries(db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction([C.STORES.ENTRIES], "readonly");
      var req = tx.objectStore(C.STORES.ENTRIES).getAll();
      req.onsuccess = function () {
        resolve(req.result || []);
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
  }

  /**
   * @param {IDBDatabase} db
   * @returns {Promise<number>}
   */
  function countEntries(db) {
    return getAllEntries(db).then(function (rows) {
      return rows.length;
    });
  }

  /**
   * @param {IDBDatabase} db
   */
  function clearEntries(db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction([C.STORES.ENTRIES], "readwrite");
      tx.objectStore(C.STORES.ENTRIES).clear();
      tx.oncomplete = function () {
        resolve();
      };
      tx.onerror = function () {
        reject(tx.error);
      };
    });
  }

  /**
   * @param {IDBDatabase} db
   * @param {object} entry
   */
  function putEntry(db, entry) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction([C.STORES.ENTRIES], "readwrite");
      tx.objectStore(C.STORES.ENTRIES).put(entry);
      tx.oncomplete = function () {
        resolve(entry);
      };
      tx.onerror = function () {
        reject(tx.error);
      };
    });
  }

  /**
   * @param {IDBDatabase} db
   * @param {string} id
   */
  function deleteEntry(db, id) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction([C.STORES.ENTRIES], "readwrite");
      tx.objectStore(C.STORES.ENTRIES).delete(id);
      tx.oncomplete = function () {
        resolve();
      };
      tx.onerror = function () {
        reject(tx.error);
      };
    });
  }

  /**
   * @param {string} title
   * @param {string} book
   * @param {string} page
   * @param {string} [memo]
   */
  function buildNewEntry(title, book, page, memo) {
    var t = title == null ? "" : String(title);
    if (t.length > C.MAX_TITLE_LENGTH) {
      t = t.slice(0, C.MAX_TITLE_LENGTH);
    }
    var today = new Date().toISOString().slice(0, 10);
    var id =
      global.crypto && crypto.randomUUID
        ? crypto.randomUUID()
        : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    return {
      id: id,
      title: t,
      titleNormalized: norm(t),
      book: book == null ? "" : String(book),
      page: page == null ? "" : String(page),
      memo: memo == null ? "" : String(memo),
      createdAt: today,
      updatedAt: today,
    };
  }

  /**
   * @param {object} prev
   * @param {object} patch { title?, book?, page?, memo? }
   */
  function patchEntry(prev, patch) {
    var title =
      patch.title !== undefined ? String(patch.title) : prev.title;
    if (title.length > C.MAX_TITLE_LENGTH) {
      title = title.slice(0, C.MAX_TITLE_LENGTH);
    }
    var book = patch.book !== undefined ? String(patch.book) : prev.book;
    var page = patch.page !== undefined ? String(patch.page) : prev.page;
    var memo = patch.memo !== undefined ? String(patch.memo) : (prev.memo || "");
    var today = new Date().toISOString().slice(0, 10);
    return {
      id: prev.id,
      title: title,
      titleNormalized: norm(title),
      book: book,
      page: page,
      memo: memo,
      createdAt: prev.createdAt,
      updatedAt: today,
    };
  }

  global.PANSEE_db = {
    openDb: openDb,
    ensureSeedDocs: ensureSeedDocs,
    getLicense: getLicense,
    getSettings: getSettings,
    updateSettings: updateSettings,
    getAllEntries: getAllEntries,
    countEntries: countEntries,
    clearEntries: clearEntries,
    putEntry: putEntry,
    deleteEntry: deleteEntry,
    buildNewEntry: buildNewEntry,
    patchEntry: patchEntry,
    defaultLicenseDoc: defaultLicenseDoc,
    defaultSettingsDoc: defaultSettingsDoc,
    putLicense: putLicense,
    syncTrialItemLimitWithConfig: syncTrialItemLimitWithConfig,
    normalizeLicenseDoc: normalizeLicenseDoc,
  };
})(typeof window !== "undefined" ? window : globalThis);
