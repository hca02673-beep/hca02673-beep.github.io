/**
 * 検索用正規化（仕様 8.3）
 */
(function (global) {
  "use strict";

  /** 半角カタカナ → 全角カタカナ（主要範囲） */
  var HW_KATA = "｡｢｣､･ｦｧｨｩｪｫｬｭｮｯｰｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝﾞﾟ";
  var FW_KATA =
    "。「」、・ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン゛゜";

  function halfKatakanaToFull(s) {
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      var idx = HW_KATA.indexOf(c);
      out += idx >= 0 ? FW_KATA[idx] : c;
    }
    return out;
  }

  /**
   * @param {string} raw
   * @returns {string}
   */
  function normalizeForSearch(raw) {
    if (raw == null) return "";
    var s = String(raw);
    // Unicode 正規化で幅などを揃えたうえで、仕様どおり補正
    s = s.normalize("NFKC");
    s = halfKatakanaToFull(s);
    // ひらがな → カタカナ（U+3041〜U+3096）
    s = s.replace(/[\u3041-\u3096]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) + 0x60);
    });
    // 英字は大文字・半角相当に（NFKC 後の ASCII）
    s = s.replace(/[a-z]/g, function (ch) {
      return ch.toUpperCase();
    });
    s = s.trim();
    s = s.replace(/\s+/g, " ");
    return s;
  }

  global.PANSEE_normalizeForSearch = normalizeForSearch;
})(typeof window !== "undefined" ? window : globalThis);
