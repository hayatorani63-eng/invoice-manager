// index.html の extractPdfText() が実際に生成する「復元後テキスト」を確認する
// 使い方: node test/dump.js [pdf-path]
"use strict";
const path = require("path");
const {extractPdfLines} = require("./loader");

async function main(){
  const target = process.argv[2] || path.join(__dirname, "fixtures", "外注支払明細書_牛込煌_202607.pdf");
  const text = await extractPdfLines(target);
  console.log("===== FILE =====");
  console.log(target);
  console.log("===== reconstructed lines (JSON.stringify) =====");
  text.split(/\n/).forEach((l, i) => {
    console.log(String(i).padStart(3, " ") + ": " + JSON.stringify(l));
  });
}
main().catch(e => { console.error(e); process.exit(1); });
