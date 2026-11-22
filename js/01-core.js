/* ============================================================
   01-core.js
   全局状态、存储、默认配置、全局档案、工具函数
   由 index.html 拆分而来；加载顺序：01 → 02 → 03
   ============================================================ */

    /* ============================================================
       脚本目录：（Ctrl+F 搜【Jxx】直接跳）
       【J01】全局状态
       【J02】默认配置与存储
       【J03】全局档案（跨对话共享）
       【J04】记忆系统（概况/事件/触发）
       【J05】锁屏密码
       【J06】天气
       【J07】主动消息（解密/合并）
       【J08】人设同步
       【J09】时间设定（现实/剧情）
       【J10】记忆系统（结束标记）
       【J11】初始化函数 init
       【J12】页面内确认框
       【J13】重命名弹窗
       【J14】设置中心
       【J15】时间戳·长按菜单·导出
       【J16】Markdown 渲染
       【J17】发送消息与流式输出
       ============================================================ */

    // ===== 页面管理：头像 / 气泡颜色 / 动效 =====
    function avGet(k) { return localStorage.getItem(k) || ''; }

        function makeAvatar(role) {
        const box = document.createElement('div');
        box.className = 'avatar';
        const s = (typeof getCurrent === 'function') ? getCurrent() : null;
        const isMe = role === 'user';
        const txt = (s && (isMe ? s.avMeText : s.avAiText))
            || avGet(isMe ? 'chat.avatar.meText' : 'chat.avatar.aiText')
            || (isMe ? '我' : 'A');
        const bg = (s && (isMe ? s.avMeBg : s.avAiBg))
            || avGet(isMe ? 'chat.avbg.me' : 'chat.avbg.ai')
            || (isMe ? '#f6e7e9' : '#e6e4e0');
        box.textContent = txt;
        box.style.background = bg;
        return box;
    }

        function hexToRgba(hex, alpha) {
        const h = String(hex || '').replace('#', '');
        if (h.length !== 6) return hex;
        const r = parseInt(h.slice(0, 2), 16);
        const g = parseInt(h.slice(2, 4), 16);
        const b = parseInt(h.slice(4, 6), 16);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    }

    // 头像底色（15 色，柔和）
    const AV_COLORS = ['#f6e7e9', '#f7e0e6', '#f3dbe6', '#efe0f2', '#e6ddf2',
        '#dfe4f5', '#dbe8f3', '#d9eef0', '#dcefe2', '#e6f0d9',
        '#f4efd6', '#f8e8d4', '#f6dfd4', '#eee3dc', '#e6e4e0'];
    const BUB_COLORS_ME = ['#f4ecdf', '#f5dfe3', '#e2ece2', '#dfe8f2', '#f2e4d8', '#e9e2ef', '#f8f0e2', '#f0e2e2'];
    const BUB_COLORS_AI = ['#eeebe6', '#ece8ee', '#eceee9', '#e9eef3', '#efeae3', '#eceaee', '#e8e6e2', '#ebe7e2'];

    function fillSwatchRow(id, colors, fn) {
        const row = document.getElementById(id);
        if (!row) return;
        row.innerHTML = '';
        colors.forEach(function (c) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'sw';
            b.setAttribute('data-c', c);
            b.style.background = c;
            b.onclick = function () { fn(c, b); };
            row.appendChild(b);
        });
    }

    function buildAllSwatches() {
        fillSwatchRow('swAvMe', AV_COLORS, function (c) { setAvatarBg('me', c); });
        fillSwatchRow('swAvAi', AV_COLORS, function (c) { setAvatarBg('ai', c); });
    }

    function setAvatarBg(which, hex) {
        localStorage.setItem(which === 'me' ? 'chat.avbg.me' : 'chat.avbg.ai', hex);
        markAvatarSwatches();
        if (!isGenerating) renderChat();
        toast('已换头像底色');
    }

    function markAvatarSwatches() {
        [['swAvMe', 'chat.avbg.me'], ['swAvAi', 'chat.avbg.ai']].forEach(function (t) {
            const row = document.getElementById(t[0]);
            if (!row) return;
            const cur = avGet(t[1]);
            Array.prototype.forEach.call(row.children, function (b) {
                b.classList.toggle('on', !!cur && b.getAttribute('data-c') === cur);
            });
        });
    }

    function applyUiSettings() {
        const on = localStorage.getItem('chat.avatar.on') !== '0';
        document.body.classList.toggle('no-avatar', !on);
        const anim = localStorage.getItem('chat.anim.on') !== '0';
        document.body.classList.toggle('no-anim', !anim);
        const me = avGet('chat.color.me');
        const ai = avGet('chat.color.ai');
        const root = document.documentElement.style;
        if (me) root.setProperty('--bubble-me-bg', hexToRgba(me, 0.86)); else root.removeProperty('--bubble-me-bg');
        if (ai) root.setProperty('--bubble-ai-bg', hexToRgba(ai, 0.86)); else root.removeProperty('--bubble-ai-bg');
        buildAllSwatches();
        markAvatarSwatches();
    }

    function setBubbleColor(btn) {
        const row = btn.parentNode;
        const hex = btn.getAttribute('data-c');
        const key = row && row.id === 'swMe' ? 'chat.color.me' : 'chat.color.ai';
        localStorage.setItem(key, hex);
        applyUiSettings();
        const inp = document.getElementById(row && row.id === 'swMe' ? 'colMe' : 'colAi');
        if (inp) inp.value = hex;
        markSwatches();
        toast('已换色');
    }

    function applyHexColor(which) {
        const inp = document.getElementById(which === 'me' ? 'hexMe' : 'hexAi');
        if (!inp) return;
        let v = String(inp.value || '').trim();
        if (v && v.charAt(0) !== '#') v = '#' + v;
        if (!/^#[0-9a-fA-F]{6}$/.test(v)) { toast('请输入 #RRGGBB，例如 #f8dfe7'); return; }
        localStorage.setItem(which === 'me' ? 'chat.color.me' : 'chat.color.ai', v.toLowerCase());
        applyUiSettings();
        fillUiSettings();
        toast('已换色');
    }

    function markSwatches() {
        [['swMe', 'chat.color.me'], ['swAi', 'chat.color.ai']].forEach(function (t) {
            const row = document.getElementById(t[0]);
            if (!row) return;
            const cur = avGet(t[1]);
            Array.prototype.forEach.call(row.children, function (b) {
                b.classList.toggle('on', cur && b.getAttribute('data-c') === cur);
            });
        });
    }

    function fillUiSettings() {
        const _rs = document.getElementById('replyStyleSel');
        if (_rs) _rs.value = localStorage.getItem('chat.replyStyle') || 'split';
        document.getElementById('uiAvatarOn').checked = localStorage.getItem('chat.avatar.on') !== '0';
        document.getElementById('uiAnimOn').checked = localStorage.getItem('chat.anim.on') !== '0';
        document.getElementById('avMeText').value = avGet('chat.avatar.meText');
        document.getElementById('avAiText').value = avGet('chat.avatar.aiText');
        const hm = document.getElementById('hexMe');
        if (hm) hm.value = avGet('chat.color.me');
        const ha = document.getElementById('hexAi');
        if (ha) ha.value = avGet('chat.color.ai');
        buildAllSwatches();
        markAvatarSwatches();
        markSwatches();
    }

    function saveUiSettings() {
        const _rsEl = document.getElementById('replyStyleSel');
        if (_rsEl) localStorage.setItem('chat.replyStyle', _rsEl.value || 'split');
        localStorage.setItem('chat.avatar.on', document.getElementById('uiAvatarOn').checked ? '1' : '0');
        localStorage.setItem('chat.anim.on', document.getElementById('uiAnimOn').checked ? '1' : '0');
        localStorage.setItem('chat.avatar.meText', String(document.getElementById('avMeText').value || '').trim().slice(0, 2));
        localStorage.setItem('chat.avatar.aiText', String(document.getElementById('avAiText').value || '').trim().slice(0, 2));
        const _norm = function (v) {
            let s = String(v || '').trim();
            if (!s) return '';
            if (s.charAt(0) !== '#') s = '#' + s;
            return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : '';
        };
        const _hm = document.getElementById('hexMe');
        const _ha = document.getElementById('hexAi');
        const me = _norm(_hm && _hm.value);
        const ai = _norm(_ha && _ha.value);
        if (me) localStorage.setItem('chat.color.me', me);
        if (ai) localStorage.setItem('chat.color.ai', ai);
        applyUiSettings();
        toast('已保存');
    }

    function resetUiColors() {
        localStorage.removeItem('chat.color.me');
        localStorage.removeItem('chat.color.ai');
        applyUiSettings();
        fillUiSettings();
        toast('已恢复默认颜色');
    }

    // 旧版本存过头像图片，这里自动清掉（不再支持图片）
    function migrateAvatars() {
        let changed = false;
        ['chat.avatar.me', 'chat.avatar.ai'].forEach(function (k) {
            if (localStorage.getItem(k)) { localStorage.removeItem(k); changed = true; }
        });
        (sessions || []).forEach(function (s) {
            if (s.avatarMe) { delete s.avatarMe; changed = true; }
            if (s.avatarAi) { delete s.avatarAi; changed = true; }
        });
        if (changed) { try { saveData(); } catch (e) { } }
    }
            // 【J01】全局状态
    let isDeepThink = localStorage.getItem('chat.deepthink') === 'true';
    let pendingImage = null;
    let pendingFileText = '';
    let pendingFileName = null;
    let isGenerating = false;
    let currentAbortController = null;

    // 修改点 4：只保留最近一次"修改前"的快照，用于撤回
    let undoEditSnapshot = null;

    // 修改点 5：只允许纯文本类文件，避免把 .docx/.pdf 当成文本读成乱码
    const TEXT_EXTS = ['txt', 'md', 'json', 'csv', 'py', 'js', 'html', 'css'];

    const DB = {
        get: (k, def) => { try { return JSON.parse(localStorage.getItem(k)) || def; } catch { return def; } },
        set: (k, v) => localStorage.setItem(k, JSON.stringify(v))
    };

    // 【J02】默认配置与存储
    let cfg = DB.get('chat.cfg', { url: 'https://api.deepseek.com/v1/chat/completions', key: '', model: 'deepseek-flash' });
    // 【J03】全局档案（跨对话共享）
    let profile = DB.get('chat.profile', { text: '', on: true });
    if (!profile || typeof profile !== 'object') profile = { text: '', on: true };
    if (typeof profile.text !== 'string') profile.text = '';
    if (typeof profile.on !== 'boolean') profile.on = true;
    if (typeof profile.lock !== 'boolean') profile.lock = false;

    function saveProfile() { DB.set('chat.profile', profile); }

    function profileBlock() {
        if (!profile.on) return '';
        const t = String(profile.text || '').trim();
        if (!t) return '';
        const suffix = profile.lock ? '\n（以上由用户手动维护，请遵循，不要改写）' : '';
        return '【关于用户的全局档案（所有对话通用）】\n' + t + suffix;
    }

    function updateProfileCount() {
        const inp = document.getElementById('profileInp');
        const el = document.getElementById('profileCount');
        if (!el) return;
        const len = inp ? inp.value.length : String(profile.text || '').length;
        el.textContent = len + ' / 300 字';
    }

    (function bindProfileCounter() {
        const inp = document.getElementById('profileInp');
        if (inp) inp.addEventListener('input', updateProfileCount);
    })();

    let sessions = DB.get('chat.sessions', []);
    let currentId = localStorage.getItem('chat.cur');

    