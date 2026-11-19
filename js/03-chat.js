/* ============================================================
   03-chat.js
   确认框、重命名、设置中心、消息交互、Markdown、发送、初始化
   由 index.html 拆分而来；加载顺序：01 → 02 → 03
   ============================================================ */
// 【J11】初始化函数 init

    function init() {
        try { migrateAvatars(); } catch (e) { }
        if (sessions.length === 0) {
            createSession();
        } else if (!sessions.find(s => s.id === currentId)) {
            currentId = sessions[0].id;
            localStorage.setItem('chat.cur', currentId);
        }
        renderSidebar();
        renderChat();
        
        // 恢复深度思考状态
        if (isDeepThink) document.getElementById('thinkBtn').classList.add('active');

        // 兼容旧记忆结构 + 恢复记忆开关显示
        sessions.forEach(function (x) { memEnsure(x); });
        renderMemSwitch();
        bindTimeMode();
        applyUiSettings();
        pullProactive(false);
        // 每 3 分钟检查一次；页面在后台时不查，省流量和电
        setInterval(function () { if (!document.hidden) pullProactive(false); }, 3 * 60 * 1000);
        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) { clearTitleBadge(); pullProactive(false); }
        });
        window.addEventListener('focus', function () { clearTitleBadge(); });
        document.addEventListener('click', function () { clearTitleBadge(); }, true);
    }

    function createSession() {
        const newSession = { id: Date.now().toString(), name: '新对话', pinned: false, updatedAt: Date.now(), messages: [], memory: '' };
        sessions.push(newSession);
        currentId = newSession.id;
        clearUndoEdit();   // 修改点 6：换会话则作废撤回
        saveData(); renderSidebar(); renderChat(); renderMemSwitch();
        if (window.innerWidth < 768 && document.getElementById('sidebar').classList.contains('on')) toggleSidebar();
    }

    function saveData() {
        try {
            DB.set('chat.sessions', sessions);
        } catch (e) {
            // 存储写满时先丢掉全部推理内容再试一次，优先保住聊天正文
            sessions.forEach(function (x) {
                (x.messages || []).forEach(function (m) { if (m.reasoning) delete m.reasoning; });
            });
            try { DB.set('chat.sessions', sessions); }
            catch (e2) { console.warn('保存失败：localStorage 空间不足', e2); }
        }
        localStorage.setItem('chat.cur', currentId);
    }

    function getCurrent() { return sessions.find(s => s.id === currentId); }

    function renderSidebar() {
        const listEl = document.getElementById('session-list');
        listEl.innerHTML = '';
        const sorted = [...sessions].sort((a, b) => {
            if (a.pinned && !b.pinned) return -1;
            if (!a.pinned && b.pinned) return 1;
            return b.updatedAt - a.updatedAt;
        });

        sorted.forEach(s => {
            const div = document.createElement('div');
            div.className = `session-item ${s.id === currentId ? 'active' : ''}`;
            const nameEl = document.createElement('span');
            nameEl.className = 'name';
            nameEl.textContent = (s.pinned ? '📌 ' : '') + s.name;
            const moreBtn = document.createElement('button');
            moreBtn.className = 'more-btn';
            moreBtn.textContent = '⋮';
            moreBtn.onclick = function (ev) {
                ev.stopPropagation();
                openMyModal(s.id);
            };
            div.appendChild(nameEl);
            if (Number(s.unread) > 0) {
                const dot = document.createElement('span');
                dot.className = 'unread-dot';
                div.appendChild(dot);
            }
            div.appendChild(moreBtn);
            div.onclick = function () {
                clearUndoEdit();
                s.unread = 0;
                currentId = s.id; saveData(); renderSidebar(); renderChat(); renderMemSwitch();
                if (window.innerWidth < 768) toggleSidebar();
            };
            listEl.appendChild(div);
        });
    }

    // 【J12】页面内确认框
    let confirmResolve = null;

    function uiAsk(title, text) {
        return new Promise(function (resolve) {
            confirmResolve = resolve;
            document.getElementById('confirmTitle').textContent = title || '确认';
            document.getElementById('confirmText').textContent = text || '';
            const cancel = document.getElementById('confirmCancelBtn');
            if (cancel) cancel.style.display = '';
            document.getElementById('confirmModal').style.display = 'flex';
        });
    }

    function uiTell(title, text) {
        return new Promise(function (resolve) {
            confirmResolve = resolve;
            document.getElementById('confirmTitle').textContent = title || '提示';
            document.getElementById('confirmText').textContent = text || '';
            const cancel = document.getElementById('confirmCancelBtn');
            if (cancel) cancel.style.display = 'none';
            document.getElementById('confirmModal').style.display = 'flex';
        });
    }

    function closeConfirm(ok) {
        const r = confirmResolve;
        confirmResolve = null;
        const m = document.getElementById('confirmModal');
        if (m) m.style.display = 'none';
        if (r) r(!!ok);
    }

    // 【J13】重命名弹窗
    let renamingId = null;

    function openRename(id) {
        const s = sessions.find(function (x) { return x.id === id; });
        if (!s) { toast('找不到这个对话'); return; }
        renamingId = id;
        const inp = document.getElementById('renameInp');
        inp.value = s.name || '';
        document.getElementById('renameModal').style.display = 'flex';
        setTimeout(function () { inp.focus(); inp.select(); }, 60);
    }

    function closeRename() {
        document.getElementById('renameModal').style.display = 'none';
        renamingId = null;
    }

    function applyRename() {
        const inp = document.getElementById('renameInp');
        const v = String(inp.value || '').trim();
        if (!v) { toast('名字不能为空'); return; }
        const s = sessions.find(function (x) { return x.id === renamingId; });
        if (!s) { closeRename(); return; }
        s.name = v.slice(0, 30);
        s.updatedAt = Date.now();
        saveData();
        renderSidebar();
        renderChat();
        closeRename();
        toast('已改名');
    }

    let editingSessionId = null;
    function openMyModal(id) {
        editingSessionId = id;
        const s = sessions.find(x => x.id === id);
        document.getElementById('pinLabelText').textContent = s.pinned ? '取消置顶' : '置顶';
        document.getElementById('actionPin').checked = true;
        document.getElementById('myModal').style.display = 'flex';
    }
    function closeMyModal() { document.getElementById('myModal').style.display = 'none'; editingSessionId = null; }
    async function confirmMyModal() {
        if (!editingSessionId) return;
        const s = sessions.find(x => x.id === editingSessionId);
        const action = document.querySelector('input[name="myChoice"]:checked').value;
        if (action === 'pin') s.pinned = !s.pinned;
        else if (action === 'rename') {
            const renameTarget = editingSessionId;
            closeMyModal();
            openRename(renameTarget);
            return;
        } else if (action === 'delete') {
            const targetId = editingSessionId;
            closeMyModal();
            const ok = await uiAsk('删除对话', '「' + (s ? s.name : '') + '」删除后无法恢复。');
            if (!ok) return;
            sessions = sessions.filter(x => x.id !== targetId);
            if (currentId === targetId) currentId = sessions[0] ? sessions[0].id : null;
        }
        saveData();
        if (!currentId) createSession(); else { renderSidebar(); renderChat(); }
        closeMyModal();
    }

    function toggleSidebar() {
        document.getElementById('sidebar').classList.toggle('on');
        document.getElementById('overlay').classList.toggle('on');
    }

    // 【J14】设置中心
    function openSettingsHub() { showSettingsPanel('hub'); }

    function showSettingsPanel(which) {
        ['settingsHub', 'settings', 'sessionSettingsModal', 'notifyModal', 'uiModal'].forEach(function (id) {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        if (which === 'chat') {
            fillSessionSettings();
            document.getElementById('sessionSettingsModal').style.display = 'flex';
        } else if (which === 'api') {
            fillApiSettings();
            document.getElementById('settings').style.display = 'flex';
        } else if (which === 'notify') {
            fillNotifySettings();
            document.getElementById('notifyModal').style.display = 'flex';
        } else if (which === 'ui') {
            fillUiSettings();
            document.getElementById('uiModal').style.display = 'flex';
        } else {
            document.getElementById('settingsHub').style.display = 'flex';
        }
    }

    function closeAllSettings() {
        ['settingsHub', 'settings', 'sessionSettingsModal', 'notifyModal', 'lockModal', 'uiModal'].forEach(function (id) {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    }

    function toggleOwnApi() {
        const on = document.getElementById('useOwnApiInp').checked;
        document.getElementById('ownApiBox').style.display = on ? 'block' : 'none';
    }

    // 统一取用本次请求的 API 配置
    function apiOf(s) {
        const own = !!(s && s.useOwnApi);
        return {
            url: (own && s.url) ? s.url : cfg.url,
            key: (own && s.key) ? s.key : cfg.key,
            model: (own && s.model) ? s.model : cfg.model
        };
    }

    function openSessionSettings() { showSettingsPanel('chat'); }

        function toggleCardBox() {
        const box = document.getElementById('cardBox');
        if (!box) return;
        const show = (box.style.display === 'none' || !box.style.display);
        box.style.display = show ? 'block' : 'none';
    }

    function toggleSessionLook() {
        const box = document.getElementById('sessionLookBox');
        if (!box) return;
        const show = (box.style.display === 'none' || !box.style.display);
        box.style.display = show ? 'block' : 'none';
        if (show) { buildSessionSwatches(); markSessionSwatches(); }
    }

    function applySessionLook() {
        const s = getCurrent();
        const root = document.documentElement.style;
        const gMe = localStorage.getItem('chat.color.me');
        const gAi = localStorage.getItem('chat.color.ai');
        const me = (s && s.bubMe) || gMe;
        const ai = (s && s.bubAi) || gAi;
        if (me) root.setProperty('--bubble-me-bg', hexToRgba(me, 0.86)); else root.removeProperty('--bubble-me-bg');
        if (ai) root.setProperty('--bubble-ai-bg', hexToRgba(ai, 0.86)); else root.removeProperty('--bubble-ai-bg');
    }

    function markSessionSwatches() {
        const s = getCurrent();
        if (!s) return;
        const map = [
            ['sessSwAvMe', s.avMeBg], ['sessSwAvAi', s.avAiBg],
            ['sessSwBubMe', s.bubMe], ['sessSwBubAi', s.bubAi]
        ];
        map.forEach(function (t) {
            const row = document.getElementById(t[0]);
            if (!row) return;
            const cur = t[1] || '';
            Array.prototype.forEach.call(row.children, function (b) {
                b.classList.toggle('on', !!cur && b.getAttribute('data-c') === cur);
            });
        });
    }

    function buildSessionSwatches() {
        fillSwatchRow('sessSwAvMe', AV_COLORS, function (c) { setSessionLook('avMeBg', c); });
        fillSwatchRow('sessSwAvAi', AV_COLORS, function (c) { setSessionLook('avAiBg', c); });
        fillSwatchRow('sessSwBubMe', BUB_COLORS_ME, function (c) { setSessionLook('bubMe', c); });
        fillSwatchRow('sessSwBubAi', BUB_COLORS_AI, function (c) { setSessionLook('bubAi', c); });
    }

    function setSessionLook(key, hex) {
        const s = getCurrent();
        if (!s) return;
        s[key] = hex;
        saveData();
        applySessionLook();
        markSessionSwatches();
        if (!isGenerating) renderChat();
        toast('只改了当前对话');
    }

    function clearSessionLook() {
        const s = getCurrent();
        if (!s) return;
        ['avMeBg', 'avAiBg', 'bubMe', 'bubAi', 'avMeText', 'avAiText'].forEach(function (k) { delete s[k]; });
        saveData();
        applySessionLook();
        buildSessionSwatches();
        markSessionSwatches();
        if (!isGenerating) renderChat();
        toast('已恢复默认外观');
    }

            function fillSessionSettings() {
        const s = getCurrent();
        if (!s) return;
        const _box = document.getElementById('sessionLookBox');
        if (_box) _box.style.display = 'none';
        const _cbox = document.getElementById('cardBox');
        if (_cbox) _cbox.style.display = 'none';
        buildSessionSwatches();
        const _t1 = document.getElementById('sessAvMeText');
        if (_t1) _t1.value = s.avMeText || '';
        const _t2 = document.getElementById('sessAvAiText');
        if (_t2) _t2.value = s.avAiText || '';
        markSessionSwatches();
        document.getElementById('sessionNameInp').value = s.name;
        document.getElementById('sessionPromptInp').value = s.systemPrompt || '';
        const _c = s.card || {};
        const _w = document.getElementById('cardWhoInp');
        if (_w) _w.value = _c.who || '';
        const _st = document.getElementById('cardStyleInp');
        if (_st) _st.value = _c.style || '';
        const _sa = document.getElementById('cardSampleInp');
        if (_sa) _sa.value = _c.sample || '';
        const _bn = document.getElementById('cardBanInp');
        if (_bn) _bn.value = _c.ban || '';
        const mem = memEnsure(s);
        document.getElementById('memSummaryInp').value = mem.summary || '';
        document.getElementById('memEventsInp').value = memToText(s);
        document.getElementById('profileInp').value = profile.text || '';
        document.getElementById('profileOnInp').checked = profile.on;
        document.getElementById('profileLockInp').checked = profile.lock;
        updateProfileCount();
        renderStoryUI();
        renderMemStatus();
        document.getElementById('sessionModelInp').value = s.model || '';
        document.getElementById('sessionUrlInp').value = s.url || '';
        document.getElementById('sessionKeyInp').value = s.key || '';
        document.getElementById('useOwnApiInp').checked = !!s.useOwnApi;
        toggleOwnApi();
        // 显示由 showSettingsPanel 负责
    }
    function closeSessionSettings() { showSettingsPanel('hub'); }
    function saveSessionSettings() {
        const s = getCurrent();
        if (!s) return;
        const newName = document.getElementById('sessionNameInp').value.trim();
        if (newName) s.name = newName;
        s.systemPrompt = document.getElementById('sessionPromptInp').value.trim();
        const _gv = function (id, max) {
            const el = document.getElementById(id);
            return el ? String(el.value || '').trim().slice(0, max) : '';
        };
        const card = {
            who: _gv('cardWhoInp', 80),
            style: _gv('cardStyleInp', 120),
            sample: _gv('cardSampleInp', 400),
            ban: _gv('cardBanInp', 120)
        };
        if (card.who || card.style || card.sample || card.ban) s.card = card;
        else delete s.card;
        const _m1 = document.getElementById('sessAvMeText');
        const _m2 = document.getElementById('sessAvAiText');
        if (_m1) {
            const v = String(_m1.value || '').trim().slice(0, 2);
            if (v) s.avMeText = v; else delete s.avMeText;
        }
        if (_m2) {
            const v2 = String(_m2.value || '').trim().slice(0, 2);
            if (v2) s.avAiText = v2; else delete s.avAiText;
        }
        const mem = memEnsure(s);
        mem.summary = document.getElementById('memSummaryInp').value.trim().slice(0, 200);
        memFromText(s, document.getElementById('memEventsInp').value);
        profile.text = document.getElementById('profileInp').value.slice(0, 300);
        profile.on = document.getElementById('profileOnInp').checked;
        profile.lock = document.getElementById('profileLockInp').checked;
        const tsel = document.getElementById('timeModeSel');
        if (tsel) s.timeMode = tsel.value;
        if (s.timeMode === 'story' && typeof s.storyOffset !== 'number') s.storyOffset = 0;
        saveProfile();
        s.useOwnApi = document.getElementById('useOwnApiInp').checked;
        s.model = document.getElementById('sessionModelInp').value.trim();
        s.url = document.getElementById('sessionUrlInp').value.trim();
        s.key = document.getElementById('sessionKeyInp').value.trim();
        saveData(); renderSidebar(); renderChat(); closeSessionSettings();
    }

    // 【J15】时间戳·长按菜单·导出
    function fmtMsgTime(ts) {
        const d = new Date(ts);
        const now = new Date();
        const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        if (d.toDateString() === now.toDateString()) return hm;
        const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        if (d.toDateString() === y.toDateString()) return '昨天 ' + hm;
        return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
    }

    function makeTimeDivider(ts) {
        const el = document.createElement('div');
        el.className = 'time-divider';
        el.textContent = fmtMsgTime(ts);
        return el;
    }

    function toast(text) {
        let el = document.getElementById('dshToast');
        if (!el) { el = document.createElement('div'); el.id = 'dshToast'; document.body.appendChild(el); }
        el.textContent = text;
        el.classList.add('show');
        clearTimeout(el._timer);
        el._timer = setTimeout(function () { el.classList.remove('show'); }, 1600);
    }

    function msgPlain(m) {
        if (typeof m.content === 'string') return m.content;
        return m.display || '';
    }

    function copyMsg(m) {
        const text = msgPlain(m);
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { toast('已复制'); }, function () { toast('复制失败'); });
        } else {
            toast('这个浏览器不支持复制');
        }
    }

    function speakMsg(m) {
        if (!('speechSynthesis' in window)) { toast('这个浏览器不支持朗读'); return; }
        window.speechSynthesis.cancel();
        const clean = msgPlain(m).replace(/[*#`>_~]/g, ' ').replace(/\s+/g, ' ');
        const u = new SpeechSynthesisUtterance(clean);
        u.lang = 'zh-CN';
        window.speechSynthesis.speak(u);
        toast('朗读中…');
    }

    async function deleteMsg(index) {
        const s = getCurrent();
        if (!s) return;
        const ok = await uiAsk('删除消息', '这条消息删除后无法恢复。');
        if (!ok) return;
        s.messages.splice(index, 1);
        s.updatedAt = Date.now();
        saveData();
        renderChat();
    }

    function regenerateAt(index) {
        if (isGenerating) { toast('等当前回复结束再试'); return; }
        const s = getCurrent();
        if (!s) return;
        let ui = index - 1;
        while (ui >= 0 && s.messages[ui].role !== 'user') ui--;
        if (ui < 0) { toast('找不到对应的提问'); return; }
        const text = String(msgPlain(s.messages[ui]) || '').trim();
        s.messages.splice(ui, index - ui + 1);
        s.updatedAt = Date.now();
        saveData();
        renderChat();
        const inp = document.getElementById('inp');
        inp.value = text;
        send();
    }

    function openMsgMenu(index, x, y) {
        closeMsgMenu();
        const s = getCurrent();
        if (!s) return;
        const m = s.messages[index];
        if (!m) return;
        const menu = document.createElement('div');
        menu.className = 'msg-menu';
        menu.id = 'msgMenu';
        const items = [{ label: '复制', fn: function () { copyMsg(m); } }];
        if (m.role === 'user') {
            items.push({ label: '编辑', fn: function () { editMessage(index); } });
        }
        if (m.role !== 'user') {
            items.push({ label: '朗读', fn: function () { speakMsg(m); } });
            items.push({ label: '重新生成', fn: function () { regenerateAt(index); } });
        }
        items.push({ label: '删除', fn: function () { deleteMsg(index); }, danger: true });
        items.forEach(function (it) {
            const b = document.createElement('button');
            b.textContent = it.label;
            if (it.danger) b.classList.add('danger');
            b.addEventListener('click', function (ev) { ev.stopPropagation(); closeMsgMenu(); it.fn(); });
            menu.appendChild(b);
        });
        document.body.appendChild(menu);
        const r = menu.getBoundingClientRect();
        menu.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
        menu.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
        setTimeout(function () { document.addEventListener('click', closeMsgMenu, { once: true }); }, 0);
    }

    function closeMsgMenu() {
        const el = document.getElementById('msgMenu');
        if (el) el.remove();
    }

    function attachLongPress(el, index) {
        let timer = null;
        function start(ev) {
            if (ev.target && ev.target.closest && ev.target.closest('button, a, input, textarea')) return;
            if (ev.type === 'mousedown' && ev.button !== 0) return;
            const x = ev.touches ? ev.touches[0].clientX : ev.clientX;
            const y = ev.touches ? ev.touches[0].clientY : ev.clientY;
            timer = setTimeout(function () { timer = null; openMsgMenu(index, x, y); }, 500);
        }
        function cancel() { if (timer) { clearTimeout(timer); timer = null; } }
        el.addEventListener('touchstart', start, { passive: true });
        el.addEventListener('touchend', cancel);
        el.addEventListener('touchmove', cancel);
        el.addEventListener('mousedown', start);
        el.addEventListener('mouseup', cancel);
        el.addEventListener('mouseleave', cancel);
        el.addEventListener('contextmenu', function (ev) {
            ev.preventDefault();
            openMsgMenu(index, ev.clientX, ev.clientY);
        });
    }

    function safeFileName(n) {
        return String(n || 'chat').replace(/[\\/:*?"<>|]/g, '_').slice(0, 30);
    }

    function downloadText(name, text, mime) {
        const blob = new Blob([text], { type: mime + ';charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    }

    function exportChat(fmt) {
        const s = getCurrent();
        if (!s) return;
        const base = 'chat-' + safeFileName(s.name) + '-' + todayStr();
        if (fmt === 'json') {
            const data = { name: s.name, exportedAt: new Date().toISOString(), messages: s.messages };
            downloadText(base + '.json', JSON.stringify(data, null, 2), 'application/json');
            toast('已导出 JSON');
        } else {
            let md = '# ' + s.name + '\n\n';
            s.messages.forEach(function (m) {
                const who = m.role === 'user' ? '我' : 'AI';
                md += '**' + who + '**' + (m.ts ? '  ' + fmtMsgTime(m.ts) : '') + '\n\n' + msgPlain(m) + '\n\n';
            });
            downloadText(base + '.md', md, 'text/markdown');
            toast('已导出 Markdown');
        }
    }

    // 把带 ||| 的回复拆成多条短消息
    function splitBubbles(text) {
        const raw = String(text == null ? '' : text);
        const parts = raw.split('|||').map(function (x) { return x.trim(); }).filter(function (x) { return x.length; });
        return parts.length ? parts : [''];
    }

    function renderChat() {
        applySessionLook();
        const s = getCurrent();
        if (!s) return;
        document.getElementById('title').textContent = s.name;
        const msgsEl = document.getElementById('msgs');
        msgsEl.innerHTML = '';
        let prevTs = 0;
        let lastRole = null;
        s.messages.forEach((m, index) => {
            if (m.ts && (!prevTs || m.ts - prevTs > 5 * 60 * 1000)) {
                msgsEl.appendChild(makeTimeDivider(m.ts));
                lastRole = null;
            }
            if (m.role === 'assistant') {
                const parts = splitBubbles(m.content);
                parts.forEach(function (pt, pi) {
                    const grouped = (lastRole === 'assistant') || pi > 0;
                    addBubble('ai', pt, pi === 0 ? m.display : '', undefined, index, 'assistant', '', pi === 0 ? m.reasoning : '', m.ts, grouped);
                });
                lastRole = 'assistant';
            } else {
                addBubble('me', m.content, m.display, m.image, index, m.role, m.fileName, m.reasoning, m.ts, false);
                lastRole = 'user';
            }
            if (m.ts) prevTs = m.ts;
        });
    }

    // 【J16】Markdown 渲染
    let mdPaintAt = 0;

    function mdEscape(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function mdInline(text) {
        let out = text;
        // 行内代码（最先处理，避免内部符号被当作强调）
        out = out.replace(/`([^`\n]+)`/g, function (m, c) { return '<code>' + c + '</code>'; });
        // 加粗
        out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
        // 斜体（单星号，且不能是 ** 的一部分）
        out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
        // 删除线
        out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
        // 链接（仅允许 http/https）
        out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
        return out;
    }

    // 语言别名：模型常写 js / py / ts，Prism 里对应的是 javascript / python / typescript
    const MD_LANG_ALIAS = {
        js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
        py: 'python', sh: 'bash', shell: 'bash', zsh: 'bash',
        html: 'markup', xml: 'markup', svg: 'markup',
        yml: 'yaml', cs: 'csharp', md: 'markdown',
        text: 'none', txt: 'none', plain: 'none'
    };

    // 有 Prism 就高亮，没有就退回纯文本（断网不会白屏）
    function renderCodeBlock(raw, lang) {
        const key = String(lang || '').toLowerCase();
        const name = MD_LANG_ALIAS[key] || key;
        const P = (typeof window !== 'undefined') ? window.Prism : null;
        if (P && name && name !== 'none' && P.languages && P.languages[name]) {
            try {
                const html = P.highlight(raw, P.languages[name], name);
                return '<pre class="language-' + name + '"><code class="language-' + name + '">' + html + '</code></pre>';
            } catch (e) { /* 落到下面的纯文本分支 */ }
        }
        return '<pre><code>' + mdEscape(raw) + '</code></pre>';
    }

    function renderMarkdown(src) {
        if (!src) return '';
        const lines = String(src).replace(/\r\n?/g, '\n').split('\n');
        const out = [];
        let i = 0;
        let listTag = null;
        let para = [];

        function flushPara() {
            if (!para.length) return;
            out.push('<p>' + mdInline(mdEscape(para.join('\n'))).replace(/\n/g, '<br>') + '</p>');
            para = [];
        }
        function closeList() {
            if (listTag) { out.push('</' + listTag + '>'); listTag = null; }
        }

        // 拆表格行：去掉首尾竖线后按 | 切开
        function splitRow(line) {
            let t = line.trim();
            if (t.startsWith('|')) t = t.slice(1);
            if (t.endsWith('|')) t = t.slice(0, -1);
            return t.split('|').map(function (s) { return s.trim(); });
        }

        // 判断是否是 "| --- | :---: |" 这种分隔行
        function isTableSep(line) {
            if (!line || line.indexOf('-') < 0) return false;
            const cells = splitRow(line);
            if (!cells.length) return false;
            return cells.every(function (c) { return /^:?-{1,}:?$/.test(c); });
        }

        while (i < lines.length) {
            const line = lines[i];

            // 围栏代码块
            const fenceOpen = line.match(/^\s*```\s*([\w+#.-]*)\s*$/);
            if (fenceOpen) {
                flushPara(); closeList();
                i++;
                const code = [];
                while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
                i++;
                out.push(renderCodeBlock(code.join('\n'), fenceOpen[1]));
                continue;
            }

            if (!line.trim()) { flushPara(); closeList(); i++; continue; }

            // 标题
            let m = line.match(/^(#{1,4})\s+(.*)$/);
            if (m) { flushPara(); closeList(); const lv = m[1].length; out.push('<h' + lv + '>' + mdInline(mdEscape(m[2])) + '</h' + lv + '>'); i++; continue; }

            // 分割线
            if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) { flushPara(); closeList(); out.push('<hr>'); i++; continue; }

            // 引用块
            if (/^\s*>\s?/.test(line)) {
                flushPara(); closeList();
                const buf = [];
                while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
                out.push('<blockquote>' + mdInline(mdEscape(buf.join('\n'))).replace(/\n/g, '<br>') + '</blockquote>');
                continue;
            }

            // 无序列表
            m = line.match(/^\s*[-*+]\s+(.*)$/);
            if (m) {
                flushPara();
                if (listTag !== 'ul') { closeList(); out.push('<ul>'); listTag = 'ul'; }
                out.push('<li>' + mdInline(mdEscape(m[1])) + '</li>');
                i++; continue;
            }

            // 有序列表
            m = line.match(/^\s*\d+[.)]\s+(.*)$/);
            if (m) {
                flushPara();
                if (listTag !== 'ol') { closeList(); out.push('<ol>'); listTag = 'ol'; }
                out.push('<li>' + mdInline(mdEscape(m[1])) + '</li>');
                i++; continue;
            }

            // GFM 表格：当前行含 |，且下一行是分隔行
            if (line.indexOf('|') >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1])) {
                flushPara(); closeList();
                const header = splitRow(line);
                const aligns = splitRow(lines[i + 1]).map(function (c) {
                    if (/^:-+:$/.test(c)) return 'center';
                    if (/^-+:$/.test(c)) return 'right';
                    return 'left';
                });
                i += 2;
                const rows = [];
                while (i < lines.length && lines[i].trim() !== '' && lines[i].indexOf('|') >= 0) {
                    rows.push(splitRow(lines[i])); i++;
                }
                let t = '<table><thead><tr>';
                for (let hi = 0; hi < header.length; hi++) {
                    t += '<th style="text-align:' + (aligns[hi] || 'left') + '">' + mdInline(mdEscape(header[hi])) + '</th>';
                }
                t += '</tr></thead><tbody>';
                for (let ri = 0; ri < rows.length; ri++) {
                    t += '<tr>';
                    for (let ci = 0; ci < header.length; ci++) {
                        t += '<td style="text-align:' + (aligns[ci] || 'left') + '">' + mdInline(mdEscape(rows[ri][ci] || '')) + '</td>';
                    }
                    t += '</tr>';
                }
                t += '</tbody></table>';
                out.push('<div class="table-wrap">' + t + '</div>');
                continue;
            }

            closeList();
            para.push(line);
            i++;
        }
        flushPara(); closeList();
        return out.join('');
    }

    // 只给"刚刚新增的消息"播放入场动画，切换会话绝不重播
    function animateLastBubble() {
        const box = document.getElementById('msgs');
        if (!box) return;
        const el = box.lastElementChild;
        if (!el) return;
        el.classList.remove('enter');
        void el.offsetWidth;
        el.classList.add('enter');
    }

    function addBubble(cls, content, displayText, imageBase64, index, role, fileName, reasoning, ts) {
        const wrap = document.createElement('div');
        wrap.className = `msg-wrap ${cls}`;
        
        const d = document.createElement('div');
        d.className = 'msg';

        let textToShow = displayText || (typeof content === 'string' ? content : '');
        if (role === 'user') {
            d.textContent = textToShow;
        } else {
            d.classList.add('md-body');
            d.innerHTML = renderMarkdown(textToShow);
        }
        if (fileName) {
            const chip = document.createElement('div');
            chip.className = 'file-chip';
            chip.textContent = '📄 ' + fileName;
            d.appendChild(chip);
        }

        // 已保存的推理内容：默认收起，点标题展开
        if (reasoning) {
            const rw = document.createElement('div');
            rw.className = 'reasoning-wrapper';
            const rh = document.createElement('div');
            rh.className = 'reasoning-header';
            rh.innerHTML = '已深度思考 <span>▶</span>';
            rh.onclick = function () { toggleReasoning(this); };
            const rc = document.createElement('div');
            rc.className = 'reasoning-content md-body';
            rc.innerHTML = renderMarkdown(reasoning);
            rw.appendChild(rh);
            rw.appendChild(rc);
            d.insertBefore(rw, d.firstChild);
        }

        if (imageBase64) {
            const img = document.createElement('img');
            img.src = imageBase64;
            img.className = 'chat-img';
            d.appendChild(img);
        }

        // 修改点 8：这里原本还有 "if (role === 'user') d.onclick = () => editMessage(index);"
        // 已删除 —— 现在只有 ○ 按钮能进入修改

        const av = makeAvatar(role);
        if (role === 'user') {
            wrap.appendChild(d);
            wrap.appendChild(av);
        } else {
            wrap.appendChild(av);
            wrap.appendChild(d);
        }
        if (arguments[9]) wrap.classList.add('grouped');
        attachLongPress(wrap, index);
        const msgsEl = document.getElementById('msgs');
        msgsEl.appendChild(wrap);
        msgsEl.scrollTop = msgsEl.scrollHeight;
        return d;
    }

    // 修改点 9：编辑前保存快照；行为仍是"截断 + 填回输入框"
    function editMessage(index) {
        if (isGenerating) { toast('请先停止当前生成，再修改历史消息'); return; }
        const s = getCurrent();
        const msg = s.messages[index];
        if (!msg || msg.role !== 'user') return;

        // 深拷贝保存，供"撤回刚才的修改"使用
        undoEditSnapshot = { sessionId: s.id, messages: JSON.parse(JSON.stringify(s.messages)) };
        document.getElementById('undoEditBar').style.display = 'flex';

        let textToEdit = msg.display || (typeof msg.content === 'string' ? msg.content : '');
        textToEdit = stripAttachMarks(textToEdit);
        pendingImage = null; pendingFileText = ''; pendingFileName = null;
        clearAttachTray();
        
        const inp = document.getElementById('inp');
        inp.value = textToEdit;
        inp.focus();
        inp.style.height = 'auto';
        inp.style.height = Math.min(inp.scrollHeight, 120) + 'px';

        s.messages = s.messages.slice(0, index);
        saveData(); renderChat();
    }

    // 修改点 10：撤回最近一次修改（只支持一次）
    function undoEdit() {
        if (!undoEditSnapshot) return;
        if (isGenerating) { toast('请先停止当前生成'); return; }

        const s = getCurrent();
        if (!s || s.id !== undoEditSnapshot.sessionId) { clearUndoEdit(); return; }

        s.messages = undoEditSnapshot.messages;
        s.updatedAt = Date.now();
        clearUndoEdit();

        const inp = document.getElementById('inp');
        inp.value = '';
        inp.style.height = '24px';

        saveData(); renderChat();
    }

    // 修改点 11：作废撤回资格
    function clearUndoEdit() {
        undoEditSnapshot = null;
        const bar = document.getElementById('undoEditBar');
        if (bar) bar.style.display = 'none';
    }

    function toggleThink() {
        isDeepThink = !isDeepThink;
        localStorage.setItem('chat.deepthink', isDeepThink);
        const btn = document.getElementById('thinkBtn');
        if (isDeepThink) btn.classList.add('active');
        else btn.classList.remove('active');
    }

    // 去掉历史消息里遗留的附件标记（旧版本会把 [图片已附加] 之类写进正文）
    function stripAttachMarks(t) {
        return String(t || '')
            .replace(/\[图片已附加\]\s*/g, '')
            .replace(/\[已附加:\s*[^\]]+\]\s*/g, '')
            .replace(/\n?\[图片\]/g, '')
            .replace(/\n?\[文件内容\]/g, '')
            .trim();
    }

    // 输入框上方的附件托盘（缩略图 / 文件名 + 删除按钮）
    function renderAttachTray() {
        const tray = document.getElementById('attachTray');
        if (!tray) return;
        tray.innerHTML = '';
        if (pendingImage) {
            const box = document.createElement('div');
            box.className = 'attach-item';
            const img = document.createElement('img');
            img.src = pendingImage;
            img.className = 'attach-thumb';
            const del = document.createElement('button');
            del.className = 'attach-del';
            del.textContent = '×';
            del.title = '移除图片';
            del.onclick = function () { pendingImage = null; renderAttachTray(); };
            box.appendChild(img);
            box.appendChild(del);
            tray.appendChild(box);
        }
        if (pendingFileName) {
            const box = document.createElement('div');
            box.className = 'attach-item attach-file';
            const name = document.createElement('span');
            name.textContent = '📄 ' + pendingFileName;
            const del = document.createElement('button');
            del.className = 'attach-del';
            del.textContent = '×';
            del.title = '移除文件';
            del.onclick = function () { pendingFileText = ''; pendingFileName = null; renderAttachTray(); };
            box.appendChild(name);
            box.appendChild(del);
            tray.appendChild(box);
        }
        tray.style.display = (pendingImage || pendingFileName) ? 'flex' : 'none';
    }

    function clearAttachTray() {
        const tray = document.getElementById('attachTray');
        if (tray) { tray.innerHTML = ''; tray.style.display = 'none'; }
    }

    document.getElementById('fileInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const ext = (file.name.split('.').pop() || '').toLowerCase();

        // 修改点 12：只接受图片和纯文本，拒绝 Word/PDF 等二进制文件
        if (!file.type.startsWith('image/') && !TEXT_EXTS.includes(ext)) {
            toast('只支持图片和纯文本文件（' + TEXT_EXTS.join(', ') + '）；Word/PDF 请先转成 txt');
            e.target.value = '';
            return;
        }
        
        if (file.type.startsWith('image/')) {
            if (file.size > 1024 * 1024) { toast('图片太大了（建议小于 1MB）'); e.target.value = ''; return; }
            const reader = new FileReader();
            reader.onload = () => {
                pendingImage = reader.result;
                pendingFileName = null;
                renderAttachTray();
            };
            reader.readAsDataURL(file);
        } else {
            const reader = new FileReader();
            reader.onload = () => {
                pendingFileText = reader.result;
                pendingFileName = file.name;
                renderAttachTray();
            };
            reader.readAsText(file);
        }
        e.target.value = '';
    });

    function handleSendClick() {
        if (isGenerating) {
            if (currentAbortController) currentAbortController.abort();
        } else {
            send();
        }
    }

    // 只保留最近 20 条 AI 回复的推理内容，避免撑爆 localStorage
    const REASON_KEEP = 20;

    function trimReasonings(s) {
        let n = 0;
        for (let i = s.messages.length - 1; i >= 0; i--) {
            const m = s.messages[i];
            if (!m || m.role !== 'assistant') continue;
            n++;
            if (n > REASON_KEEP && m.reasoning) { delete m.reasoning; }
        }
    }

    function toggleReasoning(header) {
        const content = header.nextElementSibling;
        const icon = header.querySelector('span');
        if (content.style.display === 'block') {
            content.style.display = 'none';
            icon.textContent = '▶';
        } else {
            content.style.display = 'block';
            icon.textContent = '▼';
        }
    }

    // 【J17】发送消息与流式输出

    async function send() {
        const inp = document.getElementById('inp');
        const btn = document.getElementById('send');
        const text = inp.value.trim();
        if (!text && !pendingImage && !pendingFileText) return;

        // 修改点 13：发送新消息后，旧快照作废
        clearUndoEdit();

        const s = getCurrent();
        const _api = apiOf(s);
        const actualModel = _api.model;
        const actualUrl = _api.url;
        const actualKey = _api.key;

        if (!actualKey) {
            toast('请先填写 API Key'); openSettings(); return;
        }

        let userContent = '';
        const displayText = text;   // 只存用户打的字，不再拼接任何标记

        if (!pendingImage && !pendingFileText) {
            userContent = text;
        } else {
            userContent = [];
            if (text) userContent.push({ type: "text", text: text });
            if (pendingFileText) userContent.push({ type: "text", text: `\n\n--- 附件内容 ---\n${pendingFileText}` });
            if (pendingImage) userContent.push({ type: "image_url", image_url: { url: pendingImage } });
        }

        s.messages.push({ role: 'user', content: userContent, display: displayText, image: pendingImage, fileName: pendingFileName || null, ts: Date.now() });

        if (s.name === '新对话') s.name = (text || '文件/图片').slice(0, 15);
        s.updatedAt = Date.now();
        saveData(); renderSidebar();
        document.getElementById('title').textContent = s.name;

        renderChat();
        animateLastBubble();

        inp.value = ''; inp.style.height = '24px';
        pendingImage = null; pendingFileText = ''; pendingFileName = null;
        clearAttachTray();

        isGenerating = true;
        btn.disabled = false;
        btn.textContent = '■';
        btn.classList.add('stop-mode');

        const wrap = document.createElement('div');
        wrap.className = `msg-wrap ai`;
        wrap.appendChild(makeAvatar('assistant'));
        const d = document.createElement('div');
        d.className = 'msg';
        
        // 思考面板
        const reasonWrapper = document.createElement('div');
        reasonWrapper.className = 'reasoning-wrapper';
        reasonWrapper.style.display = 'none';
        const reasonHeader = document.createElement('div');
        reasonHeader.className = 'reasoning-header';
        reasonHeader.innerHTML = '思考中<span class="typing"><i></i><i></i><i></i></span> <span>▶</span>';
        reasonHeader.onclick = function() { toggleReasoning(this); };
        const reasonContent = document.createElement('div');
        reasonContent.className = 'reasoning-content md-body';
        reasonWrapper.appendChild(reasonHeader);
        reasonWrapper.appendChild(reasonContent);
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'md-body';
        // 等第一个字到达前，先显示三个跳动的点，避免看起来卡住
        const typingEl = document.createElement('div');
        typingEl.className = 'typing';
        typingEl.innerHTML = '<i></i><i></i><i></i>';
        contentDiv.appendChild(typingEl);

        d.appendChild(reasonWrapper);
        d.appendChild(contentDiv);
        wrap.appendChild(d);
        const msgsEl = document.getElementById('msgs');
        msgsEl.appendChild(wrap);
        msgsEl.scrollTop = msgsEl.scrollHeight;

        let full = '';
        let liveDiv = contentDiv;
        let segDone = 0;
        function ensureNextAiBubble() {
            const w2 = document.createElement('div');
            w2.className = 'msg-wrap ai grouped';
            w2.appendChild(makeAvatar('assistant'));
            const d2 = document.createElement('div');
            d2.className = 'msg';
            const c2 = document.createElement('div');
            c2.className = 'md-body';
            d2.appendChild(c2);
            w2.appendChild(d2);
            msgsEl.appendChild(w2);
            liveDiv = c2;
        }
        function paintSegments() {
            const segs = splitBubbles(full);
            while (segDone < segs.length - 1) {
                liveDiv.innerHTML = renderMarkdown(segs[segDone]);
                segDone++;
                ensureNextAiBubble();
            }
            liveDiv.innerHTML = renderMarkdown(segs[segs.length - 1] || '');
        }
        let fullReasoning = '';
        currentAbortController = new AbortController();

        try {
            try { await refreshWeather(); } catch (e) { }
            const payloadMsgs = s.messages.slice(-30).map(m => ({ role: m.role, content: m.content }));
            
            // 把固定人设和长期记忆拼接起来
            let sysContent = buildSystemPrompt(s);
            if (s.memory) {
                sysContent += `\n\n【关于用户的长期记忆（非常重要）：】\n${s.memory}`;
            }
            if (sysContent) {
                payloadMsgs.unshift({ role: "system", content: sysContent });
            }

            // 动态信息（时间/天气/距上次对话/记忆提醒）放在最后，保护前缀缓存
            try {
                const dyn = dynamicNote(s);
                if (dyn && payloadMsgs.length) {
                    const last = payloadMsgs[payloadMsgs.length - 1];
                    if (last.role === 'user') {
                        last.content = String(last.content == null ? '' : last.content) + '\n\n' + dyn;
                    } else {
                        payloadMsgs.push({ role: 'user', content: dyn });
                    }
                }
            } catch (e) { }

            const bodyObj = { model: actualModel, messages: payloadMsgs, stream: true };
            bodyObj.max_tokens = (typeof cfg.max_tokens === 'number') ? cfg.max_tokens : 2048;
            if (typeof cfg.temperature === 'number') bodyObj.temperature = cfg.temperature;
            if (typeof cfg.top_p === 'number') bodyObj.top_p = cfg.top_p;
            if (isDeepThink) bodyObj.thinking = { type: "enabled" };
            else bodyObj.thinking = { type: "disabled" };

            const res = await fetch(actualUrl, {
                method:'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + actualKey },
                body: JSON.stringify(bodyObj),
                signal: currentAbortController.signal
            });
            if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + await res.text());

            const reader = res.body.getReader();
            const dec = new TextDecoder();
            let buf = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += dec.decode(value, { stream:true });
                const lines = buf.split('\n'); buf = lines.pop();
                
                for (const rawLine of lines) {
                    if (!rawLine.trim()) continue;
                    let dataStr = rawLine.trim();
                    if (dataStr.startsWith('data:')) dataStr = dataStr.substring(5).trim();
                    if (dataStr === '[DONE]' || !dataStr) continue;

                    try {
                        const j = JSON.parse(dataStr);
                        const delta = j.choices?.[0]?.delta;

                        if (delta?.reasoning_content) {
                            fullReasoning += delta.reasoning_content;
                            reasonWrapper.style.display = 'block';
                            reasonContent.innerHTML = renderMarkdown(fullReasoning);
                            msgsEl.scrollTop = msgsEl.scrollHeight;
                        }
                        if (delta?.content) {
                            full += delta.content;
                            if (full.length > 12000) {
                                try { currentAbortController.abort(); } catch (e) { }
                                full += '\n\n（输出过长，已自动停止）';
                            }
                            if (typingEl && typingEl.parentNode) typingEl.remove();
                            const _t = Date.now();
                            if (_t - mdPaintAt > 90) { mdPaintAt = _t; paintSegments(); }
                            msgsEl.scrollTop = msgsEl.scrollHeight;
                        }
                    } catch (err) {}
                }
            }

            if (full) {
                paintSegments();
                if (isDeepThink && !fullReasoning) {
                    const hint = document.createElement('div');
                    hint.className = 'no-reason-hint';
                    hint.textContent = '本次模型未返回思考过程';
                    (liveDiv.parentNode || d).appendChild(hint);
                }
                if (/(作为\s*(一个)?\s*(AI|人工智能)|语言模型|系统提示|提示词|system prompt)/i.test(full)) {
                    const warn = document.createElement('div');
                    warn.className = 'ooc-hint';
                    warn.textContent = '这句可能出戏了，可长按重新生成';
                    d.appendChild(warn);
                }
                s.messages.push({ role:'assistant', content: full, reasoning: fullReasoning || null, ts: Date.now() });
                trimReasonings(s);
                s.updatedAt = Date.now(); saveData();
                animateLastBubble();
            }
            if (fullReasoning) reasonHeader.innerHTML = '已深度思考 <span>▶</span>';

        } catch (e) {
            if (e.name === 'AbortError') {
                contentDiv.innerHTML = renderMarkdown(full) + '<p style="color:#888">[已停止生成]</p>';
                contentDiv.style.color = '#888';
                if (full) { s.messages.push({ role:'assistant', content: full, reasoning: fullReasoning || null, ts: Date.now() }); trimReasonings(s); s.updatedAt = Date.now(); saveData(); }
            } else {
                if (e.message.includes('Failed to fetch') || e.message.includes('NetworkError')) {
                    contentDiv.textContent = '⚠️ 网络连接不稳定，请重新发送';
                } else {
                    contentDiv.textContent = '⚠️ 请求出错：' + e.message;
                }
                contentDiv.style.color = '#f66';
                contentDiv.style.background = '#fee';
            }
        } finally {
            if (typeof typingEl !== 'undefined' && typingEl && typingEl.parentNode) typingEl.remove();
            isGenerating = false;
            btn.textContent = '↑';
            btn.classList.remove('stop-mode');
            currentAbortController = null;
            
            // 检查是否需要后台提取记忆
            maybeUpdateMemory(s);
        }
    }

    function fillApiSettings() {
        document.getElementById('cfgUrl').value = cfg.url;
        document.getElementById('cfgKey').value = cfg.key;
        document.getElementById('cfgModel').value = cfg.model;
        document.getElementById('cfgTemp').value = (typeof cfg.temperature === 'number') ? cfg.temperature : '';
        document.getElementById('cfgTopP').value = (typeof cfg.top_p === 'number') ? cfg.top_p : '';
        const mt = document.getElementById('cfgMaxTokens');
        if (mt) mt.value = (typeof cfg.max_tokens === 'number') ? cfg.max_tokens : 2048;
    }
    function openSettings() { showSettingsPanel('api'); }
    function closeSettings() { showSettingsPanel('hub'); }
    function modelsUrlOf(chatUrl) {
        let u = String(chatUrl || '').trim().replace(/\/+$/, '');
        if (!u) return '';
        if (/\/chat\/completions$/i.test(u)) return u.replace(/\/chat\/completions$/i, '/models');
        if (/\/models$/i.test(u)) return u;
        return u + '/models';
    }

    async function listModels() {
        const box = document.getElementById('modelList');
        const urlInp = document.getElementById('cfgUrl');
        const keyInp = document.getElementById('cfgKey');
        if (!box) return;
        const base = modelsUrlOf(urlInp ? urlInp.value : '');
        const key = String((keyInp && keyInp.value) || '').trim();
        if (!base) { box.innerHTML = '<span class="ml-err">请先填接口地址</span>'; return; }
        if (!key) { box.innerHTML = '<span class="ml-err">请先填 API Key</span>'; return; }
        box.innerHTML = '<span class="ml-tip">查询中…</span>';
        try {
            const res = await fetchT(base, 8000, { headers: { 'Authorization': 'Bearer ' + key } });
            if (!res.ok) {
                box.innerHTML = '<span class="ml-err">HTTP ' + res.status +
                    (res.status === 404 ? '（该服务商可能不支持 /models）' : (res.status === 401 ? '（Key 无效）' : '')) + '</span>';
                return;
            }
            const data = await res.json();
            const ids = (Array.isArray(data && data.data) ? data.data : [])
                .map(function (x) { return x && (x.id || x.name); })
                .filter(Boolean);
            if (!ids.length) { box.innerHTML = '<span class="ml-err">返回里没有模型列表</span>'; return; }
            box.innerHTML = '';
            ids.slice(0, 40).forEach(function (id) {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'ml-item';
                b.textContent = id;
                b.onclick = function () {
                    const m = document.getElementById('cfgModel');
                    if (m) m.value = id;
                    Array.prototype.forEach.call(box.children, function (c) { c.classList.remove('on'); });
                    b.classList.add('on');
                    toast('已填入 ' + id);
                };
                box.appendChild(b);
            });
        } catch (e) {
            box.innerHTML = '<span class="ml-err">请求失败：' + (e && e.message ? e.message : '可能是跨域限制') + '</span>';
        }
    }

    function saveSettings() {
        const temp = parseFloat(document.getElementById('cfgTemp').value);
        const topP = parseFloat(document.getElementById('cfgTopP').value);
        cfg = { url: document.getElementById('cfgUrl').value.trim(), key: document.getElementById('cfgKey').value.trim(), model: document.getElementById('cfgModel').value.trim() };
        if (Number.isFinite(temp) && temp > 1.6) {
            toast('温度太高（>1.6）会让回复语义崩坏，已取消保存');
            return;
        }
        if (Number.isFinite(temp) && temp > 1.3) {
            toast('提示：温度 >1.3 容易出戏，建议 1.0–1.3');
        }
        if (Number.isFinite(temp)) cfg.temperature = Math.min(2, Math.max(0, temp));
        if (Number.isFinite(topP)) cfg.top_p = Math.min(1, Math.max(0, topP));
        const mtv = parseInt(document.getElementById('cfgMaxTokens').value, 10);
        cfg.max_tokens = Number.isFinite(mtv) ? Math.min(8192, Math.max(128, mtv)) : 2048;
        DB.set('chat.cfg', cfg);
        showSettingsPanel('hub');
        toast('已保存');
    }

    (function bindRenameEnter() {
        const r = document.getElementById('renameInp');
        if (!r) return;
        r.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter') { ev.preventDefault(); applyRename(); }
            else if (ev.key === 'Escape') { closeRename(); }
        });
    })();

    const inpEl = document.getElementById('inp');
    inpEl.addEventListener('input', () => {
        inpEl.style.height = 'auto';
        inpEl.style.height = Math.min(inpEl.scrollHeight, 120) + 'px';
    });
    let isComposing = false;
    inpEl.addEventListener('compositionstart', () => { isComposing = true; });
    inpEl.addEventListener('compositionend', () => { isComposing = false; });
    inpEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !isComposing) { 
            e.preventDefault(); handleSendClick(); 
        }
    });

    // 手机键盘弹出时，用 visualViewport 校准布局高度
    function fitViewport() {
        const vv = window.visualViewport;
        const h = (vv && vv.height) ? vv.height : window.innerHeight;
        if (h) document.documentElement.style.setProperty('--app-h', Math.round(h) + 'px');
    }
    window.addEventListener('resize', fitViewport);
    window.addEventListener('orientationchange', function () { setTimeout(fitViewport, 120); });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', fitViewport);
        window.visualViewport.addEventListener('scroll', fitViewport);
    }
    fitViewport();

    init();

    // Prism 通过 CDN 异步加载，加载完成后把已有消息重画一次以获得代码高亮
    window.addEventListener('load', function () {
        if (window.Prism && !isGenerating) renderChat();
    });
