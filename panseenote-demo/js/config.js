/**
 * パンセノート 体験機 — 設定定数
 * 製品版 (panseenote) とは DB_NAME が異なるため、同一ブラウザで完全分離される。
 * ライセンス認証は行わない。
 */
(function (global) {
  "use strict";

  var BASE_PATH = "/panseenote-demo/";

  var CONFIG = {
    APP_ID: "PenseeNote",
    APP_VERSION: "1.0.8",
    BUILD_TIMESTAMP: "2026-04-03T00:00:00Z",
    EXPORT_JSON_VERSION: "1.0",

    /** 製品版と異なる DB_NAME で IndexedDB を完全分離 */
    DB_NAME: "panseenote-demo-db",
    DB_VERSION: 1,

    STORES: {
      ENTRIES: "entries",
      LICENSE: "license",
      SETTINGS: "settings",
    },

    DEFAULT_PLAN_CODE: "demo",
    DEFAULT_PLAN_NAME: "体験版",
    /** 体験機の登録上限（試供品サイズ） */
    DEFAULT_ITEM_LIMIT: 25,

    /** seed データのデフォルトセット名（?set=<name> で切替可） */
    DEMO_DEFAULT_SET: "lady",

    LICENSE_DOC_ID: "current",
    SETTINGS_DOC_ID: "app-settings",

    MAX_TITLE_LENGTH: 100,
    SPEECH_TIMEOUT_MS: 10000,
    MAX_SEARCH_DISPLAY: 50,

    SPEECH_LANG: "ja-JP",

    LICENSE_API_URL: "",
  };

  CONFIG.getBasePath = function () {
    return BASE_PATH;
  };

  CONFIG.getLicenseApiUrl = function () {
    return "";
  };

  global.PANSEE_CONFIG = CONFIG;
})(typeof window !== "undefined" ? window : globalThis);
