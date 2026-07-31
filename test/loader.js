// index.html の <script> をそのまま vm 上で eval し、テストに必要な関数を取り出す。
// index.html を編集したらそれがそのままテスト対象になる(コード重複を作らない)。
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const nodeCrypto = require("crypto");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");

let cached = null;

function mockElement(){
  const el = {
    style: {}, dataset: {},
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    innerHTML: "", textContent: "", value: "", checked: false, indeterminate: false, files: [],
    addEventListener(){}, removeEventListener(){},
    querySelector(){ return null; }, querySelectorAll(){ return []; },
    appendChild(){}, prepend(){}, remove(){},
    click(){}, focus(){}, blur(){},
    getContext(){ return {
      drawImage(){},
      getImageData(){ return {data:new Uint8ClampedArray(4), width:1, height:1}; },
      putImageData(){}, createImageData(){ return {data:new Uint8ClampedArray(4)}; },
      translate(){}, rotate(){}
    }; },
    setAttribute(){}, getAttribute(){ return null; }
  };
  el.parentElement = null;
  return el;
}
function mockDocument(){
  return {
    getElementById(){ return mockElement(); },
    querySelector(){ return mockElement(); },
    querySelectorAll(){ return []; },
    createElement(){ return mockElement(); },
    createTextNode(){ return {}; },
    head: mockElement(), body: mockElement(), documentElement: mockElement(),
    addEventListener(){}
  };
}
function mockStorage(){
  const store = {};
  return {
    getItem: k => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    clear: () => { for(const k of Object.keys(store)) delete store[k]; }
  };
}

function loadApp(){
  if(cached) return cached;
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if(!m) throw new Error("script block not found in index.html");
  const src = m[1];

  // sandbox 内で workerSrc = "https://..." を書き込まれると Node の pdf.js が
  // その URL を require しようとして落ちる。GlobalWorkerOptions だけ隔離した
  // シャローコピーを渡す。
  const sandboxPdfjs = Object.create(pdfjsLib);
  Object.defineProperty(sandboxPdfjs, "GlobalWorkerOptions", {
    value: { workerSrc: "" }, writable: true, enumerable: true, configurable: true
  });

  const sandbox = {
    __exports: {},
    pdfjsLib: sandboxPdfjs,
    console: { log(){}, warn(){}, error(){}, info(){}, debug(){} },
    Math, JSON, RegExp, String, Number, Boolean, Array, Object, Date, Set, Map, Symbol,
    Error, TypeError, RangeError, SyntaxError, ReferenceError,
    parseInt, parseFloat, isNaN, isFinite, Promise,
    Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array,
    Float32Array, Float64Array, ArrayBuffer, DataView,
    URL: { createObjectURL(){ return ""; }, revokeObjectURL(){} },
    setTimeout: setTimeout.bind(null), setInterval: setInterval.bind(null),
    clearTimeout: clearTimeout.bind(null), clearInterval: clearInterval.bind(null),
    document: mockDocument(),
    localStorage: mockStorage(),
    indexedDB: {
      open(){ const rq = {result:null}; setTimeout(()=>{ if(rq.onerror) rq.onerror({}); }, 0); return rq; }
    },
    crypto: nodeCrypto.webcrypto,
    Blob: (typeof Blob !== "undefined") ? Blob : function(){},
    FileReader: function(){ this.readAsDataURL=()=>{}; this.readAsText=()=>{}; },
    Image: function(){},
    TextEncoder, TextDecoder,
    atob: (typeof atob === "function") ? atob : b => Buffer.from(b, "base64").toString("binary"),
    btoa: (typeof btoa === "function") ? btoa : s => Buffer.from(s, "binary").toString("base64"),
    firebase: undefined
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;

  // 注意: try/catch でラップすると `let knownRecipients` がブロックスコープに閉じ込められ、
  // 外の resetRecipients/getRecipients から見えなくなる。ラップは行わない。
  // src の末尾で必要な参照を __exports に載せる。
  const wrapped = `
    ${src}
    ;__exports.parseInvoiceText = parseInvoiceText;
    ;__exports.reconstructLinesFromTextItems = reconstructLinesFromTextItems;
    ;__exports.normalizeCjk = normalizeCjk;
    ;__exports.fixOcrText = fixOcrText;
    ;__exports.extractCorpName = extractCorpName;
    ;__exports.cleanVendorName = cleanVendorName;
    ;__exports.resetRecipients = function(){
      knownRecipients.clear();
      localStorage.removeItem("invoiceManagerRecipients_v1");
    };
    ;__exports.getRecipients = function(){ return [...knownRecipients]; };
  `;
  vm.createContext(sandbox);
  vm.runInContext(wrapped, sandbox);

  if(sandbox.__exports.__initError){
    // eval中に非致命エラーが出ていても、必要な関数が取れていれば通す
    // (DOM 依存の即時実行部分などは無視してよい)
    if(!sandbox.__exports.parseInvoiceText){
      throw sandbox.__exports.__initError;
    }
  }
  if(!sandbox.__exports.parseInvoiceText) throw new Error("parseInvoiceText not exported");
  if(!sandbox.__exports.reconstructLinesFromTextItems) throw new Error("reconstructLinesFromTextItems not exported");
  cached = sandbox.__exports;
  return cached;
}

async function extractPdfLines(pdfPath){
  const app = loadApp();
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pdf = await pdfjsLib.getDocument({data}).promise;
  let text = "";
  const pages = Math.min(pdf.numPages, 3);
  for(let p=1; p<=pages; p++){
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    text += app.reconstructLinesFromTextItems(tc.items) + "\n";
  }
  return text;
}

async function parsePdf(pdfPath){
  const app = loadApp();
  const text = await extractPdfLines(pdfPath);
  return { text, parsed: app.parseInvoiceText(text) };
}

module.exports = { loadApp, extractPdfLines, parsePdf };
