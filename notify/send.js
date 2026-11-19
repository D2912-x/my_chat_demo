#!/usr/bin/env node
/**
 * 主动消息生成器（GitHub Actions 定时调用）
 *
 * 流程：读配置 → 判断该不该发 → 调 DeepSeek 写一句 → 加密写入 outbox.enc → 推送到 ntfy
 * 安全：本脚本不打印配置内容、消息正文、密钥，只输出状态。
 */
const fs = require('fs');
const crypto = require('crypto');

const ROOT = process.cwd();
const OUTBOX = ROOT + '/outbox.enc';
const CFG_PATH = ROOT + '/notify/config.json';

const env = process.env;
const PWD = env.NOTIFY_PWD || '';
const TOPIC = env.NTFY_TOPIC || '';
const API_KEY = env.DEEPSEEK_API_KEY || '';
const API_URL = env.DEEPSEEK_URL || 'https://api.deepseek.com/v1/chat/completions';
const MODEL = env.DEEPSEEK_MODEL || 'deepseek-chat';

let PROFILE = {};
try { PROFILE = JSON.parse(env.PROFILE_JSON || '{}'); } catch (e) { PROFILE = {}; }

let cfg = { windowStart: 540, windowEnd: 1380, minPerDay: 0, maxPerDay: 5, maxMessages: 50, staleMinutes: 180, catchupMinutes: 480, forceNow: false };
try {
  const raw = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8'));
  if (typeof raw.windowStart === 'string') {
    const a = raw.windowStart.split(':').map(Number);
    cfg.windowStart = a[0] * 60 + (a[1] || 0);
  }
  if (typeof raw.windowEnd === 'string') {
    const b = raw.windowEnd.split(':').map(Number);
    cfg.windowEnd = b[0] * 60 + (b[1] || 0);
  }
  if (Number.isFinite(raw.minPerDay)) cfg.minPerDay = raw.minPerDay;
  if (Number.isFinite(raw.maxPerDay)) cfg.maxPerDay = raw.maxPerDay;
  if (Number.isFinite(raw.perDay) && !Number.isFinite(raw.maxPerDay)) { cfg.minPerDay = raw.perDay; cfg.maxPerDay = raw.perDay; }
  if (Number.isFinite(raw.maxMessages)) cfg.maxMessages = raw.maxMessages;
  if (raw.forceNow === true) cfg.forceNow = true;   // 测试用：立即发送
  if (Number.isFinite(raw.staleMinutes)) cfg.staleMinutes = raw.staleMinutes;
  if (Number.isFinite(raw.catchupMinutes)) cfg.catchupMinutes = raw.catchupMinutes;
} catch (e) { /* 用默认值 */ }

function die(msg) { console.error(msg); process.exit(1); }
if (!PWD) die('缺少 Secret: NOTIFY_PWD');
if (!API_KEY) die('缺少 Secret: DEEPSEEK_API_KEY');
// NTFY_TOPIC 可选：没配就只写 outbox，不推送

// ---------- 人设：优先读 profile.enc（网页同步的），否则用 Secret ----------
try {
  const pf = ROOT + '/profile.enc';
  if (fs.existsSync(pf)) {
    const box = JSON.parse(fs.readFileSync(pf, 'utf8'));
    const p = decryptBox(PWD, box);
    if (p && typeof p === 'object') {
      PROFILE = Object.assign({}, PROFILE, p);
      console.log('人设来源：profile.enc（网页同步）');
    }
  } else {
    console.log('人设来源：PROFILE_JSON（Secret）');
  }
} catch (e) {
  console.log('profile.enc 解密失败，改用 PROFILE_JSON');
}

// ---------- 时间 ----------
function nowParts() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  const o = {};
  for (const p of fmt.formatToParts(new Date())) o[p.type] = p.value;
  if (o.hour === '24') o.hour = '00';   // 有些环境午夜会返回 24
  return {
    date: o.year + '-' + o.month + '-' + o.day,
    hm: o.hour + ':' + o.minute,
    minutes: Number(o.hour) * 60 + Number(o.minute)
  };
}

