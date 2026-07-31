// index.html の parseInvoiceText / reconstructLinesFromTextItems の回帰テスト
// 実行: node test/run.js
"use strict";
const fs = require("fs");
const path = require("path");
const {loadApp, parsePdf} = require("./loader");

const app = loadApp();
const results = [];
let failed = 0;

function assert(name, cond, msg){
  results.push({ok: !!cond, name, msg: cond ? "" : (msg || "")});
  if(!cond) failed++;
}
function assertEq(name, actual, expected){
  assert(name, actual === expected,
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function assertIncludes(name, s, sub){
  assert(name, typeof s === "string" && s.includes(sub),
    `expected to include ${JSON.stringify(sub)}, got ${JSON.stringify(s)}`);
}
function parse(text){
  app.resetRecipients();
  return app.parseInvoiceText(text);
}

/* =====================================================================
   1) 合成テキストによる回帰テスト(PROMPT.md の「既存の挙動を壊さないこと」)
   ===================================================================== */

// --- 日付 ---
{
  const p = parse("請求書\n発行日 2026年3月15日\nお支払期限 2026年4月30日\n合計 ¥1,000\n株式会社サンプル");
  assertEq("date: 請求日を採用し支払期限を排除", p.date, "2026-03-15");
}
{
  const p = parse("請求書\n請求日 令和8年7月31日\n合計 ¥10,000\n株式会社エガク");
  assertEq("date: 和暦 令和8年", p.date, "2026-07-31");
}
{
  const p = parse("領収書\nR8.7.9\n合計 ¥1,000\nセブンーイレブン 吉祥寺店");
  assertEq("date: R8.7.9", p.date, "2026-07-09");
}
{
  const p = parse("請求書\n請求日 令和元年5月1日\n合計 ¥3,000\n株式会社元号");
  assertEq("date: 令和元年=2019", p.date, "2019-05-01");
}
{
  const p = parse("レシート\n26/07/20 15:30\n合計 ¥800\nうどん商店");
  assertEq("date: 2桁年 26/07/20", p.date, "2026-07-20");
}
{
  const p = parse("請求書\n発行日 20260731\n合計 ¥1,000\n株式会社サンプル");
  assertEq("date: YYYYMMDD 20260731", p.date, "2026-07-31");
}
{
  const p = parse("Invoice\nIssue Date: Jul 31, 2026\nTotal: $100\nAdobe Systems Inc.");
  assertEq("date: Jul 31, 2026", p.date, "2026-07-31");
}
{
  const p = parse("Invoice\nDate: 31 Jul 2026\nTotal: $100\nAdobe Systems Inc.");
  assertEq("date: 31 Jul 2026", p.date, "2026-07-31");
}
{
  const p = parse("請求書\n発行日 2026/2/30\n請求日 2026/2/28\n合計 ¥1,000\n株式会社サンプル");
  assertEq("date: 実在しない日付(2/30)を捨てる", p.date, "2026-02-28");
}
{
  const p = parse("請求書\nTEL 03-1234-5678\n〒123-4567\n合計 ¥1,000\n株式会社サンプル");
  assertEq("date: 電話/郵便番号を日付にしない", p.date, undefined);
}
{
  const p = parse("請求書\nお支払期限 2026年4月30日\n合計 ¥1,000\n株式会社サンプル");
  assertEq("date: 支払期限しかない場合はフォールバック採用", p.date, "2026-04-30");
}
{
  // 「発行日」の直後にある日付を、同一行の「Due Date」より優先(直近キーワード優先)
  const p = parse("請求書\n発行日 2026年3月15日 支払期限 2026年4月30日\n合計 ¥1,000\n株式会社サンプル");
  assertEq("date: 同一行内で直前キーワード優先", p.date, "2026-03-15");
}

// --- 金額 ---
{
  const p = parse("請求書\n小計 ¥10,000\n消費税 ¥1,000\n合計 ¥11,000\n株式会社サンプル");
  assertEq("amount: 合計採用・小計/消費税除外", p.amount, 11000);
}
{
  const p = parse("領収書\nお預り ¥10,000\nお釣り ¥1,000\n合計 ¥9,000\nセブンーイレブン 吉祥寺店");
  assertEq("amount: お預り/お釣り除外", p.amount, 9000);
}
{
  const p = parse("請求書\nご請求金額 ¥5,000\n株式会社サンプル");
  assertEq("amount: ご請求金額を採用", p.amount, 5000);
}
{
  // キーワードが無く数値だけあるケース
  const p = parse("請求書\n¥1,234\n株式会社サンプル");
  assertEq("amount: キーワード無しでも通貨記号付き数値を拾う", p.amount, 1234);
}

// --- 発行元:御中除外と学習 ---
{
  app.resetRecipients();
  const p1 = app.parseInvoiceText("請求書\n株式会社エガク 御中\n株式会社ベンダー\n合計 ¥1,000");
  assertEq("vendor: 御中の宛先(自社)を除外", p1.vendor, "株式会社ベンダー");
  // 学習: エガクを次回以降も除外できる
  const p2 = app.parseInvoiceText("請求書\n株式会社エガク\n株式会社ベンダー2\n合計 ¥1,000");
  assert("vendor: 学習した御中先(エガク)を候補から除外", p2.vendor !== "株式会社エガク",
    `got ${p2.vendor}`);
  app.resetRecipients();
}

// --- 発行元:振込先以降の銀行名除外 ---
{
  const p = parse("請求書\n株式会社ベンダー\n合計 ¥1,000\nお振込先\nゆうちょ銀行 普通 12345678");
  assertEq("vendor: 振込先以降の銀行名を除外", p.vendor, "株式会社ベンダー");
}

// --- 発行元:前置/後置/英語 ---
{
  const p = parse("請求書\n株式会社エガク\n合計 ¥1,000");
  assertEq("vendor: 前置型(株式会社エガク)", p.vendor, "株式会社エガク");
}
{
  const p = parse("請求書\nエガク商事株式会社\n合計 ¥1,000");
  assertEq("vendor: 後置型(エガク商事株式会社)", p.vendor, "エガク商事株式会社");
}
{
  const p = parse("Invoice\nBill From: Adobe Systems Inc.\nTotal: $100");
  assertEq("vendor: 英語(Adobe Systems Inc.)", p.vendor, "Adobe Systems Inc.");
}

// --- 発行元:T番号近傍の法人名を優先 ---
{
  const p = parse(
    "請求書\n株式会社最初\nお疲れ様です\n弊社は下記のとおり\n請求申し上げます\n" +
    "株式会社最後\n登録番号 T1234567890123\n合計 ¥1,000"
  );
  assertEq("vendor: T番号近傍の法人名を優先", p.vendor, "株式会社最後");
}

// --- 発行元:法人格無しレシート ---
{
  const p = parse("レシート\nセブンーイレブン 吉祥寺店\n2026/07/20\n合計 ¥1,000");
  assertIncludes("vendor: 法人格無しレシート(セブン店名)", p.vendor, "セブン");
}

// --- 発行元:SELF_ISSUED(支払明細書系は宛名を採用) ---
{
  const p = parse(
    "外注支払明細書\n山田太郎 様\n請求日 2026年7月31日\n" +
    "お支払金額（税込） ¥50,000\nFMMK株式会社\n登録番号 T1234567890123"
  );
  assertEq("vendor: SELF_ISSUED時は宛名(相手方)を採用", p.vendor, "山田太郎");
  assertEq("SELF_ISSUED時: date", p.date, "2026-07-31");
  assertEq("SELF_ISSUED時: amount(お支払金額)", p.amount, 50000);
}

// --- 登録番号 ---
{
  const p = parse("請求書\n登録番号: T1234567890123\n合計 ¥1,000\n株式会社サンプル");
  assertEq("regNo: T + 13桁", p.regNo, "T1234567890123");
}
{
  // 空白/ハイフン入りにも対応
  const p = parse("請求書\n登録番号 T1234-5678-90123\n合計 ¥1,000\n株式会社サンプル");
  assertEq("regNo: 空白/ハイフン入り", p.regNo, "T1234567890123");
}

/* =====================================================================
   2) receiptMode(前回コミット8c4673a)が非レシート系を壊さないか
   ===================================================================== */

{
  // 通常の請求書に receiptMode がかからないこと(=法人格が普通に選ばれる)
  const p = parse("請求書\n株式会社ベンダー\n登録番号 T1234567890123\n合計 ¥1,000");
  assertEq("非レシート: 通常請求書で法人格が採用される", p.vendor, "株式会社ベンダー");
}
{
  // 「支払明細書」を含む場合 receiptMode は OFF (NON_RECEIPT に該当) で
  // SELF_ISSUED 分岐が正しく動くこと(← 17件PDFでも実証済み)
  const p = parse(
    "外注支払明細書\n田中一郎 様\n請求日 2026年6月30日\n" +
    "お支払金額（税込） ¥12,345\nFMMK株式会社\n登録番号 T1234567890123"
  );
  assertEq("非レシート: 支払明細書でreceiptMode発動せず宛名採用", p.vendor, "田中一郎");
}
{
  // 「領収書」単独タイトルの領収書では receiptMode が発動し店名を採用
  const p = parse("領収書\nスターバックス コーヒー ジャパン 表参道店\n2026/07/20\n合計 ¥600");
  assertIncludes("receiptMode発動: 領収書で店名採用", p.vendor, "スターバックス");
}

/* =====================================================================
   3) 17件PDF fixture(実際のpdf.js抽出 → reconstruct → parse)
   ===================================================================== */

async function runPdfTests(){
  const dir = path.join(__dirname, "fixtures");
  const files = fs.readdirSync(dir).filter(f => /^外注支払明細書_(.+?)_202607\.pdf$/.test(f)).sort();
  assert("fixture: 17件のPDFが存在", files.length === 17, `got ${files.length} files`);

  for(const f of files){
    const person = f.match(/^外注支払明細書_(.+?)_202607\.pdf$/)[1];
    // 端末を跨いだ学習を模したくないので都度リセット
    app.resetRecipients();
    const {parsed} = await parsePdf(path.join(dir, f));
    assertEq(`${person}: date`, parsed.date, "2026-07-31");
    assertEq(`${person}: vendor`, parsed.vendor, person);
    assertEq(`${person}: regNo`, parsed.regNo, "T7012701018263");
    assert(`${person}: amount > 0`, parsed.amount > 0, `got ${parsed.amount}`);
    // FMMK が vendor に紛れ込まないこと(SELF_ISSUED が効いていることの二重チェック)
    assert(`${person}: vendorにFMMKが含まれない`,
      !(parsed.vendor || "").includes("FMMK"), `got ${parsed.vendor}`);
  }

  // 牛込煌 の受け入れ条件(PROMPT.md)
  app.resetRecipients();
  const {parsed} = await parsePdf(path.join(dir, "外注支払明細書_牛込煌_202607.pdf"));
  assertEq("牛込煌: amount=136076(明細の120000/16076を採らない)", parsed.amount, 136076);
  assertIncludes("牛込煌: memoに Wi-Fi回線 を含む", parsed.memo, "Wi-Fi回線");
  assertIncludes("牛込煌: memoに 販売業務委託料 を含む", parsed.memo, "販売業務委託料");
}

runPdfTests().then(() => {
  console.log("");
  const pad = results.reduce((m, r) => Math.max(m, r.name.length), 0);
  for(const r of results){
    const mark = r.ok ? "  ok" : "FAIL";
    const line = mark + "  " + r.name.padEnd(pad);
    if(r.ok) console.log(line);
    else console.log(line + "  -- " + r.msg);
  }
  console.log("");
  console.log(`${results.length - failed}/${results.length} passed` + (failed ? `  (${failed} failed)` : ""));
  process.exit(failed > 0 ? 1 : 0);
}).catch(e => { console.error(e); process.exit(1); });
