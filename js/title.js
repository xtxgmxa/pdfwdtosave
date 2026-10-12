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

const PLACES = ['冠軍', '亞軍', '季軍', '殿軍', '金牌', '銀牌', '銅牌', '優勝', '優等', '甲等', '佳作', '特優'];

export function extractPlace(raw) {
  const lines = String(raw || '')
    .split(/\n/)
    .map(cleanLine)
    .filter(Boolean);
  if (lines.length > 1) lines.push(lines.join(''));

  for (const line of lines) {
    const labelAt = line.search(/名次|各次|名欠|各欠/);
    const marked = (labelAt >= 0 ? line.slice(labelAt + 2) : line)
      .replace(/第([一二三四五六七八九十\d]{1,3})[名寢茗]/g, '第$1名');
    const ranked = marked.match(/第[一二三四五六七八九十\d]{1,3}名/);
    if (ranked && (labelAt >= 0 || marked.startsWith(ranked[0]))) return ranked[0];
    const fixed = PLACES.find((place) => marked.includes(place));
    if (fixed && (labelAt >= 0 || marked.startsWith(fixed))) return fixed;
  }
  return '';
}

export function isStrongTitle(title) {
  return Boolean(title) && title.length >= 8 && /\d{2,3}年/.test(title) && /賽/.test(title);
}

const PHRASES = ['菁英盃', '菁英', '中華盃', '中華', '第十二屆', '全國', '跆拳道', '跆拳', '拳道', '錦標賽', '公開賽', '邀請賽'];

export function phraseScore(text) {
  let score = 0;
  for (const phrase of PHRASES) {
    if (text.includes(phrase)) score += phrase.length * 3;
  }
  if (/第[一二三四五六七八九十\d]{1,3}屆/.test(text)) score += 8;
  if (text.includes('錦標賽')) score += 12;
  return score;
}

function assemble(readings) {
  const lattice = readings[0].split('').map((_, index) => [...new Set(readings.map((text) => text[index]))]);
  let text = '';
  for (let i = 0; i < lattice.length; i += 1) {
    let best = lattice[i][0];
    let bestScore = -1;
    for (const ch of lattice[i]) {
      let score = readings.filter((item) => item[i] === ch).length * 2;
      const prev = text[i - 1] || '';
      if (PHRASES.some((phrase) => phrase.includes(prev + ch))) score += 6;
      const next = lattice[i + 1] || [];
      if (next.some((n) => PHRASES.some((phrase) => phrase.includes(ch + n)))) score += 4;
      if (score > bestScore) {
        bestScore = score;
        best = ch;
      }
    }
    text += best;
  }
  return text;
}

export function chooseReading(readings) {
  const clean = readings.map((text) => cleanLine(text)).filter((text) => text.length >= 4);
  if (!clean.length) return '';
  const ranked = clean
    .map((text) => ({ text, score: phraseScore(text) }))
    .sort((a, b) => b.score - a.score || b.text.length - a.text.length);
  const pool = [...new Set(ranked.filter((item) => item.text.length === ranked[0].text.length).map((item) => item.text))];
  if (pool.length === 1) return pool[0];
  const mixed = assemble(pool);
  return phraseScore(mixed) >= ranked[0].score ? mixed : ranked[0].text;
}

export function combineTitleRows(entries) {
  const rows = entries
    .filter((entry) => entry.text && !/獎狀|單位|姓名|名次|字第|組別/.test(entry.text))
    .sort((a, b) => a.y0 - b.y0);
  let best = '';
  let bestScore = -1;
  const consider = (text) => {
    const title = extractTitle(text);
    if (!title) return;
    const score = phraseScore(title) + title.length;
    if (score > bestScore) {
      best = title;
      bestScore = score;
    }
  };
  for (const row of rows) consider(row.text);
  for (let i = 0; i < rows.length - 1; i += 1) {
    const gap = rows[i + 1].y0 - rows[i].y1;
    const height = Math.max(rows[i].height, rows[i + 1].height);
    if (gap < height * 1.25) consider(`${rows[i].text}${rows[i + 1].text}`);
  }
  return best;
}