function pad2(n) { return String(n).padStart(2, '0'); }

function addDays(dateStr, n) {
  const p = dateStr.split('-').map(Number);
  const t = Date.UTC(p[0], p[1] - 1, p[2]) + n * 86400000;
  const d = new Date(t);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}

// ---------- 加密（与网页端一致：PBKDF2-SHA256 12万次 + AES-256-GCM） ----------
function decryptBox(pwd, box) {
  const salt = Buffer.from(box.salt, 'base64');
  const iv = Buffer.from(box.iv, 'base64');
  const data = Buffer.from(box.data, 'base64');
  const key = crypto.pbkdf2Sync(pwd, salt, 120000, 32, 'sha256');
  const tag = data.subarray(data.length - 16);
  const ct = data.subarray(0, data.length - 16);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  const out = Buffer.concat([d.update(ct), d.final()]);
  return JSON.parse(out.toString('utf8'));
}

function encryptBox(pwd, obj, saltB64) {
  const salt = saltB64 ? Buffer.from(saltB64, 'base64') : crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(pwd, salt, 120000, 32, 'sha256');
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  const packed = Buffer.concat([ct, c.getAuthTag()]);
  return { v: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), data: packed.toString('base64') };
}

// ---------- 随机时间点 ----------
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let x = seed || 1;
  return function () {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
}
function slotsFor(dateStr) {
  const r = rng(hashStr(dateStr));
  const lo = Math.max(0, cfg.minPerDay);
  const hi = Math.max(lo, cfg.maxPerDay);
  // 先随机决定今天发几条（0~5），再抽对应的时间点
  const count = lo + Math.floor(r() * (hi - lo + 1));
  const span = Math.max(1, cfg.windowEnd - cfg.windowStart);
  const picked = new Set();
  let guard = 0;
  while (picked.size < count && guard++ < 500) {
    picked.add(cfg.windowStart + Math.floor(r() * span));
  }
  return Array.from(picked).sort(function (a, b) { return a - b; });
}
function hhmm(m) { return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60); }

// ---------- 读状态 ----------
let state = { messages: [], sentToday: [], lastDate: '', lastAnniv: '' };
let saltB64 = '';
if (fs.existsSync(OUTBOX)) {
  try {
    const box = JSON.parse(fs.readFileSync(OUTBOX, 'utf8'));
    saltB64 = box.salt;
    state = Object.assign(state, decryptBox(PWD, box));
  } catch (e) {
    die('outbox.enc 解密失败：密码是否与网页里填写的一致？');
  }
}

const now = nowParts();
if (state.lastDate !== now.date) { state.lastDate = now.date; state.sentToday = []; }

// ---------- 判断该不该发 ----------
let kind = null;
let annTitle = '';

const anns = Array.isArray(PROFILE.anniversaries) ? PROFILE.anniversaries : [];
const tomorrowMD = addDays(now.date, 1).slice(5);
for (const a of anns) {
  if (!a || a.md !== tomorrowMD) continue;
  if (state.lastAnniv === now.date) continue;
  if (now.minutes < 540) continue;
  kind = 'anniv';
  annTitle = a.title || '一个特别的日子';
  state.lastAnniv = now.date;
  break;
}

const slots = slotsFor(now.date);
let catchupSlot = null;
if (!kind) {
  for (const s of slots) {
    if (now.minutes < s) continue;
    const key = hhmm(s);
    if (state.sentToday.indexOf(key) >= 0) continue;
    if (now.minutes - s > cfg.staleMinutes) {
      // 超出正常发送窗口，但在补发窗口内 → 记为候选（取最近的一个）
      if (now.minutes - s <= cfg.catchupMinutes) catchupSlot = s;
      state.sentToday.push(key);
      continue;
    }
    state.sentToday.push(key);
    kind = 'greet';
    break;
  }
}

