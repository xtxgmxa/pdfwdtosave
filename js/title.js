const ENDINGS = ['錦標賽', '公開賽', '邀請賽', '聯賽', '大賽', '杯賽'];

function cleanLine(line) {
  return line
    .replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/\s+/g, '')
    .replace(/[^\d\u4e00-\u9fff]/g, '');
}

function endingIndex(line) {
  let end = -1;
  for (const token of ENDINGS) {
    const at = line.lastIndexOf(token);
    if (at >= 0) end = Math.max(end, at + token.length);
  }
  if (end >= 0) return end;
  const race = line.lastIndexOf('賽');
  return race >= 0 ? race + 1 : -1;
}

function pickTitle(line) {
  const end = endingIndex(line);
  if (end < 0) return '';
  const head = line.slice(0, end);
  const year = head.match(/\d{2,3}年/g);
  const start = year ? head.lastIndexOf(year[year.length - 1]) : 0;
  const title = head.slice(start, end);
  const hasEvent = /賽|盃|杯/.test(title);
  const hasYear = /\d{2,3}年/.test(title);
  if (!hasEvent || title.length < 6 || title.length > 48) return '';
  if (!hasYear && !/錦標賽|公開賽|邀請賽/.test(title)) return '';
  return title;
}

function score(title) {
  if (!title) return 0;
  let value = title.length;
  if (title.includes('錦標賽')) value += 40;
  else if (title.includes('公開賽') || title.includes('邀請賽')) value += 28;
  if (/\d{2,3}年/.test(title)) value += 12;
  if (/盃|杯/.test(title)) value += 6;
  if (title.endsWith('賽')) value += 4;
  return value;
}

export function extractTitle(raw) {
  const lines = String(raw || '')
    .split(/\n/)
    .map(cleanLine)
    .filter((line) => line.length >= 4);

  let best = '';
  let bestScore = 0;
  const pool = lines.slice();
  if (lines.length > 1) pool.push(lines.join(''));

  for (const line of pool) {
    const title = pickTitle(line);
    const value = score(title);
    if (value > bestScore) {
      best = title;
      bestScore = value;
    }
  }
  return best;
}

const NOT_HEADLINE = /^(獎狀|奖状|證書|证书|感謝狀|賞狀|聘書|結業證書)$/;
const BODY_LINE = /字第|單位|姓名|組別|名次|特頒|此狀|中華民國/;

export function guessHeadline(raw) {
  const text = String(raw || '')
    .replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[^\d\u4e00-\u9fff]/g, '');
  if (text.length < 4 || text.length > 40) return '';
  if (NOT_HEADLINE.test(text) || BODY_LINE.test(text)) return '';
  if (!/[\u4e00-\u9fff]{3}/.test(text)) return '';
  return text;
}

export function isStrongTitle(title) {
  return Boolean(title) && title.length >= 8 && /\d{2,3}年/.test(title) && /賽/.test(title);
}
