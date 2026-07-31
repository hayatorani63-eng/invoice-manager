// pdf.js のアイテムの transform/width/height の実値を確認する(閾値設計用)
"use strict";
const fs = require("fs");
const path = require("path");
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");

async function main(){
  const target = process.argv[2] || path.join(__dirname, "fixtures", "外注支払明細書_牛込煌_202607.pdf");
  const data = new Uint8Array(fs.readFileSync(target));
  const pdf = await pdfjsLib.getDocument({data}).promise;
  const page = await pdf.getPage(1);
  const tc = await page.getTextContent();
  console.log("count:", tc.items.length);
  const start = parseInt(process.argv[3] || "0", 10);
  const end = parseInt(process.argv[4] || "60", 10);
  tc.items.slice(start, end).forEach((it0, k) => {
    const i = start + k;
    const it = it0;
    console.log(String(i).padStart(3), JSON.stringify({
      str: it.str,
      w: it.width,
      h: it.height,
      tx: it.transform[0],
      ty: it.transform[3],
      x: it.transform[4],
      y: it.transform[5],
      hasEOL: it.hasEOL
    }));
  });
}
main().catch(e => { console.error(e); process.exit(1); });
