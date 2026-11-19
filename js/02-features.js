/* ============================================================
   02-features.js
   记忆、锁屏、天气、主动消息、人设同步、时间设定
   由 index.html 拆分而来；加载顺序：01 → 02 → 03
   ============================================================ */
// 【J04】记忆系统（概况/事件/触发）
    const MEM_TRIGGER = 6;         // 新增这么多条消息后检查一次记忆
    const MEM_SOFT_LIMIT = 2000;   // 记忆文本超过此长度，要求 AI 压缩
    const MEM_MAX_EVENTS = 60;     // 事件条数上限（防止无限增长）

    // 兼容旧数据：老版本用字符串 s.memory，这里迁移成结构化事件
    function memEnsure(s) {
        if (!s.mem || typeof s.mem !== 'object') {
            s.mem = { summary: '', events: [], at: 0 };
            if (s.memory && typeof s.memory === 'string') {
                s.memory.split('\n').forEach(function (line) {
                    const t = line.trim();
                    if (!t) return;
                    const m = t.match(/^(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})\s+(.*)$/);
                    if (m) s.mem.events.push({ date: normDate(m[1]), text: m[2].trim() });
                    else s.mem.summary = (s.mem.summary ? s.mem.summary + ' ' : '') + t;
                });
            }
        }
        if (!Array.isArray(s.mem.events)) s.mem.events = [];
        if (typeof s.mem.summary !== 'string') s.mem.summary = '';
        if (typeof s.mem.at !== 'number') s.mem.at = 0;
        // 老字段清空，避免旧拼接逻辑重复注入
        s.memory = '';
        return s.mem;
    }

    function normDate(str) {
        const p = String(str).replace(/[\/\.]/g, '-').split('-');
        if (p.length < 3) return todayStr();
        return p[0] + '-' + String(p[1]).padStart(2, '0') + '-' + String(p[2]).padStart(2, '0');
    }

    function todayStr(d) {
        d = d || new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function daysBetween(dateStr, base) {
        const parts = String(dateStr).split('-');
        if (parts.length < 3) return 0;
        const a = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        const n = base || new Date();
        const b = new Date(n.getFullYear(), n.getMonth(), n.getDate());
        return Math.round((b - a) / 86400000);
    }

    function cnWeekday(d) {
        return '星期' + ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    }

    function cnPeriod(d) {
        const h = d.getHours();
        if (h < 5) return '凌晨';
        if (h < 9) return '早上';
        if (h < 12) return '上午';
        if (h < 13) return '中午';
        if (h < 18) return '下午';
        if (h < 23) return '晚上';
        return '深夜';
    }

    // 注入给模型的"当前时间"：日期 + 星期 + 时段 + 小时（不精确到分钟，避免破坏缓存）
    function nowLine(s) {
        const d = sessionNow(s);
        return '【当前时间】' + todayStr(d) + ' ' + cnWeekday(d) + ' ' + cnPeriod(d) + ' ' + d.getHours() + ' 点（' + timeLabel(s) + '）';
    }


    // 把毫秒说成"人话"
    function humanDuration(ms) {
        if (ms < 60000) return '刚刚';
        const m = Math.round(ms / 60000);
        if (m < 60) return m + ' 分钟';
        const h = Math.floor(m / 60);
        if (h < 24) return h + ' 小时';
        const d = Math.floor(h / 24);
        if (d < 30) return d + ' 天';
        const mo = Math.floor(d / 30);
        return mo + ' 个月';
    }

    // 给模型的"时间流逝感"：距上次对话多久 + 本次聊了多久
    function gapLine(s) {
        const list = (s.messages || []).filter(function (m) { return typeof m.ts === 'number'; });
        if (!list.length) return '';
        const now = sessionNow(s).getTime();
        // 最后一条是刚发出的这条消息，比较时跳过它
        const prev = list.length > 1 ? list[list.length - 2] : null;
        const out = [];
        if (prev) {
            const gap = now - prev.ts;
            if (gap >= 60000) {
                const d = new Date(prev.ts);
                const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
                out.push('【距上次对话】约 ' + humanDuration(gap) + '（上次在 ' + hm + '）');
            }
        }
        const first = list[0];
        if (first && list.length >= 3) {
            const span = now - first.ts;
            if (span >= 3600000) out.push('【本次对话已持续】约 ' + humanDuration(span));
        }
        return out.join('\n');
    }

    function memIsOn(s) { return !s.memOff; }

    // 组装 system prompt：人设 → 当前时间 → 长期记忆
    // 【J06】天气
    let weatherCache = { at: 0, text: '' };

    // 带超时的 fetch：天气不可用时绝不阻塞聊天
    function fetchT(url, ms, opts) {
        const ctrl = new AbortController();
        const timer = setTimeout(function () { try { ctrl.abort(); } catch (e) { } }, ms);
        const o = Object.assign({}, opts || {}, { signal: ctrl.signal });
        return fetch(url, o).finally(function () { clearTimeout(timer); });
    }

    function weatherText(code) {
        const m = {
            0: '晴', 1: '少云', 2: '多云', 3: '阴', 45: '雾', 48: '雾凇',
            51: '小毛雨', 53: '毛雨', 55: '大毛雨', 56: '冻毛雨', 57: '冻毛雨',
            61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '冻雨',
            71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
            80: '阵雨', 81: '强阵雨', 82: '暴雨', 85: '阵雪', 86: '强阵雪',
            95: '雷阵雨', 96: '雷阵雨伴冰雹', 99: '强雷暴'
        };
        return m[code] || '';
    }

    function currentCity() { return (localStorage.getItem('chat.city') || '').trim(); }

    async function refreshWeather() {
        const city = currentCity();
        if (!city) { weatherCache.text = ''; return ''; }
        if (Date.now() - weatherCache.at < 30 * 60 * 1000 && weatherCache.text) return weatherCache.text;
        try {
            const g = await fetchT('https://geocoding-api.open-meteo.com/v1/search?count=1&language=zh&name=' + encodeURIComponent(city), 2500);
            const gj = await g.json();
            const loc = gj && gj.results && gj.results[0];
            if (!loc) return weatherCache.text || '';
            const w = await fetchT('https://api.open-meteo.com/v1/forecast?latitude=' + loc.latitude + '&longitude=' + loc.longitude + '&current=temperature_2m,weather_code&timezone=auto', 2500);
            const wj = await w.json();
            const c = wj && wj.current;
            if (!c) return weatherCache.text || '';
            const txt = city + ' ' + (weatherText(c.weather_code) || '') + ' ' + Math.round(c.temperature_2m) + '°C';
            weatherCache = { at: Date.now(), text: txt };
            return txt;
        } catch (e) {
            return weatherCache.text || '';
        }
    }

    // 【J07】主动消息（解密/合并）
    function b64ToBytes(b64) {
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return arr;
    }

    async function deriveNotifyKey(pwd, salt) {
        const enc = new TextEncoder();
        const base = await crypto.subtle.importKey('raw', enc.encode(pwd), 'PBKDF2', false, ['deriveKey']);
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt: salt, iterations: 120000, hash: 'SHA-256' },
            base,
            { name: 'AES-GCM', length: 256 },
            false,
            ['decrypt']
        );
    }

    // 未读角标：<title> 显示 (N)
    let unreadNotify = 0;
    function updateTitleBadge() {
        const base = 'My Chat';
        document.title = unreadNotify > 0 ? ('(' + unreadNotify + ') ' + base) : base;
    }
    function clearTitleBadge() {
        if (unreadNotify) { unreadNotify = 0; updateTitleBadge(); }
    }

    function notifySeenGet() {
        try { return JSON.parse(localStorage.getItem('chat.notify.seen') || '[]'); } catch (e) { return []; }
    }
    function notifySeenAdd(list) {
        const set = new Set(notifySeenGet());
        list.forEach(function (ts) { set.add(ts); });
        localStorage.setItem('chat.notify.seen', JSON.stringify([...set].slice(-500)));
    }

    async function pullProactive(manual) {
        const pwd = localStorage.getItem('chat.notify.pwd') || '';
        if (!pwd) { if (manual) toast('请先在上方填写解密密码并保存'); return; }
        try {
            const res = await fetch('./outbox.enc?t=' + Date.now(), { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
            if (!res.ok) { if (manual) toast('没找到 outbox.enc'); return; }
            const box = await res.json();
            const salt = b64ToBytes(box.salt);
            const iv = b64ToBytes(box.iv);
            const data = b64ToBytes(box.data);
            const key = await deriveNotifyKey(pwd, salt);
            const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, data);
            const obj = JSON.parse(new TextDecoder().decode(plain));
            const list = Array.isArray(obj.messages) ? obj.messages : [];
            const explicitTarget = localStorage.getItem('chat.notify.target') || '';
            const personaId = localStorage.getItem('chat.notify.provSession') || '';
            const wantId = explicitTarget || personaId;
            const s = (wantId && sessions.find(function (x) { return x.id === wantId; })) || getCurrent();
            if (!s) return;
            const seen = new Set(
                s.messages.filter(function (m) { return m.ts; }).map(function (m) { return m.ts; })
                    .concat(notifySeenGet())
            );
            const pulledTs = [];
            let added = 0;
            list.forEach(function (m) {
                if (!m || !m.ts || !m.text) return;
                if (seen.has(m.ts)) return;
                const item = { role: 'assistant', content: m.text, ts: m.ts, proactive: true };
                // 只在"有时间戳"的消息里找位置；没有 ts 的旧消息保持原位，绝不重排
                let pos = -1;
                for (let i = 0; i < s.messages.length; i++) {
                    const t = s.messages[i].ts;
                    if (typeof t === 'number' && t > item.ts) { pos = i; break; }
                }
                if (pos >= 0) s.messages.splice(pos, 0, item);
                else s.messages.push(item);
                seen.add(m.ts);
                pulledTs.push(m.ts);
                added++;
            });
            if (added) {
                s.updatedAt = Date.now();
                saveData();
                renderSidebar();
                if (s.id === currentId && !isGenerating) renderChat();
                notifySeenAdd(pulledTs);
                if (s.id !== currentId) s.unread = (Number(s.unread) || 0) + added;
                if (!manual) {
                    unreadNotify += added;
                    updateTitleBadge();
                    toast('收到 ' + added + ' 条新消息' + (s.id === currentId ? '' : '（在「' + s.name + '」）'));
                }
            }
            renderNotifyStatus();
            if (manual) {
                if (added) toast('收到 ' + added + ' 条' + (s.id === currentId ? '主动消息' : '，已存入「' + s.name + '」'));
                else if (!list.length) toast('outbox.enc 里还没有消息（稍等 1 分钟再试）');
                else toast('文件里有 ' + list.length + ' 条，但都已存在');
            }
        } catch (e) {
            if (manual) toast('拉取失败：' + (e && e.message ? e.message : '密码可能不对'));
        }
    }

    // 【J08】人设同步
    function bytesToB64(bytes) {
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
    }

    async function deriveKeyBoth(pwd, salt) {
        const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pwd), 'PBKDF2', false, ['deriveKey']);
        return crypto.subtle.deriveKey(
            { name: 'PBKDF2', salt: salt, iterations: 120000, hash: 'SHA-256' },
            base,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }

    async function encryptProfile(pwd, obj) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await deriveKeyBoth(pwd, salt);
        const data = new TextEncoder().encode(JSON.stringify(obj));
        const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, data));
        return { v: 1, salt: bytesToB64(salt), iv: bytesToB64(iv), data: bytesToB64(ct) };
    }

    async function ghPutFile(token, repo, branch, path, obj, message) {
        const api = 'https://api.github.com/repos/' + repo + '/contents/' + path;
        const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };
        let sha = null;
        const g = await fetch(api + '?ref=' + encodeURIComponent(branch), { headers: headers });
        if (g.ok) {
            const j = await g.json();
            sha = j.sha;
        } else if (g.status !== 404) {
            throw new Error('读取失败 HTTP ' + g.status);
        }
        const body = {
            message: message,
            branch: branch,
            content: btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
        };
        if (sha) body.sha = sha;
        const p = await fetch(api, {
            method: 'PUT',
            headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
            body: JSON.stringify(body)
        });
        if (!p.ok) {
            const t = await p.text();
            throw new Error('写入失败 HTTP ' + p.status + ' ' + t.slice(0, 100));
        }
        return true;
    }

    function ghCfg() {
        return {
            token: (localStorage.getItem('chat.gh.token') || '').trim(),
            repo: (localStorage.getItem('chat.gh.repo') || '').trim(),
            branch: (localStorage.getItem('chat.gh.branch') || 'main').trim() || 'main'
        };
    }

    function renderGhStatus(extra) {
        const el = document.getElementById('ghStatus');
        if (!el) return;
        const c = ghCfg();
        el.textContent = (extra ? extra + ' · ' : '') + (c.token ? 'Token 已填' : 'Token 未填') + ' · ' + (c.repo || '未填仓库');
    }

    function collectProfilePayload() {
        const sid = document.getElementById('provSessionSel').value;
        const s = sessions.find(function (x) { return x.id === sid; }) || getCurrent();
        const mem = s ? memEnsure(s) : { events: [] };
        const anns = [];
        (mem.events || []).forEach(function (e) {
            if (!e || !e.date) return;
            anns.push({ md: String(e.date).slice(5), title: String(e.text || '').slice(0, 24) });
        });
        return {
            version: 1,
            name: (document.getElementById('profNameInp').value || '').trim(),
            persona: s ? String(s.systemPrompt || '').trim() : '',
            city: currentCity(),
            anniversaries: anns.slice(0, 30)
        };
    }

    async function syncProfileToCloud() {
        const c = ghCfg();
        const pwd = localStorage.getItem('chat.notify.pwd') || '';
        if (!pwd) { toast('请先填上面的解密密码并保存'); return; }
        if (!c.token) { toast('请先填 GitHub Token 并保存'); return; }
        const repoParts = c.repo.split('/');
        if (repoParts.length !== 2 || !repoParts[0] || !repoParts[1]) { toast('仓库格式应为 用户名/仓库名'); return; }
        const payload = collectProfilePayload();
        if (!payload.persona) { toast('选中的对话没有人设'); return; }
        renderGhStatus('同步中…');
        try {
            const box = await encryptProfile(pwd, payload);
            await ghPutFile(c.token, c.repo, c.branch, 'profile.enc', box, 'chore: update profile');
            renderGhStatus('已同步 ' + new Date().toLocaleTimeString('zh-CN'));
            toast('已同步到云端');
        } catch (e) {
            renderGhStatus('失败：' + e.message);
            toast('同步失败，看下面的状态');
        }
    }

    function fillProvSessionOptions() {
        const sel = document.getElementById('provSessionSel');
        if (!sel) return;
        sel.innerHTML = '';
        sessions.forEach(function (s) {
            const o = document.createElement('option');
            o.value = s.id;
            o.textContent = s.name + (s.systemPrompt ? '' : '（未设人设）');
            sel.appendChild(o);
        });
        sel.value = currentId;

        const tsel = document.getElementById('provTargetSel');
        if (!tsel) return;
        tsel.innerHTML = '';
        const cur = document.createElement('option');
        cur.value = '';
        cur.textContent = '当前打开的对话（默认）';
        tsel.appendChild(cur);
        sessions.forEach(function (s) {
            const o = document.createElement('option');
            o.value = s.id;
            o.textContent = s.name;
            tsel.appendChild(o);
        });
        tsel.value = localStorage.getItem('chat.notify.target') || '';
    }

    function toggleNotifyAdvanced() {
        const box = document.getElementById('notifyAdvanced');
        if (!box) return;
        const show = (box.style.display === 'none' || !box.style.display);
        box.style.display = show ? 'block' : 'none';
    }

    function fillNotifySettings() {
        document.getElementById('notifyPwdInp').value = localStorage.getItem('chat.notify.pwd') || '';
        document.getElementById('cityInp').value = currentCity();
        document.getElementById('profNameInp').value = localStorage.getItem('chat.gh.name') || '';
        const c = ghCfg();
        document.getElementById('ghTokenInp').value = c.token;
        document.getElementById('ghRepoInp').value = c.repo;
        document.getElementById('ghBranchInp').value = c.branch;
        const _adv = document.getElementById('notifyAdvanced');
        if (_adv) _adv.style.display = 'none';
        fillProvSessionOptions();
        renderGhStatus();
        renderNotifyStatus();
    }

    function saveNotifySettings() {
        localStorage.setItem('chat.notify.pwd', document.getElementById('notifyPwdInp').value.trim());
        localStorage.setItem('chat.city', document.getElementById('cityInp').value.trim());
        localStorage.setItem('chat.gh.name', document.getElementById('profNameInp').value.trim());
        localStorage.setItem('chat.gh.token', document.getElementById('ghTokenInp').value.trim());
        localStorage.setItem('chat.gh.repo', document.getElementById('ghRepoInp').value.trim());
        localStorage.setItem('chat.gh.branch', document.getElementById('ghBranchInp').value.trim() || 'main');
        const ts = document.getElementById('provTargetSel');
        if (ts) localStorage.setItem('chat.notify.target', ts.value || '');
        const ps = document.getElementById('provSessionSel');
        if (ps) localStorage.setItem('chat.notify.provSession', ps.value || '');
        weatherCache = { at: 0, text: '' };
        renderNotifyStatus();
        toast('已保存');
        refreshWeather();
    }

    function renderNotifyStatus() {
        const el = document.getElementById('notifyStatus');
        if (!el) return;
        const pwd = localStorage.getItem('chat.notify.pwd') ? '已设置' : '未设置';
        const city = currentCity() || '未填';
        const tg = localStorage.getItem('chat.notify.target') || '';
        const ps = localStorage.getItem('chat.notify.provSession') || '';
        let where = '当前打开的对话';
        const idWant = tg || ps;
        if (idWant) {
            const sWant = (sessions || []).filter(function (x) { return x.id === idWant; })[0];
            if (sWant) where = '「' + sWant.name + '」';
        }
        el.textContent = '密码：' + pwd + ' · 城市：' + city
            + ' · 消息存入：' + where
            + (weatherCache.text ? ' · 天气：' + weatherCache.text : '');
    }

    // 稳定部分（人设 / 档案 / 长期记忆）——放在前面，方便 API 命中缓存
    function buildSystemPrompt(s) {
        const parts = [];
        const card = (s && s.card) || {};
        if (card.who) parts.push('【角色】' + card.who);
        if (card.style) parts.push('【说话方式】' + card.style);
        if (card.sample) parts.push('【示例台词】\n' + card.sample);
        if (card.ban) parts.push('【禁止】' + card.ban);
        if (s.systemPrompt) parts.push('【补充设定】\n' + s.systemPrompt);
        const pb = profileBlock();
        if (pb) parts.push(pb);
        if (memIsOn(s)) {
            const mem = memEnsure(s);
            if (mem.summary || mem.events.length) {
                let block = '【关于长期记忆】';
                if (mem.summary) block += '\n概况：' + mem.summary;
                if (mem.events.length) {
                    block += '\n重要事件：';
                    mem.events.forEach(function (e) {
                        let tail = '';
                        if (e.date) {
                            const n = daysBetween(e.date, sessionNow(s));
                            tail = '（' + (n === 0 ? '就是今天' : (n > 0 ? '距今 ' + n + ' 天' : '还有 ' + (-n) + ' 天')) + '）';
                        }
                        block += '\n· ' + (e.date ? e.date + ' ' : '') + e.text + tail;
                    });
                }
                parts.push(block);
            }
        }
        return parts.join('\n\n');
    }

    // 每次都变的部分——拼到最后一条用户消息里，避免破坏缓存前缀
    function dynamicNote(s) {
        const out = [];
        if (timeModeOf(s) !== 'off') {
            out.push(nowLine(s));
            const gl = gapLine(s);
            if (gl) out.push(gl);
        }
        if (weatherCache.text) out.push('【当前天气】' + weatherCache.text);
        const card = (s && s.card) || {};
        if (card.who || card.style) {
            out.push('【角色提醒】保持「' + s.name + '」的身份与说话方式，不要跳出角色；不要提 AI、模型、提示词。');
        }

        if (memIsOn(s)) {
            const mem = memEnsure(s);
            const tail = (mem.events || []).slice(-3);
            if (mem.summary || tail.length) {
                let r = '【记忆提醒（写回复时优先参考）】';
                if (mem.summary) r += '\n概况：' + mem.summary;
                tail.forEach(function (e) {
                    r += '\n· ' + (e.date ? e.date + ' ' : '') + e.text;
                });
                out.push(r);
            }
        }
        out.push('【输出格式】像微信聊天那样：把回复拆成 1–3 条消息，每条 1–3 句话（约 20–80 字），用 ||| 分隔；不要一条只写半句话；代码、清单、长解释可以不拆，用一条。');
        return out.join('\n');
    }

    // 记忆与可编辑文本互转（每行：YYYY-MM-DD 事件）
    function memToText(s) {
        return memEnsure(s).events.map(function (e) {
            return (e.date ? e.date + ' ' : '') + e.text;
        }).join('\n');
    }

    function memFromText(s, text) {
        const mem = memEnsure(s);
        mem.events = [];
        String(text || '').split('\n').forEach(function (line) {
            const t = line.trim();
            if (!t) return;
            const m = t.match(/^(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})\s+(.*)$/);
            if (m) mem.events.push({ date: normDate(m[1]), text: m[2].trim() });
            else mem.events.push({ date: '', text: t });
        });
    }

    // 【J09】时间设定（现实/剧情）
    function timeModeOf(s) { return (s && s.timeMode) ? s.timeMode : 'real'; }

    function sessionNow(s) {
        if (timeModeOf(s) === 'story') return new Date(Date.now() + (Number(s.storyOffset) || 0));
        return new Date();
    }

    function timeLabel(s) { return timeModeOf(s) === 'story' ? '其他时间' : '本地时间'; }

    function renderStoryUI() {
        const s = getCurrent();
        const mode = s ? timeModeOf(s) : 'real';
        const sel = document.getElementById('timeModeSel');
        const box = document.getElementById('storyBox');
        const cur = document.getElementById('storyNow');
        if (sel) sel.value = mode;
        if (box) box.style.display = (mode === 'story') ? 'block' : 'none';
        if (cur && s) {
            const d = sessionNow(s);
            cur.textContent = '当前剧情时间：' + todayStr(d) + ' ' + cnWeekday(d) + ' ' + cnPeriod(d) + ' ' + d.getHours() + ' 点';
        }
    }

    function shiftStory(ms) {
        const s = getCurrent();
        if (!s) return;
        s.timeMode = 'story';
        s.storyOffset = (Number(s.storyOffset) || 0) + ms;
        saveData();
        renderStoryUI();
    }

    function resetStory() {
        const s = getCurrent();
        if (!s) return;
        s.storyOffset = 0;
        saveData();
        renderStoryUI();
    }

    function bindTimeMode() {
        const sel = document.getElementById('timeModeSel');
        if (!sel) return;
        sel.addEventListener('change', function () {
            const s = getCurrent();
            if (!s) return;
            s.timeMode = sel.value;
            if (s.timeMode === 'story' && typeof s.storyOffset !== 'number') s.storyOffset = 0;
            saveData();
            renderStoryUI();
        });
    }

    function toggleMemory() {
        const s = getCurrent();
        if (!s) return;
        s.memOff = !s.memOff;
        saveData();
        renderMemSwitch();
    }

    function renderMemSwitch() {
        const btn = document.getElementById('memBtn');
        if (!btn) return;
        const s = getCurrent();
        const on = s ? memIsOn(s) : true;
        btn.classList.toggle('active', on);
        btn.textContent = on ? '记忆 开' : '记忆 关';
        btn.title = on ? '长期记忆已开启：会注入记忆并自动整理（点击关闭）' : '长期记忆已关闭：不注入、不整理（数据仍保留，点击开启）';
    }

    function renderMemStatus() {
        const el = document.getElementById('memStatus');
        const s = getCurrent();
        if (!el || !s) return;
        const mem = memEnsure(s);
        el.textContent = (memIsOn(s) ? '记忆已开启' : '记忆已关闭（不注入、不整理）')
            + ' · ' + mem.events.length + ' 条事件'
            + (mem.at ? ' · 上次整理于第 ' + mem.at + ' 条消息' : ' · 尚未自动整理')
            + (mem.fail ? ' · ⚠ 上次整理失败（自动重试）' : '');
    }

    // 每新增 MEM_TRIGGER 条消息检查一次
    function maybeUpdateMemory(s) {
        if (!memIsOn(s)) return;
        const mem = memEnsure(s);
        if (s.messages.length - mem.at < MEM_TRIGGER) return;
        updateMemory(s);
    }

    // 让 AI 合并去重后重写整份记忆（不是追加）
    async function updateMemory(s) {
        if (s._memBusy) return;
        s._memBusy = true;
        try {
            const _api = apiOf(s);
            const actualKey = _api.key;
            const actualUrl = _api.url;
            const actualModel = _api.model;
            if (!actualKey) return;

            const mem = memEnsure(s);
            const recent = s.messages.filter(function (m) { return !m.proactive; }).slice(-16).map(function (m) {
                const who = m.role === 'user' ? '用户' : 'AI';
                let txt = (typeof m.content === 'string') ? m.content : (m.display || '');
                txt = stripAttachMarks(txt);
                if (txt.length > 1000) txt = txt.slice(0, 1000) + '…';
                return who + '：' + txt;
            }).join('\n');

            const usedLen = mem.summary.length + mem.events.reduce(function (a, e) { return a + String(e.text).length; }, 0);
            const needCompress = usedLen > MEM_SOFT_LIMIT;

            const sys = '你是"记忆整理器"。请只根据给定对话，维护用户与 AI 之间值得长期记住的信息。\n'
                + '规则：\n'
                + '1. 只保留重要且长期有效的内容：纪念日、约定、重要经历、称呼、明确偏好、关系里程碑。\n'
                + '2. 忽略寒暄、一次性情绪、临时话题、无长期价值的细节。\n'
                + '3. 合并重复、更新过时、修正错误，输出的是"整合后的完整记忆"。\n'
                + '4. 每条事件必须有日期，格式 YYYY-MM-DD；对话未提具体日期就用今天。\n'
                + '5. 最多 ' + MEM_MAX_EVENTS + ' 条，按日期升序。\n'
                + '6. 另外输出 profile：只放跨场景通用的用户信息（称呼、身份、通用偏好、重要日期），不超过300字；不要写剧情、纪念日、角色扮演设定。\n'
                + (needCompress ? '6. 现有记忆偏长，请在保留全部关键事实的前提下压缩表达。\n' : '')
                + '只输出 JSON，不要解释、不要代码块标记，格式：\n'
                + '{"profile":"关于用户的通用信息，不超过300字","summary":"一句话关系概况，不超过120字，可为空","events":[{"date":"YYYY-MM-DD","text":"事件"}]}';

            const userMsg = '今天是 ' + todayStr(sessionNow(s)) + '。\n\n现有记忆：\n'
                + JSON.stringify({ profile: profile.text, summary: mem.summary, events: mem.events })
                + '\n\n最近对话：\n' + recent
                + '\n\n请输出更新后的完整记忆 JSON；如果没有新内容，原样返回现有记忆。';

            const ctrl = new AbortController();
            const timer = setTimeout(function () { ctrl.abort(); }, 45000);
            let res;
            try {
                res = await fetch(actualUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + actualKey },
                    body: JSON.stringify({
                        model: actualModel,
                        messages: [
                            { role: 'system', content: sys },
                            { role: 'user', content: userMsg }
                        ],
                        stream: false,
                        temperature: 0.3
                    }),
                    signal: ctrl.signal
                });
            } finally {
                clearTimeout(timer);
            }
            if (!res.ok) return;

            const data = await res.json();
            let text = (data.choices && data.choices[0] && data.choices[0].message) ? data.choices[0].message.content : '';
            text = String(text || '').trim()
                .replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();

            let obj = null;
            try { obj = JSON.parse(text); } catch (e) {
                const m = text.match(/\{[\s\S]*\}/);
                if (m) { try { obj = JSON.parse(m[0]); } catch (e2) { obj = null; } }
            }
            if (!obj || !Array.isArray(obj.events)) return;   // 失败：不更新 at，下次重试

            mem.summary = String(obj.summary || '').trim().slice(0, 200);
            mem.events = obj.events
                .filter(function (e) { return e && e.text; })
                .map(function (e) {
                    return { date: e.date ? normDate(e.date) : todayStr(), text: String(e.text).trim().slice(0, 150) };
                })
                .slice(0, MEM_MAX_EVENTS);
            if (!profile.lock && typeof obj.profile === 'string' && obj.profile.trim()) {
                profile.text = obj.profile.trim().slice(0, 300);
                profile.on = true;
                saveProfile();
                updateProfileCount();
            }
            mem.at = s.messages.length;
            mem.fail = 0;
            s.updatedAt = Date.now();
            saveData();
            renderMemStatus();
        } catch (e) {
            console.warn('记忆整理失败：', e);
            try { memEnsure(s).fail = (memEnsure(s).fail || 0) + 1; saveData(); } catch (e2) { }
            renderMemStatus();
        } finally {
            s._memBusy = false;
        }
    }

    // 手动立即整理
    function organizeNow() {
        const s = getCurrent();
        if (!s) return;
        const btn = document.getElementById('memNowBtn');
        if (btn) { btn.disabled = true; btn.textContent = '整理中…'; }
        updateMemory(s).then(function () {
            renderMemStatus();
            if (btn) { btn.disabled = false; btn.textContent = '立即整理'; }
        });
    }

    // 导出 / 导入
    function exportMemory() {
        const s = getCurrent();
        if (!s) return;
        const mem = memEnsure(s);
        const payload = {
            type: 'dsh-chat-memory',
            version: 1,
            session: s.name,
            exportedAt: new Date().toISOString(),
            profile: profile.text,
            mem: { summary: mem.summary, events: mem.events }
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'memory-' + todayStr() + '.json';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    }

    function importMemory(ev) {
        const file = ev.target.files && ev.target.files[0];
        ev.target.value = '';
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function () {
            try {
                const obj = JSON.parse(reader.result);
                const m = obj.mem || obj;
                if (!m || !Array.isArray(m.events)) throw new Error('文件里没有 events 数组');
                const s = getCurrent();
                const mem = memEnsure(s);
                mem.summary = String(m.summary || '').trim().slice(0, 200);
                mem.events = m.events.filter(function (e) { return e && e.text; }).map(function (e) {
                    return { date: e.date ? normDate(e.date) : '', text: String(e.text).trim() };
                }).slice(0, MEM_MAX_EVENTS);
                if (typeof obj.profile === 'string') {
                    profile.text = obj.profile.slice(0, 300);
                    profile.on = true;
                    saveProfile();
                }
                mem.at = 0;
                saveData();
                document.getElementById('memSummaryInp').value = mem.summary;
                document.getElementById('memEventsInp').value = memToText(s);
                renderMemStatus();
                uiTell('导入完成', '已导入 ' + mem.events.length + ' 条记忆');
            } catch (e) {
                uiTell('导入失败', e.message);
            }
        };
        reader.readAsText(file);
    }
    // 【J10】记忆系统（结束标记）

    