/**
 * 玩家自建宗门前端模块
 */
/**
 * 兼容旧弹窗库调用的全局适配器
 */
window.showGameModal = function(title, content) {
    if (typeof showDecoratedActionDialog === 'function') {
        showDecoratedActionDialog({
            subtitle: escapeHtml(title),
            bodyHtml: content
        });
    } else {
        showModal(
            '<div class="modal-header-deco">' +
                '<div class="modal-header-deco__subtitle">' + escapeHtml(title) + '</div>' +
            '</div>' +
            '<div class="modal-body-padded">' + content + '</div>',
            'modal-overlay--top ui-scrollable-modal'
        );
    }
};
window.closeGameModal = function() {
    closeModal();
};

// 宗门权限位（与后端 SectPermissions 保持一致）
const SECT_PERMS = {
    PRICE_ITEM: 1 << 0,
    EXTRACT_ITEM: 1 << 1,
    REWARD_DISCIPLE: 1 << 2,
    APPROVE_EXCHANGE: 1 << 3,
    MANAGE_BOUNTY: 1 << 4,
    SET_THRESHOLD: 1 << 5,
    EDIT_ANNOUNCEMENT: 1 << 6,
    GRANT_TREASURY: 1 << 7,
    MANAGE_FARM: 1 << 8
};
const SECT_PERM_LIST = [
    { bit: SECT_PERMS.PRICE_ITEM, label: '定价上架' },
    { bit: SECT_PERMS.EXTRACT_ITEM, label: '提取物资' },
    { bit: SECT_PERMS.REWARD_DISCIPLE, label: '赏赐弟子' },
    { bit: SECT_PERMS.APPROVE_EXCHANGE, label: '审批兑换' },
    { bit: SECT_PERMS.MANAGE_BOUNTY, label: '发布悬赏' },
    { bit: SECT_PERMS.SET_THRESHOLD, label: '设置门槛' },
    { bit: SECT_PERMS.EDIT_ANNOUNCEMENT, label: '公告/入宗' },
    { bit: SECT_PERMS.GRANT_TREASURY, label: '动用金库' },
    { bit: SECT_PERMS.MANAGE_FARM, label: '灵田管理' }
];
// 兑换审批阈值由各宗门自行配置，从 sectInfo.exchangeApprovalRarity 读取（默认 99 = 不审批）
function sectHasPerm(role, perms, bit) {
    if (role === 'MASTER') return true;
    if (role === 'ELDER') return (perms & bit) !== 0;
    return false;
}