if (!kind && catchupSlot !== null) {
  kind = 'greet';
  console.log('[' + now.hm + '] 补发错过的一条（原定 ' + hhmm(catchupSlot) + '）');
}

if (!kind && cfg.forceNow) {
  // 测试模式：忽略随机时间点，立刻发一条
  kind = 'greet';
  console.log('[' + now.hm + '] 测试模式（forceNow）：立即发送一条');
}

if (!kind) {
  console.log('[' + now.hm + '] 未到时间，跳过（今天计划 ' + slots.length + ' 条）');
  process.exit(0);
}

// ---------- 天气（可选） ----------
async function getWeather() {
  const city = (PROFILE.city || '').trim();
  if (!city) return '';
  try {
    const g = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=zh&name=' + encodeURIComponent(city));
    const gj = await g.json();
    const loc = gj && gj.results && gj.results[0];
    if (!loc) return '';
    const w = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + loc.latitude + '&longitude=' + loc.longitude + '&current=temperature_2m,weather_code&timezone=auto');
    const wj = await w.json();
    const c = wj && wj.current;
    if (!c) return '';
    return city + ' ' + Math.round(c.temperature_2m) + '°C';
  } catch (e) { return ''; }
}

// ---------- 让 AI 写一句 ----------
async function generate(text) {
  const wait = await getWeather();
  const who = PROFILE.name || '对方';
  const persona = PROFILE.persona || '温柔、简短、自然';
  const sys = '你在给' + who + '发一条手机通知。人设口吻：' + persona
    + '。要求：中文，一句话，25字以内，不要用问号结尾，不要提自己是AI，不要加引号。';
  let user = kind === 'anniv'
    ? ('明天是「' + annTitle + '」，写一句温柔的提醒。')
    : ('现在是' + now.hm + '，写一句主动关心的话。');
  if (wait) user += ' 参考天气：' + wait + '。';

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
      stream: false,
      max_tokens: 80,
      temperature: 1.2
    })
  });
  if (!res.ok) throw new Error('API ' + res.status);
  const data = await res.json();
  const txt = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
  return String(txt || '').trim().replace(/^["'「]|["'」]$/g, '');
}

/* ============================================================
   【可选功能】ntfy 推送 —— 默认关闭
   网页端已改为"页面内红点 + 标题数字"提示，不依赖任何推送服务。
   NTFY_TOPIC 为空时下面这段不会执行；
   想恢复推送：在 workflow 里加回 NTFY_TOPIC 环境变量即可。
   ============================================================ */
async function push(text) {
  const r = await fetch('https://ntfy.sh/' + encodeURIComponent(TOPIC), {
    method: 'POST',
    headers: { 'Title': 'My Chat', 'Tags': 'speech_balloon' },
    body: text
  });
  if (!r.ok) throw new Error('ntfy ' + r.status);
}

(async function main() {
  let text = '';
  try {
    text = await generate(kind);
  } catch (e) {
    console.error('生成失败：' + e.message);
  }
  if (!text) {
    text = kind === 'anniv' ? ('明天是' + annTitle + '，别忘了。') : '在忙吗？记得休息一下。';
    console.log('使用兜底文案');
  }

  if (TOPIC) {
    try {
      await push(text);
      console.log('[' + now.hm + '] 已发送（' + kind + '）');
    } catch (e) {
      console.error('推送失败（不影响写入）：' + e.message);
    }
  } else {
    console.log('[' + now.hm + '] 已生成（未配置推送）');
  }

  state.messages.push({ ts: Date.now(), text: text });
  if (state.messages.length > cfg.maxMessages) {
    state.messages = state.messages.slice(-cfg.maxMessages);
  }
  fs.writeFileSync(OUTBOX, JSON.stringify(encryptBox(PWD, state, saltB64), null, 2));
  console.log('outbox.enc 已更新，共 ' + state.messages.length + ' 条');
})();
