// ==UserScript==
// @name         ZC World Test
// @namespace    zc-test
// @version      0.1.0
// @match        http://127.0.0.1:8878/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-start
// ==/UserScript==

window.__zcTest = {
  world: "main",
  fetchWasNative: window.fetch.toString().includes("native"),
};
try {
  window.__zcTest.gm = typeof GM_setValue;
} catch (e) {
  window.__zcTest.gm = "error:" + e.message;
}
window.__zcTest.patchedFetch = (function () {
  const orig = window.fetch.bind(window);
  window.fetch = async (input, init) => orig(input, init);
  return "done";
})();
