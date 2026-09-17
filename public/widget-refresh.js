(function () {
  "use strict";
  var BASE = "https://www.juicychat.ai";
  var KEY_STR = "yume1aJ83ZbPpkwb";
  var IV_STR = "yume2024cccydnzc";
  var APP_VERSION = "0.1.85";

  function status(t) {
    try { document.getElementById("s").textContent = t; } catch (e) {}
  }
  function b64EncodeBytes(bytes) {
    var s = "", chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk)
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(s);
  }
  function b64DecodeToBytes(b64) {
    var bin = atob(b64), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function utf8ToBytes(str) { return new TextEncoder().encode(str); }
  function bytesToUtf8(bytes) { return new TextDecoder().decode(bytes); }
  var aesKeyPromise = null;
  function getAesKey() {
    if (!aesKeyPromise) {
      aesKeyPromise = crypto.subtle.importKey("raw", utf8ToBytes(KEY_STR), { name: "AES-CBC" }, false, ["encrypt", "decrypt"]);
    }
    return aesKeyPromise;
  }
  async function encryptRequestPayload(plain) {
    var b64 = btoa(unescape(encodeURIComponent(plain)));
    var key = await getAesKey();
    var cipher = await crypto.subtle.encrypt({ name: "AES-CBC", iv: utf8ToBytes(IV_STR) }, key, utf8ToBytes(b64));
    return b64EncodeBytes(new Uint8Array(cipher));
  }
  async function decryptResponsePayload(b64cipher) {
    var key = await getAesKey();
    var plain = await crypto.subtle.decrypt({ name: "AES-CBC", iv: utf8ToBytes(IV_STR) }, key, b64DecodeToBytes(b64cipher));
    return decodeURIComponent(escape(atob(bytesToUtf8(new Uint8Array(plain)))));
  }
  function createSecretKey() {
    var hex = Array.prototype.map.call(crypto.getRandomValues(new Uint8Array(16)), function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
    return hex.slice(0, 5) + "m" + hex.slice(5, 9) + "4" + hex.slice(9);
  }
  function parseSetCookieHeaders(headers) {
    if (!headers) return [];
    var raw = headers["Set-Cookie"] || headers["set-cookie"] || null;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    return String(raw).split(/,(?=\s*[^;]+=)/);
  }
  function mergeCookies(existing, parts) {
    var map = {};
    String(existing || "").split(";").map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (part) {
      var eq = part.indexOf("=");
      if (eq > 0) map[part.slice(0, eq)] = part.slice(eq + 1);
    });
    (parts || []).forEach(function (header) {
      var first = String(header.split(";")[0] || "").trim();
      var eq = first.indexOf("=");
      if (eq > 0) {
        var name = first.slice(0, eq).trim();
        var value = first.slice(eq + 1).trim();
        if (!value || value.toLowerCase() === "deleted") delete map[name];
        else map[name] = value;
      }
    });
    return Object.keys(map).map(function (k) { return k + "=" + map[k]; }).join("; ");
  }
  async function http(method, url, headers, body) {
    var res = await fetch(url, {
      method: method,
      headers: headers || {},
      body: body != null ? body : undefined,
      credentials: "include",
    });
    var h = {};
    if (res.headers && res.headers.forEach) res.headers.forEach(function (v, k) { h[k] = v; });
    return { status: res.status, headers: h, text: await res.text() };
  }

  function Client(cookie) {
    this.cookie = cookie || "";
    this.secretKey = createSecretKey();
    this.distinctId = "wdg" + Date.now().toString(16);
  }
  function voucherFromCookie(cookie) {
    var m = String(cookie || "").match(/(?:^|;\s*)yume_voucher=([^;]+)/);
    if (!m) return "";
    try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
  }
  Client.prototype.headers = function () {
    var h = {
      "content-type": "application/json",
      Accept: "application/json, text/plain, */*",
      SecretKey: this.secretKey,
      client: "pc",
      system: "android",
      platformType: "web",
      appVersion: APP_VERSION,
      language: "en",
      nsfw: "1",
      voucher: voucherFromCookie(this.cookie),
      utm_source: "",
      offsetnumber: String(new Date().getTimezoneOffset()),
      navigatorlang: "en-US",
      distinctId: this.distinctId,
      Origin: BASE,
      Referer: BASE + "/",
      "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    };
    if (this.cookie) h.Cookie = this.cookie;
    return h;
  };
  Client.prototype.absorb = function (headers) {
    var sc = parseSetCookieHeaders(headers);
    if (sc.length) this.cookie = mergeCookies(this.cookie, sc);
  };
  Client.prototype.parse = async function (text) {
    var json = JSON.parse(text);
    if (json.responseData) return JSON.parse(await decryptResponsePayload(json.responseData));
    return json;
  };
  Client.prototype.post = async function (path, data) {
    var body = JSON.stringify({ requestData: await encryptRequestPayload(JSON.stringify(data == null ? {} : data)) });
    var res = await http("POST", BASE + path, this.headers(), body);
    this.absorb(res.headers);
    return this.parse(res.text);
  };
  Client.prototype.get = async function (path) {
    var res = await http("GET", BASE + path, this.headers(), null);
    this.absorb(res.headers);
    return this.parse(res.text);
  };

  function asArray(data) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== "object") return [];
    if (Array.isArray(data.list)) return data.list;
    if (Array.isArray(data.records)) return data.records;
    if (Array.isArray(data.characterList)) return data.characterList;
    if (Array.isArray(data.data)) return data.data;
    return [];
  }
  function num(v) {
    if (typeof v === "number" && isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && isFinite(Number(v))) return Number(v);
    return 0;
  }

  async function paginate(client, mode, userId) {
    var bots = [], seen = {};
    var path = mode === "own"
      ? "/yume/api/user/v1/character/getOwnUserCharacterList"
      : "/yume/api/user/v1/character/getUserSpaceCharacterList";
    for (var pageNo = 1; pageNo <= 30; pageNo++) {
      var body = mode === "own"
        ? { pageNo: pageNo, pageSize: 50, sortGmtCreate: 0, visibility: null, searchContent: "" }
        : { userId: userId, pageNo: pageNo, pageSize: 50, visibility: null, auditType: null, searchContent: "", characterTags: [], sortName: "new", gender: null };
      var res = await client.post(path, body);
      var batch = asArray(res.data);
      var added = 0;
      for (var i = 0; i < batch.length; i++) {
        var b = batch[i];
        if (!b || b.characterId == null) continue;
        var id = String(b.characterId);
        if (seen[id]) continue;
        seen[id] = true;
        bots.push({
          characterId: id,
          characterName: String(b.characterName || "Untitled"),
          chatCount: num(b.chatCount),
          likeCount: num(b.likeCount),
          favoriteCount: num(b.favoriteCount),
          visibility: b.visibility,
        });
        added++;
      }
      if (batch.length < 50) break;
      if (added === 0 && batch.length > 0) break;
    }
    return bots;
  }

  async function scrape(client, userId) {
    var me = null;
    try {
      var r = await client.get("/yume/api/user/v1/getUserInfo");
      me = r.data || null;
    } catch (e) {}
    var authenticated = !!(me && me.userId);
    var uid = userId || (me && me.userId) || "";
    if (!uid) throw new Error("No lounge user id");
    var isOwn = authenticated && String(me.userId) === String(uid);
    var profile = null;
    try {
      var pr = await client.post("/yume/api/user/v1/getOtherUserInfo", { userId: uid });
      profile = pr.data || null;
    } catch (e) {}
    var bots = await paginate(client, isOwn ? "own" : "public", uid);
    if (isOwn && bots.length === 0) bots = await paginate(client, "public", uid);
    var chats = (profile && num(profile.chatCount)) || bots.reduce(function (s, x) { return s + x.chatCount; }, 0);
    var likes = (profile && num(profile.likeCount)) || bots.reduce(function (s, x) { return s + x.likeCount; }, 0);
    var favorites = (profile && num(profile.favoriteCount)) || bots.reduce(function (s, x) { return s + x.favoriteCount; }, 0);
    var followers = (profile && num(profile.followersCount)) || 0;
    return {
      scrapedAt: new Date().toISOString(),
      userName: (me && me.userName) || (profile && profile.userName) || "",
      userId: uid,
      cookie: client.cookie,
      totals: {
        bots: bots.length,
        chats: chats,
        likes: likes,
        favorites: favorites,
        followers: followers,
        interactions: chats + likes + favorites,
      },
    };
  }

  async function publishOne(client, characterId) {
    status("Publishing " + characterId + "…");
    try {
      var me = await client.get("/yume/api/user/v1/getUserInfo");
      if (me && String(me.code) === "10004") {
        throw new Error(me.msg || "login expired");
      }
    } catch (ePing) {
      if (String((ePing && ePing.message) || ePing).indexOf("expired") !== -1) throw ePing;
    }
    var r = await client.post("/yume/api/user/v1/character/userPublishCharacter", { characterId: characterId });
    if (r && String(r.code) === "10004") {
      throw new Error(r.msg || "login expired");
    }
    var ok = !!(r && (r.success || String(r.code) === "200"));
    var msg = ok ? "Published" : String((r && (r.msg || r.message || r.code)) || "failed");
    return { ok: ok, msg: msg, cookie: client.cookie };
  }

  async function main() {
    try {
      if (!window.WidgetBridge) throw new Error("WidgetBridge missing");
      var cookie = window.WidgetBridge.getCookie() || "";
      var userId = window.WidgetBridge.getUserId() || "";
      var mode = "";
      try { mode = window.WidgetBridge.getMode ? window.WidgetBridge.getMode() : ""; } catch (eM) {}
      if (!cookie || cookie.indexOf("yume_voucher") === -1) {
        throw new Error("No session cookie — open app and login");
      }
      var client = new Client(cookie);
      if (mode === "publish") {
        var characterId = "";
        try { characterId = window.WidgetBridge.getCharacterId ? window.WidgetBridge.getCharacterId() : ""; } catch (eC) {}
        if (!characterId) throw new Error("Missing character id");
        var pub = await publishOne(client, characterId);
        status(pub.ok ? "Published" : "Fail: " + pub.msg);
        if (window.WidgetBridge.onPublishResult) {
          window.WidgetBridge.onPublishResult(!!pub.ok, pub.msg, pub.cookie || client.cookie);
        } else if (!pub.ok) {
          window.WidgetBridge.onError(pub.msg);
        } else {
          window.WidgetBridge.onResult("{}", "", pub.cookie || client.cookie);
        }
        return;
      }
      status("Pulling lounge…");
      var snap = await scrape(client, userId);
      // Day-over-day deltas unknown in headless — send 0 unless we stash previous
      var prev = null;
      try { prev = JSON.parse(localStorage.getItem("jl_widget_prev") || "null"); } catch (e) {}
      var deltaChats = 0, deltaLikes = 0, deltaInteractions = 0;
      if (prev && prev.totals) {
        deltaChats = snap.totals.chats - (prev.totals.chats || 0);
        deltaLikes = snap.totals.likes - (prev.totals.likes || 0);
        deltaInteractions = snap.totals.interactions - (prev.totals.interactions || 0);
      }
      try { localStorage.setItem("jl_widget_prev", JSON.stringify(snap)); } catch (e) {}
      var payload = {
        chats: snap.totals.chats,
        likes: snap.totals.likes,
        favorites: snap.totals.favorites,
        bots: snap.totals.bots,
        followers: snap.totals.followers,
        interactions: snap.totals.interactions,
        deltaChats: deltaChats,
        deltaLikes: deltaLikes,
        deltaInteractions: deltaInteractions,
        scrapedAt: snap.scrapedAt,
      };
      status("OK · " + snap.totals.bots + " bots");
      window.WidgetBridge.onResult(JSON.stringify(payload), snap.userName || "", snap.cookie || client.cookie);
    } catch (e) {
      status("Error: " + ((e && e.message) || e));
      try { window.WidgetBridge.onError(String((e && e.message) || e)); } catch (e2) {}
    }
  }
  main();
})();