const PlayerSectModule = {
    sectInfo: null,
    _farmPage: 1,
    _farmPageSize: 60,
    _farmBatchLimit: 5000,
    _farmPlantAllPollTimer: null,
    _farmPlantAllRunning: false,

    // 与生命/灵力弹窗一致的装饰风格弹窗
    _openDecoratedModal(subtitle, body, extraClass) {
        const html =
            '<div class="modal-header-deco">' +
                '<div class="modal-header-deco__subtitle">' + escapeHtml(subtitle) + '</div>' +
            '</div>' +
            '<div class="modal-body-padded">' + body + '</div>';
        showModal(html, 'modal-overlay--top ui-scrollable-modal' + (extraClass ? ' ' + extraClass : ''));
    },

    // ===== 初始化 =====

    init() {
        const btn = document.getElementById('btnCreatePlayerSect');
        // 炼虚期(stage>=6)且非游客才显示创建按钮
        if (window._lastPlayerData && window._lastPlayerData.realmStage >= 6 && !window._lastPlayerData.isGuest) {
            if (btn) {
                btn.textContent = `创建宗门 (${this.getCreateCostText()}灵石)`;
                btn.classList.toggle('sect-action-btn--immortal', this.isImmortalPlayer());
                btn.style.display = '';
            }
        } else if (btn) {
            btn.style.display = 'none';
        }
    },

    getStageOptionsHtml(selectedStage) {
        const names = (typeof STAGE_NAMES !== 'undefined')
            ? STAGE_NAMES
            : ['锻体期','练气期','筑基期','金丹期','元婴期','化神期','炼虚期','合道期','大乘期','渡劫期','真仙境','玄仙境','上仙境','天仙境','仙君境','仙王境','仙帝境','仙尊境','仙祖境','圣人境'];
        const selected = selectedStage === null || selectedStage === undefined ? '' : String(selectedStage);
        let html = '<option value="">全境界</option>';
        for (let i = 0; i < names.length; i++) {
            html += '<option value="' + i + '"' + (selected === String(i) ? ' selected' : '') + '>' + escapeHtml(names[i]) + '</option>';
        }
        return html;
    },

    getStageFilterValue(elementId) {
        const raw = (document.getElementById(elementId)?.value || '').trim();
        if (raw === '') return null;
        const stage = parseInt(raw, 10);
        return Number.isFinite(stage) ? stage : null;
    },

    getItemMinStage(item) {
        const stage = parseInt(item?.minStage ?? item?.requiredStage ?? 0, 10);
        return Number.isFinite(stage) ? stage : 0;
    },

    getStageName(stage) {
        const names = (typeof STAGE_NAMES !== 'undefined')
            ? STAGE_NAMES
            : ['锻体期','练气期','筑基期','金丹期','元婴期','化神期','炼虚期','合道期','大乘期','渡劫期','真仙境','玄仙境','上仙境','天仙境','仙君境','仙王境','仙帝境','仙尊境','仙祖境','圣人境'];
        return names[stage] || (stage + '境');
    },

    getStageMetaHtml(stage) {
        return stage > 0 ? '<span style="color:var(--text-muted);font-size:11px;">需' + this.getStageName(stage) + '+</span>' : '';
    },

    integerInputOptions(min, max) {
        if (typeof dialogIntegerInputOptions === 'function') {
            return dialogIntegerInputOptions(min, max);
        }
        const options = { type: 'number', inputmode: 'numeric', pattern: '[0-9]*', step: 1 };
        if (min !== undefined && min !== null) options.min = min;
        if (max !== undefined && max !== null) options.max = max;
        return options;
    },

    isImmortalPlayer() {
        const p = window._lastPlayerData || {};
        return p.portal === 'immortal' || String(p.currentArea || '').indexOf('immortal_') === 0;
    },

    getAvailableSectContinents() {
        const lowerContinents = [
            { id: 'wanyao', name: '万妖神州' },
            { id: 'youming', name: '幽冥鬼域' },
            { id: 'tianlong', name: '天龙苍境' },
            { id: 'jimo', name: '极魔血渊' },
            { id: 'changsheng', name: '长生大荒' },
            { id: 'hundun', name: '混沌墟土' }
        ];
        const immortalWorlds = [
            { id: 'ix_qingyao', name: '青曜界' },
            { id: 'ix_cangwu', name: '苍梧界' },
            { id: 'ix_xuanchen', name: '玄尘界' },
            { id: 'ix_liuhuo', name: '流火界' },
            { id: 'ix_hanyue', name: '寒月界' }
        ];
        return this.isImmortalPlayer() ? immortalWorlds : lowerContinents;
    },

    getImmortalSectLegacyWarning() {
        return '创建或加入仙界宗门会把你在灵界自建宗门保留的飞升旧照名册记录转为新的仙界宗门身份，原灵界宗门将不再显示该名册记录。';
    },

    getCreateCostText() {
        return this.isImmortalPlayer() ? '5000万' : '500万';
    },

    // ===== 创建宗门弹窗 =====

    showCreateDialog() {
        const continents = this.getAvailableSectContinents();
        const optionsHtml = continents.map(c =>
            `<option value="${c.id}">${c.name}</option>`
        ).join('');
        const locationText = this.isImmortalPlayer() ? '选定的仙界小世界' : '选定的外荒大陆';
        const isImmortal = this.isImmortalPlayer();
        const createCostText = this.getCreateCostText();
        const legacyWarning = isImmortal
            ? '<div style="color:var(--text-orange);font-size:12px;line-height:1.6;margin-bottom:12px;">' + this.getImmortalSectLegacyWarning() + '</div>'
            : '';

        const html = `
            <div style="padding:16px;">
                <p style="color:var(--text-muted);font-size:13px;margin-bottom:12px;">
                    创建宗门需花费 <b style="color:var(--text-gold);">${createCostText}</b> 灵石。
                    宗门将在${locationText}建立据点，弟子战斗与秘境收益的10%将贡献给宗门金库。
                </p>
                ${legacyWarning}
                <div style="margin-bottom:12px;">
                    <label style="display:block;font-size:13px;color:var(--text-secondary);margin-bottom:4px;">宗门名称 (2-8字)</label>
                    <input type="text" id="psectNameInput" class="app-input" style="width:100%;" maxlength="8" placeholder="请输入宗门名称" autocomplete="off">
                </div>
                <div style="margin-bottom:12px;">
                    <label style="display:block;font-size:13px;color:var(--text-secondary);margin-bottom:4px;">选择据点（决定修为加成生效区域，可后续付费搬迁）</label>
                    <select id="psectContinentSelect" class="app-select" style="width:100%;">
                        ${optionsHtml}
                    </select>
                </div>
                <button class="btn-action" onclick="PlayerSectModule.doCreate()" style="width:100%;margin-top:8px;">确认创建</button>
            </div>
        `;
        showGameModal('创建宗门', html);
    },

    async doCreate() {
        const name = document.getElementById('psectNameInput')?.value?.trim();
        const continent = document.getElementById('psectContinentSelect')?.value;
        if (!name || name.length < 2) {
            showToast('宗门名称需要2-8个字');
            return;
        }
        if (!continent) {
            showToast('请选择据点');
            return;
        }

        const createCostText = this.getCreateCostText();
        const warning = this.isImmortalPlayer() ? `\n\n${this.getImmortalSectLegacyWarning()}` : '';
        gameConfirm(`确定花费 ${createCostText} 灵石创建宗门「${name}」吗？创建后金库灵石需通过弟子税收积累。${warning}`, async () => {
            try {
                const res = await api.post('/api/game/player-sect/create', { name, continent });
                if (res.code === 200) {
                    showToast('宗门创建成功!');
                    closeGameModal();
                    SectModule.loadInfo();
                    loadPlayerInfo();
                } else {
                    showToast(res.message || '创建失败', 'error');
                }
            } catch (e) {
                showToast(e.message, 'error');
            }
        });
    },

    // ===== 浏览公开宗门 =====

    _renderBrowseSkeleton(title, bodyHtml, countText) {
        const valueHtml = countText
            ? '<div class="modal-header-deco__value">' +
                '<span class="modal-header-deco__num" style="color:var(--accent-jade);">' + countText.num + '</span>' +
                '<span class="modal-header-deco__unit" style="font-size:14px;"> ' + countText.unit + '</span>' +
              '</div>'
            : '';
        const header = '<div class="modal-header-deco">' +
            '<div class="modal-header-deco__subtitle">宗门引路</div>' +
            '<div class="modal-header-deco__value" style="margin-bottom:4px;">' +
                '<span class="modal-header-deco__num" style="font-size:24px;">' + escapeHtml(title) + '</span>' +
            '</div>' +
            valueHtml +
            '<div style="font-size:12px;color:var(--text-muted);margin-top:6px;">官方九霄宗常驻首位，其后按等级排列自建宗门</div>' +
            '</div>';
        return header + '<div class="modal-body-padded">' + bodyHtml + '</div>';
    },

    async showBrowseDialog() {
        showModal(this._renderBrowseSkeleton('宗门一览',
            '<div style="text-align:center;padding:20px;color:var(--text-muted);">加载中...</div>'
        ), 'modal-overlay--top ui-scrollable-modal');
        try {
            const res = await api.get('/api/game/player-sect/public-list?page=1');
            const list = res.data || [];
            if (list.length === 0) {
                showModal(this._renderBrowseSkeleton('宗门一览',
                    '<div style="text-align:center;padding:20px;color:var(--text-muted);">暂无公开宗门</div>'
                ), 'modal-overlay--top ui-scrollable-modal');
                return;
            }
            // 当前玩家的宗门状态
            const mySystemSectId = (window._lastPlayerData && window._lastPlayerData.sectId) || null;
            const myPlayerSectId = (PlayerSectModule.sectInfo && PlayerSectModule.sectInfo.id) || null;
            const inAnySect = !!mySystemSectId || !!myPlayerSectId;

            const rows = list.map(s => {
                const isSystem = s.kind === 'system';
                const cardCls = isSystem ? 'modal-info-card modal-info-card--jade' : 'modal-info-card';
                const kindBadge = isSystem
                    ? '<span class="sect-kind-badge sect-kind-badge--system">官方</span>'
                    : '<span class="sect-kind-badge sect-kind-badge--player">自建</span>';
                const memberText = isSystem ? '弟子 ' + s.memberCount : '弟子 ' + s.memberCount + '/' + s.maxMembers;
                const thresholdText = isSystem ? '无门槛' : s.minJoinStageName;
                const noticePreview = (s.notice || '').slice(0, 60);
                const noticeHtml = noticePreview
                    ? '<div class="sect-card-notice">公告: ' + escapeHtml(noticePreview) + ((s.notice || '').length > 60 ? '...' : '') + '</div>'
                    : '';
                let joinBtn = '';
                if (!inAnySect) {
                    if (isSystem) {
                        joinBtn = '<button class="modal-btn modal-btn--gold js-apply-system-btn" style="flex:1;height:32px;font-size:12px;">拜入九霄宗</button>';
                    } else {
                        joinBtn = '<button class="modal-btn modal-btn--gold js-apply-join-btn" data-id="' + escapeHtml(s.id) + '" data-name="' + escapeHtml(s.name) + '" style="flex:1;height:32px;font-size:12px;">申请加入</button>';
                    }
                } else {
                    const myKind = mySystemSectId ? '已在九霄宗' : '已在宗门';
                    joinBtn = '<button class="modal-btn modal-btn--outline" disabled style="flex:1;height:32px;font-size:12px;opacity:0.55;">' + myKind + '</button>';
                }
                return '<div class="' + cardCls + ' sect-browse-card">' +
                    '<div class="sect-browse-card__header">' +
                        '<div class="sect-browse-card__title">' +
                            '<span class="sect-browse-card__name">' + escapeHtml(s.name) + '</span>' +
                            '<span class="sect-browse-card__level">Lv.' + s.level + '</span>' +
                            kindBadge +
                        '</div>' +
                        '<span class="sect-browse-card__region">' + escapeHtml(s.continentName) + '</span>' +
                    '</div>' +
                    '<div class="sect-browse-card__meta">' +
                        '<span>宗主 ' + escapeHtml(s.ownerName) + '</span>' +
                        '<span>' + memberText + '</span>' +
                        '<span>' + thresholdText + '</span>' +
                    '</div>' +
                    noticeHtml +
                    '<div class="sect-browse-card__actions">' +
                        '<button class="modal-btn modal-btn--outline js-view-members-btn" data-id="' + escapeHtml(s.id) + '" data-name="' + escapeHtml(s.name) + '" style="flex:1;height:32px;font-size:12px;">查看成员</button>' +
                        joinBtn +
                    '</div>' +
                '</div>';
            }).join('');

            showModal(this._renderBrowseSkeleton('宗门一览', rows, { num: list.length, unit: '座宗门' }), 'modal-overlay--top ui-scrollable-modal');

            document.querySelectorAll('.js-apply-join-btn').forEach(btn => {
                btn.onclick = function() {
                    var sid = this.getAttribute('data-id');
                    var sname = this.getAttribute('data-name');
                    PlayerSectModule.applyJoin(sid, sname);
                };
            });
            document.querySelectorAll('.js-apply-system-btn').forEach(btn => {
                btn.onclick = function() {
                    closeModal();
                    if (typeof SectModule !== 'undefined' && typeof SectModule.joinSect === 'function') {
                        SectModule.joinSect();
                    }
                };
            });
            document.querySelectorAll('.js-view-members-btn').forEach(btn => {
                btn.onclick = function() {
                    var sid = this.getAttribute('data-id');
                    var sname = this.getAttribute('data-name');
                    PlayerSectModule.showPublicMembers(sid, sname);
                };
            });
        } catch (e) {
            showToast(e.message, 'error');
        }
    },

    async applyJoin(sectId, sectName) {
        const warning = this.isImmortalPlayer() ? `\n\n${this.getImmortalSectLegacyWarning()}` : '';
        gameConfirm(`确定申请加入「${sectName}」吗？${warning}`, async () => {
            try {
                const res = await api.post('/api/game/player-sect/apply', { sectId });
                if (res.code === 200) {
                    showToast(res.data || '申请已提交');
                    closeGameModal();
                } else {
                    showToast(res.message || '申请失败', 'error');
                }
            } catch (e) {
                showToast(e.message, 'error');
            }
        });
    },

    // ===== 自建宗门主面板 =====

    canViewSectLogs() {
        const role = this.sectInfo && this.sectInfo.myRole;
        return role === 'MASTER' || role === 'ELDER' || (this.sectInfo && this.sectInfo.logPublic === true);
    },

    async loadAndRenderLogs() {
        const container = document.getElementById('psectLogsContainer');
        if (!container) return;
        if (!this.canViewSectLogs()) {
            container.innerHTML = '<div style="color:var(--text-muted);text-align:center;font-size:12px;padding:10px;">宗门历程尚未公开</div>';
            return;
        }
        try {
            const res = await api.get('/api/game/player-sect/list-logs');
            if (res.code === 200 && res.data) {
                if (res.data.length === 0) {
                    container.innerHTML = '<div style="color:var(--text-muted);text-align:center;font-size:12px;padding:10px;">暂无日志</div>';
                    return;
                }
                let logsHtml = '';
                for (const log of res.data) {
                    const timeStr = new Date(log.createdAt).toLocaleString('zh-CN', {month:'numeric', day:'numeric', hour:'numeric', minute:'numeric'});
                    logsHtml += `
                        <div style="font-size:12px; margin-bottom:4px; padding-bottom:4px; border-bottom:1px dashed var(--border-color);">
                            <span style="color:var(--text-muted);">[${timeStr}]</span>
                            <span style="color:var(--text-info);">${escapeHtml(log.playerName)}</span>
                            <span style="color:var(--text-color);">${escapeHtml(log.content)}</span>
                        </div>
                    `;
                }
                container.innerHTML = logsHtml;
            }
        } catch (e) {
            container.innerHTML = '<div style="color:var(--text-danger);text-align:center;font-size:12px;padding:10px;">读取失败</div>';
        }
    },

    _logsHistoryState: { category: 'donate', page: 0, pageSize: 20, query: '' },
    _logsHistorySearchTimer: null,

    showLogsHistory(category) {
        if (!this.canViewSectLogs()) {
            showToast('宗门历程尚未公开', 'error');
            return;
        }
        this._logsHistoryState = { category: category || 'donate', page: 0, pageSize: 20, query: '' };
        const body = `
            <div style="display:flex;gap:8px;">
                <button id="psectLogsTabDonate" class="modal-action-btn" style="justify-content:center;" onclick="PlayerSectModule.switchLogsHistoryTab('donate')">捐献记录</button>
                <button id="psectLogsTabClaim" class="modal-action-btn" style="justify-content:center;" onclick="PlayerSectModule.switchLogsHistoryTab('claim')">领取记录</button>
                <button id="psectLogsTabExtract" class="modal-action-btn" style="justify-content:center;" onclick="PlayerSectModule.switchLogsHistoryTab('extract')">提取记录</button>
            </div>
            <div style="display:flex;gap:8px;margin-top:10px;">
                <input type="text" id="psectLogsHistorySearch" class="app-input" placeholder="搜索人物名、物品或关键词..." style="flex:1;" maxlength="50" oninput="PlayerSectModule.onLogsHistorySearchInput(this.value)">
                <button class="modal-btn modal-btn--outline" style="flex:0 0 auto;padding:0 12px;font-size:12px;" onclick="PlayerSectModule.clearLogsHistorySearch()">清空</button>
            </div>
            <div class="modal-info-card">
                <div class="modal-info-card__title modal-info-card__title--jade">✦ 流水记录</div>
                <div id="psectLogsHistoryList" class="modal-feat-list" style="min-height:200px;max-height:50vh;overflow-y:auto;">
                    <div style="color:var(--text-muted);text-align:center;font-size:12px;padding:10px;">读取中...</div>
                </div>
            </div>
            <div id="psectLogsHistoryPager" style="display:flex;gap:10px;margin-top:16px;align-items:center;"></div>
        `;
        this._openDecoratedModal('宗门历史档案', body);
        this._refreshLogsHistoryTab();
        this._loadLogsHistoryPage();
    },

    onLogsHistorySearchInput(value) {
        if (this._logsHistorySearchTimer) clearTimeout(this._logsHistorySearchTimer);
        this._logsHistorySearchTimer = setTimeout(() => {
            this._logsHistoryState.query = (value || '').trim();
            this._logsHistoryState.page = 0;
            this._loadLogsHistoryPage();
        }, 200);
    },

    clearLogsHistorySearch() {
        if (this._logsHistorySearchTimer) clearTimeout(this._logsHistorySearchTimer);
        const input = document.getElementById('psectLogsHistorySearch');
        if (input) input.value = '';
        this._logsHistoryState.query = '';
        this._logsHistoryState.page = 0;
        this._loadLogsHistoryPage();
    },

    async toggleSectLogPublic() {
        const current = this.sectInfo.logPublic === true;
        const next = !current;
        const label = next ? '公开' : '收起';
        const hint = next
            ? '公开后，普通弟子也能查看宗门动态与历史档案。'
            : '收起后，仅宗主和长老可查看宗门动态与历史档案。';
        gameConfirm(
            `<p>确定${label}宗门历程？</p><p style="font-size:12px;color:var(--text-muted);margin-top:8px;">${hint}</p>`,
            async () => {
                try {
                    const res = await api.post('/api/game/player-sect/set-log-public', { enabled: next });
                    if (res.code === 200) {
                        showToast(res.data || (next ? '已公开宗门历程' : '已仅管理可见'));
                        this.sectInfo.logPublic = next;
                        await this.loadPlayerSectInfo();
                        SectModule.loadInfo();
                    } else {
                        showToast(res.message || '操作失败', 'error');
                    }
                } catch (e) { showToast(e.message, 'error'); }
            },
            null,
            true
        );
    },

    switchLogsHistoryTab(category) {
        if (this._logsHistoryState.category === category) return;
        this._logsHistoryState.category = category;
        this._logsHistoryState.page = 0;
        this._refreshLogsHistoryTab();
        this._loadLogsHistoryPage();
    },

    _refreshLogsHistoryTab() {
        const cur = this._logsHistoryState.category;
        const donate = document.getElementById('psectLogsTabDonate');
        const claim = document.getElementById('psectLogsTabClaim');
        const extract = document.getElementById('psectLogsTabExtract');
        if (donate) donate.classList.toggle('modal-action-btn--orange', cur === 'donate');
        if (claim) claim.classList.toggle('modal-action-btn--orange', cur === 'claim');
        if (extract) extract.classList.toggle('modal-action-btn--orange', cur === 'extract');
    },

    async _loadLogsHistoryPage() {
        const list = document.getElementById('psectLogsHistoryList');
        const pager = document.getElementById('psectLogsHistoryPager');
        if (!list) return;
        list.innerHTML = '<div style="color:var(--text-muted);text-align:center;font-size:12px;padding:10px;">读取中...</div>';
        if (pager) pager.innerHTML = '';
        const { category, page, pageSize, query } = this._logsHistoryState;
        const offset = page * pageSize;
        try {
            const params = new URLSearchParams({
                category: category,
                offset: String(offset),
                limit: String(pageSize)
            });
            if (query) params.set('q', query);
            const res = await api.get(`/api/game/player-sect/list-logs-page?${params.toString()}`);
            if (res.code !== 200 || !res.data) {
                list.innerHTML = '<div style="color:var(--text-danger);text-align:center;font-size:12px;padding:10px;">读取失败</div>';
                return;
            }
            const logs = res.data.logs || [];
            const hasMore = !!res.data.hasMore;
            const iconClass = category === 'donate' ? 'modal-feat-icon--jade'
                : (category === 'extract' ? 'modal-feat-icon--purple' : 'modal-feat-icon--orange');
            if (logs.length === 0 && page === 0) {
                const emptyText = query ? '未找到匹配记录' : '暂无记录';
                list.innerHTML = `<div style="color:var(--text-muted);text-align:center;font-size:12px;padding:20px;">${emptyText}</div>`;
            } else if (logs.length === 0) {
                list.innerHTML = '<div style="color:var(--text-muted);text-align:center;font-size:12px;padding:20px;">已无更多记录</div>';
            } else {
                let html = '';
                for (const log of logs) {
                    const timeStr = new Date(log.createdAt).toLocaleString('zh-CN', { month:'numeric', day:'numeric', hour:'numeric', minute:'numeric' });
                    html += `
                        <div class="modal-feat-row">
                            <span class="modal-feat-icon ${iconClass}">✦</span>
                            <span style="flex:1;">
                                <span style="color:var(--text-muted);">[${timeStr}]</span>
                                <span style="color:var(--text-info);">${escapeHtml(log.playerName)}</span>
                                <span style="color:var(--text-color);">${escapeHtml(log.content)}</span>
                            </span>
                        </div>
                    `;
                }
                list.innerHTML = html;
            }
            if (pager) {
                const prevDisabled = page <= 0;
                pager.innerHTML = `
                    <button class="modal-btn modal-btn--outline" style="flex:1;" ${prevDisabled ? 'disabled' : ''} onclick="PlayerSectModule._gotoLogsHistoryPage(-1)">上一页</button>
                    <span style="color:var(--text-muted);font-size:12px;flex:0 0 auto;">第 ${page + 1} 页</span>
                    <button class="modal-btn modal-btn--outline" style="flex:1;" ${!hasMore ? 'disabled' : ''} onclick="PlayerSectModule._gotoLogsHistoryPage(1)">下一页</button>
                `;
            }
        } catch (e) {
            list.innerHTML = '<div style="color:var(--text-danger);text-align:center;font-size:12px;padding:10px;">读取失败</div>';
        }
    },

    _gotoLogsHistoryPage(delta) {
        const next = this._logsHistoryState.page + delta;
        if (next < 0) return;
        this._logsHistoryState.page = next;
        this._loadLogsHistoryPage();
    },

    async loadPlayerSectInfo() {
        try {
            const res = await api.get('/api/game/player-sect/info');
            const data = res.data;
            if (!data || !data.id) return false;
            this.sectInfo = data;
            this._setApplicationBadge(data.pendingApplicationCount || 0);
            this._setExchangeRequestBadge(data.pendingExchangeRequestCount || 0);
            return true;
        } catch (e) {
            return false;
        }
    },

    _farmBadgeTimer: null,
    _farmBadgeCount: 0,
    _pendingApplicationCount: 0,
    _pendingExchangeRequestCount: 0,
    startFarmBadgePolling() {
        this.stopFarmBadgePolling();
        this.loadFarmBadge();
        this._farmBadgeTimer = setInterval(() => this.loadFarmBadge(), 60000);
    },
    stopFarmBadgePolling() {
        if (this._farmBadgeTimer) { clearInterval(this._farmBadgeTimer); this._farmBadgeTimer = null; }
    },
    async loadFarmBadge() {
        try {
            const res = await api.get('/api/game/player-sect/farm/badge');
            if (res.code !== 200 || !res.data) return;
            const count = res.data.count || 0;
            const applicationCount = res.data.applicationCount || 0;
            const exchangeRequestCount = res.data.pendingExchangeRequestCount || 0;
            const text = count > 9 ? '9+' : count;
            this._farmBadgeCount = count;
            const badge = document.getElementById('sectFarmBadge');
            if (badge) {
                if (count > 0) { badge.textContent = text; badge.classList.remove('hidden'); }
                else { badge.classList.add('hidden'); }
            }
            this._setApplicationBadge(applicationCount);
            this._setExchangeRequestBadge(exchangeRequestCount);
        } catch (e) {}
    },

    _setApplicationBadge(count) {
        count = Math.max(0, parseInt(count || 0, 10) || 0);
        this._pendingApplicationCount = count;
        if (this.sectInfo) this.sectInfo.pendingApplicationCount = count;
        const text = count > 9 ? '9+' : count;
        document.querySelectorAll('.js-psect-application-badge').forEach(badge => {
            if (count > 0) {
                badge.textContent = text;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        });
        this._updateSectNavBadge();
    },

    _setExchangeRequestBadge(count) {
        count = Math.max(0, parseInt(count || 0, 10) || 0);
        this._pendingExchangeRequestCount = count;
        if (this.sectInfo) this.sectInfo.pendingExchangeRequestCount = count;
        const text = count > 9 ? '9+' : count;
        document.querySelectorAll('.js-psect-exchange-badge').forEach(badge => {
            if (count > 0) {
                badge.textContent = text;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        });
        this._updateSectNavBadge();
    },

    _updateSectNavBadge() {
        const sectBadgeD = document.getElementById('sectBadgeDesktop');
        const sectBadgeM = document.getElementById('sectBadgeMobile');
        const hasOfficial = (window._lastPlayerData && window._lastPlayerData.hasMatureCrops);
        const totalCount = (this._farmBadgeCount || 0) + (this._pendingApplicationCount || 0) + (this._pendingExchangeRequestCount || 0);
        const totalText = totalCount > 9 ? '9+' : totalCount;
        if (totalCount > 0 && !hasOfficial) {
            if (sectBadgeD) { sectBadgeD.textContent = totalText; sectBadgeD.classList.remove('hidden'); }
            if (sectBadgeM) { sectBadgeM.textContent = totalText; sectBadgeM.classList.remove('hidden'); }
        } else if (!hasOfficial) {
            if (sectBadgeD) sectBadgeD.classList.add('hidden');
            if (sectBadgeM) sectBadgeM.classList.add('hidden');
        }
    },

    renderPlayerSectView(data) {
        this.sectInfo = data;
        const isOwner = data.myRole === 'MASTER';
        const isManage = data.myRole === 'MASTER' || data.myRole === 'ELDER';
        const pendingApplicationCount = data.pendingApplicationCount || 0;
        const pendingApplicationText = pendingApplicationCount > 9 ? '9+' : pendingApplicationCount;
        const pendingExchangeRequestCount = data.pendingExchangeRequestCount || 0;
        const pendingExchangeRequestText = pendingExchangeRequestCount > 9 ? '9+' : pendingExchangeRequestCount;
        this._pendingApplicationCount = pendingApplicationCount;
        this._pendingExchangeRequestCount = pendingExchangeRequestCount;
        this._updateSectNavBadge();

        const roleMap = { 'MASTER': '宗主', 'ELDER': '长老', 'DISCIPLE': '弟子', 'ASCENDED': '已飞升' };
        const upgradeInfo = this.getUpgradeInfo(data.level);

        let overviewHtml = `
            <div class="court-card">
                <div class="sect-info-header">
                    <h4 class="sect-name">${escapeHtml(data.name)}</h4>
                    <span class="sect-level-badge">Lv.${data.level}</span>
                </div>
                <div class="psect-stats-grid">
                    <div class="psect-stat-card">
                        <span class="psect-stat-label">职位</span>
                        <span class="psect-stat-val">${roleMap[data.myRole] || data.myRole}</span>
                    </div>
                    <div class="psect-stat-card">
                        <span class="psect-stat-label">可用贡献</span>
                        <span class="psect-stat-val psect-val-info">${data.myAvailableContribution}</span>
                    </div>
                    <div class="psect-stat-card">
                        <span class="psect-stat-label">成员</span>
                        <span class="psect-stat-val">${data.memberCount} / ${data.maxMembers}</span>
                    </div>
                    <div class="psect-stat-card">
                        <span class="psect-stat-label">总部</span>
                        <span class="psect-stat-val">${data.continentName}</span>
                    </div>
                    <div class="psect-stat-card">
                        <span class="psect-stat-label">灵脉</span>
                        <span class="psect-stat-val ${data.spiritVeinActiveHere ? 'psect-val-info' : ''}">Lv.${data.spiritVeinLevel || 0} · ${escapeHtml(data.spiritVeinName || '未启脉')}</span>
                    </div>
                    <div class="psect-stat-card psect-stat-wide">
                        <span class="psect-stat-label">金库</span>
                        <span class="psect-stat-val psect-val-gold">${data.treasury} 灵石</span>
                    </div>
                </div>
            </div>

            <div class="court-card">
                <div class="court-card-header">-- 宗门公告 --</div>
                <p class="sect-notice-text">${escapeHtml(data.notice || '无公告')}</p>
                ${isManage ? `
                <div style="margin-top:10px;">
                    <textarea id="psectNoticeInput" class="app-input" style="width:100%;height:60px;" placeholder="输入新的宗门公告...">${data.notice || ''}</textarea>
                    <button class="btn-action" onclick="PlayerSectModule.updateNotice()" style="width:100%;margin-top:8px;">发布公告</button>
                </div>
                ` : ''}
            </div>
        `;

        if (this.canViewSectLogs()) {
            var logPublicText = this.sectInfo.logPublic === true ? '已公开' : '公开';
            overviewHtml += `
            <div class="court-card">
                <div class="court-card-header" style="display:flex;align-items:center;justify-content:space-between;">
                    <span>-- 宗门动态 --</span>
                    <div style="display:flex;gap:4px;">
                        ${this.sectInfo.myRole === 'MASTER' ? `<button class="btn-action" onclick="PlayerSectModule.toggleSectLogPublic()" style="padding:2px 8px;font-size:11px;${this.sectInfo.logPublic === true ? '' : 'color:var(--text-muted);'}" title="宗门历程公开开关">${logPublicText}</button>` : ''}
                        <button class="btn-action" onclick="PlayerSectModule.showLogsHistory('donate')" style="padding:2px 8px;font-size:11px;">历史档案</button>
                    </div>
                </div>
                <div id="psectLogsContainer" class="psect-logs-box">
                    <div style="color:var(--text-muted);text-align:center;font-size:12px;padding:10px;">读取中...</div>
                </div>
            </div>
            `;
        }

        let facilityHtml = `
        <div class="court-card">
            <div class="court-card-header">-- 宗门设施 --</div>
            <div class="psect-facility-grid">
                <button class="btn-action psect-facility-btn" onclick="PlayerSectModule.showMembers()">
                    <span class="psect-facility-icon" style="color:var(--accent-jade);">[册]</span>弟子名册
                </button>
                <button class="btn-action psect-facility-btn" onclick="PlayerSectModule.showWarehouse()" style="position:relative">
                    <span class="psect-facility-icon" style="color:var(--text-gold);">[库]</span>宗门仓库
                    <span class="friend-btn-badge js-psect-exchange-badge ${pendingExchangeRequestCount > 0 ? '' : 'hidden'}">${pendingExchangeRequestText}</span>
                </button>
                <button class="btn-action psect-facility-btn" onclick="PlayerSectModule.showBuiltinShop()">
                    <span class="psect-facility-icon" style="color:var(--accent-purple);">[铺]</span>宗门商铺
                </button>
                <button class="btn-action psect-facility-btn" onclick="PlayerSectModule.showTasks()">
                    <span class="psect-facility-icon" style="color:var(--text-info);">[赏]</span>宗门悬赏
                </button>
                <button class="btn-action psect-facility-btn" onclick="PlayerSectModule.showFarm()" style="position:relative">
                    <span class="psect-facility-icon" style="color:var(--accent-jade);">[田]</span>宗门灵田
                    <span class="friend-btn-badge hidden" id="sectFarmBadge"></span>
                </button>
                <button class="btn-action psect-facility-btn" onclick="PlayerSectModule.showSpiritVein()">
                    <span class="psect-facility-icon" style="color:var(--text-info);">[脉]</span>宗门灵脉
                </button>
                <button class="btn-action psect-facility-btn" onclick="PlayerSectModule.quickDonate()">
                    <span class="psect-facility-icon" style="color:var(--text-success);">[捐]</span>捐献物资
                </button>
                <button class="btn-action psect-facility-btn" onclick="PlayerSectModule.donateStone()">
                    <span class="psect-facility-icon" style="color:var(--text-purple);">[献]</span>捐献灵石
                </button>
                <button class="btn-action psect-facility-btn" onclick="PlayerSectModule.showSectArt()">
                    <span class="psect-facility-icon" style="color:var(--accent-gold);">[法]</span>镇派功法
                </button>
            </div>
            <button class="btn-action" onclick="PlayerSectModule.showBrowseDialog()" style="width:100%;margin-top:10px;">宗门一览</button>
            <button class="btn-action" onclick="showSectPowerRankingModal()" style="width:100%;margin-top:8px;background:rgba(201,153,58,0.12);color:var(--text-gold);border:1px solid var(--text-gold);">宗门战力排行榜</button>
        </div>
        `;

        let manageHtml = '';
        if (isManage) {
            manageHtml += `
            <div class="court-card">
                <div class="court-card-header">-- 宗门管理 --</div>
                <div class="psect-facility-grid">
                    <button class="btn-action psect-facility-btn" onclick="PlayerSectModule.showApplications()" style="position:relative">审批申请<span class="friend-btn-badge js-psect-application-badge ${pendingApplicationCount > 0 ? '' : 'hidden'}">${pendingApplicationText}</span></button>
                    ${isOwner ? `<button class="btn-action psect-facility-btn" onclick="PlayerSectModule.showRenameDialog()">宗门改名</button>` : ''}
                    ${isOwner ? `<button class="btn-action psect-facility-btn" onclick="PlayerSectModule.showRelocateDialog()">搬迁据点</button>` : ''}
                </div>
            </div>
            `;
        }

        if (isOwner) {
            manageHtml += `
            <div class="court-card">
                <div class="court-card-header">-- 金库管理 --</div>
                <div style="margin-bottom:10px;">
                    <label class="psect-field-label">提取灵石 (每周限额: 金库余额的20%)</label>
                    <div style="display:flex;gap:8px;">
                        <input type="number" id="psectWithdrawAmt" class="app-input" style="flex:1;" min="1" placeholder="金额">
                        <button class="btn-action" onclick="PlayerSectModule.withdraw()">提取</button>
                    </div>
                </div>
                ${upgradeInfo ? `
                <button class="btn-action" onclick="PlayerSectModule.upgrade()" style="width:100%;margin-top:8px;">
                    升级宗门 (Lv.${data.level + 1} 需 ${upgradeInfo} 灵石)
                </button>
                ` : ''}
                ${isOwner ? `
                <button class="btn-action psect-expand-slots-btn" onclick="PlayerSectModule.expandSlots()">
                    扩容名额 (第${(data.extraSlots || 0) + 1}个 · 需 ${PlayerSectModule.getExpandCost(data.extraSlots || 0)} 灵石)
                </button>
                ` : ''}
                <div style="border-top:1px dashed var(--border-color);margin-top:14px;padding-top:14px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                        <span style="font-size:13px;color:var(--text-gold);">宗门老祖护道 (每次扣除 ${data.rescueCost} 可用贡献)</span>
                        <select id="psectRescueSelect" class="app-select" style="width:80px;" onchange="PlayerSectModule.toggleRescue(this.value)">
                            <option value="true" ${data.isRescueEnabled?'selected':''}>开启</option>
                            <option value="false" ${!data.isRescueEnabled?'selected':''}>关闭</option>
                        </select>
                    </div>
                    <div style="display:flex;gap:8px;">
                        <input type="number" id="psectRescueCostVal" class="app-input" style="flex:1;" min="500" max="20000" placeholder="护道消耗 (500~20,000)" value="${data.rescueCost}">
                        <button class="btn-action" onclick="PlayerSectModule.setRescueCost()">修改消耗</button>
                    </div>
                </div>
            </div>
            `;
        }

        if (isManage) {
            manageHtml += `
            <div class="court-card">
                <div class="court-card-header">-- 设置管理门槛 --</div>
                <div style="margin-bottom:12px;">
                    <label class="psect-field-label">入宗境界门槛</label>
                    <div style="display:flex;gap:8px;">
                        <select id="psectThresholdSelect" class="app-select" style="flex:1;">
                            <option value="0" ${data.minJoinStage===0?'selected':''}>无限制</option>
                            <option value="1" ${data.minJoinStage===1?'selected':''}>练气期</option>
                            <option value="2" ${data.minJoinStage===2?'selected':''}>筑基期</option>
                            <option value="3" ${data.minJoinStage===3?'selected':''}>金丹期</option>
                            <option value="4" ${data.minJoinStage===4?'selected':''}>元婴期</option>
                            <option value="5" ${data.minJoinStage===5?'selected':''}>化神期</option>
                            <option value="6" ${data.minJoinStage===6?'selected':''}>炼虚期</option>
                            <option value="7" ${data.minJoinStage===7?'selected':''}>合道期</option>
                        </select>
                        <button class="btn-action" onclick="PlayerSectModule.setThreshold()">设置</button>
                    </div>
                </div>
                <div style="margin-bottom:12px;">
                    <label class="psect-field-label">最低允许捐献品质</label>
                    <div style="display:flex;gap:8px;">
                        <select id="psectDonateThresholdSelect" class="app-select" style="flex:1;">
                            <option value="0" ${data.minDonateRarity===0?'selected':''}>全部允许</option>
                            <option value="1" ${data.minDonateRarity===1?'selected':''}>凡品及以上</option>
                            <option value="2" ${data.minDonateRarity===2?'selected':''}>优良及以上</option>
                            <option value="3" ${data.minDonateRarity===3?'selected':''}>稀有及以上</option>
                            <option value="4" ${data.minDonateRarity===4?'selected':''}>史诗及以上</option>
                            <option value="5" ${data.minDonateRarity===5?'selected':''}>传说及以上</option>
                        </select>
                        <button class="btn-action" onclick="PlayerSectModule.setDonateThreshold()">设置</button>
                    </div>
                </div>
                <div style="margin-bottom:12px;">
                    <label class="psect-field-label">最低兑换境界</label>
                    <div style="display:flex;gap:8px;">
                        <select id="psectExchangeThresholdSelect" class="app-select" style="flex:1;">
                            <option value="0" ${data.minExchangeStage===0?'selected':''}>无限制</option>
                            <option value="1" ${data.minExchangeStage===1?'selected':''}>练气期</option>
                            <option value="2" ${data.minExchangeStage===2?'selected':''}>筑基期</option>
                            <option value="3" ${data.minExchangeStage===3?'selected':''}>金丹期</option>
                            <option value="4" ${data.minExchangeStage===4?'selected':''}>元婴期</option>
                            <option value="5" ${data.minExchangeStage===5?'selected':''}>化神期</option>
                            <option value="6" ${data.minExchangeStage===6?'selected':''}>炼虚期</option>
                            <option value="7" ${data.minExchangeStage===7?'selected':''}>合道期</option>
                        </select>
                        <button class="btn-action" onclick="PlayerSectModule.setExchangeThreshold()">设置</button>
                    </div>
                </div>
                <div style="margin-bottom:12px;">
                    <label class="psect-field-label">兑换审批门槛</label>
                    <div style="display:flex;gap:8px;">
                        <select id="psectExchangeApprovalSelect" class="app-select" style="flex:1;">
                            <option value="99" ${(data.exchangeApprovalRarity||99)>=99?'selected':''}>不审批(默认)</option>
                            <option value="5" ${data.exchangeApprovalRarity===5?'selected':''}>传说及以上需审批</option>
                            <option value="4" ${data.exchangeApprovalRarity===4?'selected':''}>史诗及以上需审批</option>
                            <option value="3" ${data.exchangeApprovalRarity===3?'selected':''}>稀有及以上需审批</option>
                            <option value="2" ${data.exchangeApprovalRarity===2?'selected':''}>优良及以上需审批</option>
                            <option value="1" ${data.exchangeApprovalRarity===1?'selected':''}>全部兑换需审批</option>
                        </select>
                        <button class="btn-action" onclick="PlayerSectModule.setExchangeApprovalRarity()">设置</button>
                    </div>
                    <p style="font-size:10px;color:var(--text-muted);margin-top:4px;">默认关闭审批，开启后达到门槛的兑换需长老确认。</p>
                </div>
                <div>
                    <label class="psect-field-label">禁止捐献的物品类型</label>
                    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
                        ${[
                            {val:'weapon',label:'武器'},{val:'armor',label:'防具'},{val:'accessory',label:'饰品'},
                            {val:'furnace',label:'炼丹炉'},{val:'pill',label:'丹药'},{val:'material',label:'材料'},
                            {val:'fragment',label:'碎片'},{val:'talisman',label:'符箓'},{val:'misc',label:'杂物'}
                        ].map(t => {
                            const blockedTypes = (data.blockedDonateTypes || '').split(',').filter(Boolean);
                            const checked = blockedTypes.includes(t.val);
                            return `<label class="psect-checkbox-label${checked?' psect-checkbox-checked':''}"><input type="checkbox" class="psectDonateTypeCheck" value="${t.val}" ${checked?'checked':''}>${t.label}</label>`;
                        }).join('\n                        ')}
                    </div>
                    <button class="btn-action" onclick="PlayerSectModule.setBlockedDonateTypes()" style="width:100%;font-size:12px;">保存类型设置</button>
                    <p style="font-size:10px;color:var(--text-muted);margin-top:6px;">勾选的类型将被禁止捐献入仓。默认全部允许。</p>
                </div>
            </div>
            `;
        }

        const dangerAction = isOwner
            ? `<button class="btn-action btn-danger" onclick="PlayerSectModule.disbandSect()" style="width:100%;margin-top:16px;">解散宗门</button>`
            : `<button class="btn-action btn-danger" onclick="PlayerSectModule.leaveSect()" style="width:100%;margin-top:16px;">退出宗门</button>`;
        if (isManage) {
            manageHtml += dangerAction;
        } else {
            overviewHtml += dangerAction;
        }

        const tabs = [
            { key: 'overview', label: '概览', html: overviewHtml },
            { key: 'facility', label: '设施', html: facilityHtml }
        ];
        if (manageHtml.trim()) tabs.push({ key: 'manage', label: '管理', html: manageHtml });
        if (!this._homeActiveTab || !tabs.some(t => t.key === this._homeActiveTab)) {
            this._homeActiveTab = tabs[0].key;
        }

        let html = `<div class="psect-home">
            <div class="psect-home-tabs" role="tablist">
                ${tabs.map(t => `
                    <button type="button" class="psect-home-tab${t.key === this._homeActiveTab ? ' psect-home-tab--active' : ''}" role="tab" data-psect-home-tab="${t.key}" aria-selected="${t.key === this._homeActiveTab ? 'true' : 'false'}" onclick="PlayerSectModule.switchHomeTab('${t.key}')">${t.label}</button>
                `).join('')}
            </div>
            <div class="psect-home-panels">
                ${tabs.map(t => `
                    <div class="psect-home-panel${t.key === this._homeActiveTab ? ' psect-home-panel--active' : ''}" data-psect-home-panel="${t.key}">
                        ${t.html}
                    </div>
                `).join('')}
            </div>
        `;

        if (this.canViewSectLogs()) {
            setTimeout(() => PlayerSectModule.loadAndRenderLogs(), 50);
        }
        this.startFarmBadgePolling();

        html += `</div>`;
        return html;
    },

    _homeActiveTab: 'overview',
    switchHomeTab(tabKey) {
        this._homeActiveTab = tabKey || 'overview';
        document.querySelectorAll('.psect-home-tab').forEach(btn => {
            const active = btn.dataset.psectHomeTab === this._homeActiveTab;
            btn.classList.toggle('psect-home-tab--active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        document.querySelectorAll('.psect-home-panel').forEach(panel => {
            panel.classList.toggle('psect-home-panel--active', panel.dataset.psectHomePanel === this._homeActiveTab);
        });
    },

    getUpgradeInfo(level) {
        const costs = { 2: 1000000, 3: 5000000, 4: 20000000, 5: 50000000 };
        return costs[level + 1] || null;
    },

    getExpandCost(currentExtra) {
        return 500000;
    },

    formatStone(n) {
        if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿';
        if (n >= 10000) return (n / 10000).toFixed(0) + '万';
        return n.toLocaleString();
    },

    canManageSpiritVein() {
        return sectHasPerm(this.sectInfo?.myRole, this.sectInfo?.myPermissions || 0, SECT_PERMS.MANAGE_FARM);
    },

    // ===== 操作方法 =====

    async toggleRescue(val) {
        try {
            const enabled = val === 'true';
            const res = await api.post('/api/game/player-sect/toggle-rescue', { enabled });
            if (res.code === 200) {
                showToast('护道设置已更新');
            } else {
                showToast(res.message || '更新失败', 'error');
            }
        } catch (e) {
            showToast('网络异常', 'error');
        }
    },

    async setRescueCost() {
        const costInput = document.getElementById('psectRescueCostVal');
        if (!costInput) return;
        const val = parseInt(costInput.value);
        if (isNaN(val) || val < 500 || val > 20000) {
            showToast('请输入 500 到 20,000 之间的数值', 'error');
            return;
        }
        
        try {
            const res = await api.post('/api/game/player-sect/set-rescue-cost', { cost: val });
            if (res.code === 200) {
                showToast('护道消耗已修改成功');
                this.loadPlayerSectInfo();
            } else {
                showToast(res.message || '更新失败', 'error');
            }
        } catch (e) {
            showToast('网络异常', 'error');
        }
    },

    async setThreshold() {
        const select = document.getElementById('psectThresholdSelect');
        if (!select) return;
        const val = parseInt(select.value, 10);
        try {
            const res = await api.post('/api/game/player-sect/set-threshold', { minStage: val });
            if (res.code === 200) {
                showToast('入宗门槛设置成功');
                this.loadPlayerSectInfo();
            } else {
                showToast(res.message || '更新失败', 'error');
            }
        } catch (e) {
            showToast('网络异常', 'error');
        }
    },

    async setDonateThreshold() {
        const select = document.getElementById('psectDonateThresholdSelect');
        if (!select) return;
        const val = parseInt(select.value, 10);
        try {
            const res = await api.post('/api/game/player-sect/set-donate-threshold', { minRarity: val });
            if (res.code === 200) {
                showToast('捐献门槛设置成功');
                this.loadPlayerSectInfo();
            } else {
                showToast(res.message || '更新失败', 'error');
            }
        } catch (e) {
            showToast('网络异常', 'error');
        }
    },

    async setExchangeThreshold() {
        const select = document.getElementById('psectExchangeThresholdSelect');
        if (!select) return;
        const val = parseInt(select.value, 10);
        try {
            const res = await api.post('/api/game/player-sect/set-exchange-threshold', { minStage: val });
            if (res.code === 200) {
                showToast('兑换境界设置成功');
                this.loadPlayerSectInfo();
            } else {
                showToast(res.message || '更新失败', 'error');
            }
        } catch (e) {
            showToast('网络异常', 'error');
        }
    },

    async setExchangeApprovalRarity() {
        const select = document.getElementById('psectExchangeApprovalSelect');
        if (!select) return;
        const val = parseInt(select.value, 10);
        try {
            const res = await api.post('/api/game/player-sect/set-exchange-approval-rarity', { minRarity: val });
            if (res.code === 200) {
                showToast(val >= 99 ? '已关闭审批' : '审批门槛设置成功');
                this.loadPlayerSectInfo();
            } else {
                showToast(res.message || '更新失败', 'error');
            }
        } catch (e) {
            showToast('网络异常', 'error');
        }
    },

    async setBlockedDonateTypes() {
        const checks = document.querySelectorAll('.psectDonateTypeCheck');
        const blocked = [];
        checks.forEach(c => { if (c.checked) blocked.push(c.value); });
        try {
            const res = await api.post('/api/game/player-sect/set-blocked-donate-types', { types: blocked });
            if (res.code === 200) {
                showToast('类型设置成功');
                this.loadPlayerSectInfo();
            } else {
                showToast(res.message || '更新失败', 'error');
            }
        } catch (e) {
            showToast('网络异常', 'error');
        }
    },

    // ===== 状态数据 =====
    warehouseCache: [],
    warehouseFilter: 'all',
    warehouseSort: 'default',
    warehouseStageFilter: null,
    warehouseSearchTimer: null,
    // 批量提取（仅有 EXTRACT_ITEM 权限者可见）
    warehouseBatchMode: false,
    warehouseBatchSelected: null, // Set<itemId> ：null 表示尚未初始化

    async showWarehouse() {
        try {
            const res = await api.get('/api/game/player-sect/warehouse');
            if (res.code === 200) {
                this.warehouseCache = res.data || [];
                const isModalOpen = document.getElementById('psectWarehouseList') != null;
                if (!isModalOpen) {
                    this.renderWarehouseSkeleton();
                    // 重建骨架后同步高亮到当前筛选
                    this.highlightWarehouseTab();
                }
                this.renderWarehouseItems();
            } else {
                showToast(res.message);
            }
        } catch(e) {
            showToast('网络异常');
        }
    },

    renderWarehouseSkeleton() {
        const canApprove = this.sectInfo && sectHasPerm(this.sectInfo.myRole, this.sectInfo.myPermissions || 0, SECT_PERMS.APPROVE_EXCHANGE);
        const canExtract = this.sectInfo && sectHasPerm(this.sectInfo.myRole, this.sectInfo.myPermissions || 0, SECT_PERMS.EXTRACT_ITEM);
        const pendingExchangeRequestCount = this.sectInfo ? (this.sectInfo.pendingExchangeRequestCount || 0) : (this._pendingExchangeRequestCount || 0);
        const pendingExchangeRequestText = pendingExchangeRequestCount > 9 ? '9+' : pendingExchangeRequestCount;
        const approvalBtn = canApprove
            ? `<button class="modal-btn modal-btn--outline" style="flex:0 0 auto;height:38px;padding:0 14px;font-size:12px;position:relative;" onclick="PlayerSectModule.showExchangeRequests()">审批兑换<span class="friend-btn-badge js-psect-exchange-badge ${pendingExchangeRequestCount > 0 ? '' : 'hidden'}">${pendingExchangeRequestText}</span></button>`
            : '';
        const batchLabel = this.warehouseBatchMode ? '退出批量' : '批量提取';
        const batchBtn = canExtract
            ? '<button id="psectWarehouseBatchBtn" class="modal-btn modal-btn--outline" style="flex:0 0 auto;height:38px;padding:0 14px;font-size:12px;" onclick="PlayerSectModule.toggleWarehouseBatchMode()">' + batchLabel + '</button>'
            : '';
        // 进入批量模式时挂在最上方的操作条（动态填充）
        const batchToolbar = '<div id="psectWarehouseBatchToolbar" style="display:none;margin-bottom:10px;padding:8px 10px;border:1px dashed var(--accent-gold);border-radius:6px;background:rgba(201,153,58,0.08);"></div>';
        let html = `
        <div class="modal-info-card">
            <div class="modal-info-card__title">✦ 检索筛选</div>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
                <input type="text" id="psectWarehouseSearch" class="app-input" placeholder="搜索物资名称..." style="flex:1;min-width:140px;" oninput="PlayerSectModule.onSearchInput()">
                <select id="psectWarehouseStageFilter" class="app-select" style="width:104px;" onchange="PlayerSectModule.onWarehouseStageChange(this.value)">
                    ${this.getStageOptionsHtml(this.warehouseStageFilter)}
                </select>
                <select id="psectWarehouseSort" class="app-select" style="width:100px;" onchange="PlayerSectModule.onSortChange(this.value)">
                    <option value="default">默认排序</option>
                    <option value="rarity">按品级</option>
                    <option value="name">按名称</option>
                </select>
                ${batchBtn}
                ${approvalBtn}
            </div>
            <div id="psectWarehouseTabs" style="display:flex; overflow-x:auto; margin-top:10px; border-top:1px dashed var(--border-color); padding-top:8px; gap:8px;">
                <button class="inv-filter-tab" data-type="all" onclick="PlayerSectModule.filterWarehouse('all')" style="padding:4px 8px;font-size:12px;background:none;border:none;color:var(--text-gray);cursor:pointer;border-bottom:2px solid transparent;">全部</button>
                <button class="inv-filter-tab" data-type="equip" onclick="PlayerSectModule.filterWarehouse('equip')" style="padding:4px 8px;font-size:12px;background:none;border:none;color:var(--text-gray);cursor:pointer;border-bottom:2px solid transparent;">装备</button>
                <button class="inv-filter-tab" data-type="furnace" onclick="PlayerSectModule.filterWarehouse('furnace')" style="padding:4px 8px;font-size:12px;background:none;border:none;color:var(--text-gray);cursor:pointer;border-bottom:2px solid transparent;">炼丹炉</button>
                <button class="inv-filter-tab" data-type="pill" onclick="PlayerSectModule.filterWarehouse('pill')" style="padding:4px 8px;font-size:12px;background:none;border:none;color:var(--text-gray);cursor:pointer;border-bottom:2px solid transparent;">丹药</button>
                <button class="inv-filter-tab" data-type="material" onclick="PlayerSectModule.filterWarehouse('material')" style="padding:4px 8px;font-size:12px;background:none;border:none;color:var(--text-gray);cursor:pointer;border-bottom:2px solid transparent;">材料</button>
                <button class="inv-filter-tab" data-type="other" onclick="PlayerSectModule.filterWarehouse('other')" style="padding:4px 8px;font-size:12px;background:none;border:none;color:var(--text-gray);cursor:pointer;border-bottom:2px solid transparent;">其它</button>
            </div>
        </div>
        <div class="modal-info-card modal-info-card--jade">
            <div class="modal-info-card__title modal-info-card__title--jade">✦ 仓库存物</div>
            ${batchToolbar}
            <div id="psectWarehouseList" class="psect-warehouse-grid">
                <!-- dynamic list -->
            </div>
        </div>
        `;
        this._openDecoratedModal('宗门仓库', html);
        // 重新打开骨架时，保持已有批量状态（toggle 按钮文案/工具条同步）
        this.refreshWarehouseBatchToolbar();
    },

    onSearchInput() {
        if (this.warehouseSearchTimer) clearTimeout(this.warehouseSearchTimer);
        this.warehouseSearchTimer = setTimeout(() => {
            this.renderWarehouseItems();
        }, 150);
    },

    onSortChange(val) {
        this.warehouseSort = val;
        this.renderWarehouseItems();
    },

    onWarehouseStageChange(val) {
        const raw = (val || '').trim();
        this.warehouseStageFilter = raw === '' ? null : parseInt(raw, 10);
        if (!Number.isFinite(this.warehouseStageFilter)) this.warehouseStageFilter = null;
        this.renderWarehouseItems();
    },

    filterWarehouse(type) {
        this.warehouseFilter = type;
        // 基于 data-type 属性精确定位高亮，不再依赖 evt.target
        const tabs = document.querySelectorAll('#psectWarehouseTabs .inv-filter-tab');
        tabs.forEach(t => {
            const isActive = t.getAttribute('data-type') === type;
            t.style.color = isActive ? 'var(--text-gold)' : 'var(--text-gray)';
            t.style.borderBottom = isActive ? '2px solid var(--text-gold)' : '2px solid transparent';
            t.classList.toggle('active', isActive);
        });
        this.renderWarehouseItems();
    },

    highlightWarehouseTab() {
        const type = this.warehouseFilter || 'all';
        const tabs = document.querySelectorAll('#psectWarehouseTabs .inv-filter-tab');
        tabs.forEach(t => {
            const isActive = t.getAttribute('data-type') === type;
            t.style.color = isActive ? 'var(--text-gold)' : 'var(--text-gray)';
            t.style.borderBottom = isActive ? '2px solid var(--text-gold)' : '2px solid transparent';
            t.classList.toggle('active', isActive);
        });
    },

    getWarehouseEquipTypeRank(item) {
        const type = item && item.type;
        if (type === 'weapon') return 0;
        if (type === 'armor') return 1;
        if (type === 'accessory') return 2;
        return 99;
    },

    compareWarehouseItemsBySelectedSort(a, b) {
        if (this.warehouseSort === 'rarity') {
            const diff = (b.quality || 0) - (a.quality || 0);
            if (diff !== 0) return diff;
            return (a.name || '').localeCompare(b.name || '', 'zh');
        }
        if (this.warehouseSort === 'name') {
            return (a.name || '').localeCompare(b.name || '', 'zh');
        }
        return 0;
    },

    buildWarehouseStatsHtml(item) {
        const parts = [];
        const refineLevel = Number(item.refineLevel || 0);
        const refineScale = refineLevel > 0 ? refineLevel * 0.03 : 0;
        const addStat = (key, label, cls) => {
            const value = Number(item[key] || 0);
            if (!value) return;
            const extra = refineScale > 0 ? ` (+${Math.floor(value * refineScale)})` : '';
            parts.push(`<span class="${cls}">${label}+${value}${extra}</span>`);
        };
        addStat('attackBonus', '攻', 'stat-atk');
        addStat('defenseBonus', '防', 'stat-def');
        addStat('hpBonus', '血', 'stat-hp');
        addStat('spiritBonus', '识', 'stat-spirit');
        addStat('capacityBonus', '容', 'stat-hp');
        const wearRate = Number(item.wearRate || 0);
        if (wearRate > 0) {
            const wearPct = (wearRate / 100).toFixed(2);
            parts.push(`<span class="stat-wear">破损${wearPct}%</span>`);
        }
        return parts.join(' ');
    },

    getWarehouseInscriptionSlots(item) {
        const raw = item && item.inscriptionsJson;
        if (!raw || raw === '[]') return [];
        try {
            const slots = JSON.parse(raw);
            if (!Array.isArray(slots)) return [];
            return slots.map((slot, index) => {
                if (!slot || Number(slot.quality || 0) <= 0) return null;
                return Object.assign({ _slotIndex: index }, slot);
            }).filter(Boolean);
        } catch (e) {
            return [];
        }
    },

    hasWarehouseInscriptions(item) {
        return this.getWarehouseInscriptionSlots(item).length > 0;
    },

    getWarehouseInscriptionQualityName(quality) {
        const names = (typeof INSCRIPTION_QUALITY_NAMES !== 'undefined')
            ? INSCRIPTION_QUALITY_NAMES
            : ['', '凡纹', '灵纹', '宝纹', '仙纹', '神纹', '圣纹', '天纹'];
        return names[Number(quality || 0)] || '铭文';
    },

    getWarehouseInscriptionStatName(statType) {
        const names = (typeof INSCRIPTION_STAT_NAMES !== 'undefined')
            ? INSCRIPTION_STAT_NAMES
            : { attack: '攻击', defense: '防御', hp: '气血', spirit: '神识' };
        return names[statType] || '属性';
    },

    getWarehouseInscriptionColor(quality) {
        if (typeof _inscriptionQualityColor === 'function') return _inscriptionQualityColor(Number(quality || 0));
        const q = Number(quality || 0);
        if (q >= 6) return '#ff4757';
        if (q >= 5) return 'var(--accent-gold)';
        if (q >= 4) return '#a78bfa';
        if (q >= 3) return '#4fc3f7';
        return 'var(--text-secondary)';
    },

    formatWarehouseHeavenInscriptionPercent(value) {
        if (typeof formatHeavenInscriptionPercent === 'function') {
            return formatHeavenInscriptionPercent(value);
        }
        return (Number(value || 0) / 10).toFixed(1) + '%';
    },

    resolveWarehouseHeavenInscriptionValue(slot, item) {
        if (!slot || !item) return 0;
        let base = 0;
        if (slot.statType === 'attack') base = Number(item.baseAttack != null ? item.baseAttack : (item.attackBonus || 0));
        if (slot.statType === 'defense') base = Number(item.baseDefense != null ? item.baseDefense : (item.defenseBonus || 0));
        if (slot.statType === 'hp') base = Number(item.baseHp != null ? item.baseHp : (item.hpBonus || 0));
        if (base <= 0) return 0;
        return Math.max(1, Math.floor(base * Number(slot.value || 0) / 1000));
    },

    formatWarehouseInscriptionDisplay(slot, item) {
        if (typeof formatInscriptionDisplay === 'function') {
            return formatInscriptionDisplay(slot, item);
        }
        const qName = this.getWarehouseInscriptionQualityName(slot.quality);
        if (Number(slot.quality || 0) === 7) {
            const heavenNames = { attack: '锋', defense: '御', hp: '命' };
            const statName = this.getWarehouseInscriptionStatName(slot.statType);
            const percent = this.formatWarehouseHeavenInscriptionPercent(slot.value);
            const resolved = this.resolveWarehouseHeavenInscriptionValue(slot, item);
            const valueText = '+' + percent + (resolved > 0 ? '(+' + resolved + statName + ')' : '');
            return {
                qualityName: qName,
                statName: heavenNames[slot.statType] || '纹',
                valueText: valueText,
                compactText: qName + '·' + (heavenNames[slot.statType] || '纹') + valueText
            };
        }
        const sName = this.getWarehouseInscriptionStatName(slot.statType);
        const valueText = '+' + Number(slot.value || 0);
        return {
            qualityName: qName,
            statName: sName,
            valueText: valueText,
            compactText: qName + '·' + sName + valueText
        };
    },

    buildWarehouseInscriptionsHtml(item) {
        const slots = this.getWarehouseInscriptionSlots(item);
        if (!slots.length) return '';
        return slots.map(slot => {
            const display = this.formatWarehouseInscriptionDisplay(slot, item);
            const color = this.getWarehouseInscriptionColor(slot.quality);
            return `<span class="stat-inscription" style="color:${color}">${display.compactText}</span>`;
        }).join(' ');
    },

    showWarehouseInscriptions(itemId) {
        const item = (this.warehouseCache || []).find(i => String(i.id) === String(itemId));
        if (!item) {
            showToast('物资不存在，请刷新宗门仓库');
            return;
        }
        const slots = this.getWarehouseInscriptionSlots(item);
        if (!slots.length) {
            showToast('该物资尚未铭刻灵纹');
            return;
        }

        const totals = { attack: 0, defense: 0, hp: 0, spirit: 0 };
        slots.forEach(slot => {
            if (Object.prototype.hasOwnProperty.call(totals, slot.statType)) {
                totals[slot.statType] += Number(slot.value || 0);
            }
        });
        const totalHtml = Object.keys(totals).map(key => {
            if (!totals[key]) return '';
            return `<span class="stat-inscription">${this.getWarehouseInscriptionStatName(key)}+${totals[key]}</span>`;
        }).filter(Boolean).join(' ');

        const rowsHtml = slots.map((slot, index) => {
            const quality = Number(slot.quality || 0);
            const color = this.getWarehouseInscriptionColor(quality);
            const display = this.formatWarehouseInscriptionDisplay(slot, item);
            const mpCost = quality <= 1 ? 0 : ({ 2: 2, 3: 8, 4: 25, 5: 80, 6: 200, 7: 500 }[quality] || 0);
            const costText = mpCost > 0 ? ` · 普攻耗灵${mpCost}` : '';
            const slotIndex = Number.isFinite(Number(slot._slotIndex)) ? Number(slot._slotIndex) : index;
            return `<div class="inscription-slot-card inscription-slot-card--filled" style="--insc-quality-color:${color};">`
                + `<span class="inscription-slot-card__icon">✧</span>`
                + `<span class="inscription-slot-card__main">`
                + `<span class="inscription-slot-card__label">槽位 ${slotIndex + 1}${costText}</span>`
                + `<b class="inscription-slot-card__value">${escapeHtml(display.compactText)}</b>`
                + `</span>`
                + `</div>`;
        }).join('');

        const refineText = Number(item.refineLevel || 0) > 0 ? ` +${Number(item.refineLevel || 0)}` : '';
        const titleName = escapeHtml(item.name || '宗门物资') + refineText;
        const html = `
            <div class="modal-header-deco">
                <div class="modal-header-deco__subtitle">宗门仓库铭文</div>
                <div class="inscription-header-title">${titleName}</div>
                <div class="inscription-header-meta">
                    <span>已铭刻 ${slots.length} 条</span>
                    <span>宗门仓库</span>
                </div>
            </div>
            <div class="modal-body-padded inscription-dialog-body">
                ${totalHtml ? `<section class="modal-info-card inscription-section"><div class="inscription-section__head"><div><div class="inscription-section__title">✦ <span>合计加成</span></div><div class="inscription-section__note">当前物资已铭刻属性汇总。</div></div></div><div class="psect-warehouse-card__stats psect-warehouse-card__inscriptions">${totalHtml}</div></section>` : ''}
                <section class="modal-info-card inscription-section inscription-section--slots">
                    <div class="inscription-section__head">
                        <div>
                            <div class="inscription-section__title">✦ <span>已铭刻槽位</span></div>
                            <div class="inscription-section__note">仅展示宗门仓库物资的铭文状态，不在此处执行铭刻。</div>
                        </div>
                    </div>
                    <div class="inscription-slot-list">${rowsHtml}</div>
                </section>
                <div class="inscription-result-actions modal-btn-row">
                    <button class="modal-btn modal-btn--outline inscription-close-btn" onclick="closeModal()">关闭</button>
                </div>
            </div>
        `;
        showModal(html, 'modal-overlay--top ui-scrollable-modal inscription-modal-overlay');
    },

    getFilteredWarehouse() {
        let items = [...(this.warehouseCache || [])];
        
        const searchEl = document.getElementById('psectWarehouseSearch');
        const query = searchEl ? searchEl.value.trim().toLowerCase() : '';
        if (query) {
            items = items.filter(i => (i.name||'').toLowerCase().includes(query));
        }

        if (this.warehouseStageFilter !== null) {
            items = items.filter(i => this.getItemMinStage(i) === this.warehouseStageFilter);
        }

        if (this.warehouseFilter === 'equip') {
            items = items.filter(i => ['weapon','armor','accessory'].includes(i.type));
        } else if (this.warehouseFilter === 'furnace') {
            items = items.filter(i => i.type === 'furnace');
        } else if (this.warehouseFilter === 'pill') {
            items = items.filter(i => i.type === 'pill');
        } else if (this.warehouseFilter === 'material') {
            items = items.filter(i => ['material','fragment'].includes(i.type));
        } else if (this.warehouseFilter === 'other') {
            items = items.filter(i => !['weapon','armor','accessory','furnace','pill','material','fragment'].includes(i.type));
        }

        if (this.warehouseFilter === 'equip') {
            items.sort((a, b) => {
                const typeDiff = this.getWarehouseEquipTypeRank(a) - this.getWarehouseEquipTypeRank(b);
                if (typeDiff !== 0) return typeDiff;
                return this.compareWarehouseItemsBySelectedSort(a, b);
            });
        } else if (this.warehouseSort === 'rarity' || this.warehouseSort === 'name') {
            items.sort((a, b) => this.compareWarehouseItemsBySelectedSort(a, b));
        }
        
        return items;
    },

    renderWarehouseItems() {
        const container = document.getElementById('psectWarehouseList');
        if (!container) return;

        const myRole = this.sectInfo ? this.sectInfo.myRole : '';
        const myPerms = this.sectInfo ? (this.sectInfo.myPermissions || 0) : 0;
        const canPrice = sectHasPerm(myRole, myPerms, SECT_PERMS.PRICE_ITEM);
        const canExtract = sectHasPerm(myRole, myPerms, SECT_PERMS.EXTRACT_ITEM);
        const isManage = canPrice || canExtract;
        const items = this.getFilteredWarehouse();
        const inBatch = this.warehouseBatchMode && canExtract;
        if (inBatch && !this.warehouseBatchSelected) this.warehouseBatchSelected = new Set();

        if (items.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-gray);">未找到匹配的物资，宗门仓库空空如也</div>';
            this.refreshWarehouseBatchToolbar();
            return;
        }

        let html = '';
        items.forEach(item => {
            const color = (typeof getRarityColor === 'function') ? getRarityColor(item.quality) : 'inherit';

            let actionHtml = '';
            const hasInscriptions = this.hasWarehouseInscriptions(item);
            const viewInscriptionsBtn = hasInscriptions
                ? `<button class="psect-warehouse-card__btn psect-warehouse-card__btn--inscription" onclick="PlayerSectModule.showWarehouseInscriptions('${item.id}')">铭文</button>`
                : '';
            if (inBatch) {
                const checked = this.warehouseBatchSelected.has(String(item.id)) ? 'checked' : '';
                actionHtml = `<label class="psect-warehouse-card__check">`
                    + `<input type="checkbox" data-bbar-extract-id="${item.id}" ${checked} onchange="PlayerSectModule.toggleWarehouseBatchItem('${item.id}', this.checked)">`
                    + `<span>批量</span>`
                    + `</label>`;
            } else if (isManage) {
                actionHtml += viewInscriptionsBtn;
                if (canPrice) actionHtml += `<button class="psect-warehouse-card__btn" onclick="PlayerSectModule.setSectItemPrice('${item.id}', ${item.priceContribution}, ${item.baseSellPrice})">定价</button>`;
                if (canPrice) actionHtml += `<button class="psect-warehouse-card__btn" onclick="PlayerSectModule.setMaterialPrice('${item.id}', ${jsAttr(item.materialPrice || '')}, ${jsAttr(item.templateId || '')}, ${!!item.isForgeEquipment}, ${jsAttr(item.materialPriceText || '')}, ${jsAttr(JSON.stringify(item.materialPriceItems || []))}, ${jsAttr(JSON.stringify(item.forgeMaterialItems || []))})">材料价</button>`;
                if (canPrice) actionHtml += `<button class="psect-warehouse-card__btn${item.requiresApproval ? ' psect-warehouse-card__btn--active' : ''}" onclick="PlayerSectModule.toggleItemApproval('${item.id}', ${!item.requiresApproval})">${item.requiresApproval ? '取消审批' : '需审批'}</button>`;
                if (canExtract) actionHtml += `<button class="psect-warehouse-card__btn" onclick="PlayerSectModule.extractItem('${item.id}', ${item.amount}, ${jsAttr(item.name)}, ${item.priceContribution}, ${item.baseSellPrice}, ${jsAttr(item.materialPrice || '')}, ${jsAttr(item.materialPriceText || '')})">提取</button>`;
            } else if (item.priceContribution >= 0) {
                const sectMinStage = this.sectInfo.minExchangeStage || 0;
                const itemMinStage = item.requiredStage || 0;
                const effectiveMinStage = Math.max(sectMinStage, itemMinStage);
                const stageHint = effectiveMinStage > 0 ? `<span class="psect-warehouse-card__hint">需${this.getStageName(effectiveMinStage)}+</span>` : '';
                const approvalThreshold = (this.sectInfo && this.sectInfo.exchangeApprovalRarity) || 99;
                const approvalHint = ((item.quality || 0) >= approvalThreshold || item.requiresApproval)
                    ? '<span class="psect-warehouse-card__hint psect-warehouse-card__hint--gold">需审批</span>'
                    : '';
                actionHtml += `${stageHint}${approvalHint}${viewInscriptionsBtn}<button class="psect-warehouse-card__btn" onclick="PlayerSectModule.buySectItem('${item.id}', ${item.priceContribution}, ${item.amount}, ${jsAttr(item.name)}, ${item.quality || 0}, ${jsAttr(item.materialPrice || '')}, ${!!item.requiresApproval}, ${jsAttr(JSON.stringify(item.materialPriceItems || []))}, ${jsAttr(item.materialPriceText || '')})">兑换</button>`;
            } else {
                actionHtml += viewInscriptionsBtn;
            }

            const rarityName = (typeof getRarityName === 'function') ? getRarityName(item.quality) : `${item.quality}阶`;
            let typeLabel = '';
            if (item.type === 'weapon') typeLabel = '武器';
            else if (item.type === 'armor') typeLabel = '防具';
            else if (item.type === 'accessory') typeLabel = '饰品';
            else if (item.type === 'furnace') typeLabel = '炼丹炉';
            else typeLabel = rarityName;

            let displayName = escapeHtml(item.name);
            if (item.refineLevel > 0) {
                displayName += ` <span style="color:var(--text-danger)">+${item.refineLevel}</span>`;
            }

            // 装备属性 + 境界要求(复用普通储物的工具函数)
            const isEquipItem = item.type === 'weapon' || item.type === 'armor' || item.type === 'accessory' || item.type === 'ring';
            const hasStats = isEquipItem && (item.attackBonus || item.defenseBonus || item.hpBonus || item.spiritBonus || item.capacityBonus);
            const statsHtml = hasStats
                ? '<div class="psect-warehouse-card__stats">' + this.buildWarehouseStatsHtml(item) + '</div>'
                : '';
            const inscriptionsHtml = this.buildWarehouseInscriptionsHtml(item);
            let realmHintHtml = '';
            const reqStage = item.minStage || item.requiredStage || 0;
            if (isEquipItem && reqStage > 0) {
                realmHintHtml = '<span class="psect-warehouse-card__tag">需' + this.getStageName(reqStage) + '+</span>';
            }
            let flagsHtml = '';
            if (item.extensionData) flagsHtml += '<span class="psect-warehouse-card__tag">词条</span>';
            if (hasInscriptions) flagsHtml += '<span class="psect-warehouse-card__tag">铭文</span>';
            flagsHtml += realmHintHtml;
            const descText = escapeHtml(item.description || '');
            const descHtml = descText ? `<div class="psect-warehouse-card__desc" title="${descText}">${descText}</div>` : '';

            html += `
                <div class="psect-warehouse-card rarity-${item.quality || 0}">
                    <div class="psect-warehouse-card__top">
                        <span class="psect-warehouse-card__name" style="color:${color}" title="${escapeHtml(item.name)}">${displayName}</span>
                        <span class="psect-warehouse-card__qty">x${item.amount}</span>
                    </div>
                    <div class="psect-warehouse-card__meta">
                        <span>[${typeLabel}]</span>
                        <span>${item.priceContribution >= 0 ? `${item.priceContribution}贡/件` : '未上架'}</span>
                        ${item.materialPrice
                            ? `<span style="color:var(--accent-orange);font-size:11px;" title="${escapeHtml(item.materialPriceText || item.materialPrice)}">或${item.isForgeEquipment ? '当前锻造材料' : '材料兑换'}</span>`
                            : ''}
                    </div>
                    ${statsHtml}
                    ${inscriptionsHtml ? `<div class="psect-warehouse-card__stats psect-warehouse-card__inscriptions">${inscriptionsHtml}</div>` : ''}
                    ${descHtml}
                    ${flagsHtml ? `<div class="psect-warehouse-card__tags">${flagsHtml}</div>` : ''}
                    <div class="psect-warehouse-card__actions">
                        ${actionHtml}
                    </div>
                </div>
            `;
        });
        container.innerHTML = html;
        this.refreshWarehouseBatchToolbar();
    },

    /**
     * 切换批量提取模式：清理选中集合 + 刷新顶部工具条 + 重渲列表（每行追加复选框/隐藏单条按钮）。
     */
    toggleWarehouseBatchMode() {
        const myRole = this.sectInfo ? this.sectInfo.myRole : '';
        const myPerms = this.sectInfo ? (this.sectInfo.myPermissions || 0) : 0;
        if (!sectHasPerm(myRole, myPerms, SECT_PERMS.EXTRACT_ITEM)) {
            showToast('你无提取宗门仓库权限');
            return;
        }
        this.warehouseBatchMode = !this.warehouseBatchMode;
        this.warehouseBatchSelected = new Set();
        const btn = document.getElementById('psectWarehouseBatchBtn');
        if (btn) btn.textContent = this.warehouseBatchMode ? '退出批量' : '批量提取';
        this.renderWarehouseItems();
    },

    toggleWarehouseBatchItem(itemId, checked) {
        if (!this.warehouseBatchSelected) this.warehouseBatchSelected = new Set();
        const key = String(itemId);
        if (checked) this.warehouseBatchSelected.add(key);
        else this.warehouseBatchSelected.delete(key);
        this.refreshWarehouseBatchToolbar();
    },

    /** 选中当前过滤后的所有物品（不跨过滤器） */
    selectAllVisibleWarehouse() {
        if (!this.warehouseBatchSelected) this.warehouseBatchSelected = new Set();
        const items = this.getFilteredWarehouse();
        items.forEach(it => this.warehouseBatchSelected.add(String(it.id)));
        this.renderWarehouseItems();
    },

    clearWarehouseSelection() {
        this.warehouseBatchSelected = new Set();
        this.renderWarehouseItems();
    },

    /** 顶部工具条：显示选中数 + 全选/清空/提取按钮，仅批量模式下展示 */
    refreshWarehouseBatchToolbar() {
        const bar = document.getElementById('psectWarehouseBatchToolbar');
        if (!bar) return;
        if (!this.warehouseBatchMode) {
            bar.style.display = 'none';
            bar.innerHTML = '';
            return;
        }
        const selectedCount = this.warehouseBatchSelected ? this.warehouseBatchSelected.size : 0;
        bar.style.display = '';
        bar.innerHTML =
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
            + '<span style="font-size:12px;color:var(--text-secondary);">批量提取模式：勾选后按全数量提取，并按贡献价扣除可用贡献。</span>'
            + '<span style="margin-left:auto;font-size:12px;color:var(--text-gold);">已选 <b>' + selectedCount + '</b> 项</span>'
            + '</div>'
            + '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">'
            + '<button class="modal-btn modal-btn--outline" style="flex:1;min-width:90px;height:34px;font-size:12px;" onclick="PlayerSectModule.selectAllVisibleWarehouse()">全选当前</button>'
            + '<button class="modal-btn modal-btn--outline" style="flex:1;min-width:90px;height:34px;font-size:12px;" onclick="PlayerSectModule.clearWarehouseSelection()">清空选中</button>'
            + '<button class="modal-btn modal-btn--gold" style="flex:1.4;min-width:120px;height:34px;font-size:12px;'
            + (selectedCount === 0 ? 'opacity:0.55;pointer-events:none;' : '')
            + '" onclick="PlayerSectModule.submitWarehouseBatchExtract()">提取选中 (' + selectedCount + ')</button>'
            + '</div>';
    },

    async submitWarehouseBatchExtract() {
        if (!this.warehouseBatchSelected || this.warehouseBatchSelected.size === 0) {
            showToast('请先勾选要提取的物资');
            return;
        }
        // 一次最多 50 项（与后端校验对齐）
        if (this.warehouseBatchSelected.size > 50) {
            showToast('一次最多提取 50 项，请分批');
            return;
        }
        // 把选中的 itemId 与对应库存量打包，按全数量提取
        const idMap = {};
        (this.warehouseCache || []).forEach(it => { idMap[String(it.id)] = it; });
        const items = [];
        this.warehouseBatchSelected.forEach(id => {
            const cached = idMap[id];
            if (cached && cached.amount > 0) items.push({ warehouseId: id, amount: cached.amount });
        });
        if (items.length === 0) {
            showToast('选中物资已不在仓库，请刷新');
            return;
        }
        try {
            const res = await api.post('/api/game/player-sect/extract-item-batch', { items: items });
            if (res.code === 200) {
                const data = res.data || {};
                const ok = data.successCount || 0;
                const total = data.totalCount || 0;
                const skip = (data.skipped || []).length;
                let msg = '已提取 ' + ok + ' 项，共 ' + total + ' 件';
                if (skip > 0) msg += '，跳过 ' + skip + ' 项 (背包满或库存变化)';
                showToast(msg);
                if (skip > 0 && data.skipped && data.skipped.length) {
                    // 跳过原因稍详细：用 alert 列出，便于宗主排查
                    const detail = data.skipped.slice(0, 10).join('\n') + (data.skipped.length > 10 ? '\n…' : '');
                    if (typeof gameAlert === 'function') gameAlert('部分物资未能提取：\n' + detail);
                }
                this.warehouseBatchMode = false;
                this.warehouseBatchSelected = new Set();
                const btn = document.getElementById('psectWarehouseBatchBtn');
                if (btn) btn.textContent = '批量提取';
                this.showWarehouse();
                if (typeof loadInventory === 'function') loadInventory();
            } else {
                showToast(res.message || '批量提取失败', 'error');
            }
        } catch (e) {
            showToast('网络异常', 'error');
        }
    },

    setSectItemPrice(itemId, currentPrice, baseSellPrice) {
        const suggestPrice = Math.max(1, Math.floor((baseSellPrice || 0) * 1.2));
        const msg = currentPrice >= 0
            ? `修改售价（当前售价：${currentPrice} 贡献/件，默认贡献价：${suggestPrice}）。\n请输入新的售价（输入 -1 取消上架；低于默认价会按默认价处理）：`
            : `上架物资（默认贡献价：${suggestPrice} 贡献/件）。\n请输入兑换单价（输入 -1 保持不出售；低于默认价会按默认价处理）：`;
        const defaultVal = currentPrice >= 0 ? currentPrice : suggestPrice;

        gamePrompt(msg, defaultVal.toString(), async function(val) {
            const price = parseInt(val, 10);
            if (isNaN(price) || price < -1) {
                showToast('输入的价格无效');
                return;
            }

            try {
                const res = await api.post('/api/game/player-sect/set-item-price', {
                    warehouseId: itemId,
                    price: price
                });
                if (res.code === 200) {
                    showToast('操作成功');
                    PlayerSectModule.showWarehouse();
                } else {
                    showToast(res.message, 'error');
                }
            } catch(e) {
                showToast('网络异常', 'error');
            }
        });
    },

    setMaterialPrice(itemId, currentMaterialPrice, templateId, isForgeEquipment, currentMaterialText, currentMaterialItemsJson, forgeMaterialItemsJson) {
        let currentItems = [];
        let forgeItems = [];
        try {
            currentItems = JSON.parse(currentMaterialItemsJson || '[]') || [];
        } catch (e) {
            currentItems = [];
        }
        try {
            forgeItems = JSON.parse(forgeMaterialItemsJson || '[]') || [];
        } catch (e) {
            forgeItems = [];
        }
        const rowsHtml = (currentItems.length ? currentItems : [{ name: '', qty: 1 }])
            .map(item => this.buildMaterialPriceRowHtml(item.name || item.id || '', item.qty || 1, item.id || ''))
            .join('');
        const clearBtn = currentMaterialPrice
            ? `<button class="modal-btn modal-btn--outline" style="flex:1;" onclick="PlayerSectModule.clearMaterialPrice('${itemId}')">清除材料价</button>`
            : '';
        const currentHtml = currentMaterialText
            ? `<div style="font-size:12px;color:var(--text-muted);line-height:1.7;margin-top:6px;">当前材料价：${escapeHtml(currentMaterialText)}</div>`
            : '<div style="font-size:12px;color:var(--text-muted);line-height:1.7;margin-top:6px;">当前未设置材料价。</div>';
        const forgeBtn = isForgeEquipment && forgeItems.length
            ? `<button class="modal-btn modal-btn--outline" style="margin-top:10px;width:100%;" onclick="PlayerSectModule.fillMaterialPriceRows(${jsAttr(JSON.stringify(forgeItems))})">采用当前装备材料后编辑数量</button>`
            : '';
        const html = `<div style="padding:8px;">
            <div class="modal-info-card modal-info-card--jade">
                <div class="modal-info-card__title modal-info-card__title--jade">设置材料兑换价</div>
                <div style="font-size:12px;color:var(--text-muted);line-height:1.7;">
                    可自行输入材料名和数量；装备物资也可先采用当前装备锻造材料，再调整每种材料数量。
                </div>
                ${currentHtml}
                <div id="psectMaterialPriceRows" style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">${rowsHtml}</div>
                <button class="modal-btn modal-btn--outline" style="margin-top:10px;width:100%;" onclick="PlayerSectModule.addMaterialPriceRow()">新增材料</button>
                ${forgeBtn}
            </div>
            <div style="display:flex;gap:8px;margin-top:12px;">
                <button class="modal-btn modal-btn--gold" style="flex:1;" onclick="PlayerSectModule.submitMaterialPriceRows('${itemId}')">保存</button>
                ${clearBtn}
                <button class="modal-btn modal-btn--outline" style="flex:1;" onclick="closeGameModal()">取消</button>
            </div>
        </div>`;
        showGameModal('材料价', html);
    },

    buildMaterialPriceRowHtml(name, qty, id) {
        const safeName = name || '';
        const dataAttrs = id
            ? ` data-id="${escapeHtml(id)}" data-name="${escapeHtml(safeName)}"`
            : '';
        return `<div class="psect-material-price-row" style="display:grid;grid-template-columns:minmax(0,1fr) 88px 34px;gap:6px;align-items:center;">
            <input class="app-input psect-material-price-name" value="${escapeHtml(safeName)}" placeholder="材料名或ID"${dataAttrs} oninput="PlayerSectModule.onMaterialPriceNameInput(this)" style="width:100%;box-sizing:border-box;margin-bottom:0 !important;">
            <input class="app-input psect-material-price-qty" type="number" min="1" value="${Math.max(1, parseInt(qty, 10) || 1)}" placeholder="数量" style="width:100%;box-sizing:border-box;margin-bottom:0 !important;">
            <button class="modal-btn modal-btn--outline" style="height:34px;padding:0;" onclick="PlayerSectModule.removeMaterialPriceRow(this)">×</button>
        </div>`;
    },

    addMaterialPriceRow() {
        const box = document.getElementById('psectMaterialPriceRows');
        if (!box) return;
        box.insertAdjacentHTML('beforeend', this.buildMaterialPriceRowHtml('', 1, ''));
    },

    fillMaterialPriceRows(itemsJson) {
        let items = [];
        try {
            items = JSON.parse(itemsJson || '[]') || [];
        } catch (e) {
            items = [];
        }
        const box = document.getElementById('psectMaterialPriceRows');
        if (!box || !items.length) return;
        box.innerHTML = items.map(item => this.buildMaterialPriceRowHtml(item.name || item.id || '', item.qty || 1, item.id || '')).join('');
    },

    onMaterialPriceNameInput(input) {
        if (!input) return;
        const originalName = input.getAttribute('data-name') || '';
        if ((input.value || '').trim() !== originalName) {
            input.removeAttribute('data-id');
        }
    },

    removeMaterialPriceRow(btn) {
        const row = btn && btn.closest ? btn.closest('.psect-material-price-row') : null;
        if (row) row.remove();
    },

    async submitMaterialPriceRows(itemId) {
        const rows = Array.from(document.querySelectorAll('#psectMaterialPriceRows .psect-material-price-row'));
        const materials = [];
        for (const row of rows) {
            const nameInput = row.querySelector('.psect-material-price-name');
            const name = nameInput?.value.trim() || '';
            const id = nameInput?.getAttribute('data-id') || '';
            const qty = parseInt(row.querySelector('.psect-material-price-qty')?.value, 10);
            if (!name) continue;
            if (isNaN(qty) || qty <= 0) {
                showToast('材料数量必须大于0');
                return;
            }
            materials.push(id ? { id, qty } : { name, qty });
        }
        if (materials.length === 0) {
            showToast('请至少填写一种材料');
            return;
        }
        try {
            const res = await api.post('/api/game/player-sect/set-material-price', {
                warehouseId: itemId,
                materials: JSON.stringify(materials)
            });
            if (res.code === 200) {
                showToast('材料价格已设置');
                closeGameModal();
                PlayerSectModule.showWarehouse();
            } else {
                showToast(res.message, 'error');
            }
        } catch(e) {
            showToast('网络异常', 'error');
        }
    },

    async applyTemplateMaterialPrice(itemId, templateId) {
        if (!templateId) {
            showToast('模板ID缺失', 'error');
            return;
        }
        try {
            const res = await api.post('/api/game/player-sect/set-material-price', {
                warehouseId: itemId,
                templateId: templateId
            });
            if (res.code === 200) {
                showToast('已采用当前装备锻造材料');
                closeGameModal();
                PlayerSectModule.showWarehouse();
            } else {
                showToast(res.message, 'error');
            }
        } catch(e) {
            showToast('网络异常', 'error');
        }
    },

    async clearMaterialPrice(itemId) {
        try {
            const res = await api.post('/api/game/player-sect/set-material-price', {
                warehouseId: itemId,
                materials: ''
            });
            if (res.code === 200) {
                showToast('材料价格已清除');
                closeGameModal();
                PlayerSectModule.showWarehouse();
            } else {
                showToast(res.message, 'error');
            }
        } catch(e) {
            showToast('网络异常', 'error');
        }
    },

    async toggleItemApproval(itemId, requiresApproval) {
        try {
            const res = await api.post('/api/game/player-sect/set-item-approval', {
                warehouseId: itemId,
                requiresApproval: requiresApproval
            });
            if (res.code === 200) {
                showToast(requiresApproval ? '已设置该物品兑换需审批' : '已取消该物品审批要求');
                PlayerSectModule.showWarehouse();
            } else {
                showToast(res.message, 'error');
            }
        } catch(e) { showToast('网络异常', 'error'); }
    },

    formatMaterialCostText(matList, fallbackText) {
        if (Array.isArray(matList) && matList.length > 0) {
            return matList.map(m => (m.itemName || m.name || m.id || '材料') + ' ×' + (m.quantity || m.qty || 0)).join('、');
        }
        return fallbackText || '';
    },

    buySectItem(itemId, price, maxQty, name, rarity, materialPrice, requiresApproval, materialPriceItemsJson, materialPriceText) {
        const approvalThreshold = (this.sectInfo && this.sectInfo.exchangeApprovalRarity) || 99;
        const needApproval = (rarity || 0) >= approvalThreshold || requiresApproval;
        const maxAffordable = Math.floor(this.sectInfo.myAvailableContribution / Math.max(1, price));
        const canMaterialPay = !!materialPrice;

        if (canMaterialPay) {
            let matList = [];
            try {
                const namedArr = JSON.parse(materialPriceItemsJson || '[]') || [];
                if (namedArr.length > 0) {
                    matList = namedArr.map(m => ({ itemName: m.name || m.id, quantity: m.qty }));
                } else {
                    const arr = JSON.parse(materialPrice);
                    matList = arr.map(m => ({ itemName: m.id, quantity: m.qty }));
                }
            } catch(e) { return; }
            this.showPaymentChoiceDialog(itemId, price, maxQty, name, rarity, maxAffordable, matList, needApproval, materialPriceText);
            return;
        }

        if (needApproval) {
            this.showExchangeApplyDialog(itemId, price, maxQty, name, maxAffordable, 'CONTRIBUTION');
            return;
        }
        gamePrompt(`兑换物资：【${name}】\n单价: ${price} 贡献\n当前库存: ${maxQty}件\n最高可买: ${maxAffordable}件\n请输入兑换数量：`, '1', async function(val) {
            const qty = parseInt(val, 10);
            if (isNaN(qty) || qty <= 0 || qty > maxQty) {
                showToast('兑换数量无效');
                return;
            }
            try {
                const res = await api.post('/api/game/player-sect/buy-item', {
                    warehouseId: itemId,
                    amount: qty,
                    paymentMethod: 'CONTRIBUTION'
                });
                if (res.code === 200) {
                    showToast(res.message);
                    SectModule.loadInfo();
                    PlayerSectModule.showWarehouse();
                    loadInventory();
                } else {
                    showToast(res.message, 'error');
                }
            } catch(e) {
                showToast('网络异常', 'error');
            }
        }, null, false, PlayerSectModule.integerInputOptions(1, maxQty));
    },

    showPaymentChoiceDialog(itemId, price, maxQty, name, rarity, maxAffordable, matList, needApproval, materialPriceText) {
        const matCostText = this.formatMaterialCostText(matList, materialPriceText);
        const html = `<div style="padding:8px;">
            <div class="modal-info-card modal-info-card--jade">
                <div class="modal-info-card__title modal-info-card__title--jade">选择兑换方式</div>
                <div style="font-size:12px;color:var(--text-muted);line-height:1.7;">
                    【${escapeHtml(name)}】支持两种支付方式：
                </div>
            </div>
            <div class="modal-info-card" style="margin-top:12px;">
                <div class="modal-info-card__title">✦ 材料兑换价</div>
                <div style="font-size:12px;color:var(--text-muted);line-height:1.7;word-break:break-word;">${escapeHtml(matCostText)}/件</div>
            </div>
            <div style="display:flex;gap:8px;margin-top:12px;">
                <button class="modal-btn modal-btn--outline" style="flex:1;min-width:0;white-space:normal;line-height:1.45;" onclick="PlayerSectModule.proceedBuyWithPayment('${itemId}', ${price}, ${maxQty}, ${jsAttr(name)}, ${rarity}, ${maxAffordable}, 'CONTRIBUTION', ${needApproval})">
                    贡献点兑换<br><small>${price} 贡献/件</small>
                </button>
                <button class="modal-btn modal-btn--gold" style="flex:1;min-width:0;white-space:normal;line-height:1.45;" title="${escapeHtml(matCostText)}" onclick="PlayerSectModule.proceedBuyWithPayment('${itemId}', ${price}, ${maxQty}, ${jsAttr(name)}, ${rarity}, 0, 'MATERIAL', ${needApproval})">
                    材料兑换<br><small style="font-size:10px;">消耗上方材料/件</small>
                </button>
            </div>
        </div>`;
        showGameModal('选择兑换方式', html);
    },

    proceedBuyWithPayment(itemId, price, maxQty, name, rarity, maxAffordable, paymentMethod, needApproval) {
        if (paymentMethod === 'MATERIAL') {
            if (needApproval) {
                this.showExchangeApplyDialog(itemId, price, maxQty, name, 0, 'MATERIAL');
                return;
            }
            gamePrompt(`材料兑换：【${name}】\n当前库存: ${maxQty}件\n请输入兑换数量：`, '1', async function(val) {
                const qty = parseInt(val, 10);
                if (isNaN(qty) || qty <= 0 || qty > maxQty) {
                    showToast('兑换数量无效');
                    return;
                }
                try {
                    const previewRes = await api.post('/api/game/player-sect/preview-material-exchange', {
                        warehouseId: itemId,
                        amount: qty
                    });
                    if (previewRes.code !== 200 || !previewRes.data) {
                        showToast(previewRes.message || '材料校验失败', 'error');
                        return;
                    }
                    const missingItems = (previewRes.data.items || []).filter(it => (parseInt(it.missing || 0, 10) || 0) > 0);
                    if (missingItems.length > 0) {
                        PlayerSectModule.showMaterialExchangeShortageDialog(itemId, qty, previewRes.data);
                    } else {
                        await PlayerSectModule.submitMaterialExchange(itemId, qty, false);
                    }
                } catch(e) {
                    showToast('网络异常', 'error');
                }
            }, null, false, PlayerSectModule.integerInputOptions(1, maxQty));
        } else {
            if (needApproval) {
                this.showExchangeApplyDialog(itemId, price, maxQty, name, maxAffordable, 'CONTRIBUTION');
                return;
            }
            gamePrompt(`兑换物资：【${name}】\n单价: ${price} 贡献\n当前库存: ${maxQty}件\n最高可买: ${maxAffordable}件\n请输入兑换数量：`, '1', async function(val) {
                const qty = parseInt(val, 10);
                if (isNaN(qty) || qty <= 0 || qty > maxQty) {
                    showToast('兑换数量无效');
                    return;
                }
                try {
                    const res = await api.post('/api/game/player-sect/buy-item', {
                        warehouseId: itemId,
                        amount: qty,
                        paymentMethod: 'CONTRIBUTION'
                    });
                    if (res.code === 200) {
                        showToast(res.message);
                        SectModule.loadInfo();
                        PlayerSectModule.showWarehouse();
                        loadInventory();
                    } else {
                        showToast(res.message, 'error');
                    }
                } catch(e) {
                    showToast('网络异常', 'error');
                }
            }, null, false, PlayerSectModule.integerInputOptions(1, maxQty));
        }
    },

    formatSectMaterialPreviewNumber(num) {
        if (typeof formatNumber === 'function') return formatNumber(num || 0);
        return String(num || 0);
    },

    showMaterialExchangeShortageDialog(itemId, qty, preview) {
        const items = (preview.items || []).filter(it => (parseInt(it.missing || 0, 10) || 0) > 0);
        const rows = items.map(it => {
            const purchasable = !!it.purchasable;
            const sourceText = purchasable
                ? `${escapeHtml(it.source || '商铺')} · ${this.formatSectMaterialPreviewNumber(it.purchaseCost || 0)} 灵石`
                : '暂无购买渠道';
            return `
                <tr>
                    <td>${escapeHtml(it.name || it.id || '材料')}</td>
                    <td>${this.formatSectMaterialPreviewNumber(it.need || 0)}</td>
                    <td>${this.formatSectMaterialPreviewNumber(it.owned || 0)}</td>
                    <td style="color:var(--text-red);font-weight:600;">${this.formatSectMaterialPreviewNumber(it.missing || 0)}</td>
                    <td style="color:${purchasable ? 'var(--text-gold)' : 'var(--text-muted)'};">${sourceText}</td>
                </tr>`;
        }).join('');
        const costEnough = (preview.currentStones || 0) >= (preview.totalPurchaseCost || 0);
        const canAutoBuy = !!preview.canAutoBuy;
        const actionText = canAutoBuy
            ? `补齐 ${this.formatSectMaterialPreviewNumber(preview.totalPurchaseCost || 0)} 灵石并兑换`
            : (costEnough ? '无法一键补齐' : '灵石不足');
        const html = `<div style="padding:8px;">
            <div class="modal-info-card modal-info-card--jade">
                <div class="modal-info-card__title modal-info-card__title--jade">材料不足</div>
                <div style="font-size:12px;color:var(--text-muted);line-height:1.7;">
                    兑换【${escapeHtml(preview.itemName || '物资')}】x${this.formatSectMaterialPreviewNumber(qty)} 还缺以下材料。
                </div>
            </div>
            <div class="modal-info-card" style="margin-top:12px;overflow:auto;">
                <table class="guide-table" style="width:100%;font-size:12px;">
                    <tr><th>材料</th><th>需要</th><th>已有</th><th>缺口</th><th>补齐</th></tr>
                    ${rows}
                </table>
            </div>
            <div class="modal-info-card" style="margin-top:12px;">
                <div style="font-size:12px;color:var(--text-muted);line-height:1.7;">
                    补齐费用：<b style="color:var(--text-gold);">${this.formatSectMaterialPreviewNumber(preview.totalPurchaseCost || 0)}</b> 灵石；
                    当前持有：<b>${this.formatSectMaterialPreviewNumber(preview.currentStones || 0)}</b> 灵石。
                </div>
            </div>
            <div style="display:flex;gap:8px;margin-top:14px;">
                <button class="modal-btn modal-btn--outline" style="flex:1;" onclick="closeModal()">取消</button>
                <button class="modal-btn modal-btn--gold" style="flex:1;${canAutoBuy ? '' : 'opacity:.55;cursor:not-allowed;'}" ${canAutoBuy ? `onclick="PlayerSectModule.submitMaterialExchange('${itemId}', ${qty}, true)"` : 'disabled'}>
                    ${actionText}
                </button>
            </div>
        </div>`;
        showGameModal('材料不足', html);
    },

    async submitMaterialExchange(itemId, qty, autoBuyMissing) {
        try {
            const res = await api.post('/api/game/player-sect/buy-item-with-materials', {
                warehouseId: itemId,
                amount: qty,
                autoBuyMissing: !!autoBuyMissing
            });
            if (res.code === 200) {
                closeModal();
                showToast(res.message);
                SectModule.loadInfo();
                PlayerSectModule.showWarehouse();
                loadInventory();
            } else {
                showToast(res.message, 'error');
            }
        } catch(e) {
            showToast('网络异常', 'error');
        }
    },

    showExchangeApplyDialog(itemId, price, maxQty, name, maxAffordable, paymentMethod) {
        const isMaterial = paymentMethod === 'MATERIAL';
        const limit = isMaterial ? maxQty : Math.min(maxQty, maxAffordable);
        if (limit <= 0 && !isMaterial) {
            showToast('可用贡献不足');
            return;
        }
        const priceDesc = isMaterial ? '材料支付（审批通过后扣除材料）' : `单价 ${price} 贡献`;
        const html = `<div style="padding:8px;">
            <div class="modal-info-card modal-info-card--jade">
                <div class="modal-info-card__title modal-info-card__title--jade">✦ 申请物资</div>
                <div style="font-size:12px;color:var(--text-muted);line-height:1.7;">
                    【${escapeHtml(name)}】需长老审批后发放。${priceDesc}，当前库存 ${maxQty} 件，最多可申请 ${limit} 件。
                </div>
            </div>
            <div class="modal-info-card" style="margin-top:12px;">
                <div class="modal-info-card__title">✦ 申请数量</div>
                <input id="psectExchangeQty" type="number" inputmode="numeric" pattern="[0-9]*" step="1" min="1" max="${limit}" value="1" class="app-input" style="width:100%;box-sizing:border-box;">
            </div>
            <div class="modal-info-card" style="margin-top:12px;">
                <div class="modal-info-card__title">✦ 申请原因</div>
                <textarea id="psectExchangeReason" maxlength="200" rows="3" class="app-input" style="width:100%;box-sizing:border-box;resize:vertical;" placeholder="例如：突破炼器、宗门任务、秘境备战等"></textarea>
                <div style="font-size:11px;color:var(--text-muted);margin-top:6px;">审批人会看到这段说明，最多 200 字。</div>
            </div>
            <div style="display:flex;gap:8px;margin-top:14px;">
                <button class="modal-btn modal-btn--outline" style="flex:1;" onclick="PlayerSectModule.showWarehouse()">取消</button>
                <button class="modal-btn modal-btn--gold" style="flex:1;" onclick="PlayerSectModule.submitExchangeApplication('${itemId}', ${price}, ${maxQty}, '${paymentMethod}')">提交申请</button>
            </div>
        </div>`;
        showGameModal('物资申请', html);
    },

    async submitExchangeApplication(itemId, price, maxQty, paymentMethod) {
        const qty = parseInt(document.getElementById('psectExchangeQty')?.value || '0', 10);
        const reason = (document.getElementById('psectExchangeReason')?.value || '').trim();
        if (isNaN(qty) || qty <= 0 || qty > maxQty) {
            showToast('申请数量无效');
            return;
        }
        if (!reason) {
            showToast('请填写申请原因');
            return;
        }
        if (reason.length > 200) {
            showToast('申请原因最多 200 字');
            return;
        }
        const isMaterial = paymentMethod === 'MATERIAL';
        if (!isMaterial) {
            const totalCost = price * qty;
            if (this.sectInfo && this.sectInfo.myAvailableContribution < totalCost) {
                showToast('可用贡献不足');
                return;
            }
        }
        try {
            const res = await api.post('/api/game/player-sect/buy-item', {
                warehouseId: itemId,
                amount: qty,
                reason: reason,
                paymentMethod: paymentMethod || 'CONTRIBUTION'
            });
            if (res.code === 200) {
                showToast(res.message);
                SectModule.loadInfo();
                await PlayerSectModule.loadPlayerSectInfo();
                PlayerSectModule.showWarehouse();
            } else {
                showToast(res.message, 'error');
            }
        } catch(e) {
            showToast('网络异常', 'error');
        }
    },

    // ===== 审批兑换 =====
    async showExchangeRequests() {
        try {
            const res = await api.get('/api/game/player-sect/exchange-requests?includeResolved=false');
            const list = res.data || [];
            const canApprove = this.sectInfo && sectHasPerm(this.sectInfo.myRole, this.sectInfo.myPermissions || 0, SECT_PERMS.APPROVE_EXCHANGE);
            if (canApprove) this._setExchangeRequestBadge(list.length);
            const qualityColors = ['','#9e9e9e','#4caf50','#2196f3','#9c27b0','#ff9800','#f44336'];
            let html = '<div style="padding:4px;">';
            if (list.length === 0) {
                html += '<div style="text-align:center;padding:20px;color:var(--text-muted);">暂无待审批申请</div>';
            } else {
                list.forEach(r => {
                    const color = qualityColors[r.itemRarity] || '#fff';
                    const reason = r.applicationReason ? escapeHtml(r.applicationReason) : '未填写';
                    const isMaterial = r.paymentMethod === 'MATERIAL';
                    const paymentText = isMaterial ? '材料支付' : `${r.totalCost} 贡献`;
                    const materialDetail = (isMaterial && r.materialCostText) ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">材料明细：${escapeHtml(r.materialCostText)}</div>` : '';
                    const partialBtn = r.amount > 1
                        ? `<button class="btn-action" style="flex:1;color:var(--text-gold);" onclick="PlayerSectModule.partialApproveExchange(${r.id}, ${r.amount})">部分通过</button>`
                        : '';
                    html += `<div class="modal-info-card" style="margin-top:8px;padding:10px;border-left:3px solid ${color};">
                        <div style="display:flex;justify-content:space-between;">
                            <span><b style="color:${color};">${escapeHtml(r.itemName)} ×${r.amount}</b></span>
                            <span style="font-size:12px;color:var(--text-muted);">${paymentText}</span>
                        </div>
                        ${materialDetail}
                        <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">申请人：${escapeHtml(r.applicantName)}</div>
                        <div style="font-size:12px;color:var(--text-muted);margin-top:4px;line-height:1.5;">申请原因：${reason}</div>
                        <div style="display:flex;gap:6px;margin-top:6px;">
                            <button class="btn-action" style="flex:1;" onclick="PlayerSectModule.approveExchange(${r.id})">全部通过</button>
                            ${partialBtn}
                            <button class="btn-action btn-danger" style="flex:1;" onclick="PlayerSectModule.rejectExchange(${r.id})">拒绝</button>
                        </div>
                    </div>`;
                });
            }
            html += '</div>';
            showGameModal('待审批兑换申请', html);
        } catch(e) {
            showToast('网络异常', 'error');
        }
    },

    async approveExchange(requestId) {
        try {
            const res = await api.post('/api/game/player-sect/approve-exchange', { requestId });
            showToast(res.code === 200 ? '已通过' : (res.message || '操作失败'));
            if (res.code === 200) {
                await this.loadPlayerSectInfo();
                this.showExchangeRequests();
            }
        } catch(e) {
            showToast('网络异常', 'error');
        }
    },

    partialApproveExchange(requestId, requestAmount) {
        const maxPartial = Math.max(1, requestAmount - 1);
        gamePrompt(`部分通过：申请数量为 ${requestAmount} 件\n请输入批准数量（1~${maxPartial}）：`, '1', async (val) => {
            const qty = parseInt(val, 10);
            if (isNaN(qty) || qty <= 0 || qty >= requestAmount) {
                showToast(`部分通过数量需在 1~${maxPartial} 之间`);
                return;
            }
            try {
                const res = await api.post('/api/game/player-sect/approve-exchange', { requestId, approvedAmount: qty });
                if (res.code === 200) {
                    showToast(`已部分通过，批准 ${qty} 件`);
                    await this.loadPlayerSectInfo();
                    this.showExchangeRequests();
                } else {
                    showToast(res.message || '操作失败', 'error');
                }
            } catch(e) {
                showToast('网络异常', 'error');
            }
        }, null, false, PlayerSectModule.integerInputOptions(1, maxPartial));
    },

    rejectExchange(requestId) {
        gamePrompt('拒绝原因（必填）：', '', async (reason) => {
            if (!reason || !reason.trim()) { showToast('需填写拒绝原因'); return; }
            try {
                const res = await api.post('/api/game/player-sect/reject-exchange', { requestId, reason: reason.trim() });
                showToast(res.code === 200 ? '已拒绝' : (res.message || '操作失败'));
                if (res.code === 200) {
                    await this.loadPlayerSectInfo();
                    this.showExchangeRequests();
                }
            } catch(e) {
                showToast('网络异常', 'error');
            }
        });
    },

    // ===== 宗主调整长老权限 =====
    showEditPermissions(targetId, targetName, currentPerms) {
        let html = `<div style="padding:8px;">
            <div style="color:var(--text-muted);margin-bottom:10px;font-size:12px;">为【${escapeHtml(targetName)}】勾选开放的权限（-1 即默认全开）</div>`;
        SECT_PERM_LIST.forEach(p => {
            const checked = (currentPerms & p.bit) !== 0 ? 'checked' : '';
            html += `<label style="display:flex;align-items:center;gap:6px;padding:4px 0;">
                <input type="checkbox" data-bit="${p.bit}" ${checked}> ${p.label}
            </label>`;
        });
        html += `<div style="display:flex;gap:6px;margin-top:14px;">
            <button class="modal-btn modal-btn--outline" style="flex:1;" onclick="closeModal()">取消</button>
            <button class="modal-btn modal-btn--gold" style="flex:1;" onclick="PlayerSectModule.saveMemberPermissions(${targetId})">保存</button>
        </div></div>`;
        showGameModal('调整长老权限', html);
    },

    async saveMemberPermissions(targetId) {
        const boxes = document.querySelectorAll('#customModal input[type="checkbox"][data-bit]');
        let perms = 0;
        boxes.forEach(b => { if (b.checked) perms |= parseInt(b.getAttribute('data-bit'), 10); });
        try {
            const res = await api.post('/api/game/player-sect/set-member-permissions', { targetPlayerId: targetId, permissions: perms });
            showToast(res.code === 200 ? '权限已更新' : (res.message || '操作失败'));
            if (res.code === 200) { closeModal(); this.showMembers(); }
        } catch(e) {
            showToast('网络异常', 'error');
        }
    },

    extractItem(itemId, maxQty, name, priceContribution, baseSellPrice, materialPrice, materialPriceText) {
        var defaultCost = Math.max(1, Math.floor((baseSellPrice || 0) * 1.2));
        var unitCost = priceContribution >= 0 ? Math.max(priceContribution || 0, defaultCost) : defaultCost;
        if (materialPrice) {
            const matText = materialPriceText || materialPrice;
            const html = `<div style="padding:8px;">
                <div class="modal-info-card modal-info-card--jade">
                    <div class="modal-info-card__title modal-info-card__title--jade">选择提取方式</div>
                    <div style="font-size:12px;color:var(--text-muted);line-height:1.7;">
                        【${escapeHtml(name)}】当前库存 ${maxQty} 件。材料提取会消耗您背包中的材料，不扣可用贡献。
                    </div>
                </div>
                <div class="psect-extract-choice-row">
                    <button class="modal-btn modal-btn--outline psect-extract-choice-btn" onclick="PlayerSectModule.promptExtractItem('${itemId}', ${maxQty}, ${jsAttr(name)}, ${unitCost}, 'CONTRIBUTION')">
                        <span class="psect-extract-choice-btn__title">贡献提取</span>
                        <span class="psect-extract-choice-btn__sub">${unitCost} 贡献/件</span>
                    </button>
                    <button class="modal-btn modal-btn--gold psect-extract-choice-btn" onclick="PlayerSectModule.promptExtractItem('${itemId}', ${maxQty}, ${jsAttr(name)}, ${unitCost}, 'MATERIAL')">
                        <span class="psect-extract-choice-btn__title">材料提取</span>
                        <span class="psect-extract-choice-btn__sub" title="${escapeHtml(matText)}">${escapeHtml(matText)}/件</span>
                    </button>
                </div>
            </div>`;
            showGameModal('选择提取方式', html);
            return;
        }
        this.promptExtractItem(itemId, maxQty, name, unitCost, 'CONTRIBUTION');
    },

    promptExtractItem(itemId, maxQty, name, unitCost, paymentMethod) {
        const isMaterial = paymentMethod === 'MATERIAL';
        const costText = isMaterial ? '消耗材料，不扣贡献' : `每件消耗: ${unitCost} 可用贡献`;
        gamePrompt(`提取宗门物资：【${name}】\n当前库存: ${maxQty}件\n${costText}\n请输入提取数量：`, '1', async function(val) {
            var qty = parseInt(val, 10);
            if (isNaN(qty) || qty <= 0 || qty > maxQty) {
                showToast('提取数量无效');
                return;
            }
            try {
                var res = await api.post('/api/game/player-sect/extract-item', {
                    warehouseId: itemId, // Database ID corresponding to PlayerSectItems.id
                    amount: qty,
                    paymentMethod: paymentMethod
                });
                if (res.code === 200) {
                    showToast('提取成功');
                    if (typeof closeGameModal === 'function') closeGameModal();
                    PlayerSectModule.showWarehouse(); // refresh
                    loadInventory();
                } else {
                    showToast(res.message);
                }
            } catch(e) {
                showToast('网络异常');
            }
        }, null, false, PlayerSectModule.integerInputOptions(1, maxQty));
    },

    donateStone() {
        const balance = (this.sectInfo && this.sectInfo.currentStones) || (window._lastPlayerData && window._lastPlayerData.lowerStone) || 0;
        const maxDonate = Math.floor(balance / 10);
        if (maxDonate <= 0) {
            showToast('当前余额不足，今日暂无可存入额度');
            return;
        }
        gamePrompt(`向宗门金库存入灵石（兑换比例 1灵石 = 1贡献点）：\n每日限一次，单次最多当前余额10%，本次最多 ${this.formatStone(maxDonate)} 灵石：`, String(Math.min(maxDonate, 100)), async function(val) {
            const amount = parseInt(val, 10);
            if (isNaN(amount) || amount <= 0) {
                showToast('金额无效');
                return;
            }
            if (amount > maxDonate) {
                showToast('今日最多可存入 ' + PlayerSectModule.formatStone(maxDonate) + ' 灵石');
                return;
            }
            try {
                const res = await api.post('/api/game/player-sect/donate-stone', { amount });
                if (res.code === 200) {
                    showToast('存入成功');
                    SectModule.loadInfo(); // Refresh available contribution
                    if (typeof loadPlayerInfo === 'function') loadPlayerInfo(); // Refresh stones
                } else {
                    showToast(res.message || '存入失败', 'error');
                }
            } catch(e) {
                showToast('网络异常', 'error');
            }
        }, null, false, PlayerSectModule.integerInputOptions(1, maxDonate));
    },

    async quickDonate() {
        try {
            const res = await api.get('/api/game/inventory');
            if (res.code === 200) {
                this.renderDonateModal(res.data);
            } else {
                showToast(res.message);
            }
        } catch (e) {
            showToast('获取包裹失败');
        }
    },

    renderDonateModal(inventoryList) {
        const minRarity = this.sectInfo.minDonateRarity || 0;
        const equipTypes = ['weapon', 'armor', 'accessory', 'ring'];

        const aggMap = new Map();
        const equipList = [];

        inventoryList.forEach(item => {
            const isFrozen = item.tradeCooldown && item.tradeCooldown > Date.now();
            if (item.type === 'currency' || item.isEquipped || isFrozen || item.isLocked) return;
            if (item.isNatal || item.isNatalArtifact || item.isIncarnationEquipped) return;
            if ((item.rarity || 0) < minRarity) return;

            if (equipTypes.indexOf(item.type) >= 0) {
                equipList.push(item);
            } else {
                const k = item.templateId;
                if (!aggMap.has(k)) {
                    aggMap.set(k, { templateId: k, name: item.name, type: item.type, sellPrice: item.sellPrice || 0, qty: 0, minStage: item.minStage || 0 });
                }
                aggMap.get(k).qty += (item.quantity || 1);
            }
        });

        if (aggMap.size === 0 && equipList.length === 0) {
            const emptyHtml =
                '<div class="modal-header-deco">' +
                    '<div class="modal-header-deco__subtitle">宗门捐献</div>' +
                    '<div style="font-size:12px; color:var(--text-muted); margin-top:8px;">你的背包中没有可捐献的物资。</div>' +
                '</div>' +
                '<div class="modal-body-padded">' +
                    '<div class="modal-info-card modal-info-card--jade">' +
                        '<div class="modal-info-card__title modal-info-card__title--jade">✦ 提示</div>' +
                        '<div style="font-size:12px;color:var(--text-muted);line-height:1.6;">前往秘境历练或市集采购，再来捐献也不迟。</div>' +
                    '</div>' +
                '</div>';
            showModal(emptyHtml, 'modal-overlay--top ui-scrollable-modal');
            return;
        }

        // 按"特殊词条/状态 + 物品类型"分组，并用 tab 切换展示。
        const groups = {
            special:   { label: '特殊装备', items: [] },
            equip:     { label: '普通装备', items: [] },
            pill:      { label: '丹药',     items: [] },
            blueprint: { label: '图纸',     items: [] },
            scroll:    { label: '卷轴',     items: [] },
            material:  { label: '材料杂物', items: [] },
            furnace:   { label: '丹炉',     items: [] }
        };
        const groupOrder = ['special', 'equip', 'pill', 'blueprint', 'scroll', 'material', 'furnace'];

        equipList.forEach(item => {
            const isSpecial = this._isSpecialDonateItem(item);
            const contrib = Math.max(1, Math.floor((item.sellPrice || 0) * 1.2));
            const tags = [];
            if (item.refineLevel > 0) tags.push('+' + item.refineLevel);
            if (item.isNatal) tags.push('本命');
            if (item.extension && item.extension !== 'null') {
                try {
                    const ext = JSON.parse(item.extension);
                    if (ext && ext.affix && ext.affix.name) tags.push('词条·' + ext.affix.name);
                } catch (e) {}
            }
            if (item.inscriptionsJson && item.inscriptionsJson !== '' && item.inscriptionsJson !== '[]') tags.push('铭文');
            const tagText = tags.length ? ' [' + tags.join('/') + ']' : '';
            const minStage = this.getItemMinStage(item);
            const stageMeta = this.getStageMetaHtml(minStage);
            (isSpecial ? groups.special : groups.equip).items.push({
                key: 'inst:' + item.id,
                instanceId: String(item.id),
                baseId: item.templateId,
                qty: item.quantity || 1,
                contribPer: contrib,
                minStage: minStage,
                search: ((item.name || '') + tagText).toLowerCase(),
                nameHtml: escapeHtml(item.name) + escapeHtml(tagText),
                metaHtml: '×' + (item.quantity || 1) + ' · ' + contrib + '贡/件' + (stageMeta ? ' · ' + stageMeta : '')
            });
        });

        aggMap.forEach(g => {
            const contrib = Math.max(1, Math.floor(g.sellPrice * 1.2));
            const groupKey = this._classifyDonateGroup(g.type);
            const minStage = this.getItemMinStage(g);
            const stageMeta = this.getStageMetaHtml(minStage);
            groups[groupKey].items.push({
                key: 'tpl:' + g.templateId,
                instanceId: '',
                baseId: g.templateId,
                qty: g.qty,
                contribPer: contrib,
                minStage: minStage,
                search: (g.name || '').toLowerCase(),
                nameHtml: escapeHtml(g.name),
                metaHtml: '×' + g.qty + ' · ' + contrib + '贡/件' + (stageMeta ? ' · ' + stageMeta : '')
            });
        });

        this._donateGroups = groups;
        this._donateGroupOrder = groupOrder;
        this._donateActiveGroup = groupOrder.find(gk => groups[gk].items.length > 0) || 'material';

        const isManager = this.sectInfo && (this.sectInfo.myRole === 'MASTER' || this.sectInfo.myRole === 'ELDER');
        const availableContrib = (this.sectInfo && this.sectInfo.myAvailableContribution) || 0;
        const priceField = isManager ? `
                <div class="modal-info-card" style="margin-top: 16px;">
                    <div class="modal-info-card__title">✦ 兑换定价 <span class="psect-donate-hint">（管理专属，留空使用默认价）</span></div>
                    <input type="number" id="psectDonatePrice" class="app-input" placeholder="留空=默认贡献价，-1=暂不上架" min="-1">
                </div>` : '';
        const tipText = isManager
            ? '作为管理，您可在捐献时直接设定兑换价格。留空使用默认贡献价；输入 -1 表示暂不上架，低于默认贡献价会按默认价处理。'
            : '捐献后您将获得出售价 120% 的宗门贡献。同时资源将自动归入宗门仓库的公共库（默认设定为原售价的120%供同门兑换，宗主/长老可再次改价）。';

        this._donateSelected = {};
        const html = `
            <div class="modal-header-deco">
                <div class="modal-header-deco__subtitle">宗门捐献</div>
                <div class="modal-header-deco__value" style="margin-bottom: 4px;">
                    <span class="modal-header-deco__num" style="color:var(--text-gold);">${availableContrib}</span>
                    <span class="modal-header-deco__unit" style="margin-left:6px;">可用贡献</span>
                </div>
                <div style="font-size:12px; color:var(--text-muted);">${tipText}</div>
            </div>
            <div class="modal-body-padded">
                <div class="modal-info-card modal-info-card--jade">
                    <div class="modal-info-card__title modal-info-card__title--jade">✦ 选择闲置物资 <span class="psect-donate-hint">（可勾选多项一次性上交）</span></div>
                    <div class="psect-donate-toolbar">
                        <input id="psectDonateSearch" class="app-input psect-donate-search" placeholder="输入名称搜索..." oninput="PlayerSectModule.filterDonateOptions()">
                        <select id="psectDonateStageFilter" class="app-select" onchange="PlayerSectModule.filterDonateOptions()">
                            ${this.getStageOptionsHtml(null)}
                        </select>
                        <button type="button" class="psect-donate-link" onclick="PlayerSectModule.toggleDonateSelectAll()">全选/取消本类</button>
                    </div>
                    <div id="psectDonateTabs" class="psect-donate-tabs" role="tablist"></div>
                    <div id="psectDonateGroups" class="psect-donate-list"></div>
                    <div id="psectDonatePreview" class="psect-donate-preview"></div>
                </div>
                ${priceField}
                <div class="modal-action-list" style="margin-top: 16px;">
                    <button class="modal-action-btn" id="psectDonateSubmitBtn" style="height:40px; padding:0 16px; display:flex; justify-content:center;" onclick="PlayerSectModule.submitDonateForm()">
                        <span style="text-align:center; font-weight:bold; color:var(--text-primary); width:100%;">上交所选物资</span>
                    </button>
                </div>
            </div>
        `;
        showModal(html, 'modal-overlay--top ui-scrollable-modal psect-donate-modal-overlay');
        this._renderDonateGroups();
        this.updateDonatePreview();
    },

    _isSpecialDonateItem(item) {
        if (!item) return false;
        if (item.refineLevel && item.refineLevel > 0) return true;
        if (item.isNatal) return true;
        if (item.inscriptionsJson && item.inscriptionsJson !== '' && item.inscriptionsJson !== '[]') return true;
        if (item.extension && item.extension !== 'null') {
            try {
                const ext = JSON.parse(item.extension);
                if (ext && ext.affix && ext.affix.name) return true;
            } catch (e) {}
        }
        return false;
    },

    _classifyDonateGroup(type) {
        if (type === 'pill') return 'pill';
        if (type === 'blueprint') return 'blueprint';
        if (type === 'skill_scroll' || type === 'art_scroll') return 'scroll';
        if (type === 'furnace') return 'furnace';
        return 'material';
    },

    _donateSelected: {}, // { key: { baseId, instanceId, qty, max, contribPer } }
    _donateBatchLimit: 50,
    _donateActiveGroup: 'material',

    _findDonateItem(key) {
        for (const gk of (this._donateGroupOrder || [])) {
            const g = this._donateGroups && this._donateGroups[gk];
            if (!g) continue;
            const it = g.items.find(x => x.key === key);
            if (it) return it;
        }
        return null;
    },

    _donateSelectedEntryCount() {
        return Object.keys(this._donateSelected || {}).length;
    },

    _visibleDonateItems(gk) {
        const g = this._donateGroups && this._donateGroups[gk];
        if (!g || !g.items) return [];
        const kwEl = document.getElementById('psectDonateSearch');
        const kw = kwEl ? (kwEl.value || '').trim().toLowerCase() : '';
        const stageFilter = this.getStageFilterValue('psectDonateStageFilter');
        return g.items.filter(it => {
            if (kw && it.search.indexOf(kw) < 0) return false;
            if (stageFilter !== null && this.getItemMinStage(it) !== stageFilter) return false;
            return true;
        });
    },

    _selectDonateItem(it, checked) {
        if (!it) return false;
        if (checked) {
            if (!this._donateSelected[it.key] && this._donateSelectedEntryCount() >= this._donateBatchLimit) {
                return false;
            }
            const currentQty = (this._donateSelected[it.key] && this._donateSelected[it.key].qty) || it.qty;
            this._donateSelected[it.key] = {
                baseId: it.baseId,
                instanceId: it.instanceId || '',
                qty: Math.max(1, Math.min(it.qty, currentQty)),
                max: it.qty
            };
        } else {
            delete this._donateSelected[it.key];
        }
        return true;
    },

    _renderDonateGroups() {
        const wrap = document.getElementById('psectDonateGroups');
        if (!wrap || !this._donateGroups) return;
        const tabs = document.getElementById('psectDonateTabs');
        const visibleByGroup = {};
        const visibleKeys = (this._donateGroupOrder || []).filter(gk => {
            const visible = this._visibleDonateItems(gk);
            visibleByGroup[gk] = visible;
            return visible.length > 0;
        });

        if (!visibleKeys.length) {
            if (tabs) tabs.innerHTML = '';
            wrap.innerHTML = '<div class="psect-donate-empty">未找到匹配的物资</div>';
            return;
        }

        if (visibleKeys.indexOf(this._donateActiveGroup) === -1) {
            this._donateActiveGroup = visibleKeys[0];
        }

        if (tabs) {
            tabs.innerHTML = visibleKeys.map(gk => {
                const g = this._donateGroups[gk];
                const active = gk === this._donateActiveGroup;
                return '<button type="button" class="psect-donate-tab' + (active ? ' psect-donate-tab--active' : '') + '" role="tab" aria-selected="' + (active ? 'true' : 'false') + '" onclick="PlayerSectModule.selectDonateTab(\'' + gk + '\')">' +
                    '<span>' + escapeHtml(g.label) + '</span><b>' + visibleByGroup[gk].length + '</b>' +
                    '</button>';
            }).join('');
        }

        const visible = visibleByGroup[this._donateActiveGroup] || [];
        const rows = visible.map(it => {
            const sel = this._donateSelected[it.key];
            const checked = !!sel;
            const curQty = checked ? sel.qty : it.qty;
            const safeKey = it.key.replace(/[^a-zA-Z0-9_]/g, '_');
            const nameHtml = it.nameHtml || it.label || '';
            const metaHtml = it.metaHtml || '';
            return '<label class="psect-donate-row' + (checked ? ' psect-donate-row--active' : '') + '">' +
                '<input type="checkbox" class="psect-donate-check" data-key="' + escapeHtml(it.key) + '" ' + (checked ? 'checked' : '') + '>' +
                '<span class="psect-donate-row__main">' +
                    '<span class="psect-donate-row__name">' + nameHtml + '</span>' +
                    (metaHtml ? '<span class="psect-donate-row__meta">' + metaHtml + '</span>' : '') +
                '</span>' +
                '<input type="number" class="psect-donate-qty" id="psd_' + safeKey + '" data-key="' + escapeHtml(it.key) + '" min="1" max="' + it.qty + '" value="' + curQty + '"' + (checked ? '' : ' disabled') + '>' +
                '</label>';
        }).join('');

        wrap.innerHTML = '<div class="psect-donate-tab-panel">' + rows + '</div>';

        wrap.querySelectorAll('.psect-donate-check').forEach(cb => {
            cb.addEventListener('change', e => this._onDonateCheck(e.target));
        });
        wrap.querySelectorAll('.psect-donate-qty').forEach(inp => {
            inp.addEventListener('input', e => this._onDonateQty(e.target));
            inp.addEventListener('blur', e => this._onDonateQtyBlur(e.target));
            inp.addEventListener('click', e => e.stopPropagation());
        });
    },

    selectDonateTab(groupKey) {
        if (!this._donateGroups || !this._donateGroups[groupKey]) return;
        this._donateActiveGroup = groupKey;
        this._renderDonateGroups();
    },

    _onDonateCheck(input) {
        const key = input.getAttribute('data-key');
        const it = this._findDonateItem(key);
        if (!it) return;
        const row = input.closest('.psect-donate-row');
        const qtyEl = row ? row.querySelector('.psect-donate-qty') : null;
        if (input.checked) {
            if (!this._donateSelected[key] && this._donateSelectedEntryCount() >= this._donateBatchLimit) {
                input.checked = false;
                showToast('一次最多上交 ' + this._donateBatchLimit + ' 项，请先提交或取消部分选择');
                return;
            }
            const cur = (this._donateSelected[key] && this._donateSelected[key].qty) || (parseInt(qtyEl?.value, 10) || it.qty);
            this._donateSelected[key] = {
                baseId: it.baseId,
                instanceId: it.instanceId || '',
                qty: Math.max(1, Math.min(it.qty, cur)),
                max: it.qty
            };
            if (row) row.classList.add('psect-donate-row--active');
            if (qtyEl) { qtyEl.disabled = false; qtyEl.value = this._donateSelected[key].qty; }
        } else {
            delete this._donateSelected[key];
            if (row) row.classList.remove('psect-donate-row--active');
            if (qtyEl) qtyEl.disabled = true;
        }
        this.updateDonatePreview();
    },

    _onDonateQty(input) {
        const key = input.getAttribute('data-key');
        const max = parseInt(input.getAttribute('max'), 10) || 1;
        const raw = (input.value || '').trim();
        if (raw === '') {
            if (this._donateSelected[key]) {
                this._donateSelected[key].qty = 1;
                this.updateDonatePreview();
            }
            return;
        }
        let v = parseInt(raw, 10);
        if (!Number.isFinite(v) || v < 1) v = 1;
        if (v > max) v = max;
        if (this._donateSelected[key]) {
            this._donateSelected[key].qty = v;
            this.updateDonatePreview();
        }
    },

    _onDonateQtyBlur(input) {
        const key = input.getAttribute('data-key');
        const max = parseInt(input.getAttribute('max'), 10) || 1;
        let v = parseInt(input.value, 10);
        if (!Number.isFinite(v) || v < 1) v = 1;
        if (v > max) v = max;
        input.value = String(v);
        if (this._donateSelected[key]) {
            this._donateSelected[key].qty = v;
            this.updateDonatePreview();
        }
    },

    updateDonatePreview() {
        const preview = document.getElementById('psectDonatePreview');
        if (!preview) return;
        let totalContrib = 0;
        let totalCount = 0;
        Object.keys(this._donateSelected).forEach(key => {
            const sel = this._donateSelected[key];
            const it = this._findDonateItem(key);
            if (!it) return;
            const contribPer = it.contribPer || 1;
            totalContrib += contribPer * sel.qty;
            totalCount += sel.qty;
        });
        if (totalCount === 0) {
            preview.innerHTML = '<span style="color:var(--text-muted);">尚未勾选物资</span>';
            return;
        }
        const selectedEntries = this._donateSelectedEntryCount();
        preview.innerHTML = '<span style="color:var(--text-muted);">已选 ' + selectedEntries + '/' + this._donateBatchLimit + ' 项 · 合计 ' + totalCount + ' 件 · 预计获得</span> ' +
            '<span style="color:var(--text-gold);font-weight:bold;">' + totalContrib + '</span> ' +
            '<span style="color:var(--text-muted);">贡献</span>';
    },

    toggleDonateSelectAll() {
        this._toggleDonateItems(this._visibleDonateItems(this._donateActiveGroup));
    },

    toggleDonateGroupSelect(gk, ev) {
        if (ev) {
            ev.preventDefault();
            ev.stopPropagation();
        }
        this._toggleDonateItems(this._visibleDonateItems(gk));
    },

    _toggleDonateItems(items) {
        if (!items || !items.length) return;
        const allSelected = items.every(it => this._donateSelected[it.key]);
        if (allSelected) {
            items.forEach(it => this._selectDonateItem(it, false));
            this._renderDonateGroups();
            this.updateDonatePreview();
            return;
        }

        let added = 0;
        let blocked = 0;
        items.forEach(it => {
            const wasSelected = !!this._donateSelected[it.key];
            const ok = this._selectDonateItem(it, true);
            if (ok && !wasSelected) added++;
            if (!ok) blocked++;
        });
        this._renderDonateGroups();
        this.updateDonatePreview();
        if (blocked > 0) {
            showToast('已选满 ' + this._donateBatchLimit + ' 项，本次只补选了 ' + added + ' 项');
        }
    },

    filterDonateOptions() {
        this._renderDonateGroups();
    },

    async submitDonateForm() {
        const skippedLocal = [];
        const items = Object.keys(this._donateSelected).map(key => {
            const sel = this._donateSelected[key];
            const amount = parseInt(sel.qty, 10);
            if (!sel.baseId || !Number.isFinite(amount) || amount <= 0) {
                skippedLocal.push(key);
                return null;
            }
            const entry = { itemBaseId: String(sel.baseId), amount: amount };
            if (sel.instanceId && sel.instanceId !== 'null' && sel.instanceId !== '') {
                const instanceId = parseInt(sel.instanceId, 10);
                if (!Number.isFinite(instanceId)) {
                    skippedLocal.push(key);
                    return null;
                }
                entry.instanceId = instanceId;
            }
            return entry;
        }).filter(Boolean);
        if (!items.length) { showToast('请勾选要上交的物资'); return; }
        if (skippedLocal.length > 0) {
            showToast('已跳过 ' + skippedLocal.length + ' 项异常物资，请刷新背包后再试', 'warn');
        }
        if (items.length > this._donateBatchLimit) {
            showToast('一次最多上交 ' + this._donateBatchLimit + ' 项，请分批');
            return;
        }

        const priceEl = document.getElementById('psectDonatePrice');
        if (priceEl && priceEl.value.trim() !== '') {
            const p = parseInt(priceEl.value, 10);
            if (!isNaN(p)) items.forEach(e => e.price = p);
        }

        const btn = document.getElementById('psectDonateSubmitBtn');
        if (btn) { btn.disabled = true; btn.querySelector('span').textContent = '上交中…'; }
        try {
            const res = await api.post('/api/game/player-sect/donate-item-batch', { items });
            if (res.code === 200) {
                const d = res.data || {};
                let msg = (d.successCount || 0) > 0
                    ? '成功上交 ' + (d.successCount || 0) + ' 项，获得 ' + (d.totalContrib || 0) + ' 贡献'
                    : '未成功上交物资';
                if (d.skipped && d.skipped.length) msg += '，' + d.skipped.length + ' 项未通过';
                showToast(msg);
                if (d.skipped && d.skipped.length) {
                    setTimeout(() => showToast(d.skipped.slice(0, 3).join('；'), 'warn'), 800);
                }
                closeGameModal();
                if (typeof loadInventory === 'function') loadInventory();
                if (typeof SectModule !== 'undefined' && typeof SectModule.loadInfo === 'function') {
                    await SectModule.loadInfo();
                }
                await this.loadPlayerSectInfo();
                this.loadAndRenderLogs();
            } else {
                showToast(res.message || '上交失败', 'error');
            }
        } catch(e) {
            showToast('操作异常', 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.querySelector('span').textContent = '上交所选物资'; }
        }
    },

    // ===== 宗门内置商铺 =====
    builtinShopCache: [],
    builtinShopStageFilter: null,

    async showBuiltinShop() {
        try {
            // 首次进商铺时储物缓存可能为空，先拉一次以保证"储物已有"准确
            if (typeof _inventoryCache !== 'undefined' && (!_inventoryCache || _inventoryCache.length === 0)) {
                try {
                    const invRes = await api.get('/api/game/inventory');
                    if (invRes.code === 200 && Array.isArray(invRes.data)) _inventoryCache = invRes.data;
                } catch (e) { /* ignore */ }
            }
            const res = await api.get('/api/game/player-sect/builtin-shop');
            if (res.code === 200) {
                this.builtinShopCache = res.data || [];
                this.renderBuiltinShopSkeleton();
                this.renderBuiltinShopItems();
            } else {
                showToast(res.message);
            }
        } catch(e) {
            showToast('网络异常', 'error');
        }
    },

    renderBuiltinShopSkeleton() {
        const myContrib = (this.sectInfo && this.sectInfo.myAvailableContribution) || 0;
        const treasury = (this.sectInfo && this.sectInfo.treasury) || 0;
        const isManage = this.sectInfo && (this.sectInfo.myRole === 'MASTER' || this.sectInfo.myRole === 'ELDER');
        const shopOpen = !this.sectInfo || this.sectInfo.builtinShopOpen !== false;
        const statusBadge = shopOpen
            ? '<span style="color:var(--accent-jade);font-weight:bold;">已开放</span>'
            : '<span style="color:var(--text-orange);font-weight:bold;">已关闭</span>';
        const toggleBtn = isManage
            ? `<button class="btn-action btn-sm" style="margin-left:8px;font-size:12px;" onclick="PlayerSectModule.toggleBuiltinShop(${shopOpen ? 'false' : 'true'})">${shopOpen ? '关闭商铺' : '开放商铺'}</button>`
            : '';
        const html = `
        <div class="modal-info-card">
            <div class="modal-info-card__title">✦ 宗门商铺</div>
            <p style="color:var(--text-muted);font-size:12px;line-height:1.6;margin:6px 0 0;">
                以宗门贡献兑换通用物资。长老及宗主享 9 折优惠。每兑换 1 点贡献需由宗门金库承担 2 灵石支出。
            </p>
            <div style="margin-top:8px;display:flex;gap:14px;flex-wrap:wrap;align-items:center;color:var(--text-secondary);font-size:13px;">
                <span>状态：${statusBadge}${toggleBtn}</span>
                <span>可用贡献：<b style="color:var(--text-gold);">${myContrib}</b></span>
                <span>宗门金库：<b style="color:var(--accent-gold);">${treasury}</b> 灵石</span>
                <select id="psectBuiltinShopStageFilter" class="app-select" style="width:104px;" onchange="PlayerSectModule.onBuiltinShopStageChange(this.value)">
                    ${this.getStageOptionsHtml(this.builtinShopStageFilter)}
                </select>
            </div>
        </div>
        <div class="modal-info-card modal-info-card--jade">
            <div class="modal-info-card__title modal-info-card__title--jade">✦ 在售珍品</div>
            <div id="psectBuiltinShopList" class="sect-shop-list" style="max-height:50vh; overflow-y:auto; padding-right:4px;">
                <!-- dynamic list -->
            </div>
        </div>
        `;
        this._openDecoratedModal('宗门商铺', html);
    },

    async toggleBuiltinShop(open) {
        try {
            const res = await api.post('/api/game/player-sect/toggle-builtin-shop', { open: !!open });
            if (res.code === 200) {
                showToast(res.data || (open ? '已开放' : '已关闭'));
                await this.loadPlayerSectInfo();
                this.showBuiltinShop();
            } else {
                showToast(res.message || '切换失败');
            }
        } catch (e) {
            showToast(e.message || '网络异常', 'error');
        }
    },

    onBuiltinShopStageChange(val) {
        const raw = (val || '').trim();
        this.builtinShopStageFilter = raw === '' ? null : parseInt(raw, 10);
        if (!Number.isFinite(this.builtinShopStageFilter)) this.builtinShopStageFilter = null;
        this.renderBuiltinShopItems();
    },

    renderBuiltinShopItems() {
        const container = document.getElementById('psectBuiltinShopList');
        if (!container) return;
        const shopOpen = !this.sectInfo || this.sectInfo.builtinShopOpen !== false;
        if (!shopOpen) {
            container.innerHTML = '<p class="inventory-empty" style="color:var(--text-orange);">宗门商铺当前已关闭，请联系宗主或长老开放。</p>';
            return;
        }
        let items = this.builtinShopCache || [];
        if (this.builtinShopStageFilter !== null) {
            items = items.filter(item => this.getItemMinStage(item) === this.builtinShopStageFilter);
        }
        if (items.length === 0) {
            container.innerHTML = '<p class="inventory-empty">商铺暂未上架商品</p>';
            return;
        }
        let html = '';
        items.forEach(item => {
            const colorFn = (typeof getRarityColor === 'function') ? getRarityColor : null;
            const nameStyle = colorFn ? ('color:' + colorFn(item.rarity)) : '';
            const safeId = item.templateId.replace(/[^a-zA-Z0-9_]/g, '_');
            const qtyId = 'psectShopQty_' + safeId;
            const isService = item.type === 'service';
            const stoneCost = item.costContrib * 1;
            const ownedQty = item.realItemId && typeof getOwnedItemQuantity === 'function' ? getOwnedItemQuantity(item.realItemId) : 0;
            const ownedHtml = item.realItemId ? ` · <span style="color:var(--accent-jade);">储物已有 ${ownedQty}</span>` : '';
            const stageHtml = this.getStageMetaHtml(this.getItemMinStage(item));
            html += `
                <div class="sect-shop-item">
                    <div class="sect-shop-item-info">
                        <span class="sect-shop-item-name" style="${nameStyle}">${escapeHtml(item.name)}</span>
                        <span class="sect-shop-item-desc">${escapeHtml(item.description || '')}</span>
                        <span class="sect-shop-item-price">${item.costContrib} 贡献 · 金库 ${stoneCost} 灵石${stageHtml ? ' · ' + stageHtml : ''}${ownedHtml}</span>
                    </div>
                    <div class="sect-shop-item-actions">
                        ${!isService ? `<input type="number" id="${qtyId}" class="sect-shop-qty" value="1" min="1" max="99">` : ''}
                        <button class="sect-btn-buy" onclick="PlayerSectModule.buyBuiltinShopItem('${item.templateId}', ${isService ? 'null' : `'${qtyId}'`}, ${item.costContrib})">${isService ? '接受治疗' : '兑换'}</button>
                    </div>
                </div>
            `;
        });
        container.innerHTML = html;
    },

    buyBuiltinShopItem(itemId, qtyInputId, unitContrib) {
        const count = qtyInputId ? Math.min(99, Math.max(1, parseInt(document.getElementById(qtyInputId)?.value) || 1)) : 1;
        const totalContrib = (unitContrib || 0) * count;
        const totalStone = totalContrib * 1;
        const confirmMsg = count > 1
            ? `确定兑换 ${count} 件？\n消耗 ${totalContrib} 贡献，宗门金库支出 ${totalStone} 灵石。`
            : `确定？\n消耗 ${totalContrib} 贡献，宗门金库支出 ${totalStone} 灵石。`;
        gameConfirm(confirmMsg, async () => {
            try {
                const res = await api.post('/api/game/player-sect/buy-builtin-item', { itemId, quantity: count });
                if (res.code === 200) {
                    showToast(count > 1 ? `成功兑换 ${count} 件` : '操作成功');
                    await this.loadPlayerSectInfo();
                    this.showBuiltinShop();
                    if (typeof loadPlayerInfo === 'function') loadPlayerInfo();
                } else {
                    showToast(res.message || '操作失败');
                }
            } catch (e) {
                showToast(e.message || '网络异常', 'error');
            }
        });
    },

    async showTasks() {
        try {
            const res = await api.get('/api/game/player-sect/list-tasks');
            if (res.code === 200) {
                this.renderTasksModal(res.data);
            } else {
                showToast(res.message);
            }
        } catch(e) {
            showToast('网络异常');
        }
    },

    renderTasksModal(tasks) {
        const isManage = this.sectInfo.myRole === 'MASTER' || this.sectInfo.myRole === 'ELDER';
        let html = '';

        if (isManage) {
            html += `
                <div class="modal-info-card modal-info-card--jade">
                    <div class="modal-info-card__title modal-info-card__title--jade">✦ 长老布令</div>
                    <p style="font-size:12px;color:var(--text-secondary);margin:0 0 10px;">发布悬赏需指定材料编号，弟子提交后即得相应贡献。</p>
                    <button class="modal-action-btn modal-action-btn--orange" style="justify-content:center;" onclick="PlayerSectModule.publishTask()">+ 发布新悬赏</button>
                </div>
            `;
        }

        if (!tasks || tasks.length === 0) {
            html += '<div class="modal-info-card" style="text-align:center;color:var(--text-muted);padding:20px;">当前暂无悬赏任务</div>';
        } else {
            html += '<div style="max-height:55vh;overflow-y:auto;padding-right:4px;">';
            tasks.forEach(task => {
                const color = getRarityColor(task.itemQuality);
                const progressPct = Math.min(100, Math.floor(task.currentAmount / task.targetAmount * 100));
                const filled = task.currentAmount >= task.targetAmount;

                let actionHtml = '';
                if (!filled) {
                    actionHtml += `<button class="modal-btn modal-btn--outline" onclick="PlayerSectModule.submitTask(${task.id}, '${escapeHtml(task.itemName)}')" style="height:30px;padding:0 10px;font-size:12px;margin-right:4px;">提交物资</button>`;
                } else {
                    actionHtml += `<span style="font-size:12px;color:var(--accent-jade);margin-right:8px;">已满额</span>`;
                }
                if (isManage) {
                    actionHtml += `<button class="modal-btn modal-btn--danger" onclick="PlayerSectModule.deleteTask(${task.id})" style="height:30px;padding:0 10px;font-size:12px;">取消</button>`;
                }

                html += `
                    <div class="modal-info-card" style="margin-top:8px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;">
                            <div>
                                <div style="color:${color};font-weight:bold;">收集 ${escapeHtml(task.itemName)}</div>
                                <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">单件奖励: <span style="color:var(--text-gold);">${task.rewardPerItem} 贡献</span></div>
                                <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">发布人: ${escapeHtml(task.publisherName)}</div>
                            </div>
                            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
                                <div style="font-size:12px;font-family:monospace;color:var(--text-secondary);">${task.currentAmount} / ${task.targetAmount}</div>
                                <div style="display:flex;gap:4px;">${actionHtml}</div>
                            </div>
                        </div>
                        <div style="margin-top:8px;background:var(--bg-dark);height:4px;border-radius:2px;overflow:hidden;">
                            <div style="width:${progressPct}%;height:100%;background:${filled ? 'var(--accent-jade)' : 'var(--text-info)'};"></div>
                        </div>
                    </div>
                `;
            });
            html += '</div>';
        }
        this._openDecoratedModal('宗门悬赏', html);
    },

    publishTask() {
        const commonItems = [
            // 普通常见物资
            { id: 'herb_lingcao', name: '灵草 (1阶)' },
            { id: 'herb_lingzhi', name: '灵芝 (2阶)' },
            { id: 'herb_xuanlian', name: '玄莲花 (3阶)' },
            { id: 'herb_longsui', name: '龙髓草 (4阶)' },
            { id: 'ore_lingshi', name: '灵矿石 (1阶)' },
            { id: 'ore_jingshi', name: '精金矿 (3阶)' },
            { id: 'ore_tianjing', name: '天精矿 (4阶)' },
            { id: 'beast_core_low', name: '低阶妖核 (1阶)' },
            { id: 'beast_core_mid', name: '中阶妖核 (2阶)' },
            { id: 'beast_core_high', name: '高阶妖核 (3阶)' },
            { id: 'item_beast_core_low', name: '下品妖丹 (1阶)' },
            { id: 'item_beast_core_mid', name: '中品妖丹 (2阶)' },
            { id: 'item_beast_core_high', name: '上品妖丹 (4阶)' },
            // 北荒材料
            { id: 'mat_cold_iron', name: '寒铁矿石 (3阶)' },
            { id: 'mat_toxic_essence', name: '瘴毒精华 (3阶)' },
            { id: 'mat_frost_stone', name: '玄冰石 (4阶)' },
            { id: 'mat_ming_shard', name: '冥族碎片 (4阶)' },
            { id: 'mat_dragon_bone', name: '龙骨碎片 (4阶)' },
            { id: 'mat_void_residue', name: '虚空残渣 (4阶)' },
            { id: 'item_core_quality', name: '极品妖兽内丹 (4阶)' },
            { id: 'item_heaven_dew', name: '造化甘露 (5阶)' },
            { id: 'item_dragon_blood', name: '龙血果 (5阶)' },
            // 外荒材料
            { id: 'mat_ym_flower', name: '彼岸花 (4阶)' },
            { id: 'mat_jm_blood_jade', name: '沸血魔玉 (4阶)' },
            { id: 'mat_nine_grade_core', name: '万妖本源丹 (5阶)' },
            { id: 'mat_wy_bone', name: '上古真灵本命骨 (5阶)' },
            { id: 'mat_wy_ancestor_blood', name: '妖祖源血 (5阶)' },
            { id: 'mat_ym_spring', name: '幽冥泉眼 (5阶)' },
            { id: 'mat_tl_thunder_src', name: '劫雷之源 (5阶)' },
            { id: 'mat_tl_dragon_marrow', name: '真龙天髓 (5阶)' },
            { id: 'mat_jm_evil_core', name: '极恶魔气结晶 (5阶)' },
            { id: 'mat_jm_dao_src', name: '魔道法则本源 (5阶)' },
            { id: 'mat_cs_time_sand', name: '时之砂 (5阶)' },
            { id: 'mat_cs_life_essence', name: '寿华之精 (5阶)' },
            { id: 'mat_hd_void_crystal', name: '虚空结晶 (5阶)' },
            { id: 'mat_hd_chaos_core', name: '混沌晶核 (5阶)' }
        ];

        let selectHtml = '<select id="psectTaskItemId" class="app-input" style="width:100%;cursor:pointer;">';
        commonItems.forEach(i => {
            selectHtml += `<option value="${i.id}">${i.name}</option>`;
        });
        selectHtml += '</select>';

        const html = `
            <div class="modal-info-card">
                <div class="modal-info-card__title">✦ 悬赏配置</div>
                <label style="display:block;margin-bottom:4px;color:var(--text-muted);font-size:12px;">悬赏目标物资</label>
                ${selectHtml}
                <label style="display:block;margin:10px 0 4px;color:var(--text-muted);font-size:12px;">需求总数量</label>
                <input type="number" id="psectTaskTargetAmount" class="app-input" style="width:100%;" placeholder="例如: 100" min="1" max="99999" value="100">
                <label style="display:block;margin:10px 0 4px;color:var(--text-muted);font-size:12px;">单件奖励贡献 <span style="font-size:11px;color:var(--text-gold);">(上限: 99万)</span></label>
                <input type="number" id="psectTaskReward" class="app-input" style="width:100%;" placeholder="例如: 5" min="1" max="999999" value="5">
            </div>
            <p style="font-size:11px;color:var(--text-secondary);margin:12px 4px 0;line-height:1.4;">提示：成功发布后，全体弟子均可上交此物资赚取贡献。物资上限满后悬赏将自动撤下并放入总宗入库。</p>
            <div class="modal-btn-row">
                <button class="modal-btn modal-btn--gold" onclick="PlayerSectModule.submitPublishTask()">确认发布</button>
                <button class="modal-btn modal-btn--outline" onclick="PlayerSectModule.showTasks()">返回</button>
            </div>
        `;
        this._openDecoratedModal('发布宗门悬赏', html);
    },

    async submitPublishTask() {
        const itemBaseId = document.getElementById('psectTaskItemId').value;
        const targetAmount = parseInt(document.getElementById('psectTaskTargetAmount').value, 10);
        const rewardPerItem = parseInt(document.getElementById('psectTaskReward').value, 10);

        if (!itemBaseId || isNaN(targetAmount) || targetAmount <= 0) {
            showToast('输入数量不合法');
            return;
        }
        if (isNaN(rewardPerItem) || rewardPerItem <= 0 || rewardPerItem > 999999) {
            showToast('单件奖励贡献不合法(最高99万)');
            return;
        }

        try {
            const res = await api.post('/api/game/player-sect/publish-task', {
                itemBaseId: itemBaseId,
                targetAmount: targetAmount,
                rewardPerItem: rewardPerItem
            });
            if (res.code === 200) {
                showToast('发布成功');
                PlayerSectModule.showTasks();
            } else {
                showToast(res.message, 'error');
            }
        } catch(e) {
            showToast('网络异常', 'error');
        }
    },

    submitTask(taskId, itemName) {
        gamePrompt(`提交物资【${itemName}】至宗门悬赏：\n请输入提交数量：`, '1', async function(val) {
            const qty = parseInt(val, 10);
            if (isNaN(qty) || qty <= 0) {
                showToast('提交数量无效');
                return;
            }
            try {
                const res = await api.post('/api/game/player-sect/submit-task', {
                    taskId: taskId,
                    amount: qty
                });
                if (res.code === 200) {
                    showToast('提交成功');
                    SectModule.loadInfo(); // Refresh available contribution
                    PlayerSectModule.showTasks();
                    loadInventory();
                } else {
                    showToast(res.message, 'error');
                }
            } catch(e) {
                showToast('网络异常', 'error');
            }
        });
    },

    deleteTask(taskId) {
        gameConfirm('确定要取消该悬赏任务吗？已收集的物资将保留在宗门仓库。', async () => {
            try {
                const res = await api.post('/api/game/player-sect/delete-task', { taskId });
                if (res.code === 200) {
                    showToast('已取消');
                    PlayerSectModule.showTasks();
                } else {
                    showToast(res.message, 'error');
                }
            } catch(e) {
                showToast('网络异常', 'error');
            }
        });
    },

    showRenameDialog() {
        const currentName = this.sectInfo?.name || '';
        const html = `
            <div class="modal-info-card modal-info-card--jade">
                <div class="modal-info-card__title modal-info-card__title--jade">✦ 改名规则</div>
                <p style="font-size:12px;color:var(--text-secondary);margin:0;line-height:1.5;">
                    改名需从宗门金库扣除 <b style="color:var(--text-gold);">100万</b> 灵石，改名后 <b>7天</b> 内不可再次改名。
                </p>
            </div>
            <div class="modal-info-card">
                <div class="modal-info-card__title">✦ 名称变更</div>
                <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">当前名称: <span style="color:var(--text-gold);">${escapeHtml(currentName)}</span></div>
                <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px;">新名称 (2-8字)</label>
                <input type="text" id="psectRenameInput" class="app-input" style="width:100%;" maxlength="8" placeholder="请输入新的宗门名称" autocomplete="off">
            </div>
            <div class="modal-btn-row">
                <button class="modal-btn modal-btn--gold" onclick="PlayerSectModule.doRename()">确认改名</button>
            </div>
        `;
        this._openDecoratedModal('宗门改名', html);
    },

    async doRename() {
        const name = document.getElementById('psectRenameInput')?.value?.trim();
        if (!name || name.length < 2) {
            showToast('宗门名称需要2-8个字');
            return;
        }
        const currentName = this.sectInfo?.name || '';
        if (name === currentName) {
            showToast('新名称与当前名称相同');
            return;
        }

        gameConfirm(`确定将宗门名称从「${escapeHtml(currentName)}」改为「${escapeHtml(name)}」吗？\n将从宗门金库扣除 100万 灵石，且7天内不可再次改名。`, async () => {
            try {
                const res = await api.post('/api/game/player-sect/rename', { name });
                if (res.code === 200) {
                    showToast('宗门改名成功!');
                    closeGameModal();
                    SectModule.loadInfo();
                } else {
                    showToast(res.message || '改名失败', 'error');
                }
            } catch (e) {
                showToast(e.message, 'error');
            }
        });
    },

    // ===== 搬迁据点弹窗 =====
    showRelocateDialog() {
        const continents = this.getAvailableSectContinents();
        const info = this.sectInfo || {};
        const currentContinent = info.continent || '';
        const currentName = info.continentName || '';
        const lastRelocated = info.lastRelocatedAt || 0;
        const isFirst = !lastRelocated || lastRelocated <= 0;

        const COOLDOWN_MS = 14 * 24 * 3600 * 1000;
        const now = Date.now();
        const cooldownLeft = isFirst ? 0 : Math.max(0, COOLDOWN_MS - (now - lastRelocated));
        const cooldownText = (() => {
            if (cooldownLeft <= 0) return '';
            const days = Math.floor(cooldownLeft / (24 * 3600 * 1000));
            const hours = Math.floor((cooldownLeft % (24 * 3600 * 1000)) / (3600 * 1000));
            return days > 0 ? `${days}天${hours}小时` : `${hours}小时`;
        })();

        const cost = isFirst ? 3_000_000 : 5_000_000;
        const costText = isFirst ? '<b style="color:var(--text-gold);">300万</b>（首次）' : '<b style="color:var(--text-gold);">500万</b>';

        const optionsHtml = continents
            .filter(c => c.id !== currentContinent)
            .map(c => `<option value="${c.id}">${c.name}</option>`)
            .join('');
        if (!optionsHtml) {
            showToast('暂无可搬迁据点');
            return;
        }

        const cooldownBlock = cooldownLeft > 0 ? `
            <div class="modal-info-card" style="border-color:rgba(220,80,80,0.4);">
                <div class="modal-info-card__title" style="color:var(--text-danger);">⚠ 冷却中</div>
                <p style="font-size:12px;color:var(--text-secondary);margin:0;line-height:1.5;">
                    距离上次搬迁不足 14 天，还需等待 <b>${cooldownText}</b>。
                </p>
            </div>` : '';

        const html = `
            <div class="modal-info-card modal-info-card--jade">
                <div class="modal-info-card__title modal-info-card__title--jade">✦ 据点意义</div>
                <p style="font-size:12px;color:var(--text-secondary);margin:0;line-height:1.5;">
                    宗门"位置"决定 <b>修为加成生效区域</b>——灵界按大陆生效，仙界按小世界生效。<br>
                    战斗加成则全境通用，不受位置影响。
                </p>
            </div>
            ${cooldownBlock}
            <div class="modal-info-card">
                <div class="modal-info-card__title">✦ 搬迁规则</div>
                <p style="font-size:12px;color:var(--text-secondary);margin:0 0 8px 0;line-height:1.5;">
                    本次搬迁需从宗门金库扣除 ${costText} 灵石，搬迁后 <b>14 天</b>内不可再次搬迁。<br>
                    搬迁完成将通知所有弟子，加成将在新据点即时生效。
                </p>
                <div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">
                    当前据点：<span style="color:var(--text-gold);">${escapeHtml(currentName)}</span>
                </div>
                <label style="display:block;font-size:12px;color:var(--text-muted);margin-bottom:4px;">迁往据点</label>
                <select id="psectRelocateSelect" class="app-select" style="width:100%;">
                    ${optionsHtml}
                </select>
            </div>
            <div class="modal-btn-row">
                <button class="modal-btn modal-btn--gold" onclick="PlayerSectModule.doRelocate()" ${cooldownLeft > 0 ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : ''}>确认搬迁</button>
            </div>
        `;
        this._openDecoratedModal('搬迁宗门据点', html);
    },

    async doRelocate() {
        const select = document.getElementById('psectRelocateSelect');
        const continent = select?.value;
        if (!continent) {
            showToast('请选择新的据点');
            return;
        }
        const newName = select.options[select.selectedIndex]?.text || continent;
        const info = this.sectInfo || {};
        const isFirst = !info.lastRelocatedAt || info.lastRelocatedAt <= 0;
        const costText = isFirst ? '300万（首次）' : '500万';

        gameConfirm(`确定将宗门据点搬迁到「${escapeHtml(newName)}」吗？\n将从宗门金库扣除 ${costText} 灵石，14 天内不可再次搬迁。`, async () => {
            try {
                const res = await api.post('/api/game/player-sect/relocate', { continent });
                if (res.code === 200) {
                    showToast('宗门据点搬迁成功!');
                    closeGameModal();
                    SectModule.loadInfo();
                } else {
                    showToast(res.message || '搬迁失败', 'error');
                }
            } catch (e) {
                showToast(e.message, 'error');
            }
        });
    },

    async showSpiritVein() {
        await this.loadPlayerSectInfo();
        const info = this.sectInfo || {};
        const currentBonus = parseInt(info.spiritVeinBonusPct || 0, 10) || 0;
        const activeText = info.spiritVeinActiveHere
            ? '<span style="color:var(--text-success);">当前所在地生效</span>'
            : '<span style="color:var(--text-muted);">当前不在宗门驻地范围，冥想不生效</span>';
        const next = info.spiritVeinNext || null;
        const canManage = this.canManageSpiritVein();
        let nextHtml = '';

        if (next) {
            const materials = (next.materials || []).map(m => {
                const enough = (m.owned || 0) >= (m.need || 0);
                return `
                    <div style="display:flex;justify-content:space-between;gap:10px;font-size:12px;color:var(--text-secondary);">
                        <span>${escapeHtml(m.name || m.id)}</span>
                        <b style="color:${enough ? 'var(--text-success)' : 'var(--text-danger)'};">${m.owned || 0} / ${m.need || 0}</b>
                    </div>
                `;
            }).join('');
            const locks = [];
            if (!canManage) locks.push('需要宗主或拥有灵田管理权限的长老操作');
            if ((info.level || 0) < (next.requiredSectLevel || 0)) locks.push(`宗门需达到 Lv.${next.requiredSectLevel}`);
            if ((info.treasury || 0) < (next.treasuryCost || 0)) locks.push(`金库需 ${this.formatStone(next.treasuryCost || 0)} 灵石`);
            (next.materials || []).forEach(m => {
                if ((m.owned || 0) < (m.need || 0)) locks.push(`${m.name || m.id}不足`);
            });
            const lockText = locks.length > 0
                ? `<div style="font-size:11px;color:var(--text-danger);line-height:1.5;margin-top:8px;">${locks.map(escapeHtml).join('；')}</div>`
                : '';
            nextHtml = `
                <div class="modal-info-card">
                    <div class="modal-info-card__title">✦ 下一阶：${escapeHtml(next.name || '')}</div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
                        <div style="font-size:12px;color:var(--text-secondary);">需求宗门 <b style="color:var(--text-gold);">Lv.${next.requiredSectLevel}</b></div>
                        <div style="font-size:12px;color:var(--text-secondary);">冥想修为 <b style="color:var(--text-gold);">+${next.cultivationBonusPct || 0}%</b></div>
                        <div style="font-size:12px;color:var(--text-secondary);grid-column:1 / -1;">金库消耗 <b style="color:var(--text-gold);">${this.formatStone(next.treasuryCost || 0)}</b> 灵石</div>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:6px;">${materials}</div>
                    ${lockText}
                </div>
                ${canManage ? `
                <div class="modal-btn-row">
                    <button class="modal-btn modal-btn--gold" onclick="PlayerSectModule.upgradeSpiritVein()" ${next.canUpgrade ? '' : 'disabled style="opacity:0.5;cursor:not-allowed;"'}>升级灵脉</button>
                </div>` : ''}
            `;
        } else {
            nextHtml = `
                <div class="modal-info-card">
                    <div class="modal-info-card__title">✦ 灵脉圆满</div>
                    <p style="font-size:12px;color:var(--text-secondary);margin:0;line-height:1.5;">宗门灵脉已达当前最高阶。</p>
                </div>
            `;
        }

        const html = `
            <div class="modal-info-card modal-info-card--jade">
                <div class="modal-info-card__title modal-info-card__title--jade">✦ 生效规则</div>
                <p style="font-size:12px;color:var(--text-secondary);margin:0;line-height:1.5;">
                    灵脉只提升 <b>宗门驻地范围内的冥想修为</b>；灵界按大陆生效，仙界按小世界生效。探索、战斗、丹药、任务不享受该加成。宗门搬迁后生效范围随新驻地变化。
                </p>
            </div>
            <div class="modal-info-card">
                <div class="modal-info-card__title">✦ 当前灵脉</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    <div style="font-size:12px;color:var(--text-secondary);">品阶 <b style="color:var(--text-gold);">Lv.${info.spiritVeinLevel || 0}</b></div>
                    <div style="font-size:12px;color:var(--text-secondary);">名称 <b style="color:var(--text-gold);">${escapeHtml(info.spiritVeinName || '未启脉')}</b></div>
                    <div style="font-size:12px;color:var(--text-secondary);">驻地 <b style="color:var(--text-gold);">${escapeHtml(info.continentName || '-')}</b></div>
                    <div style="font-size:12px;color:var(--text-secondary);">加成 <b style="color:var(--text-gold);">+${currentBonus}%</b></div>
                </div>
                <div style="font-size:12px;margin-top:10px;">${activeText}</div>
            </div>
            ${nextHtml}
        `;
        this._openDecoratedModal('宗门灵脉', html);
    },

    async upgradeSpiritVein() {
        const next = this.sectInfo?.spiritVeinNext;
        if (!next) return;
        gameConfirm(`确定消耗金库 ${this.formatStone(next.treasuryCost || 0)} 灵石和材料，将宗门灵脉升级为「${escapeHtml(next.name || '')}」吗？`, async () => {
            try {
                const res = await api.post('/api/game/player-sect/spirit-vein/upgrade');
                if (res.code === 200) {
                    showToast('灵脉升级成功!');
                    await this.loadPlayerSectInfo();
                    this.showSpiritVein();
                    if (window.SectModule && typeof SectModule.loadInfo === 'function') SectModule.loadInfo();
                } else {
                    showToast(res.message || '升级失败', 'error');
                }
            } catch (e) {
                showToast(e.message || '网络异常', 'error');
            }
        });
    },

    async updateNotice() {
        const notice = document.getElementById('psectNoticeInput')?.value?.trim();
        if (notice === undefined) return;
        try {
            const res = await api.post('/api/game/player-sect/update-notice', { notice });
            if (res.code === 200) {
                showToast('公告已更新');
                SectModule.loadInfo();
            } else {
                showToast(res.message || '更新失败', 'error');
            }
        } catch (e) {
            showToast(e.message, 'error');
        }
    },

    async withdraw() {
        const amount = parseInt(document.getElementById('psectWithdrawAmt')?.value);
        if (!amount || amount <= 0) {
            showToast('请输入有效金额');
            return;
        }
        try {
            const res = await api.post('/api/game/player-sect/withdraw', { amount });
            if (res.code === 200) {
                showToast('提取成功');
                SectModule.loadInfo();
                loadPlayerInfo();
            } else {
                showToast(res.message || '提取失败', 'error');
            }
        } catch (e) {
            showToast(e.message, 'error');
        }
    },

    async upgrade() {
        gameConfirm('确定使用金库灵石升级宗门吗？', async () => {
            try {
                const res = await api.post('/api/game/player-sect/upgrade');
                if (res.code === 200) {
                    showToast('宗门升级成功!');
                    SectModule.loadInfo();
                } else {
                    showToast(res.message || '升级失败', 'error');
                }
            } catch (e) {
                showToast(e.message, 'error');
            }
        });
    },

    async expandSlots() {
        var info = this.sectInfo;
        if (!info) return;
        var next = (info.extraSlots || 0) + 1;
        var cost = this.getExpandCost(info.extraSlots || 0);
        gameConfirm('确定花费 ' + this.formatStone(cost) + ' 灵石扩容第 ' + next + ' 个弟子名额吗？', async () => {
            try {
                const res = await api.post('/api/game/player-sect/expand-slots');
                if (res.code === 200) {
                    showToast('扩容成功! 弟子名额 +1');
                    SectModule.loadInfo();
                } else {
                    showToast(res.message || '扩容失败', 'error');
                }
            } catch (e) {
                showToast(e.message, 'error');
            }
        });
    },

    async setThreshold() {
        const minStage = parseInt(document.getElementById('psectThresholdSelect')?.value || '0');
        try {
            const res = await api.post('/api/game/player-sect/set-threshold', { minStage });
            if (res.code === 200) {
                showToast('门槛已设置');
            } else {
                showToast(res.message || '设置失败', 'error');
            }
        } catch (e) {
            showToast(e.message, 'error');
        }
    },

    // ===== 宗门灵田 =====
    async showFarm(page) {
        if (Number.isFinite(page)) {
            this._farmPage = Math.max(1, Math.floor(page));
        }
        try {
            const params = new URLSearchParams({
                page: String(this._farmPage || 1),
                pageSize: String(this._farmPageSize || 60)
            });
            const res = await api.get('/api/game/player-sect/farm/overview?' + params.toString());
            if (res.code !== 200) {
                showToast(res.message || '获取灵田失败');
                return;
            }
            this._farmData = res.data;
            this._farmPage = Math.max(1, Number(res.data?.myPlotPage || this._farmPage || 1));
            this.renderFarmModal();
        } catch (e) {
            showToast('网络异常');
        }
    },

    _farmSeedRarity(r) {
        const c = getRarityColor ? getRarityColor(r) : 'var(--text-gold)';
        return c;
    },

    _farmBatchCount(inputId, maxCount) {
        const raw = parseInt(document.getElementById(inputId)?.value, 10);
        if (!Number.isFinite(raw) || raw <= 0) return 1;
        return Math.min(raw, Math.max(1, maxCount || 1));
    },

    _farmNumberOr(d, field, fallback) {
        const raw = d ? d[field] : undefined;
        const value = Number(raw);
        if (raw !== undefined && raw !== null && Number.isFinite(value)) {
            return Math.max(0, Math.floor(value));
        }
        return fallback;
    },

    _farmMaxClaimCount(d = this._farmData) {
        const batchLimit = this._farmBatchLimit || 5000;
        const claimCost = Number(d?.claimContribCost || 0);
        const contribution = Math.max(0, Number(d?.myAvailableContribution || 0));
        const contributionLimit = claimCost > 0 ? Math.floor(contribution / claimCost) : batchLimit;
        const realmLimit = this._farmNumberOr(d, 'maxFarmClaimCount', batchLimit);
        return Math.max(0, Math.min(contributionLimit, realmLimit, batchLimit));
    },

    _farmStatusCount(d, field, status) {
        const plots = d?.myPlots || [];
        return this._farmNumberOr(d, field, plots.filter(p => p.status === status).length);
    },

    _farmIdleCount(d = this._farmData) {
        return this._farmStatusCount(d, 'myIdleCount', 'IDLE');
    },

    _farmPlantedCount(d = this._farmData) {
        return this._farmStatusCount(d, 'myPlantedCount', 'PLANTED');
    },

    _farmMatureCount(d = this._farmData) {
        return this._farmStatusCount(d, 'myMatureCount', 'MATURE');
    },

    _farmPlotTotal(d = this._farmData) {
        const plots = d?.myPlots || [];
        return this._farmNumberOr(d, 'myPlotTotal', plots.length);
    },

    _farmDurationText(ms) {
        const totalMin = Math.max(0, Math.ceil((Number(ms) || 0) / 60000));
        if (totalMin <= 0) return '已到期';
        const hours = Math.floor(totalMin / 60);
        const mins = totalMin % 60;
        if (hours >= 24) {
            const days = Math.floor(hours / 24);
            const restHours = hours % 24;
            return days + '天' + (restHours > 0 ? restHours + '时' : '');
        }
        return hours > 0 ? (hours + '时' + mins + '分') : (mins + '分');
    },

    _farmInvasionCard(d) {
        const invasion = d?.farmInvasion || null;
        const riskLabel = escapeHtml(d?.farmRiskLabel || invasion?.riskLabel || '清净');
        const threatPercent = Math.max(0, Math.min(100, Number(d?.farmThreatPercent ?? invasion?.threatPercent ?? 0)));
        const activeCropCount = this._farmPlantedCount(d) + this._farmMatureCount(d);
        const personalLimit = Math.max(0, Number(d?.myFarmSlotLimit || 0));
        const overLimit = Math.max(0, Number(d?.myOverLimitPlantedCount || Math.max(0, activeCropCount - personalLimit)));
        if (!invasion) {
            if (threatPercent < 25) return '';
            return '<div class="modal-info-card psect-farm-invasion-card psect-farm-invasion-card--watch">' +
                '<div class="psect-farm-invasion-head">' +
                    '<div><div class="modal-info-card__title" style="margin:0;">个人守田</div><p>已种灵田灵息外散，8点后妖兽会锁定超载灵田。</p></div>' +
                    '<span class="psect-farm-invasion-badge">' + riskLabel + '</span>' +
                '</div>' +
                '<div class="psect-farm-invasion-meter"><div style="width:' + threatPercent + '%;"></div></div>' +
                '<div class="psect-farm-invasion-meta"><span>威胁 ' + threatPercent + '%</span><span>已种 ' + activeCropCount + ' / ' + personalLimit + '</span><span>超载 ' + overLimit + '</span><span>18点结算</span></div>' +
                '</div>';
        }

        const currentHp = Math.max(0, Number(invasion.currentHp || 0));
        const maxHp = Math.max(1, Number(invasion.maxHp || 1));
        const hpPct = Math.max(0, Math.min(100, Math.round(currentHp * 100 / maxHp)));
        const myHitCount = Math.max(0, Number(invasion.myHitCount || 0));
        const maxHitCount = Math.max(0, Number(invasion.maxHitCount || 0));
        const hitLeft = Math.max(0, maxHitCount - myHitCount);
        const disabled = invasion.status !== 'ACTIVE' || hitLeft <= 0;
        const remainText = this._farmDurationText(invasion.remainingMs || 0);
        return '<div class="modal-info-card psect-farm-invasion-card psect-farm-invasion-card--active">' +
            '<div class="psect-farm-invasion-head">' +
                '<div><div class="modal-info-card__title" style="margin:0;">灵田兽潮</div><p>' + escapeHtml(invasion.bossName || '妖兽') + ' 正在侵扰灵田。</p></div>' +
                '<span class="psect-farm-invasion-badge psect-farm-invasion-badge--active">' + riskLabel + '</span>' +
            '</div>' +
            '<div class="psect-farm-invasion-hp">' +
                '<div class="psect-farm-invasion-hp__bar" style="width:' + hpPct + '%;"></div>' +
                '<span>' + this.formatStone(currentHp) + ' / ' + this.formatStone(maxHp) + '</span>' +
            '</div>' +
            '<div class="psect-farm-invasion-meta">' +
                '<span>剩余 ' + remainText + '</span>' +
                '<span>需求战力 ' + this.formatStone(invasion.requiredPower || 0) + '</span>' +
                '<span>守田 本人</span>' +
                '<span>出手 ' + myHitCount + ' / ' + maxHitCount + '</span>' +
            '</div>' +
            '<div class="psect-farm-invasion-actions">' +
                '<button class="modal-action-btn modal-action-btn--danger" onclick="PlayerSectModule.attackFarmInvasion()"' + (disabled ? ' disabled' : '') + '>' +
                    '<span class="modal-action-btn__text">' + (disabled ? '已无出手机会' : '抵御兽潮') + '</span>' +
                    '<span class="modal-action-btn__cost">胜利6小时双倍生长，失守会损失灵田</span>' +
                '</button>' +
            '</div>' +
            '</div>';
    },

    _farmPagerHtml(d) {
        const page = Math.max(1, Number(d?.myPlotPage || this._farmPage || 1));
        const totalPages = Math.max(1, Number(d?.myPlotTotalPages || 1));
        const total = Math.max(0, Number(d?.myPlotTotal || 0));
        const pageSize = Math.max(1, Number(d?.myPlotPageSize || this._farmPageSize || 60));
        const from = total > 0 ? ((page - 1) * pageSize + 1) : 0;
        const to = total > 0 ? Math.min(total, page * pageSize) : 0;
        if (totalPages <= 1) {
            return '<div class="psect-farm-pager psect-farm-pager--single"><span>共 ' + total + ' 块灵田</span></div>';
        }
        return '<div class="psect-farm-pager">' +
            '<button class="pager-btn" onclick="PlayerSectModule.changeFarmPage(1)"' + (page <= 1 ? ' disabled' : '') + '>首页</button>' +
            '<button class="pager-btn" onclick="PlayerSectModule.changeFarmPage(' + (page - 1) + ')"' + (page <= 1 ? ' disabled' : '') + '>上页</button>' +
            '<span class="pager-info">第 ' + page + ' / ' + totalPages + ' 页 · ' + from + '-' + to + ' / ' + total + '</span>' +
            '<button class="pager-btn" onclick="PlayerSectModule.changeFarmPage(' + (page + 1) + ')"' + (page >= totalPages ? ' disabled' : '') + '>下页</button>' +
            '<button class="pager-btn" onclick="PlayerSectModule.changeFarmPage(' + totalPages + ')"' + (page >= totalPages ? ' disabled' : '') + '>到底</button>' +
            '</div>';
    },

    changeFarmPage(page) {
        this.showFarm(page);
    },

    _farmPlotCard(plot) {
        const status = plot.status;
        const slotLabel = `第 ${plot.slotIndex + 1} 号`;
        if (status === 'IDLE') {
            // 仅用于按钮 tooltip 的粗略预估；实际返还按服务端保存的"开垦时实付贡献"/2 计算
            const estRefund = Math.floor((this._farmData?.claimContribCost || 0) / 2);
            return `<div class="psect-farm-plot psect-farm-plot--idle">
                <div class="psect-farm-plot__title">${slotLabel}灵田</div>
                <div class="psect-farm-plot__status">空闲</div>
                <div class="psect-farm-plot__actions">
                    <button class="btn-action psect-farm-plot__btn" onclick="PlayerSectModule.openPlantDialog(${plot.plotId})">播种</button>
                    <button class="btn-action btn-action--danger psect-farm-plot__btn psect-farm-plot__btn--release" onclick="PlayerSectModule.releasePlot(${plot.plotId})" title="退田预估返还 ${estRefund} 点贡献 (按当前开垦费估算, 实际以开垦时实付的 50% 为准)">退田</button>
                </div>
            </div>`;
        }
        if (status === 'MATURE') {
            return `<div class="psect-farm-plot psect-farm-plot--mature">
                <div class="psect-farm-plot__title">${slotLabel}灵田</div>
                <div class="psect-farm-plot__status">已成熟</div>
                <div class="psect-farm-plot__content">${escapeHtml(plot.yieldName || '灵药')}</div>
                <div class="psect-farm-plot__actions">
                    <button class="btn-action psect-farm-plot__btn psect-farm-plot__btn--harvest" onclick="PlayerSectModule.harvestPlot(${plot.plotId})">收获</button>
                    <button class="btn-action btn-action--danger psect-farm-plot__btn" onclick="PlayerSectModule.uprootPlot(${plot.plotId})" title="铲除作物，作物与种子都不返还">铲除</button>
                </div>
            </div>`;
        }
        // PLANTED
        const mins = Math.max(1, Math.ceil(plot.remainingMs / 60000));
        const timeText = mins >= 60 ? `${Math.floor(mins / 60)} 时 ${mins % 60} 分` : `${mins} 分`;
        return `<div class="psect-farm-plot psect-farm-plot--planted">
            <div class="psect-farm-plot__title">${slotLabel}灵田</div>
            <div class="psect-farm-plot__status">成长中</div>
            <div class="psect-farm-plot__content">${escapeHtml(plot.seedName || '')}</div>
            <div class="psect-farm-plot__time">剩余 ${timeText}</div>
            <div class="psect-farm-plot__actions">
                <button class="btn-action btn-action--danger psect-farm-plot__btn" onclick="PlayerSectModule.uprootPlot(${plot.plotId})" title="铲除作物，作物与种子都不返还">铲除</button>
            </div>
        </div>`;
    },

    renderFarmModalLegacy() {
        const d = this._farmData;
        if (!d) return;
        const canManage = !!d.canManage;
        const myUsedCount = d.myPlots.length;
        const availableSlots = Math.max(0, d.totalSlots - d.claimedSlots);
        const maxClaimCount = this._farmMaxClaimCount(d);
        const canClaim = maxClaimCount > 0;

        // ---- 装饰头 ----
        let html = '<div class="modal-header-deco">' +
            '<div class="modal-header-deco__subtitle">宗门灵田脉络</div>' +
            '<div class="modal-header-deco__value" style="margin-bottom: 4px;">' +
                '<span class="modal-header-deco__num" style="color:var(--accent-jade);">' + d.claimedSlots + '</span>' +
                '<span class="modal-header-deco__unit" style="font-size:18px;">/</span>' +
                '<span class="modal-header-deco__num modal-header-deco__num--muted" style="font-size:24px;">' + d.totalSlots + '</span>' +
            '</div>' +
            '<div style="font-size:12px; color:var(--text-muted);">宗门气脉延展出的灵土，弟子贡献开垦后归属本人，空闲时可退田返还部分贡献。</div>' +
            '</div>';

        // ---- 主体 ----
        html += '<div class="modal-body-padded">';

        // 灵田概况
        const baseSlotsText = (d.baseSlots || 0) + ' (宗门等级)';
        const extraSlotsText = (d.extraSlots || 0) > 0
            ? ' + <b style="color:var(--text-purple);">' + d.extraSlots + '</b> (宗主扩充)'
            : '';
        html += '<div class="modal-info-card modal-info-card--jade">' +
            '<div class="modal-info-card__title modal-info-card__title--jade">✦ 灵田概况</div>' +
            '<div class="modal-feat-list" style="margin-left: 4px;">' +
                '<div class="modal-feat-row"><span class="modal-feat-icon modal-feat-icon--jade">◈</span><span>灵田总数: <b style="color:var(--accent-jade);">' + d.totalSlots + '</b> 块 = ' + baseSlotsText + extraSlotsText + '</span></div>' +
                '<div class="modal-feat-row"><span class="modal-feat-icon modal-feat-icon--jade">◈</span><span>我的灵田: <b style="color:var(--accent-jade);">' + myUsedCount + '</b> 块</span></div>' +
                '<div class="modal-feat-row"><span class="modal-feat-icon modal-feat-icon--orange">◈</span><span>可用贡献: <b style="color:var(--text-gold);">' + d.myAvailableContribution + '</b></span></div>' +
                '<div class="modal-feat-row"><span class="modal-feat-icon modal-feat-icon--purple">◈</span><span>手中灵石: <b style="color:var(--text-purple);">' + d.mySpiritStones + '</b></span></div>' +
                '<div class="modal-feat-row"><span class="modal-feat-icon modal-feat-icon--blue">◈</span><span>每块开垦费: <b style="color:var(--text-gold);">' + d.claimContribCost + '</b> 贡献</span></div>' +
            '</div>' +
            '</div>';

        // 我的灵田
        const matureCount = (d.myPlots || []).filter(p => p.status === 'MATURE').length;
        const idleCount = (d.myPlots || []).filter(p => p.status === 'IDLE').length;
        let quickActions = '';
        if (matureCount > 0 || idleCount > 0) {
            quickActions = '<div class="psect-farm-quick">';
            if (matureCount > 0) {
                quickActions += '<button class="btn-action psect-farm-quick__btn psect-farm-quick__btn--harvest" onclick="PlayerSectModule.harvestAll()">一键收菜 (' + matureCount + ')</button>';
            }
            if (idleCount > 0) {
                quickActions += '<button class="btn-action psect-farm-quick__btn" onclick="PlayerSectModule.openPlantAllDialog()">批量播种 (' + idleCount + ')</button>';
            }
            quickActions += '</div>';
        }
        html += '<div class="modal-info-card" style="margin-top:16px;">' +
            '<div class="psect-farm-section-head">' +
                '<div class="modal-info-card__title" style="margin:0;">✦ 我的灵田</div>' +
                quickActions +
            '</div>';
        if (!d.myPlots || d.myPlots.length === 0) {
            html += '<div class="psect-farm-placeholder">尚未开垦灵田，点击下方按钮开垦第一块。</div>';
        } else {
            html += '<div class="psect-farm-grid">';
            d.myPlots.forEach(p => { html += this._farmPlotCard(p); });
            html += '</div>';
        }
        html += '</div>';

        // 宗门坊市·灵种
        html += '<div class="modal-info-card" style="margin-top:16px;">' +
            '<div class="modal-info-card__title">✦ 宗门坊市·灵种</div>';
        if (!d.seeds || d.seeds.length === 0) {
            html += '<div class="psect-farm-placeholder">暂无可售灵种</div>';
        } else {
            html += '<div class="modal-feat-list" style="margin-left:4px;">';
            d.seeds.forEach(seed => {
                const color = this._farmSeedRarity(seed.seedRarity);
                const offShelf = seed.priceSpiritStones < 0;
                const priceStr = offShelf
                    ? '<b style="color:var(--text-muted);">已下架</b>'
                    : '<b style="color:var(--text-purple);">' + seed.priceSpiritStones + ' 灵石</b>' + (seed.isCustomPriced ? ' <span style="color:var(--text-muted);font-size:11px;">(宗主定价)</span>' : '');
                html += '<div class="modal-feat-row">' +
                    '<span class="modal-feat-icon modal-feat-icon--jade">◈</span>' +
                    '<span><b style="color:' + color + ';">' + escapeHtml(seed.seedName) + '</b> · 产 ' + escapeHtml(seed.yieldName) + ' ×' + seed.yieldMin + '-' + seed.yieldMax + ' · ' + seed.growHours + '小时 · ' + priceStr + '</span>' +
                    '</div>';
            });
            html += '</div>';
        }
        html += '<div style="font-size:11px; color:var(--text-muted); margin-top:8px;">灵石由买家扣除，全数自动汇入宗门金库。</div>';
        html += '</div>';

        // 灵田管理 (仅宗主 / MANAGE_FARM 权限)
        if (canManage) {
            html += '<div class="modal-info-card" style="margin-top:16px; border-color:rgba(255,255,255,0.1);">' +
                '<div class="modal-info-card__title" style="color:var(--text-secondary);">⚙ 灵田管理</div>' +
                '<div style="display:flex; flex-direction:column; gap:8px;">';
            // 开垦费
            html += '<div style="display:flex; align-items:center; justify-content:space-between; background:rgba(255,255,255,0.03); padding:8px 12px; border-radius:4px;">' +
                '<span style="font-size:13px; color:var(--text-secondary);">开垦贡献费</span>' +
                '<div style="display:flex; align-items:center; gap:6px;">' +
                    '<input type="number" id="psectFarmClaimCost" class="app-input" style="width:80px; padding:4px; text-align:center; font-size:13px;" min="0" value="' + d.claimContribCost + '">' +
                    '<button class="modal-action-btn" style="height:30px; padding:0 12px; font-size:12px; width:auto;" onclick="PlayerSectModule.setFarmClaimCost()"><span class="modal-action-btn__text">保存</span></button>' +
                '</div>' +
                '</div>';
            // 灵种售价
            d.seeds.forEach(seed => {
                html += '<div style="display:flex; align-items:center; justify-content:space-between; background:rgba(255,255,255,0.03); padding:8px 12px; border-radius:4px;">' +
                    '<span style="font-size:13px; color:var(--text-secondary);">' + escapeHtml(seed.seedName) + ' <span style="font-size:11px; color:var(--text-muted);">(-1 下架)</span></span>' +
                    '<div style="display:flex; align-items:center; gap:6px;">' +
                        '<input type="number" id="psectFarmSeedPrice_' + seed.seedId + '" class="app-input" style="width:80px; padding:4px; text-align:center; font-size:13px;" value="' + seed.priceSpiritStones + '">' +
                        '<button class="modal-action-btn" style="height:30px; padding:0 12px; font-size:12px; width:auto;" onclick="PlayerSectModule.setFarmSeedPrice(\'' + seed.seedId + '\')"><span class="modal-action-btn__text">保存</span></button>' +
                    '</div>' +
                    '</div>';
            });
            // 扩充灵田 (花宗门金库灵石)
            const extraSlots = d.extraSlots || 0;
            const nextCost = d.nextExpandCost || 0;
            const treasury = d.sectTreasury || 0;
            const powerExtraSlotLimit = Math.max(0, Number(d.powerExtraSlotLimit || 0));
            const maxAffordableExpand = nextCost > 0 ? Math.floor(treasury / nextCost) : (this._farmBatchLimit || 5000);
            const maxExpandCount = Math.min(this._farmBatchLimit || 5000, maxAffordableExpand);
            const expandDisabled = maxExpandCount <= 0;
            const expandHint = !expandDisabled
                ? '每格 ' + nextCost + ' 灵石 · 最多 ' + maxExpandCount + ' 格 (金库: ' + treasury + ')'
                : '金库灵石不足 (' + treasury + '/' + nextCost + ')';
            html += '<div style="display:flex; align-items:center; justify-content:space-between; background:rgba(139,92,246,0.06); padding:8px 12px; border-radius:4px; border:1px solid rgba(139,92,246,0.2); margin-top:4px;">' +
                '<div style="display:flex; flex-direction:column; gap:2px;">' +
                    '<span style="font-size:13px; color:var(--text-secondary);">扩充灵田 <span style="font-size:11px; color:var(--text-muted);">(已扩 ' + extraSlots + ' 格)</span></span>' +
                    '<span style="font-size:11px; color:var(--text-muted);">稳定承载参考 ' + powerExtraSlotLimit + ' 格 · 宗门战力 ' + this.formatStone(d.sectFarmPower || 0) + '</span>' +
                    '<span style="font-size:11px; color:var(--text-muted);">' + expandHint + '</span>' +
                '</div>' +
                '<div style="display:flex; align-items:center; gap:6px;">' +
                    '<input type="number" id="psectFarmExpandCount" class="app-input" style="width:70px; padding:4px; text-align:center; font-size:13px;" min="1" max="' + Math.max(1, maxExpandCount) + '" value="' + Math.max(1, Math.min(5, maxExpandCount || 1)) + '">' +
                    '<button class="modal-action-btn" style="height:30px; padding:0 12px; font-size:12px; width:auto;' + (expandDisabled ? 'opacity:0.5;pointer-events:none;' : '') + '" onclick="PlayerSectModule.expandFarmBatch()">' +
                        '<span class="modal-action-btn__text">扩充</span>' +
                    '</button>' +
                '</div>' +
                '</div>';
            html += '</div></div>';
        }

        html += '</div>'; // modal-body-padded

        // ---- 底部开垦按钮 ----
        const claimDisabled = canClaim ? '' : ' style="opacity:0.5;pointer-events:none;"';
        const claimHint = d.myAvailableContribution < d.claimContribCost
            ? '贡献不足'
            : (availableSlots > 0 ? '优先使用空位' : '继续开垦新田');
        html += '<div class="modal-btn-row" style="padding: 0 20px 20px; margin-top:0; align-items:stretch; gap:8px;">' +
            '<input type="number" id="psectFarmClaimCount" class="app-input" style="width:82px; text-align:center;" min="1" max="' + Math.max(1, maxClaimCount) + '" value="' + Math.max(1, Math.min(5, maxClaimCount || 1)) + '"' + (canClaim ? '' : ' disabled') + '>' +
            '<button class="modal-action-btn modal-action-btn--orange" style="flex:1;"' + claimDisabled + ' onclick="PlayerSectModule.claimPlots()">' +
                '<span class="modal-action-btn__icon">✦</span>' +
                '<span class="modal-action-btn__text">开垦灵田</span>' +
                '<span class="modal-action-btn__cost">每块 ' + d.claimContribCost + ' 贡献 · 最多 ' + maxClaimCount + ' 块 · ' + claimHint + '</span>' +
            '</button>' +
            '</div>';

        showModal(html, 'modal-overlay--top ui-scrollable-modal');
    },

    renderFarmModal() {
        const d = this._farmData;
        if (!d) return;

        const canManage = !!d.canManage;
        const myPlots = d.myPlots || [];
        const seeds = d.seeds || [];
        const myPlotTotal = this._farmPlotTotal(d);
        const idleCount = this._farmIdleCount(d);
        const matureCount = this._farmMatureCount(d);
        const plantedCount = this._farmPlantedCount(d);
        const availableSlots = Math.max(0, (d.totalSlots || 0) - (d.claimedSlots || 0));
        const maxClaimCount = this._farmMaxClaimCount(d);
        const canClaim = maxClaimCount > 0;
        const claimDefault = Math.max(1, Math.min(100, maxClaimCount || 1));
        const activeCropCount = matureCount + plantedCount;
        const progressPct = Math.min(100, Math.max(0, Math.round((d.claimedSlots || 0) * 100 / Math.max(1, d.totalSlots || 1))));
        const extraSlotsText = (d.extraSlots || 0) > 0 ? ' + ' + d.extraSlots + ' 扩充' : '';
        const contributionText = (d.myAvailableContribution || 0) >= 10000 ? this.formatStone(d.myAvailableContribution || 0) : (d.myAvailableContribution || 0);
        const treasuryText = this.formatStone(d.sectTreasury || 0);
        const spiritStoneText = this.formatStone(d.mySpiritStones || 0);
        const farmPowerText = this.formatStone(d.sectFarmPower || 0);
        const myFarmSlotLimit = Math.max(0, Number(d.myFarmSlotLimit || 0));
        const overLimitPlanted = Math.max(0, Number(d.myOverLimitPlantedCount || Math.max(0, activeCropCount - myFarmSlotLimit)));
        const riskLabel = d.farmRiskLabel || '清净';
        const threatPercent = Math.max(0, Math.min(100, Number(d.farmThreatPercent || 0)));
        const growthBuffRemainingMs = Math.max(0, Number(d.farmGrowthBuffRemainingMs || 0));
        const growthSpeedMultiplier = Math.max(1, Number(d.farmGrowthSpeedMultiplier || 1));
        const growthSpeedText = growthBuffRemainingMs > 0
            ? ((Math.round(growthSpeedMultiplier * 10) / 10).toString().replace(/\.0$/, '') + 'x')
            : '1x';
        const growthBuffHint = growthBuffRemainingMs > 0 ? ('剩余 ' + this._farmDurationText(growthBuffRemainingMs)) : '击退兽潮后激活';

        let html = '<div class="modal-header-deco psect-farm-hero">' +
            '<div class="modal-header-deco__subtitle">宗门灵田</div>' +
            '<div class="psect-farm-hero__count"><span>' + (d.claimedSlots || 0) + '</span><small>/ ' + (d.totalSlots || 0) + '</small></div>' +
            '<div class="psect-farm-progress" aria-label="灵田开垦进度"><div class="psect-farm-progress__bar" style="width:' + progressPct + '%;"></div></div>' +
            '<div class="psect-farm-hero__meta">' +
                '<span><b>' + availableSlots + '</b><small>空位</small></span>' +
                '<span><b>' + myPlotTotal + '</b><small>我的</small></span>' +
                '<span><b>' + (d.othersClaimedCount || 0) + '</b><small>他人</small></span>' +
            '</div>' +
            '</div>';

        html += '<div class="modal-body-padded psect-farm-body">';

        html += '<div class="psect-farm-stat-grid">' +
            '<div class="psect-farm-stat"><span>总灵田</span><b>' + (d.totalSlots || 0) + '</b><small>' + (d.baseSlots || 0) + ' 宗门等级' + extraSlotsText + '</small></div>' +
            '<div class="psect-farm-stat"><span>我的灵田</span><b>' + myPlotTotal + '</b><small>空闲 ' + idleCount + ' · 成熟 ' + matureCount + '</small></div>' +
            '<div class="psect-farm-stat"><span>可用贡献</span><b title="' + (d.myAvailableContribution || 0) + '">' + contributionText + '</b><small>每块 ' + (d.claimContribCost || 0) + '</small></div>' +
            '<div class="psect-farm-stat"><span>宗门金库</span><b title="' + (d.sectTreasury || 0) + '">' + treasuryText + '</b><small>手中灵石 ' + spiritStoneText + '</small></div>' +
            '<div class="psect-farm-stat"><span>宗门承载</span><b title="' + (d.sectFarmPower || 0) + '">' + farmPowerText + '</b><small>已扩 ' + (d.extraSlots || 0) + ' · 稳定参考 ' + (d.powerExtraSlotLimit || 0) + '</small></div>' +
            '<div class="psect-farm-stat"><span>境界稳守</span><b>' + myFarmSlotLimit + '</b><small>已种 ' + activeCropCount + ' / ' + myFarmSlotLimit + (overLimitPlanted > 0 ? ' · 超载 ' + overLimitPlanted : '') + '</small></div>' +
            '<div class="psect-farm-stat psect-farm-stat--risk"><span>个人兽潮</span><b>' + escapeHtml(riskLabel) + '</b><small>' + threatPercent + '% · 风险 ' + (d.farmEffectiveRisk || 0) + '</small></div>' +
            '<div class="psect-farm-stat"><span>生长加速</span><b>' + growthSpeedText + '</b><small>' + growthBuffHint + '</small></div>' +
            '</div>';

        html += this._farmInvasionCard(d);

        html += '<div class="modal-info-card modal-info-card--jade psect-farm-ops-card">' +
            '<div class="psect-farm-section-head">' +
                '<div class="modal-info-card__title modal-info-card__title--jade">✦ 田务操作</div>' +
                '<div class="psect-farm-status-chips"><span>空闲 ' + idleCount + '</span><span>成长 ' + plantedCount + '</span><span>成熟 ' + matureCount + '</span></div>' +
            '</div>' +
            '<div class="psect-farm-action-grid">' +
                '<button class="modal-action-btn modal-action-btn--jade" onclick="PlayerSectModule.harvestAll()"' + (matureCount > 0 ? '' : ' disabled') + '><span class="modal-action-btn__text">一键收菜</span><span class="modal-action-btn__cost">' + matureCount + ' 块</span></button>' +
                '<button class="modal-action-btn modal-action-btn--gold" onclick="PlayerSectModule.openPlantAllDialog()"' + (idleCount > 0 ? '' : ' disabled') + '><span class="modal-action-btn__text">批量播种</span><span class="modal-action-btn__cost">最多 ' + idleCount + ' 块</span></button>' +
                '<button class="modal-action-btn modal-action-btn--danger" onclick="PlayerSectModule.uprootAll()"' + (activeCropCount > 0 ? '' : ' disabled') + '><span class="modal-action-btn__text">一键铲除</span><span class="modal-action-btn__cost">' + activeCropCount + ' 块</span></button>' +
                '<button class="modal-action-btn modal-action-btn--outline" onclick="PlayerSectModule.releaseAllPlots()"' + (idleCount > 0 ? '' : ' disabled') + '><span class="modal-action-btn__text">一键退田</span><span class="modal-action-btn__cost">' + idleCount + ' 块空闲</span></button>' +
                '<div class="psect-farm-inline-action">' +
                    '<label for="psectFarmClaimCountMain">开垦数量</label>' +
                    '<input type="number" id="psectFarmClaimCountMain" class="app-input" min="1" max="' + Math.max(1, maxClaimCount) + '" value="' + claimDefault + '"' + (canClaim ? '' : ' disabled') + '>' +
                    '<button class="modal-action-btn modal-action-btn--orange" onclick="PlayerSectModule.claimPlotsFrom(\'psectFarmClaimCountMain\')"' + (canClaim ? '' : ' disabled') + '><span class="modal-action-btn__text">批量开垦</span><span class="modal-action-btn__cost">最多 ' + maxClaimCount + '</span></button>' +
                    '<button class="modal-action-btn modal-action-btn--outline" onclick="PlayerSectModule.claimPlots(' + maxClaimCount + ')"' + (canClaim ? '' : ' disabled') + '><span class="modal-action-btn__text">按最大开垦</span></button>' +
                '</div>' +
            '</div>' +
            '</div>';

        html += '<div class="modal-info-card psect-farm-panel">' +
            '<div class="psect-farm-section-head">' +
                '<div class="modal-info-card__title" style="margin:0;">✦ 我的灵田</div>' +
                '<div class="psect-farm-status-chips"><span>本页 ' + myPlots.length + ' 块</span><span>共 ' + myPlotTotal + ' 块</span></div>' +
            '</div>';
        if (myPlotTotal === 0) {
            html += '<div class="psect-farm-placeholder">尚未开垦灵田</div>';
        } else {
            html += this._farmPagerHtml(d);
            html += '<div class="psect-farm-grid">';
            myPlots.forEach(p => { html += this._farmPlotCard(p); });
            html += '</div>';
            html += this._farmPagerHtml(d);
        }
        html += '</div>';

        html += '<div class="modal-info-card psect-farm-panel">' +
            '<div class="psect-farm-section-head">' +
                '<div class="modal-info-card__title" style="margin:0;">✦ 宗门坊市·灵种</div>' +
                '<div class="psect-farm-status-chips"><span>灵石入金库</span></div>' +
            '</div>';
        if (seeds.length === 0) {
            html += '<div class="psect-farm-placeholder">暂无可售灵种</div>';
        } else {
            html += '<div class="psect-farm-seed-list">';
            seeds.forEach(seed => {
                const color = this._farmSeedRarity(seed.seedRarity);
                const offShelf = seed.priceSpiritStones < 0;
                const priceHtml = offShelf
                    ? '<span class="psect-farm-seed__price psect-farm-seed__price--off">已下架</span>'
                    : '<span class="psect-farm-seed__price">' + seed.priceSpiritStones + ' 灵石</span>';
                html += '<div class="psect-farm-seed">' +
                    '<div class="psect-farm-seed__main"><b style="color:' + color + ';">' + escapeHtml(seed.seedName) + '</b><span>产 ' + escapeHtml(seed.yieldName) + ' ×' + seed.yieldMin + '-' + seed.yieldMax + '</span></div>' +
                    '<div class="psect-farm-seed__meta"><span>' + seed.growHours + '时</span><span>背包 ' + (seed.bagCount || 0) + '</span>' + priceHtml + (seed.isCustomPriced ? '<span>定价</span>' : '') + '</div>' +
                    '</div>';
            });
            html += '</div>';
        }
        html += '</div>';

        if (canManage) {
            const extraSlots = d.extraSlots || 0;
            const nextCost = d.nextExpandCost || 0;
            const shrinkRefund = d.shrinkSlotRefund || Math.floor(nextCost / 2);
            const treasury = d.sectTreasury || 0;
            const powerExtraSlotLimit = Math.max(0, Number(d.powerExtraSlotLimit || 0));
            const maxAffordableExpand = nextCost > 0 ? Math.floor(treasury / nextCost) : (this._farmBatchLimit || 5000);
            const maxExpandCount = Math.min(this._farmBatchLimit || 5000, maxAffordableExpand);
            const maxShrinkCount = Math.min(this._farmBatchLimit || 5000, extraSlots);
            const expandDisabled = maxExpandCount <= 0;
            const shrinkDisabled = maxShrinkCount <= 0;
            const expandHint = !expandDisabled
                ? '每格 ' + nextCost + ' · 最多 ' + maxExpandCount
                : '金库不足 ' + treasury + '/' + nextCost;
            html += '<div class="modal-info-card psect-farm-manage-card">' +
                '<div class="psect-farm-section-head">' +
                    '<div class="modal-info-card__title" style="margin:0;color:var(--text-secondary);">⚙ 灵田管理</div>' +
                    '<div class="psect-farm-status-chips"><span>宗主管理</span></div>' +
                '</div>' +
                '<div class="psect-farm-manage-list">' +
                    '<div class="psect-farm-manage-row">' +
                        '<label for="psectFarmClaimCost">开垦贡献费</label>' +
                        '<div class="psect-farm-manage-row__controls"><input type="number" id="psectFarmClaimCost" class="app-input" min="0" value="' + d.claimContribCost + '"><button class="modal-action-btn" onclick="PlayerSectModule.setFarmClaimCost()"><span class="modal-action-btn__text">保存</span></button></div>' +
                    '</div>';
            seeds.forEach(seed => {
                html += '<div class="psect-farm-manage-row">' +
                    '<label for="psectFarmSeedPrice_' + seed.seedId + '">' + escapeHtml(seed.seedName) + '<small>-1 下架</small></label>' +
                    '<div class="psect-farm-manage-row__controls"><input type="number" id="psectFarmSeedPrice_' + seed.seedId + '" class="app-input" value="' + seed.priceSpiritStones + '"><button class="modal-action-btn" onclick="PlayerSectModule.setFarmSeedPrice(\'' + seed.seedId + '\')"><span class="modal-action-btn__text">保存</span></button></div>' +
                    '</div>';
            });
            html += '<div class="psect-farm-manage-row psect-farm-manage-row--accent">' +
                '<label for="psectFarmExpandCount">扩充灵田<small>已扩 ' + extraSlots + ' · 稳定参考 ' + powerExtraSlotLimit + ' · 金库 ' + treasury + '</small></label>' +
                '<div class="psect-farm-manage-row__controls"><input type="number" id="psectFarmExpandCount" class="app-input" min="1" max="' + Math.max(1, maxExpandCount) + '" value="' + Math.max(1, Math.min(5, maxExpandCount || 1)) + '"' + (expandDisabled ? ' disabled' : '') + '><button class="modal-action-btn modal-action-btn--purple" onclick="PlayerSectModule.expandFarmBatch()"' + (expandDisabled ? ' disabled' : '') + '><span class="modal-action-btn__text">扩充</span><span class="modal-action-btn__cost">' + expandHint + '</span></button></div>' +
                '</div>' +
                '<div class="psect-farm-manage-row">' +
                '<label for="psectFarmShrinkCount">缩减扩充<small>每格返 ' + shrinkRefund + ' · 需高位空出</small></label>' +
                '<div class="psect-farm-manage-row__controls"><input type="number" id="psectFarmShrinkCount" class="app-input" min="1" max="' + Math.max(1, maxShrinkCount) + '" value="' + Math.max(1, Math.min(5, maxShrinkCount || 1)) + '"' + (shrinkDisabled ? ' disabled' : '') + '><button class="modal-action-btn modal-action-btn--outline" onclick="PlayerSectModule.shrinkFarmBatch()"' + (shrinkDisabled ? ' disabled' : '') + '><span class="modal-action-btn__text">缩减</span><span class="modal-action-btn__cost">' + (shrinkDisabled ? '无扩充灵田' : '最多 ' + maxShrinkCount + ' 格') + '</span></button></div>' +
                '</div>' +
                '</div></div>';
        }

        html += '</div>';

        showModal(html, 'modal-overlay--top ui-scrollable-modal psect-farm-modal-overlay');
    },

    async claimPlot() {
        this.claimPlots(1);
    },

    async claimPlotsFrom(inputId) {
        const d = this._farmData;
        if (!d) return;
        const maxClaimCount = this._farmMaxClaimCount(d);
        await this.claimPlots(this._farmBatchCount(inputId, maxClaimCount));
    },

    async claimPlots(count) {
        const d = this._farmData;
        if (!d) return;
        const maxClaimCount = this._farmMaxClaimCount(d);
        const claimCount = count || this._farmBatchCount('psectFarmClaimCount', maxClaimCount);
        if (maxClaimCount <= 0) {
            showToast('贡献不足', 'error');
            return;
        }
        if (claimCount > maxClaimCount) {
            showToast('最多只能开垦 ' + maxClaimCount + ' 块', 'error');
            return;
        }
        const totalCost = (d.claimContribCost || 0) * claimCount;
        const submit = async () => {
            try {
                const res = await api.post('/api/game/player-sect/farm/claim-batch', { count: claimCount });
                if (res.code === 200) {
                    showToast(res.data || '开垦成功');
                    this.showFarm();
                } else {
                    showToast(res.message || '开垦失败', 'error');
                }
            } catch (e) { showToast('网络异常'); }
        };
        if (claimCount <= 1) {
            await submit();
        } else {
            gameConfirm('确定一次开垦 ' + claimCount + ' 块灵田？将消耗 ' + totalCost + ' 点贡献。', submit);
        }
    },

    async expandFarm() {
        this.expandFarmBatch(1);
    },

    async expandFarmBatch(count) {
        const d = this._farmData;
        if (!d) return;
        const costPerSlot = d.nextExpandCost || 0;
        const treasury = d.sectTreasury || 0;
        const maxAffordableExpand = costPerSlot > 0 ? Math.floor(treasury / costPerSlot) : (this._farmBatchLimit || 5000);
        const maxExpandCount = Math.min(this._farmBatchLimit || 5000, maxAffordableExpand);
        const expandCount = count || this._farmBatchCount('psectFarmExpandCount', maxExpandCount);
        if (maxExpandCount <= 0) {
            showToast('宗门金库灵石不足', 'error');
            return;
        }
        if (expandCount > maxExpandCount) {
            showToast('最多只能扩充 ' + maxExpandCount + ' 格', 'error');
            return;
        }
        const totalCost = costPerSlot * expandCount;
        gameConfirm('确定花费宗门金库 ' + totalCost + ' 灵石扩充 ' + expandCount + ' 格灵田？', async () => {
            try {
                const res = await api.post('/api/game/player-sect/farm/expand-batch', { count: expandCount });
                if (res.code === 200) {
                    showToast(res.data || '扩充成功');
                    this.showFarm();
                } else {
                    showToast(res.message || '扩充失败', 'error');
                }
            } catch (e) { showToast('网络异常'); }
        });
    },

    async shrinkFarmBatch(count) {
        const d = this._farmData;
        if (!d) return;
        const extraSlots = d.extraSlots || 0;
        const maxShrinkCount = Math.min(this._farmBatchLimit || 5000, extraSlots);
        const shrinkCount = count || this._farmBatchCount('psectFarmShrinkCount', maxShrinkCount);
        if (maxShrinkCount <= 0) {
            showToast('没有可缩减的扩充灵田', 'error');
            return;
        }
        if (shrinkCount > maxShrinkCount) {
            showToast('最多只能缩减 ' + maxShrinkCount + ' 格', 'error');
            return;
        }
        const refundPerSlot = d.shrinkSlotRefund || Math.floor((d.nextExpandCost || 0) / 2);
        const totalRefund = refundPerSlot * shrinkCount;
        gameConfirm('确定缩减 ' + shrinkCount + ' 格扩充灵田？\n将返还约 ' + totalRefund + ' 灵石到宗门金库。若高号灵田仍被占用，系统会拒绝缩减。', async () => {
            try {
                const res = await api.post('/api/game/player-sect/farm/shrink-batch', { count: shrinkCount });
                if (res.code === 200) {
                    showToast(res.data || '缩减成功');
                    this.showFarm();
                } else {
                    showToast(res.message || '缩减失败', 'error');
                }
            } catch (e) { showToast('网络异常'); }
        });
    },

    openPlantDialog(plotId) {
        const seeds = this._farmData?.seeds || [];
        // 背包中有库存 或 坊市上架中 才可选
        const available = seeds.filter(s => (s.bagCount || 0) > 0 || s.priceSpiritStones >= 0);
        if (available.length === 0) {
            showToast('坊市暂无可购灵种，背包也无可用灵种');
            return;
        }
        const plot = (this._farmData?.myPlots || []).find(p => p.plotId === plotId);
        const plotLabel = plot ? `第 ${plot.slotIndex + 1} 号灵田` : '灵田';
        const lastSeedId = this._lastSeedId;
        const hasLast = lastSeedId && available.some(s => s.seedId === lastSeedId);
        let opts = '';
        available.forEach(s => {
            const hasBag = (s.bagCount || 0) > 0;
            const source = hasBag
                ? `背包 ×${s.bagCount}`
                : (s.priceSpiritStones >= 0 ? `坊市 ${s.priceSpiritStones}灵石` : '已下架');
            const selected = hasLast && s.seedId === lastSeedId ? ' selected' : '';
            opts += `<option value="${s.seedId}"${selected}>${escapeHtml(s.seedName)} · ${escapeHtml(source)} · 产${escapeHtml(s.yieldName)} ×${s.yieldMin}-${s.yieldMax} · ${s.growHours}h</option>`;
        });

        let html = '<div class="modal-header-deco">' +
            '<div class="modal-header-deco__subtitle">灵田播种</div>' +
            '<div style="font-size:16px; color:var(--accent-jade); font-weight:bold; margin-top:4px;">' + escapeHtml(plotLabel) + '</div>' +
            '<div style="font-size:12px; color:var(--text-muted); margin-top:6px;">优先消耗背包灵种或灵胚；若无则从坊市购买（灵石汇入金库）。</div>' +
            '</div>';

        html += '<div class="modal-body-padded">' +
            '<div class="modal-info-card modal-info-card--jade">' +
                '<div class="modal-info-card__title modal-info-card__title--jade">✦ 选择灵种</div>' +
                '<select id="psectFarmSeedSelect" class="app-input" style="width:100%;">' + opts + '</select>' +
            '</div>' +
            '</div>';

        html += '<div class="modal-btn-row" style="padding: 0 20px 20px; margin-top:0;">' +
            '<button class="modal-action-btn modal-action-btn--orange" onclick="PlayerSectModule.submitPlant(' + plotId + ')">' +
                '<span class="modal-action-btn__icon">✦</span>' +
                '<span class="modal-action-btn__text">播种</span>' +
            '</button>' +
            '<button class="modal-action-btn" onclick="PlayerSectModule.showFarm()">' +
                '<span class="modal-action-btn__text">返回</span>' +
            '</button>' +
            '</div>';

        showModal(html, 'modal-overlay--top ui-scrollable-modal');
    },

    async submitPlant(plotId) {
        const seedId = document.getElementById('psectFarmSeedSelect')?.value;
        if (!seedId) { showToast('未选种子'); return; }
        try {
            const res = await api.post('/api/game/player-sect/farm/plant', { plotId, seedId });
            if (res.code === 200) {
                this._lastSeedId = seedId;
                showToast('播种成功');
                this.showFarm();
            } else {
                showToast(res.message || '播种失败', 'error');
            }
        } catch (e) { showToast('网络异常'); }
    },

    async harvestPlot(plotId) {
        try {
            const res = await api.post('/api/game/player-sect/farm/harvest', { plotId });
            if (res.code === 200) {
                showToast('收获成功');
                this.showFarm();
            } else {
                showToast(res.message || '收获失败', 'error');
            }
        } catch (e) { showToast('网络异常'); }
    },

    async harvestAll() {
        try {
            const res = await api.post('/api/game/player-sect/farm/harvest-all', {});
            if (res.code === 200) {
                showToast(res.data || '已一键收获');
                this.showFarm();
                if (typeof loadInventory === 'function') loadInventory();
            } else {
                showToast(res.message || '一键收获失败', 'error');
            }
        } catch (e) { showToast('网络异常'); }
    },

    async uprootAll() {
        const activeCount = this._farmPlantedCount() + this._farmMatureCount();
        if (activeCount <= 0) {
            showToast('暂无可铲除的作物');
            return;
        }
        gameConfirm(`确定一键铲除 ${activeCount} 块灵田的作物吗？\n成长中和已成熟作物都会清空，种子与产物都不返还。`, async () => {
            try {
                const res = await api.post('/api/game/player-sect/farm/uproot-all', {});
                if (res.code === 200) {
                    showToast(res.data || '已一键铲除');
                    this.showFarm();
                    this.loadFarmBadge();
                } else {
                    showToast(res.message || '一键铲除失败', 'error');
                }
            } catch (e) { showToast('网络异常'); }
        });
    },

    _setPlantAllDialogBusy(busy) {
        const disabled = !!busy;
        this._farmPlantAllRunning = disabled;
        ['psectFarmSeedSelectAll', 'psectFarmPlantAllCount', 'psectFarmPlantAllConfirmBtn', 'psectFarmPlantAllBackBtn'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = disabled;
        });
        const textEl = document.getElementById('psectFarmPlantAllConfirmText');
        if (textEl) textEl.textContent = disabled ? '播种中...' : '确认播种';
    },

    _renderPlantAllProgress(progress) {
        const box = document.getElementById('psectFarmPlantAllProgress');
        if (!box) return;
        const status = progress?.status || 'running';
        if (status === 'idle' && !this._farmPlantAllRunning) {
            box.style.display = 'none';
            return;
        }

        const total = Math.max(0, Math.floor(Number(progress?.total || 0)));
        const processedRaw = Math.max(0, Math.floor(Number(progress?.processed || 0)));
        const processed = total > 0 ? Math.min(processedRaw, total) : processedRaw;
        const pct = total > 0
            ? Math.min(100, Math.max(0, Math.round(processed * 100 / total)))
            : (status === 'completed' ? 100 : 0);
        const fallback = status === 'completed'
            ? '播种完成'
            : (status === 'error' ? '播种失败' : '播种中...');
        const message = progress?.message || fallback;

        box.style.display = '';
        box.classList.toggle('psect-farm-batch-progress--done', status === 'completed');
        box.classList.toggle('psect-farm-batch-progress--error', status === 'error');

        const textEl = document.getElementById('psectFarmPlantAllProgressText');
        if (textEl) textEl.textContent = message;
        const countEl = document.getElementById('psectFarmPlantAllProgressCount');
        if (countEl) countEl.textContent = total > 0 ? (processed + '/' + total) : (status === 'running' ? '处理中' : '');
        const barEl = document.getElementById('psectFarmPlantAllProgressBar');
        if (barEl) barEl.style.width = pct + '%';
    },

    _stopPlantAllProgressPolling() {
        if (this._farmPlantAllPollTimer) {
            clearInterval(this._farmPlantAllPollTimer);
            this._farmPlantAllPollTimer = null;
        }
    },

    _startPlantAllProgressPolling() {
        this._stopPlantAllProgressPolling();
        this._farmPlantAllPollTimer = setInterval(() => {
            this._refreshPlantAllProgressOnce();
        }, 600);
    },

    async _refreshPlantAllProgressOnce() {
        try {
            const res = await api.get('/api/game/player-sect/farm/plant-all-progress');
            if (res.code === 200 && res.data) {
                this._renderPlantAllProgress(res.data);
                return res.data;
            }
        } catch (e) {
            // 轮询失败不打断正在进行的播种请求，最终结果仍以提交接口为准。
        }
        return null;
    },

    openPlantAllDialog() {
        const seeds = this._farmData?.seeds || [];
        const available = seeds.filter(s => (s.bagCount || 0) > 0 || s.priceSpiritStones >= 0);
        if (available.length === 0) {
            showToast('坊市暂无可购灵种，背包也无可用灵种');
            return;
        }
        const idleCount = this._farmIdleCount();
        if (idleCount === 0) { showToast('没有空闲的灵田'); return; }

        const lastSeedId = this._lastSeedId;
        const hasLast = lastSeedId && available.some(s => s.seedId === lastSeedId);
        let opts = '';
        available.forEach(s => {
            const hasBag = (s.bagCount || 0) > 0;
            const source = hasBag
                ? `背包 ×${s.bagCount}`
                : (s.priceSpiritStones >= 0 ? `坊市 ${s.priceSpiritStones}灵石` : '已下架');
            const selected = hasLast && s.seedId === lastSeedId ? ' selected' : '';
            opts += `<option value="${s.seedId}"${selected}>${escapeHtml(s.seedName)} · ${escapeHtml(source)} · 产${escapeHtml(s.yieldName)} ×${s.yieldMin}-${s.yieldMax} · ${s.growHours}h</option>`;
        });

        let html = '<div class="modal-header-deco">' +
            '<div class="modal-header-deco__subtitle">批量播种</div>' +
            '<div style="font-size:16px; color:var(--accent-jade); font-weight:bold; margin-top:4px;">空闲灵田 ' + idleCount + ' 块</div>' +
            '<div style="font-size:12px; color:var(--text-muted); margin-top:6px;">按选择数量投入同一种灵种；优先用背包，背包不足时按坊市价从灵石扣（汇入金库）。</div>' +
            '</div>';

        html += '<div class="modal-body-padded">' +
            '<div class="modal-info-card modal-info-card--jade">' +
                '<div class="modal-info-card__title modal-info-card__title--jade">✦ 选择灵种</div>' +
                '<select id="psectFarmSeedSelectAll" class="app-input" style="width:100%;">' + opts + '</select>' +
                '<div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:10px;">' +
                    '<label for="psectFarmPlantAllCount" style="font-size:12px; color:var(--text-muted);">播种数量</label>' +
                    '<input type="number" id="psectFarmPlantAllCount" class="app-input" style="width:92px; text-align:center;" min="1" max="' + idleCount + '" value="' + idleCount + '">' +
                '</div>' +
                '<div id="psectFarmPlantAllProgress" class="psect-farm-batch-progress" style="display:none;">' +
                    '<div class="psect-farm-batch-progress__head">' +
                        '<span id="psectFarmPlantAllProgressText">准备播种...</span>' +
                        '<b id="psectFarmPlantAllProgressCount">0/0</b>' +
                    '</div>' +
                    '<div class="psect-farm-batch-progress__track">' +
                        '<div id="psectFarmPlantAllProgressBar" class="psect-farm-batch-progress__bar" style="width:0%;"></div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '</div>';

        html += '<div class="modal-btn-row" style="padding: 0 20px 20px; margin-top:0;">' +
            '<button id="psectFarmPlantAllConfirmBtn" class="modal-action-btn modal-action-btn--orange" onclick="PlayerSectModule.submitPlantAll()">' +
                '<span class="modal-action-btn__icon">✦</span>' +
                '<span id="psectFarmPlantAllConfirmText" class="modal-action-btn__text">确认播种</span>' +
            '</button>' +
            '<button id="psectFarmPlantAllBackBtn" class="modal-action-btn" onclick="PlayerSectModule.showFarm()">' +
                '<span class="modal-action-btn__text">返回</span>' +
            '</button>' +
            '</div>';

        showModal(html, 'modal-overlay--top ui-scrollable-modal');
    },

    async submitPlantAll() {
        if (this._farmPlantAllRunning) {
            showToast('正在播种中...');
            return;
        }
        const seedId = document.getElementById('psectFarmSeedSelectAll')?.value;
        if (!seedId) { showToast('未选种子'); return; }
        const idleCount = this._farmIdleCount();
        const count = this._farmBatchCount('psectFarmPlantAllCount', idleCount);
        this._setPlantAllDialogBusy(true);
        this._renderPlantAllProgress({ status: 'running', total: count, processed: 0, message: '准备播种...' });
        this._startPlantAllProgressPolling();
        try {
            const res = await api.post('/api/game/player-sect/farm/plant-all', { seedId, count });
            const finalProgress = await this._refreshPlantAllProgressOnce();
            this._stopPlantAllProgressPolling();
            if (res.code === 200) {
                this._lastSeedId = seedId;
                this._renderPlantAllProgress(finalProgress || { status: 'completed', total: count, processed: count, message: res.data || '批量播种完成' });
                showToast(res.data || '批量播种完成');
                setTimeout(() => {
                    this._farmPlantAllRunning = false;
                    this.showFarm();
                }, 500);
                if (typeof loadInventory === 'function') loadInventory();
            } else {
                const message = res.message || '批量播种失败';
                this._renderPlantAllProgress(finalProgress || { status: 'error', total: count, processed: 0, message });
                showToast(message, 'error');
                this._setPlantAllDialogBusy(false);
            }
        } catch (e) {
            this._stopPlantAllProgressPolling();
            this._renderPlantAllProgress({ status: 'error', total: count, processed: 0, message: '网络异常' });
            showToast('网络异常', 'error');
            this._setPlantAllDialogBusy(false);
        }
    },

    async attackFarmInvasion() {
        try {
            const res = await api.post('/api/game/player-sect/farm/invasion/attack', {});
            if (res.code === 200) {
                const data = res.data || {};
                const logs = Array.isArray(data.battleLogs) ? data.battleLogs : [];
                if (logs.length) {
                    if (typeof typewriterLogs === 'function') {
                        const speed = logs.length > 15 ? 15 : 30;
                        await typewriterLogs(logs, 'battle', speed);
                    } else if (typeof appendLogs === 'function') {
                        appendLogs(logs, 'battle');
                    } else if (typeof appendLog === 'function') {
                        logs.forEach(function(log) { appendLog(log, 'battle'); });
                    }
                }
                showToast(data.message || '已抵御兽潮');
                this.showFarm();
            } else {
                showToast(res.message || '抵御失败', 'error');
            }
        } catch (e) {
            showToast('网络异常', 'error');
        }
    },

    async uprootPlot(plotId) {
        const plot = (this._farmData?.myPlots || []).find(p => p.plotId === plotId);
        const slot = plot ? (plot.slotIndex + 1) : '?';
        const seedName = plot && plot.seedName ? plot.seedName : '该作物';
        gameConfirm(`确定铲除第 ${slot} 号灵田的「${seedName}」吗？\n生长时间作废，且不返还种子。`, async () => {
            try {
                const res = await api.post('/api/game/player-sect/farm/uproot', { plotId });
                if (res.code === 200) {
                    showToast('已铲除');
                    this.showFarm();
                } else {
                    showToast(res.message || '铲除失败', 'error');
                }
            } catch (e) { showToast('网络异常'); }
        });
    },

    async releasePlot(plotId) {
        const plot = (this._farmData?.myPlots || []).find(p => p.plotId === plotId);
        const slot = plot ? (plot.slotIndex + 1) : '?';
        // 预估仅作提示, 实际返还以服务端 "开垦时实付贡献 / 2" 为准 (宗主调价、老灵田迁移可能不一致)
        const estRefund = Math.floor((this._farmData?.claimContribCost || 0) / 2);
        gameConfirm(`确定退还第 ${slot} 号灵田？\n预估返还 ${estRefund} 点贡献 (按开垦时实付的 50%, 向下取整; 实际以服务端为准)。\n该灵田槽位会回到宗门公共池供他人开垦。`, async () => {
            try {
                const res = await api.post('/api/game/player-sect/farm/release', { plotId });
                if (res.code === 200) {
                    const actual = (res.data && typeof res.data.refund === 'number') ? res.data.refund : estRefund;
                    showToast(actual > 0 ? `已退田, 返还 ${actual} 点贡献` : '已退田');
                    this.showFarm();
                } else {
                    showToast(res.message || '退田失败', 'error');
                }
            } catch (e) { showToast('网络异常'); }
        });
    },

    async releaseAllPlots() {
        const idleCount = this._farmIdleCount();
        const total = this._farmPlotTotal();
        const activeCount = Math.max(0, total - idleCount);
        if (idleCount <= 0) {
            showToast(activeCount > 0 ? '暂无空闲灵田可退，请先收获或铲除作物' : '你尚未开垦灵田');
            return;
        }
        gameConfirm(`确定一键退还 ${idleCount} 块空闲灵田吗？\n按每块开垦时实付贡献的 50% 返还；仍有作物的 ${activeCount} 块不会退还。`, async () => {
            try {
                const res = await api.post('/api/game/player-sect/farm/release-all', {});
                if (res.code === 200) {
                    showToast(res.data || '已一键退田');
                    this.showFarm();
                } else {
                    showToast(res.message || '一键退田失败', 'error');
                }
            } catch (e) { showToast('网络异常'); }
        });
    },

    async reclaimMemberFarm(targetPlayerId, farmPlotCount) {
        const member = (this._memberList || []).find(m => m.playerId === targetPlayerId);
        const playerName = member ? (member.playerName || '该弟子') : '该弟子';
        const count = parseInt(farmPlotCount, 10) || 0;
        if (count <= 0) {
            showToast('该弟子没有灵田');
            return;
        }
        gameConfirm(`确定收回【${playerName}】名下 ${count} 块宗门灵田吗？\n收回后灵田槽位回到宗门公共池，已种植作物将一并清除，且不返还开垦贡献。`, async () => {
            try {
                const res = await api.post('/api/game/player-sect/farm/reclaim-member', { targetPlayerId });
                if (res.code === 200) {
                    showToast(res.data || '已收回灵田');
                    this.showMembers();
                    this.loadFarmBadge();
                } else {
                    showToast(res.message || '收回失败', 'error');
                }
            } catch (e) {
                showToast(e.message || '网络异常', 'error');
            }
        });
    },

    async setFarmClaimCost() {
        const val = parseInt(document.getElementById('psectFarmClaimCost')?.value, 10);
        if (isNaN(val) || val < 0) { showToast('贡献费不合法'); return; }
        try {
            const res = await api.post('/api/game/player-sect/farm/set-claim-cost', { claimContribCost: val });
            if (res.code === 200) {
                showToast('已更新');
                this.showFarm();
            } else {
                showToast(res.message || '更新失败', 'error');
            }
        } catch (e) { showToast('网络异常'); }
    },

    async setFarmSeedPrice(seedId) {
        const val = parseInt(document.getElementById('psectFarmSeedPrice_' + seedId)?.value, 10);
        if (isNaN(val) || val < -1) { showToast('价格不合法'); return; }
        try {
            const res = await api.post('/api/game/player-sect/farm/set-seed-price', { seedId, priceSpiritStones: val });
            if (res.code === 200) {
                showToast('已更新');
                this.showFarm();
            } else {
                showToast(res.message || '更新失败', 'error');
            }
        } catch (e) { showToast('网络异常'); }
    },

    async showMembers() {
        try {
            const res = await api.get('/api/game/player-sect/members');
            const list = res.data || [];
            this._memberList = list;
            const isOwner = this.sectInfo?.myRole === 'MASTER';
            const isManage = this.sectInfo?.myRole === 'MASTER' || this.sectInfo?.myRole === 'ELDER';
            const canGrantTreasury = sectHasPerm(this.sectInfo?.myRole, this.sectInfo?.myPermissions || 0, SECT_PERMS.GRANT_TREASURY);
            const canManageFarm = sectHasPerm(this.sectInfo?.myRole, this.sectInfo?.myPermissions || 0, SECT_PERMS.MANAGE_FARM);
            this._renderMemberList(list, isOwner, isManage, '弟子名册', canGrantTreasury, canManageFarm);
        } catch (e) {
            showToast(e.message, 'error');
        }
    },

    async showPublicMembers(sectId, sectName) {
        try {
            const res = await api.get('/api/game/player-sect/public-members?sectId=' + encodeURIComponent(sectId));
            const list = res.data || [];
            this._renderMemberList(list, false, false, sectName + ' - 弟子名册', false, false);
        } catch (e) {
            showToast(e.message, 'error');
        }
    },

    formatMemberLastActive(ts) {
        const value = Number(ts) || 0;
        if (value <= 0) return '暂无记录';
        const diff = Date.now() - value;
        if (diff < 0) return new Date(value).toLocaleString('zh-CN', { hour12: false });
        const minute = 60 * 1000;
        const hour = 60 * minute;
        const day = 24 * hour;
        if (diff < 5 * minute) return '刚刚';
        if (diff < hour) return Math.floor(diff / minute) + '分钟前';
        if (diff < day) return Math.floor(diff / hour) + '小时前';
        if (diff < 7 * day) return Math.floor(diff / day) + '天前';
        return new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    },

    _renderMemberList(list, isOwner, isManage, title, canGrantTreasury, canManageFarm) {
        const roleMap = {
            'MASTER': '宗主', 'ELDER': '长老', 'DISCIPLE': '弟子', 'ASCENDED': '已飞升',
            'CHIEF': '首席弟子', 'CORE_DISCIPLE': '核心弟子',
            'INNER_DISCIPLE': '内门弟子', 'OUTER_DISCIPLE': '外门弟子'
        };
        const roleIcon = {
            'MASTER': icon('crown', { size: 14, color: 'var(--text-gold)' }),
            'ELDER': '⚜', 'DISCIPLE': '◈', 'ASCENDED': '↟',
            'CHIEF': '✦', 'CORE_DISCIPLE': '◆',
            'INNER_DISCIPLE': '◇', 'OUTER_DISCIPLE': '·'
        };

        let html = '<div class="modal-header-deco">' +
            '<div class="modal-header-deco__subtitle">弟子名册</div>' +
            '<div class="modal-header-deco__value" style="margin-bottom: 4px;">' +
            '<span class="modal-header-deco__num" id="psectMemberVisibleCount" style="color:var(--accent-jade);">' + list.length + '</span>' +
            '<span class="modal-header-deco__unit" style="font-size:18px;"> 名弟子</span>' +
            '</div>' +
            '<div style="font-size:12px; color:var(--text-muted);">按职位与贡献排列，点击操作可管理同门。</div>' +
            '</div>' +
            '<div class="modal-body-padded">';

        if (list.length === 0) {
            html += '<div style="text-align:center;color:var(--text-muted);padding:16px;">空无一人...</div>';
        } else {
            html += '<div class="psect-member-search-bar">' +
                '<input type="search" id="psectMemberSearch" class="app-input psect-member-search" placeholder="搜索道号、境界、职位..." oninput="PlayerSectModule.filterRenderedMembers()">' +
                '</div>' +
                '<div id="psectMemberEmpty" class="psect-member-empty hidden">未找到匹配弟子</div>';
            const myId = (window._lastPlayerData && window._lastPlayerData.id) || 0;
            const showPrivateFields = title === '弟子名册';
            list.forEach(function(m) {
                let actions = '';
                var isAscended = m.role === 'ASCENDED';
                var farmPlotCount = parseInt(m.farmPlotCount || 0, 10) || 0;
                var displayName = (typeof window.formatFriendName === 'function' && m.playerId) ? window.formatFriendName(m.playerId, m.playerName) : m.playerName;
                var roleLabel = roleMap[m.role] || m.role;
                var safeRoleLabel = escapeHtml(roleLabel);
                var safeRealmText = escapeHtml(isAscended ? '仙界已退宗' : m.realmName);
                var searchText = [
                    displayName,
                    m.playerName,
                    m.realmName,
                    roleLabel,
                    m.role,
                    m.contribution,
                    farmPlotCount
                ].join(' ').toLowerCase();
                if (isManage && !isAscended) {
                    actions += '<button class="btn-action" onclick="PlayerSectModule.showGrantDialog(' + m.playerId + ', \'' + escapeHtml(m.playerName) + '\')" style="padding:2px 6px;font-size:11px;margin-right:4px;">赏赐</button>';
                }
                if (canGrantTreasury && m.playerId !== myId && !isAscended) {
                    actions += '<button class="btn-action" onclick="PlayerSectModule.showGrantTreasuryDialog(' + m.playerId + ', \'' + escapeHtml(m.playerName) + '\')" style="padding:2px 6px;font-size:11px;margin-right:4px;">发福利</button>';
                }
                var canReclaimRole = isOwner ? m.role !== 'MASTER' : (m.role === 'DISCIPLE' || isAscended);
                if (canManageFarm && farmPlotCount > 0 && m.playerId !== myId && canReclaimRole) {
                    actions += '<button class="btn-action btn-danger" onclick="PlayerSectModule.reclaimMemberFarm(' + m.playerId + ', ' + farmPlotCount + ')" style="padding:2px 6px;font-size:11px;margin-right:4px;">收回灵田</button>';
                }
                if (isOwner && m.role !== 'MASTER' && !isAscended) {
                    if (m.role === 'DISCIPLE') {
                        actions += '<button class="btn-action" onclick="PlayerSectModule.appointElder(' + m.playerId + ')" style="padding:2px 6px;font-size:11px;margin-right:4px;">任命长老</button>';
                    } else if (m.role === 'ELDER') {
                        actions += '<button class="btn-action" onclick="PlayerSectModule.showEditPermissions(' + m.playerId + ', \'' + escapeHtml(m.playerName) + '\', ' + (m.permissions || 0) + ')" style="padding:2px 6px;font-size:11px;margin-right:4px;">权限</button>';
                        actions += '<button class="btn-action" onclick="PlayerSectModule.removeElder(' + m.playerId + ')" style="padding:2px 6px;font-size:11px;margin-right:4px;">撤销长老</button>';
                    }
                    actions += '<button class="btn-action" onclick="PlayerSectModule.transferMaster(' + m.playerId + ', \'' + escapeHtml(m.playerName) + '\')" style="padding:2px 6px;font-size:11px;margin-right:4px;background:var(--bg-card);color:var(--text-gold);border:1px solid var(--border-color);">禅让</button>';
                    actions += '<button class="btn-action btn-danger" onclick="PlayerSectModule.kickMember(' + m.playerId + ')" style="padding:2px 6px;font-size:11px;">踢出</button>';
                }

                var isMaster = m.role === 'MASTER';
                var cardClass = isMaster ? 'modal-info-card--jade' : (isAscended ? 'modal-info-card--muted' : '');
                var iconStyle = isMaster ? 'color:var(--text-gold);' : (m.role === 'ELDER' ? 'color:var(--accent-jade);' : (isAscended ? 'color:var(--text-muted);' : 'color:var(--text-secondary);'));

                html += '<div class="modal-info-card js-psect-member-card ' + cardClass + '" data-member-search="' + escapeHtml(searchText) + '" style="margin-top:8px;">';
                html += '<div style="display:flex;align-items:center;justify-content:space-between;">';
                html += '<div style="display:flex;align-items:center;gap:8px;">';
                html += '<span style="font-size:16px;' + iconStyle + '">' + (roleIcon[m.role] || '◈') + '</span>';
                html += '<b style="font-size:14px;color:var(--text-primary);">' + escapeHtml(displayName) + '</b>';
                html += '<span style="font-size:11px;' + iconStyle + '">' + safeRoleLabel + '</span>';
                html += '</div>';
                html += '<span style="font-size:11px;color:var(--text-muted);">' + safeRealmText + '</span>';
                html += '</div>';
                html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px;">';
                html += '<span style="font-size:12px;color:var(--text-secondary);">' + (isAscended ? '飞升前贡献留档' : '贡献') + ' <span style="color:var(--accent-jade);font-weight:bold;">' + m.contribution + '</span></span>';
                if (actions) {
                    html += '<div style="display:flex;flex-wrap:wrap;gap:4px;">' + actions + '</div>';
                }
                html += '</div>';
                if (showPrivateFields) {
                    html += '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:6px;font-size:11px;color:var(--text-muted);">';
                    html += '<span>最后活跃 ' + PlayerSectModule.formatMemberLastActive(m.lastActiveAt) + '</span>';
                    html += '<span>灵田 <b style="color:var(--accent-jade);">' + farmPlotCount + '</b> 块</span>';
                    html += '</div>';
                }
                html += '</div>';
            });
        }

        html += '</div>';

        showModal(html, 'modal-overlay--top ui-scrollable-modal');
    },

    filterRenderedMembers() {
        const input = document.getElementById('psectMemberSearch');
        const query = input ? input.value.trim().toLowerCase() : '';
        const cards = Array.from(document.querySelectorAll('.js-psect-member-card'));
        let visibleCount = 0;

        cards.forEach(card => {
            const searchText = card.getAttribute('data-member-search') || '';
            const matched = !query || searchText.includes(query);
            card.style.display = matched ? '' : 'none';
            if (matched) visibleCount += 1;
        });

        const countEl = document.getElementById('psectMemberVisibleCount');
        if (countEl) {
            countEl.textContent = query ? visibleCount + '/' + cards.length : String(cards.length);
        }

        const emptyEl = document.getElementById('psectMemberEmpty');
        if (emptyEl) {
            emptyEl.classList.toggle('hidden', visibleCount > 0 || cards.length === 0);
        }
    },

    async showApplications() {
        try {
            const res = await api.get('/api/game/player-sect/applications');
            const list = res.data || [];
            this._setApplicationBadge(list.length);
            this.loadFarmBadge();
            if (list.length === 0) {
                this._openDecoratedModal('入宗申请', '<p style="text-align:center;padding:20px;color:var(--text-muted);">暂无待审批申请</p>');
                return;
            }
            const html = list.map(a => `
                <div class="modal-info-card">
                    <div style="display:flex;align-items:center;justify-content:space-between;">
                        <div>
                            <b style="color:var(--text-primary);">${escapeHtml(a.playerName)}</b>
                            <span style="font-size:11px;color:var(--text-muted);margin-left:6px;">${a.realmName}</span>
                        </div>
                    </div>
                    <div class="modal-btn-row" style="margin-top:10px;">
                        <button class="modal-btn modal-btn--gold" onclick="PlayerSectModule.approveApp(${a.id})">通过</button>
                        <button class="modal-btn modal-btn--danger" onclick="PlayerSectModule.rejectApp(${a.id})">拒绝</button>
                    </div>
                </div>
            `).join('');
            this._openDecoratedModal('入宗申请', `<div style="max-height:60vh;overflow-y:auto;padding-right:4px;">${html}</div>`);
        } catch (e) {
            showToast(e.message, 'error');
        }
    },

    async approveApp(appId) {
        try {
            const res = await api.post('/api/game/player-sect/approve', { applicationId: appId });
            if (res.code === 200) {
                showToast('已通过');
                this.showApplications();
            } else {
                showToast(res.message || '操作失败', 'error');
            }
        } catch (e) {
            showToast(e.message, 'error');
        }
    },

    async rejectApp(appId) {
        try {
            const res = await api.post('/api/game/player-sect/reject', { applicationId: appId });
            if (res.code === 200) {
                showToast('已拒绝');
                this.showApplications();
            } else {
                showToast(res.message || '操作失败', 'error');
            }
        } catch (e) {
            showToast(e.message, 'error');
        }
    },

    async appointElder(targetId) {
        try {
            const res = await api.post('/api/game/player-sect/appoint-elder', { targetId });
            if (res.code === 200) {
                showToast('已任命长老');
                this.showMembers();
            } else {
                showToast(res.message || '操作失败', 'error');
            }
        } catch (e) {
            showToast(e.message, 'error');
        }
    },

    async removeElder(targetId) {
        try {
            const res = await api.post('/api/game/player-sect/remove-elder', { targetId });
            if (res.code === 200) {
                showToast('已撤销长老');
                this.showMembers();
            } else {
                showToast(res.message || '操作失败', 'error');
            }
        } catch (e) {
            showToast(e.message, 'error');
        }
    },

    async transferMaster(targetId, playerName) {
        gameConfirm(`警告：确定要将宗主之位禅让给【${playerName}】吗？此操作不可逆！`, async () => {
            try {
                const res = await api.post('/api/game/player-sect/transfer-master', { targetId });
                if (res.code === 200) {
                    showToast('禅让成功，你已退位为长老');
                    closeGameModal();
                    SectModule.loadInfo();
                    loadPlayerInfo();
                } else {
                    showToast(res.message || '禅让失败', 'error');
                }
            } catch (e) {
                showToast(e.message, 'error');
            }
        });
    },

    async showGrantDialog(targetId, playerName) {
        try {
            const res = await api.get('/api/game/player-sect/warehouse');
            const items = res.data || [];
            if (items.length === 0) {
                showToast('宗门仓库空空如也，无法赏赐');
                return;
            }

            this._grantItems = items;

            const html = `
                <div style="padding:16px;">
                    <p style="color:var(--text-secondary);font-size:13px;margin-bottom:12px;">正在给弟子 <b style="color:var(--text-gold);">${escapeHtml(playerName)}</b> 赏赐物资：</p>
                    <div style="margin-bottom:12px;">
                        <label style="display:block;font-size:13px;color:var(--text-secondary);margin-bottom:4px;">选择物资</label>
                        <input type="text" id="psectGrantSearch" class="app-input" placeholder="搜索物资名称..." style="width:100%;margin-bottom:8px;" oninput="PlayerSectModule.filterGrantItems()">
                        <select id="psectGrantSelect" class="app-select" style="width:100%;" onchange="PlayerSectModule.onGrantSelectChange()"></select>
                        <div id="psectGrantEmpty" style="display:none;margin-top:8px;text-align:center;color:var(--text-muted);font-size:12px;">未找到匹配的仓库物资</div>
                    </div>
                    <div style="margin-bottom:12px;">
                        <label style="display:block;font-size:13px;color:var(--text-secondary);margin-bottom:4px;">赏赐数量</label>
                        <input type="number" id="psectGrantAmt" class="app-input" style="width:100%;" min="1" max="${items[0].amount}" value="1">
                    </div>
                    <button class="btn-action" onclick="PlayerSectModule.doGrant(${targetId})" style="width:100%;margin-top:8px;">确认赏赐</button>
                    <button class="btn-action" style="width:100%;margin-top:8px;background:transparent;border:1px solid var(--border-color);color:var(--text-muted);" onclick="PlayerSectModule.showMembers()">返回名册</button>
                </div>
            `;
            showGameModal('宗门赏赐', html);
            this.filterGrantItems();
        } catch (e) {
            showToast('获取仓库数据失败', 'error');
        }
    },

    filterGrantItems() {
        const select = document.getElementById('psectGrantSelect');
        if (!select) return;
        const query = (document.getElementById('psectGrantSearch')?.value || '').trim().toLowerCase();
        const matched = (this._grantItems || []).filter(item => {
            const haystack = [
                item.name || '',
                item.description || '',
                item.type || ''
            ].join(' ').toLowerCase();
            return !query || haystack.indexOf(query) >= 0;
        });

        select.innerHTML = matched.map(item => {
            const stage = this.getStageMetaHtml(this.getItemMinStage(item));
            const meta = '库存: ' + item.amount + (stage ? ' · ' + stage.replace(/<[^>]+>/g, '') : '');
            return `<option value="${item.id}" data-max="${item.amount}">${escapeHtml(item.name)} (${meta})</option>`;
        }).join('');

        const empty = document.getElementById('psectGrantEmpty');
        if (empty) empty.style.display = matched.length ? 'none' : '';
        select.disabled = matched.length === 0;
        this.onGrantSelectChange();
    },

    onGrantSelectChange() {
        const select = document.getElementById('psectGrantSelect');
        const amountInput = document.getElementById('psectGrantAmt');
        if (!select || !amountInput) return;
        const opt = select.options[select.selectedIndex];
        const max = opt ? parseInt(opt.getAttribute('data-max'), 10) || 1 : 1;
        amountInput.max = String(max);
        amountInput.disabled = !opt;
        let value = parseInt(amountInput.value, 10);
        if (!Number.isFinite(value) || value < 1) value = 1;
        if (value > max) value = max;
        amountInput.value = String(value);
    },

    async doGrant(targetId) {
        const select = document.getElementById('psectGrantSelect');
        if (!select || select.disabled || !select.value) {
            showToast('请选择物资');
            return;
        }
        const warehouseId = select.value;
        const amount = parseInt(document.getElementById('psectGrantAmt').value);
        if (!amount || amount <= 0) {
            showToast('请输入有效数量');
            return;
        }

        try {
            const res = await api.post('/api/game/player-sect/grant-item', { targetId, warehouseId, amount });
            if (res.code === 200) {
                showToast('赏赐成功');
                PlayerSectModule.showMembers();
            } else {
                showToast(res.message || '赏赐失败', 'error');
            }
        } catch (e) {
            showToast(e.message, 'error');
        }
    },

    showGrantTreasuryDialog(targetId, playerName) {
        const treasury = (this.sectInfo && this.sectInfo.treasury) || 0;
        const grantMax = Math.min(10000000, Math.floor(treasury / 10));
        if (grantMax <= 0) {
            showToast('宗门金库不足，今日暂无可发放额度');
            return;
        }
        const html = `
            <div style="padding:16px;">
                <p style="color:var(--text-secondary);font-size:13px;margin-bottom:12px;">正在从宗门金库向弟子 <b style="color:var(--text-gold);">${escapeHtml(playerName)}</b> 发放灵石福利：</p>
                <div style="margin-bottom:8px;font-size:12px;color:var(--text-muted);">金库余额：<span style="color:var(--text-gold);">${this.formatStone(treasury)}</span> 灵石 · 每日限一次 · 本次最多 ${this.formatStone(grantMax)}</div>
                <div style="margin-bottom:12px;">
                    <label style="display:block;font-size:13px;color:var(--text-secondary);margin-bottom:4px;">发放金额</label>
                    <input type="number" id="psectGrantTreasuryAmt" class="app-input" style="width:100%;" min="1" max="${grantMax}" placeholder="灵石数量">
                </div>
                <button class="btn-action" onclick="PlayerSectModule.doGrantTreasury(${targetId})" style="width:100%;margin-top:8px;">确认发放</button>
                <button class="btn-action" style="width:100%;margin-top:8px;background:transparent;border:1px solid var(--border-color);color:var(--text-muted);" onclick="PlayerSectModule.showMembers()">返回名册</button>
            </div>
        `;
        showGameModal('发放福利', html);
    },

    async doGrantTreasury(targetId) {
        const treasury = (this.sectInfo && this.sectInfo.treasury) || 0;
        const grantMax = Math.min(10000000, Math.floor(treasury / 10));
        const amount = parseInt(document.getElementById('psectGrantTreasuryAmt')?.value);
        if (!amount || amount <= 0) { showToast('请输入有效金额'); return; }
        if (grantMax <= 0) { showToast('宗门金库不足，今日暂无可发放额度'); return; }
        if (amount > grantMax) { showToast('今日最多可发放 ' + this.formatStone(grantMax) + ' 灵石'); return; }
        try {
            const res = await api.post('/api/game/player-sect/grant', { targetId, amount });
            if (res.code === 200) {
                showToast('发放成功');
                SectModule.loadInfo();
                PlayerSectModule.showMembers();
            } else {
                showToast(res.message || '发放失败', 'error');
            }
        } catch (e) {
            showToast(e.message, 'error');
        }
    },

    async kickMember(targetId) {
        gameConfirm('确定踢出该弟子吗？', async () => {
            try {
                const res = await api.post('/api/game/player-sect/kick', { targetId });
                if (res.code === 200) {
                    showToast('已踢出');
                    this.showMembers();
                } else {
                    showToast(res.message || '操作失败', 'error');
                }
            } catch (e) {
                showToast(e.message, 'error');
            }
        });
    },

    leaveSect() {
        gameConfirm('确定退出宗门吗？退出后12小时内不可加入新宗门。', async () => {
            try {
                const res = await api.post('/api/game/player-sect/leave');
                if (res.code === 200) {
                    showToast('已退出宗门');
                    SectModule.loadInfo();
                    loadPlayerInfo();
                } else {
                    showToast(res.message || '退出失败', 'error');
                }
            } catch (e) {
                showToast(e.message, 'error');
            }
        });
    },

    disbandSect() {
        gameConfirm('【警告】解散宗门后，金库灵石和仓库物资将全部退回给你，所有弟子退出，此操作不可撤销! 确定继续？', async () => {
            try {
                const res = await api.post('/api/game/player-sect/disband');
                if (res.code === 200) {
                    showToast('宗门已解散');
                    SectModule.loadInfo();
                    loadPlayerInfo();
                } else {
                    showToast(res.message || '解散失败', 'error');
                }
            } catch (e) {
                showToast(e.message, 'error');
            }
        });
    },

    // ===== 镇派功法 =====
    _SECT_ART_TIER_NAMES: ['', '化神', '炼虚', '合道', '大乘', '渡劫'],
    _SECT_ART_PROB_ROWS: [
        ['修为获取(冥想)', '3~5%', '4~7%', '6~9%', '8~12%', '10~15%'],
        ['灵气吸收(冥想)', '3~5%', '4~7%', '6~10%', '8~13%', '10~16%'],
        ['突破成功率', '1%', '1.5%', '2%', '3%', '4%'],
        ['神识恢复速度', '3~5%', '4~7%', '6~9%', '8~12%', '10~15%'],
        ['气血恢复速度', '5~8%', '7~11%', '10~14%', '13~18%', '16~25%'],
        ['丹毒减免', '5~8%', '7~12%', '10~15%', '13~20%', '18~30%'],
        ['折寿减免', '5%', '8~10%', '12~15%', '18~22%', '22~30%'],
        ['突破保底加速', '1%', '1.5%', '2%', '3%', '4~5%'],
        ['灵田产出', '5~8%', '8~12%', '12~16%', '16~20%', '20~25%'],
        ['丹道精进', '2~3%', '3~4%', '4~5%', '5~7%', '6~8%'],
        ['战利品掉落率', '3~4%', '4~6%', '5~7%', '6~8%', '8~10%'],
        ['暴击率', '1~1.5%', '1.5~2%', '2~3%', '3~4%', '4~5%'],
        ['闪避率', '1~1.5%', '1.5~2%', '2~2.5%', '2.5~3.5%', '3~4%'],
        ['怪物经验加成', '5~8%', '7~10%', '9~12%', '11~14%', '13~15%']
    ],

    _buildSectArtProbabilityDetails() {
        const rows = this._SECT_ART_PROB_ROWS.map(row => `
            <tr>
                <td>${row[0]}</td>
                <td>${row[1]}</td>
                <td>${row[2]}</td>
                <td>${row[3]}</td>
                <td>${row[4]}</td>
                <td>${row[5]}</td>
            </tr>
        `).join('');
        return `
            <details style="margin-top:10px;font-size:11px;color:var(--text-muted);cursor:pointer;" open>
                <summary style="color:var(--text-secondary);">洗炼概率与数值范围</summary>
                <p style="margin:6px 0;">洗炼先从 14 种词条中等概率抽取，<b style="color:var(--text-gold);">每种词条 7.14%</b>；再按所选品级在对应范围内等概率取值，显示时四舍五入到 0.1%。修为获取(冥想)与怪物经验加成仅天仙境及以下生效，仙君境及以上不生效。</p>
                <table style="width:100%;font-size:11px;color:var(--text-muted);border-collapse:collapse;">
                    <tr style="color:var(--text-secondary);"><th align="left">词条</th><th align="left">化神</th><th align="left">炼虚</th><th align="left">合道</th><th align="left">大乘</th><th align="left">渡劫</th></tr>
                    ${rows}
                </table>
            </details>
        `;
    },

    async showSectArt() {
        try {
            const res = await api.get('/api/game/sect-art/info');
            if (res.code !== 200) {
                showToast(res.message || '加载失败');
                return;
            }
            this.sectArtCache = res.data;
            this._renderSectArtModal();
        } catch (e) {
            showToast(e.message || '网络异常');
        }
    },

    _renderSectArtModal() {
        const data = this.sectArtCache;
        const isOwner = this.sectInfo && this.sectInfo.myRole === 'MASTER';
        const treasury = (this.sectInfo && this.sectInfo.treasury) || 0;
        const html = this._buildSectArtBody(data, isOwner, treasury);
        this._openDecoratedModal('镇派功法', html);
    },

    _buildSectArtBody(data, isOwner, treasury) {
        if (!data) {
            return '<div style="padding:20px;color:var(--text-muted);">无宗门数据</div>';
        }
        const sectLevel = data.sectLevel;
        const maxAllowedTier = data.maxAllowedTier;
        const totalSlots = data.totalSlots;
        const tierLabel = this._SECT_ART_TIER_NAMES[maxAllowedTier] || '化神';

        let html = '';

        // 头部说明
        html += `
            <div class="modal-info-card">
                <div class="modal-info-card__title">✦ 镇派绝学</div>
                <p style="font-size:13px;color:var(--text-muted);margin:4px 0 8px;">
                    宗主开创、宗门共修。功法品级随宗门等级解锁，玩家境界达到「品级 - 2 大境」即可享受被动加成。
                </p>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px;">
                    <div>当前宗门: <b>Lv.${sectLevel}</b></div>
                    <div>金库: <b style="color:var(--text-gold);">${treasury} 灵石</b></div>
                    <div>可洗最高品级: <b>${tierLabel}</b></div>
                    <div>词条槽位上限: <b>${totalSlots}</b></div>
                </div>
            </div>
        `;

        if (!data.name) {
            // 未开创
            html += `
                <div class="modal-info-card modal-info-card--gold">
                    <div class="modal-info-card__title">✦ 开创镇派功法</div>
                    <p style="font-size:13px;color:var(--text-muted);margin-bottom:8px;">
                        消耗宗门金库 <b style="color:var(--text-gold);">300,000 灵石</b> 开创本宗的镇派绝学。
                        ${isOwner ? '请输入名称（2~12字）与道源描述（可选，0~80字）。' : '<b style="color:var(--text-danger)">仅宗主可开创</b>。'}
                    </p>
                    ${isOwner ? `
                    <input type="text" id="sectArtNewName" class="app-input" placeholder="功法名称 (例: 太一玄微诀)" maxlength="12" style="width:100%;margin-bottom:6px;">
                    <textarea id="sectArtNewDesc" class="app-input" placeholder="道源描述 (可选)" maxlength="80" style="width:100%;height:50px;margin-bottom:8px;"></textarea>
                    <button class="btn-action" style="width:100%;" onclick="PlayerSectModule.doCreateSectArt()">开创功法 (-30万灵石)</button>
                    ` : ''}
                </div>
            `;
            return html;
        }

        // 已开创
        const minStageTip = data.maxAffixTier > 0
            ? `（${data.minUserStageName}及以上方可受益）`
            : '（暂无词条）';
        html += `
            <div class="modal-info-card modal-info-card--gold">
                <div class="modal-info-card__title">✦ 《${escapeHtml(data.name)}》</div>
                <p style="font-size:12px;color:var(--text-muted);margin:4px 0 8px;">${escapeHtml(data.description || '尚无道源记述')}</p>
                <p style="font-size:12px;color:var(--text-info);margin:0 0 4px;">已开创洗炼次数：${data.totalWashCount}次 ${minStageTip}</p>
            </div>
        `;

        // 词条槽列表
        html += '<div class="modal-info-card modal-info-card--jade"><div class="modal-info-card__title modal-info-card__title--jade">✦ 词条槽位</div>';
        for (let i = 1; i <= totalSlots; i++) {
            const affix = (data.affixes || [])[i - 1];
            const isPending = data.pendingSlot === i;
            html += `<div style="border:1px dashed var(--border-color);border-radius:6px;padding:8px;margin-bottom:8px;">`;
            html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <b style="color:var(--text-gold);">第 ${i} 槽</b>
                ${affix ? `<span style="font-size:11px;color:var(--text-muted);">${this._SECT_ART_TIER_NAMES[affix.tier]}品</span>` : '<span style="font-size:11px;color:var(--text-muted);">空槽</span>'}
            </div>`;
            if (affix) {
                const capPct = affix.pctCap > 0 ? `（全身上限${(affix.pctCap * 100).toFixed(0)}%）` : '';
                html += `<div style="font-size:13px;color:var(--text-success);">${escapeHtml(affix.description)} <span style="font-size:11px;color:var(--text-muted);">${capPct}</span></div>`;
            } else {
                html += `<div style="font-size:13px;color:var(--text-muted);">— 暂无词条 —</div>`;
            }
            if (isPending && data.pendingAffix) {
                const pCapPct = data.pendingAffix.pctCap > 0 ? `（全身上限${(data.pendingAffix.pctCap * 100).toFixed(0)}%）` : '';
                html += `<div style="margin-top:6px;padding:6px;background:rgba(232,200,120,0.10);border-radius:4px;">
                    <div style="font-size:11px;color:var(--text-gold);">待替换:</div>
                    <div style="font-size:13px;color:var(--text-gold);">${escapeHtml(data.pendingAffix.description)} <span style="font-size:11px;color:var(--text-muted);">${pCapPct}</span></div>
                </div>`;
            }
            if (isOwner) {
                html += `<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">`;
                for (let t = 1; t <= maxAllowedTier; t++) {
                    const dis = (data.pendingSlot && data.pendingSlot !== 0) ? 'disabled style="opacity:0.5;"' : '';
                    html += `<button class="btn-sm btn-technique" ${dis} onclick="PlayerSectModule.doSectArtWash(${i}, ${t})">洗炼·${this._SECT_ART_TIER_NAMES[t]}品</button>`;
                }
                html += `</div>`;
            }
            html += `</div>`;
        }
        html += '</div>';

        // pending 操作区
        if (data.pendingSlot && data.pendingAffix && isOwner) {
            html += `
                <div class="modal-info-card modal-info-card--gold">
                    <div class="modal-info-card__title">✦ 确认/放弃洗炼结果</div>
                    <p style="font-size:12px;color:var(--text-muted);margin:4px 0 8px;">
                        第 ${data.pendingSlot} 槽待替换为 <b style="color:var(--text-gold);">${escapeHtml(data.pendingAffix.description)}</b>。
                        确认替换需缴纳印记灵石。
                    </p>
                    <div style="display:flex;gap:6px;">
                        <button class="btn-action" style="flex:1;" onclick="PlayerSectModule.doSectArtConfirm()">确认替换</button>
                        <button class="modal-btn modal-btn--outline" style="flex:1;" onclick="PlayerSectModule.doSectArtAbandon()">放弃</button>
                    </div>
                </div>
            `;
        }

        // 改名 / 描述
        if (isOwner) {
            html += `
                <div class="modal-info-card">
                    <div class="modal-info-card__title">✦ 改名 / 重述道源</div>
                    <input type="text" id="sectArtRenameName" class="app-input" placeholder="新功法名称" maxlength="12" value="${escapeHtml(data.name)}" style="width:100%;margin-bottom:6px;">
                    <textarea id="sectArtRenameDesc" class="app-input" placeholder="新道源描述" maxlength="80" style="width:100%;height:50px;margin-bottom:6px;">${escapeHtml(data.description || '')}</textarea>
                    <button class="btn-action" style="width:100%;" onclick="PlayerSectModule.doSectArtRename()">应用改名 (-10万灵石)</button>
                </div>
            `;
        }

        // 成本说明
        html += `
            <div class="modal-info-card">
                <div class="modal-info-card__title">✦ 洗炼消耗</div>
                <table style="width:100%;font-size:12px;color:var(--text-muted);border-collapse:collapse;">
                    <tr style="color:var(--text-secondary);"><th align="left">品级</th><th align="left">灵石</th><th align="left">材料</th><th align="left">确认</th></tr>
                    <tr><td>化神</td><td>5万</td><td>灵草×5</td><td>2万</td></tr>
                    <tr><td>炼虚</td><td>15万</td><td>灵芝×5</td><td>5万</td></tr>
                    <tr><td>合道</td><td>40万</td><td>玄莲花×3</td><td>15万</td></tr>
                    <tr><td>大乘</td><td>100万</td><td>龙髓草×3</td><td>40万</td></tr>
                    <tr><td>渡劫</td><td>250万</td><td>龙髓草×8</td><td>100万</td></tr>
                </table>
                ${this._buildSectArtProbabilityDetails()}
                <details style="margin-top:8px;font-size:11px;color:var(--text-muted);cursor:pointer;">
                    <summary style="color:var(--text-secondary);">各属性全身合计上限</summary>
                    <table style="width:100%;font-size:11px;color:var(--text-muted);border-collapse:collapse;margin-top:4px;">
                        <tr><td>修为获取(冥想) 30%</td><td>灵气吸收(冥想) 30%</td></tr>
                        <tr><td>突破成功率 5%</td><td>神识恢复速度 30%</td></tr>
                        <tr><td>气血恢复速度 50%</td><td>丹毒减免 40%</td></tr>
                        <tr><td>折寿减免 50%</td><td>突破保底加速 10%</td></tr>
                        <tr><td>灵田产出 40%</td><td>丹道精进 15%</td></tr>
                        <tr><td>战利品掉落率 20%</td><td>暴击率 10%</td></tr>
                        <tr><td>闪避率 8%</td><td>怪物经验加成 30%</td></tr>
                    </table>
                    <p style="margin-top:4px;">暴击率与闪避率在 PVP 中衰减 50%。修为获取(冥想)与怪物经验加成仅天仙境及以下生效，仙君境及以上不生效。上限为全身合计封顶，包含个人功法、装备、灵纹等其他来源的同类加成。</p>
                </details>
                <p style="margin-top:6px;font-size:11px;color:var(--text-muted);">材料从宗主背包扣除；灵石由宗门金库支付；洗炼不设长冷却，但存在待确认结果时需先确认或放弃。</p>
            </div>
        `;

        return html;
    },

    async doCreateSectArt() {
        const name = (document.getElementById('sectArtNewName')?.value || '').trim();
        const description = (document.getElementById('sectArtNewDesc')?.value || '').trim();
        if (name.length < 2 || name.length > 12) { showToast('名称需 2~12 字'); return; }
        gameConfirm(`确定花费宗门金库 30万 灵石开创《${name}》吗？`, async () => {
            try {
                const res = await api.post('/api/game/sect-art/create', { name, description });
                if (res.code === 200) {
                    showToast('开创成功');
                    this.sectArtCache = res.data;
                    closeGameModal();
                    await this.loadPlayerSectInfo();
                    this.showSectArt();
                } else {
                    showToast(res.message || '开创失败', 'error');
                }
            } catch (e) { showToast(e.message, 'error'); }
        });
    },

    async doSectArtRename() {
        const name = (document.getElementById('sectArtRenameName')?.value || '').trim();
        const description = (document.getElementById('sectArtRenameDesc')?.value || '').trim();
        if (name.length < 2 || name.length > 12) { showToast('名称需 2~12 字'); return; }
        try {
            const res = await api.post('/api/game/sect-art/rename', { name, description });
            if (res.code === 200) {
                showToast('已更新');
                this.sectArtCache = res.data;
                closeGameModal();
                await this.loadPlayerSectInfo();
                this.showSectArt();
            } else {
                showToast(res.message || '更新失败', 'error');
            }
        } catch (e) { showToast(e.message, 'error'); }
    },

    async doSectArtWash(slot, tier) {
        gameConfirm(`确定花费宗门金库洗炼第 ${slot} 槽 (${this._SECT_ART_TIER_NAMES[tier]}品) 吗？洗出后需在 24 小时内确认或放弃。`, async () => {
            try {
                const res = await api.post('/api/game/sect-art/wash', { slot, tier });
                if (res.code === 200) {
                    showToast('洗炼出新词条，待确认');
                    this.sectArtCache = res.data;
                    closeGameModal();
                    await this.loadPlayerSectInfo();
                    this.showSectArt();
                } else {
                    showToast(res.message || '洗炼失败', 'error');
                }
            } catch (e) { showToast(e.message, 'error'); }
        });
    },

    async doSectArtConfirm() {
        try {
            const res = await api.post('/api/game/sect-art/confirm');
            if (res.code === 200) {
                showToast('已确认替换');
                this.sectArtCache = res.data;
                closeGameModal();
                await this.loadPlayerSectInfo();
                this.showSectArt();
            } else {
                showToast(res.message || '确认失败', 'error');
            }
        } catch (e) { showToast(e.message, 'error'); }
    },

    async doSectArtAbandon() {
        gameConfirm('确定放弃此次洗出的词条吗？灵石与材料不退还。', async () => {
            try {
                const res = await api.post('/api/game/sect-art/abandon');
                if (res.code === 200) {
                    showToast('已放弃');
                    this.sectArtCache = res.data;
                    closeGameModal();
                    this.showSectArt();
                } else {
                    showToast(res.message || '放弃失败', 'error');
                }
            } catch (e) { showToast(e.message, 'error'); }
        });
    }
};
