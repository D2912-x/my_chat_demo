/* ============================================================
   04-moments.js —— 朋友圈
   - 多个"朋友圈"（圈子），每个圈子选参与的 AI 成员
   - 每天每个圈子最多 5 条动态（按日期+圈子确定性随机）
   - 生成动态时顺带生成 0-2 条其他成员评论
   - 你可以评论，动态作者会回你一句
   ============================================================ */

const MOM_MAX_PER_DAY = 5;
const MOM_MAX_COMMENTS = 20;   // 每条动态最多 20 条评论
let currentCircleId = null;
let circleDraftNew = false;

function momentsData() {
    let d = DB.get('chat.moments', null);
    if (!d || typeof d !== 'object' || !Array.isArray(d.circles)) d = { circles: [], posts: [] };
    if (!Array.isArray(d.posts)) d.posts = [];
    return d;
}
function saveMoments(d) { DB.set('chat.moments', d); }

function momHash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
}

function momPlan(circleId, dateStr) {
    const seed = momHash(circleId + '|' + dateStr);
    const count = 1 + (seed % MOM_MAX_PER_DAY);
    const times = [];
    for (let i = 0; i < count; i++) {
        const s2 = momHash(circleId + '|' + dateStr + '|' + i);
        times.push(s2 % 1440);
    }
    times.sort(function (a, b) { return a - b; });
    return times;
}

function momTodayPosts(d, circleId) {
    const t = todayStr();
    return d.posts.filter(function (p) { return p.circleId === circleId && p.date === t; });
}

function momMembers(circle) {
    return (circle.members || []).map(function (id) {
        return (sessions || []).filter(function (s) { return s.id === id; })[0];
    }).filter(Boolean);
}

function openMoments() {
    const d = momentsData();
    if (!d.circles.length) {
        d.circles.push({ id: 'c' + Date.now(), name: '我的朋友圈', members: sessions.slice(0, 2).map(function (s) { return s.id; }) });
        saveMoments(d);
    }
    if (!currentCircleId) currentCircleId = d.circles[0].id;
    document.getElementById('momentsModal').style.display = 'flex';
    renderMoments();
    generateMoments(false, 2);
}

function closeMoments() { document.getElementById('momentsModal').style.display = 'none'; }

function switchCircle(id) { currentCircleId = id; renderMoments(); }

