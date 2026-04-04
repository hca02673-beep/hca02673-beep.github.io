/**
 * ライセンスキー形式チェック（本物判定はサーバーのみ）と GAS API 呼び出し
 */
(function (global) {
  "use strict";

  /** 推奨形式: PN1-XXXX-XXXX-XXXX（英数字大文字） */
  var LICENSE_KEY_RE = /^PN1-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

  var ERROR_CODE_MESSAGES = {
    INVALID_JSON: "通信データが不正です",
    INVALID_ACTION: "サーバー要求が不正です",
    INVALID_LICENSE_FORMAT: "ライセンスキー形式が不正です",
    LICENSE_NOT_FOUND: "ライセンスキーが見つかりません",
    LICENSE_DELETED: "このライセンスは無効です",
    INTERNAL_ERROR: "サーバーエラーが発生しました",
  };

  function normalizeLicenseKeyInput(raw) {
    return String(raw || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "");
  }

  function isValidLicenseKeyFormat(key) {
    if (!key) return false;
    return LICENSE_KEY_RE.test(String(key).trim().toUpperCase());
  }

  function messageForErrorCode(code, fallbackMessage) {
    if (code && ERROR_CODE_MESSAGES[code]) return ERROR_CODE_MESSAGES[code];
    if (fallbackMessage) return fallbackMessage;
    return "認証に失敗しました";
  }

  /**
   * @param {string} url
   * @param {object} payload
   * @returns {Promise<object>}
   */
  function clipText(text, max) {
    var s = String(text == null ? "" : text);
    if (s.length <= max) return s;
    return s.slice(0, max) + "...";
  }

  function buildApiError(kind, message, extra) {
    var err = new Error(message || "API request failed");
    err.name = "LicenseApiError";
    err.kind = kind || "unknown";
    if (extra && typeof extra === "object") {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) {
          err[k] = extra[k];
        }
      }
    }
    return err;
  }

  function postLicenseAction(url, payload) {
    var timeoutMs = 15000;
    var ctrl =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    var tid = null;
    if (ctrl) {
      tid = global.setTimeout(function () {
        ctrl.abort();
      }, timeoutMs);
    }

    var params = [];
    for (var k in payload) {
      if (Object.prototype.hasOwnProperty.call(payload, k)) {
        params.push(
          encodeURIComponent(k) + "=" + encodeURIComponent(String(payload[k] == null ? "" : payload[k]))
        );
      }
    }
    var getUrl = url + (url.indexOf("?") >= 0 ? "&" : "?") + params.join("&");

    return fetch(getUrl, {
      method: "GET",
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (res) {
        return res.text().then(function (raw) {
          if (!res.ok) {
            throw buildApiError(
              "http",
              "HTTP " + res.status + " " + (res.statusText || ""),
              {
                status: res.status,
                statusText: res.statusText || "",
                responseText: clipText(raw, 400),
              }
            );
          }
          var data;
          try {
            data = raw ? JSON.parse(raw) : {};
          } catch (e) {
            throw buildApiError("invalid_json", "JSON parse error", {
              responseText: clipText(raw, 400),
            });
          }
          return data;
        });
      })
      .catch(function (e) {
        if (e && e.name === "AbortError") {
          throw buildApiError("timeout", "Request timeout", { timeoutMs: timeoutMs });
        }
        if (e && e.name === "LicenseApiError") throw e;
        throw buildApiError("network", (e && e.message) || "Network error");
      })
      .finally(function () {
        if (tid) global.clearTimeout(tid);
      });
  }

  global.PANSEE_license = {
    LICENSE_KEY_RE: LICENSE_KEY_RE,
    normalizeLicenseKeyInput: normalizeLicenseKeyInput,
    isValidLicenseKeyFormat: isValidLicenseKeyFormat,
    messageForErrorCode: messageForErrorCode,
    postLicenseAction: postLicenseAction,
  };
})(typeof window !== "undefined" ? window : globalThis);
