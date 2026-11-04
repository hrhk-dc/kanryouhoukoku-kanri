// 業種の選別（アプリとサーバーの両方で使う）
// 飲食店／美容院／アパレル／整体・整骨院／不動産／建築・土木／その他。情報がなければ空欄
export const INDUSTRIES = ["飲食店", "美容院", "アパレル", "整体・整骨院", "不動産", "建築・土木", "その他"];

// 上から順に当てはめる（先に合ったものが採用される）
const RULES = [
  ["整体・整骨院", /physiotherap|chiropract|massage|acupunct|osteopath|整体|整骨|接骨|鍼灸|はり|カイロ|マッサージ|治療院|リラクゼーション|ほぐし|リフレ/i],
  ["美容院", /hair_salon|hair_care|beauty_salon|barber|nail_salon|spa\b|eyelash|美容|ヘア|理容|理髪|床屋|ネイル|エステ|まつげ|まつ毛|アイラッシュ|サロン|脱毛|ブライダルエステ/i],
  ["不動産", /real_estate|property|不動産|賃貸|住宅販売|マンション|分譲|宅建|アパート/i],
  ["建築・土木", /contractor|electrician|plumber|painter|roofing|home_builder|construction|architect|建築|建設|土木|工務店|リフォーム|工事|設計事務所|塗装|解体|電気工事|設備|内装|外構|造園|左官|大工|ハウスメーカー|住宅メーカー|板金|防水/i],
  ["アパレル", /clothing|shoe_store|apparel|boutique|jewelry_store|アパレル|洋服|衣料|衣類|ブティック|古着|ファッション|靴|シューズ|服飾|呉服|着物|セレクトショップ|婦人服|紳士服|子供服/i],
  ["飲食店", /restaurant|cafe|coffee|bakery|\bbar\b|meal_|food|ramen|sushi|izakaya|pub\b|diner|ice_cream|dessert|レストラン|飲食|カフェ|喫茶|居酒屋|ラーメン|らーめん|食堂|寿司|鮨|焼肉|焼鳥|焼き鳥|そば|うどん|蕎麦|ベーカリー|パン屋|酒場|料理|弁当|ケーキ|スイーツ|洋食|和食|中華|イタリアン|フレンチ|ファストフード|ハンバーガー|ハンバーグ|定食|ダイニング|ビストロ|お好み焼|たこ焼|天ぷら|とんかつ|カレー|餃子|スナック|ラウンジ|バル|(^|[\s・（(])バー($|[\s・）)])/i]
];

// text: Googleの業種名など／name: 店舗名（業種名で決まらないときの補助）
// 戻り値：INDUSTRIESのどれか。まったく情報がないときは ""（未入力）
export function classifyIndustry(text, name = "") {
  const t = String(text || "").trim();
  const hit = (s) => RULES.find(([, re]) => re.test(s))?.[0] || "";
  if (t) return hit(t) || hit(String(name || "")) || "その他";
  const n = String(name || "").trim();
  return n ? hit(n) : "";
}