function renderMoments() {
    const d = momentsData();
    const bar = document.getElementById('circlesBar');
    if (bar) {
        bar.innerHTML = '';
        d.circles.forEach(function (c) {
            const b = document.createElement('button');
            b.className = 'circle-tab' + (c.id === currentCircleId ? ' on' : '');
            b.textContent = c.name;
            b.onclick = function () { switchCircle(c.id); };
            bar.appendChild(b);
        });
        const add = document.createElement('button');
        add.className = 'circle-tab add';
        add.textContent = '＋';
        add.onclick = function () { openCircleEditor(true); };
        bar.appendChild(add);
    }

    const list = document.getElementById('momentsList');
    if (!list) return;
    list.innerHTML = '';
    const c = d.circles.filter(function (x) { return x.id === currentCircleId; })[0];
    if (!c) return;

    const ml = document.getElementById('circleMembersLine');
    if (ml) {
        const names = momMembers(c).map(function (m) { return m.name; });
        ml.textContent = names.length
            ? ('成员 ' + names.length + ' 个：' + names.join('、') + (names.length === 1 ? '（只有一个人，不会有人评论）' : ''))
            : '这个圈子还没有成员，点「成员设置」添加';
    }
    const posts = d.posts.filter(function (p) { return p.circleId === c.id; }).sort(function (a, b) { return b.at - a.at; });

    if (!posts.length) {
        const em = document.createElement('div');
        em.className = 'mom-empty';
        em.textContent = '还没有动态。点下面「生成动态」试试。';
        list.appendChild(em);
        return;
    }

    posts.slice(0, 30).forEach(function (p) {
        const card = document.createElement('div');
        card.className = 'mom-card';

        const head = document.createElement('div');
        head.className = 'mom-head';
        const av = document.createElement('div');
        av.className = 'mom-avatar';
        av.textContent = (p.byName || 'A').slice(0, 1);
        const nm = document.createElement('span');
        nm.className = 'mom-name';
        nm.textContent = p.byName || 'AI';
        const tm = document.createElement('span');
        tm.className = 'mom-time';
        tm.textContent = fmtMsgTime(p.at);
        head.appendChild(av); head.appendChild(nm); head.appendChild(tm);
        card.appendChild(head);

        const body = document.createElement('div');
        body.className = 'mom-text';
        body.textContent = p.text;
        card.appendChild(body);

        const allowedNow = momMembers(c).map(function (m) { return m.name; }).concat(['我']);
        (p.comments || []).filter(function (cm) {
            return cm && allowedNow.indexOf(String(cm.byName)) >= 0;
        }).forEach(function (cm) {
            const row = document.createElement('div');
            row.className = 'mom-comment' + (cm.mine ? ' mine' : '');
            const w = document.createElement('b');
            w.textContent = (cm.byName || 'AI') + '：';
            const tx = document.createElement('span');
            tx.textContent = cm.text;
            row.appendChild(w); row.appendChild(tx);
            card.appendChild(row);
        });

        const inputRow = document.createElement('div');
        inputRow.className = 'mom-input-row';
        const inp = document.createElement('input');
        inp.placeholder = '写评论…';
        const btn = document.createElement('button');
        btn.className = 'mem-btn';
        btn.textContent = '发送';
        btn.onclick = function () { addMomentComment(p.id, inp.value); };
        inputRow.appendChild(inp); inputRow.appendChild(btn);
        card.appendChild(inputRow);

        list.appendChild(card);
    });
}

async function generateMoments(manual, limit) {
    const d = momentsData();
    const c = d.circles.filter(function (x) { return x.id === currentCircleId; })[0];
    if (!c) return;
    const members = momMembers(c);
    if (!members.length) {
        if (manual) toast('先点「＋」勾选至少一个对话作为成员');
        return;
    }
    const times = momPlan(c.id, todayStr());
    const today = momTodayPosts(d, c.id);
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const missing = [];
    times.forEach(function (tm) {
        if (tm > nowMin) return;
        const exists = today.some(function (p) {
            const pm = new Date(p.at).getHours() * 60 + new Date(p.at).getMinutes();
            return Math.abs(pm - tm) < 3;
        });
        if (!exists) missing.push(tm);
    });
    const todo = missing.slice(0, Math.max(1, limit || 1));
    if (!todo.length) {
        if (manual) {
            const future = times.filter(function (tm) { return tm > nowMin; });
            if (future.length) {
                const hh = String(Math.floor(future[0] / 60)).padStart(2, '0') + ':' + String(future[0] % 60).padStart(2, '0');
                toast('今天还差 ' + future.length + ' 条，最早 ' + hh + ' 才发');
            } else {
                toast('今天这 ' + times.length + ' 条都发过了');
            }
        }
        return;
    }
    if (manual) toast('正在生成 ' + todo.length + ' 条…');
    for (const tm of todo) {
        const who = members[momHash(c.id + '|' + tm) % members.length];
        const others = members.filter(function (m) { return m.id !== who.id; });
        try {
            const post = await momMakePost(c, who, others, tm);
            const dd = momentsData();
            dd.posts.push(post);
            saveMoments(dd);
            if (document.getElementById('momentsModal').style.display === 'flex') renderMoments();
        } catch (e) {
            console.warn('朋友圈生成失败：', e);
            if (manual) toast('生成失败：' + e.message);
            break;
        }
    }
}

function momPersonaText(s) {
    const card = (s && s.card) || {};
    const parts = [];
    if (card.who) parts.push('身份：' + card.who);
    if (card.style) parts.push('说话方式：' + card.style);
    if (card.sample) parts.push('示例：' + card.sample);
    if (card.ban) parts.push('禁止：' + card.ban);
    if (card.extra) parts.push('其他：' + String(card.extra).slice(0, 120));
    if (!parts.length && s && s.systemPrompt) parts.push(String(s.systemPrompt).slice(0, 300));
    return parts.join('\n') || ('名字：' + (s ? s.name : 'AI'));
}

async function momMakePost(circle, who, others, minutes) {
    const api = apiOf(who);
    if (!api.key) throw new Error('该对话没配置 API Key');
    const endpoint = assertSafeApiUrl(api.url);
    const t = new Date();
    t.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    const timeStr = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
    const mem = who.mem || {};
    const memTxt = mem.summary ? ('你和好友的关系：' + mem.summary) : '';
    const otherNames = others.map(function (m) { return m.name; });
    const otherDesc = others.map(function (m) {
        const card2 = (m && m.card) || {};
        const brief = [card2.who, card2.style].filter(Boolean).join('；') || m.name;
        return m.name + '：' + brief;
    }).join('\n');

    const sys = '你要以「' + who.name + '」的身份发一条朋友圈动态。\n'
        + momPersonaText(who) + '\n'
        + (memTxt ? memTxt + '\n' : '')
        + '要求：20-60 字，第一人称，口语化，不提自己是 AI，不加引号，避免空话。\n'
        + (otherNames.length
            ? ('另外生成 0-3 条好友评论，评论者只能从下面这些人里选，必须符合各自人设：\n' + otherDesc
                + '\n每条不超过 15 字，像微信里随口一句，语气要能区分出是谁。\n')
            : '')
        + '只输出 JSON：{"text":"动态内容","comments":[{"who":"评论者名","text":"评论"}]}';

    const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.key },
        body: JSON.stringify({
            model: api.model,
            messages: [{ role: 'system', content: sys }, { role: 'user', content: '现在是 ' + timeStr + '，写吧。' }],
            stream: false,
            temperature: 1.1,
            max_tokens: 700
        })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    let txt = String((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '').trim();
    txt = txt.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
    let obj = null;
    try { obj = JSON.parse(txt); } catch (e) {
        const m = txt.match(/\{[\s\S]*\}/);
        if (m) { try { obj = JSON.parse(m[0]); } catch (e2) { } }
    }
    if (!obj || !obj.text) {
        let clean = txt;
        const mt = clean.match(/"text"\s*:\s*"([^"]{1,300})"/);
        if (mt) clean = mt[1];
        clean = clean.split('{"')[0].replace(/^[{["]\s*|[{["]\s*$/g, '').trim();
        obj = { text: clean.slice(0, 120) || '……', comments: [] };
    }

    const allowedNames = others.map(function (m) { return m.name; });
    const comments = (Array.isArray(obj.comments) ? obj.comments : [])
        .filter(function (x) { return x && x.text && x.who && allowedNames.indexOf(String(x.who)) >= 0; })
        .slice(0, 3)
        .map(function (x, i) {
            return { byName: String(x.who).slice(0, 12), text: String(x.text).slice(0, 30), at: t.getTime() + (i + 1) * 60000 };
        });

    if (!others.length) comments.length = 0;

    return {
        id: 'p' + Date.now() + Math.random().toString(36).slice(2, 6),
        circleId: circle.id,
        date: todayStr(),
        by: who.id,
        byName: who.name,
        at: t.getTime(),
        text: String(obj.text).slice(0, 200),
        comments: comments
    };
}

async function addMomentComment(postId, text) {
    text = String(text || '').trim();
    if (!text) return;
    const d = momentsData();
    const p = d.posts.filter(function (x) { return x.id === postId; })[0];
    if (!p) return;
    p.comments = p.comments || [];
    if (p.comments.length >= MOM_MAX_COMMENTS) { toast('这条动态的评论已经满 20 条了'); return; }
    p.comments.push({ byName: '我', text: text.slice(0, 60), at: Date.now(), mine: true });
    saveMoments(d);
    renderMoments();

    const author = (sessions || []).filter(function (s) { return s.id === p.by; })[0];
    if (!author) { toast('找不到这条动态的作者，无法自动回复'); return; }
    try {
        const api = apiOf(author);
        if (!api.key) { toast('「' + author.name + '」没配置 API Key，无法回复'); return; }
        const endpoint = assertSafeApiUrl(api.url);
        const sys = '你是「' + author.name + '」。' + momPersonaText(author)
            + '\n有人在你的朋友圈动态下评论了。像微信里那样随口回一句：不超过 15 字，不要客套，不提 AI，不加引号，只输出这句话。';
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.key },
            body: JSON.stringify({
                model: api.model,
                messages: [{ role: 'system', content: sys }, { role: 'user', content: '你的动态：' + p.text + '\n对方评论：' + text }],
                stream: false,
                temperature: 1.1,
                max_tokens: 80
            })
        });
        if (!res.ok) return;
        const data = await res.json();
        let rp = String((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '').trim();
        rp = rp.replace(/^["「]|["」]$/g, '').slice(0, 30);
        if (!rp) return;
        const d2 = momentsData();
        const p2 = d2.posts.filter(function (x) { return x.id === postId; })[0];
        if (!p2) return;
        if ((p2.comments || []).length >= MOM_MAX_COMMENTS) return;
        p2.comments.push({ byName: p2.byName, text: rp, at: Date.now() });
        saveMoments(d2);
        renderMoments();
    } catch (e) {
        toast('「' + author.name + '」回复失败：' + (e && e.message ? e.message : '网络问题'));
    }
}

function openCircleEditor(isNew) {
    const d = momentsData();
    circleDraftNew = !!isNew;
    const list = document.getElementById('circleMemberList');
    if (!list) return;
    list.innerHTML = '';
    const cur = circleDraftNew ? null : d.circles.filter(function (c) { return c.id === currentCircleId; })[0];
    const curMembers = (cur && cur.members) || [];
    sessions.forEach(function (s) {
        const row = document.createElement('label');
        row.className = 'circle-member';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = s.id;
        cb.checked = curMembers.indexOf(s.id) >= 0;
        const nm = document.createElement('span');
        nm.textContent = s.name;
        row.appendChild(cb); row.appendChild(nm);
        list.appendChild(row);
    });
    document.getElementById('circleNameInp').value = cur ? cur.name : '';
    const ttl = document.getElementById('circleEditorTitle');
    if (ttl) ttl.textContent = circleDraftNew ? '新建朋友圈' : '朋友圈设置';
    document.getElementById('circleEditor').style.display = 'flex';
}

function closeCircleEditor() { document.getElementById('circleEditor').style.display = 'none'; }

function saveCircle() {
    const d = momentsData();
    const name = String(document.getElementById('circleNameInp').value || '').trim() || '新朋友圈';
    const members = [...document.querySelectorAll('#circleMemberList input:checked')].map(function (c) { return c.value; });
    let cur = circleDraftNew ? null : d.circles.filter(function (c) { return c.id === currentCircleId; })[0];
    if (cur) { cur.name = name; cur.members = members; }
    else {
        cur = { id: 'c' + Date.now(), name: name, members: members };
        d.circles.push(cur);
        currentCircleId = cur.id;
    }
    circleDraftNew = false;
    saveMoments(d);
    closeCircleEditor();
    renderMoments();
    toast('已保存：' + name);
}

function deleteCircle() {
    if (circleDraftNew) { circleDraftNew = false; closeCircleEditor(); return; }
    const d = momentsData();
    d.circles = d.circles.filter(function (c) { return c.id !== currentCircleId; });
    d.posts = d.posts.filter(function (p) { return p.circleId !== currentCircleId; });
    if (!d.circles.length) d.circles.push({ id: 'c' + Date.now(), name: '我的朋友圈', members: [] });
    currentCircleId = d.circles[0].id;
    saveMoments(d);
    closeCircleEditor();
    renderMoments();
    toast('已删除该朋友圈');
}

function generateMomentsManual() {
    generateMoments(true, 5).catch(function (e) { toast('生成失败：' + e.message); });
}
