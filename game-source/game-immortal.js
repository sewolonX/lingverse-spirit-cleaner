/**
 * 仙界破界 - 小世界探索与主域经营
 */
var ImmortalModule = (function () {
    var API = '/api/game/immortal';
    var _busy = false;
    var _lastState = null;

    function esc(s) {
        if (s == null) return '';
        var d = document.createElement('div');
        d.textContent = String(s);
        return d.innerHTML;
    }

    function escJs(s) {
        return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }

    function findById(list, id) {
        list = list || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === id) return list[i];
        }
        return null;
    }

    function num(n) {
        return Number(n || 0).toLocaleString();
    }

    function pct(n) {
        n = Number(n || 0);
        return Math.max(0, Math.min(100, n));
    }

    function immortalWorldName(state) {
        var areaId = (state && state.currentAreaId) || '';
        var areaName = (state && state.currentAreaName) || '';
        if (areaName.indexOf('·') > 0) return areaName.split('·')[0];
        if (areaId.indexOf('_qingyao_') >= 0) return '青曜界';
        if (areaId.indexOf('_cangwu_') >= 0) return '苍梧界';
        if (areaId.indexOf('_xuanchen_') >= 0) return '玄尘界';
        if (areaId.indexOf('_liuhuo_') >= 0) return '流火界';
        if (areaId.indexOf('_hanyue_') >= 0) return '寒月界';
        return '小世界';
    }

    function currentAreaLayerText(state) {
        var areaId = (state && state.currentAreaId) || '';
        if (areaId.indexOf('immortal_prison_') === 0) return '混天典狱';
        if (areaId === 'immortal_outer_domain' || areaId === 'immortal_heaven_gate') return '主城外围';
        if (areaId.indexOf('immortal_world_') === 0) return immortalWorldName(state);
        return '仙界边域';
    }

    function phaseText(state) {
        if (!state) return '--';
        if (state.detained) return '典狱保释';
        return state.escaped ? '主城经营' : '小界破界';
    }

    function routeGoalText(state, route) {
        if (state.detained) {
            return '当前先提交仙材或灵石保释，回到小世界后继续探索。';
        }
        if (state.escaped) {
            return '你已完成小世界阶段，当前重点是在九霄主域外围积累功勋、兑换资源并继续压低污染。';
        }
        return '当前可探索所有小世界节点；进入主城外围或九霄主域需先打过守关天仙。';
    }

    function renderReturnTransitCard(state) {
        state = state || {};
        var coordinateName = state.ascendCoordinateItemName || '太初道碑坐标';
        var fragmentName = state.ascendFragmentItemName || '太初道碑残片';
        var synthDisabled = state.canSynthesizeCoordinate ? '' : ' disabled';
        if (state.returnLowerVisible) {
            var lowerDisabled = state.canReturnLowerWorld ? '' : ' disabled';
            var anchorName = state.returnAnchorAreaName || '暂无生效锚点';
            var remainingText = state.returnAnchorRemainingMinutes > 0 ? ('约' + num(state.returnAnchorRemainingMinutes) + '分钟') : '--';
            var html = '<div class="court-card immortal-card immortal-card--status">';
            html += '<div class="court-card-header">-- 太初返灵 --</div>';
            html += '<p class="court-card-hint">仙界修士需消耗 1 枚' + esc(coordinateName) + '，才可借生效中的太初道碑锚点短暂返回灵界。</p>';
            html += '<div class="immortal-resource-grid">';
            html += '<div><span>' + esc(fragmentName) + '</span><b>' + num(state.ascendFragmentOwned) + '/' + num(state.ascendFragmentRequired || 10) + '</b></div>';
            html += '<div><span>' + esc(coordinateName) + '</span><b>' + num(state.ascendCoordinateOwned) + '</b></div>';
            html += '<div><span>返灵锚点</span><b>' + esc(anchorName) + '</b></div>';
            html += '<div><span>锚点剩余</span><b>' + esc(remainingText) + '</b></div>';
            html += '</div>';
            html += '<div class="immortal-actions">';
            html += '<button class="btn-icon immortal-secondary-btn" onclick="ImmortalModule.synthesizeCoordinate()"' + synthDisabled + '>合成坐标</button>';
            html += '<button class="btn-action btn-court-salary" onclick="ImmortalModule.returnLowerWorld()"' + lowerDisabled + '>借锚返灵</button>';
            html += '</div>';
            html += '<p class="court-card-hint">获取: ' + esc(fragmentName) + '可在灵界混沌墟土 - 飞升劫台掉落，也可在仙界商铺的黑市货架以 500000 灵石购买；' + esc(coordinateName) + '不在 NPC 商铺直接出售，只能由 10 枚残片合成。</p>';
            if (state.returnLowerDisabledReason) {
                html += '<p class="court-card-hint immortal-warning">' + esc(state.returnLowerDisabledReason) + '</p>';
            }
            if (state.synthesizeDisabledReason && !state.canSynthesizeCoordinate) {
                html += '<p class="court-card-hint">坐标合成: ' + esc(state.synthesizeDisabledReason) + '</p>';
            }
            html += '</div>';
            return html;
        }
        if (state.returnImmortalVisible) {
            var upperDisabled = state.canReturnImmortalWorld ? '' : ' disabled';
            var targetName = state.returnImmortalTargetAreaName || '原仙界落点';
            var status = state.returnImmortalAnchorExpired ? '已失效' : '尚未失效';
            var html2 = '<div class="court-card immortal-card immortal-card--status">';
            html2 += '<div class="court-card-header">-- 太初返仙 --</div>';
            html2 += '<p class="court-card-hint">锚点失效后，需消耗 1 枚' + esc(coordinateName) + '收束返灵因果，返回原仙界落点。</p>';
            html2 += '<div class="immortal-resource-grid">';
            html2 += '<div><span>' + esc(coordinateName) + '</span><b>' + num(state.ascendCoordinateOwned) + '</b></div>';
            html2 += '<div><span>返回落点</span><b>' + esc(targetName) + '</b></div>';
            html2 += '<div><span>锚点状态</span><b>' + esc(status) + '</b></div>';
            html2 += '</div>';
            html2 += '<div class="immortal-actions">';
            html2 += '<button class="btn-action btn-court-salary" onclick="ImmortalModule.returnImmortalWorld()"' + upperDisabled + '>返回仙界</button>';
            html2 += '</div>';
            if (state.returnImmortalDisabledReason) {
                html2 += '<p class="court-card-hint immortal-warning">' + esc(state.returnImmortalDisabledReason) + '</p>';
            }
            html2 += '</div>';
            return html2;
        }
        return '';
    }

    async function load() {
        var el = document.getElementById('immortalContent');
        if (el) el.innerHTML = '<p class="inventory-empty">加载中...</p>';
        try {
            var res = await api.get(API + '/state');
            if (!res || res.code !== 200) {
                if (el) el.innerHTML = '<p class="inventory-empty">' + esc((res && res.message) || '加载失败') + '</p>';
                return;
            }
            render(res.data);
        } catch (e) {
            if (el) el.innerHTML = '<p class="inventory-empty">网络异常</p>';
        }
    }

    function render(state) {
        var el = document.getElementById('immortalContent');
        if (!el) return;
        _lastState = state || null;
        if (!state || !state.unlocked) {
            el.innerHTML = '<div class="court-card immortal-card immortal-card--locked"><div class="court-card-header">-- 飞升未启 --</div>' +
                '<p class="court-card-hint">' + esc((state && state.reason) || '真仙境及以上方可进入仙界。') + '</p></div>';
            return;
        }

        var route = state.route || {};
        var html = '';
        if (state.ascendVisible) {
            var synthDisabled = state.canSynthesizeCoordinate ? '' : ' disabled';
            var ascendDisabled = state.canAscend ? '' : ' disabled';
            html += '<div class="court-card immortal-card immortal-hero">';
            html += '<div class="court-card-header">-- 仙界指引 --</div>';
            html += '<p class="court-card-hint">太初道碑坐标可短暂锚定仙界接引裂隙。飞升成功后不会提升境界，会被分配到一处小世界开局；落点、仙界身份与路线身份均在成功后揭晓。</p>';
            html += '<p class="court-card-hint">仙界玩法从小世界穿梭开始：飞升后可在所有小世界节点探索，收集仙材与路线资源；进入主城外围或九霄主域需先打过守关天仙。</p>';
            html += '<div class="immortal-resource-grid immortal-ascend-grid">';
            html += '<div><span>' + esc(state.ascendFragmentItemName || '太初道碑残片') + '</span><b>' + num(state.ascendFragmentOwned) + '/' + num(state.ascendFragmentRequired || 10) + '</b></div>';
            html += '<div><span>' + esc(state.ascendCoordinateItemName || '太初道碑坐标') + '</span><b>' + num(state.ascendCoordinateOwned) + '/' + num(state.ascendCoordinateRequired || 1) + '</b></div>';
            html += '<div><span>飞升境界</span><b>' + esc(state.ascendRealmName || '--') + '</b></div>';
            html += '<div><span>成功率</span><b>' + pct(state.ascendSuccessRate) + '%</b></div>';
            html += '<div><span>接引残韵</span><b>' + num(state.ascendFailStreak) + '/' + num(state.ascendPityGuaranteeFails || 10) + '</b></div>';
            html += '<div><span>失败损失</span><b>' + num(state.ascendFailureCultivationLoss) + '</b></div>';
            html += '</div>';
            html += '<div class="immortal-actions">';
            html += '<button class="btn-icon immortal-secondary-btn" onclick="ImmortalModule.synthesizeCoordinate()"' + synthDisabled + '>合成坐标</button>';
            html += '<button class="btn-action btn-court-salary immortal-ascend-btn" onclick="ImmortalModule.ascend()"' + ascendDisabled + '>飞升仙界</button>';
            html += '</div>';
            if (state.ascendDisabledReason) {
                html += '<p class="court-card-hint immortal-warning">' + esc(state.ascendDisabledReason) + '</p>';
            } else {
                var pityText = '';
                if (num(state.ascendFailStreak) > 0) {
                    pityText = ' 当前基础成功率 ' + pct(state.ascendBaseSuccessRate) + '%，接引残韵加成 +' + pct(state.ascendPityBonus) + '%。';
                }
                html += '<p class="court-card-hint">每次飞升消耗 1 枚太初道碑坐标；失败只消耗坐标并扣除当前境界 10% 修为，并积累 1 层接引残韵，下次成功率 +5%，10 层后下次飞升必成。' + pityText + '</p>';
            }
            html += '<p class="court-card-hint immortal-warning">成功后会与灵界社交、宗门和交易体系隔离，仙界妖兽会携带完整功法、技能与装备；探索中遇到监察使时可尝试逃跑，失败会被押入混天典狱保释。</p>';
            if (state.synthesizeDisabledReason && !state.canSynthesizeCoordinate) {
                html += '<p class="court-card-hint">坐标合成: ' + esc(state.synthesizeDisabledReason) + '</p>';
            }
            html += '</div>';
            html += renderReturnTransitCard(state);
            el.innerHTML = html;
            return;
        }

        html += '<div class="court-card immortal-card immortal-hero">';
        html += '<div class="court-card-header">-- ' + esc(route.title || '仙界飞升者') + ' --</div>';
        html += '<div class="immortal-identity-grid">';
        html += '<div class="court-title-row"><span class="court-label">身份</span><span class="court-value">' + esc(route.identity || '--') + '</span></div>';
        html += '<div class="court-title-row"><span class="court-label">当前</span><span class="court-value">' + esc(state.currentAreaName || '--') + '</span></div>';
        html += '<div class="court-title-row"><span class="court-label">路线</span><span class="court-value">' + esc(route.name || '--') + '</span></div>';
        html += '<div class="court-title-row"><span class="court-label">界层</span><span class="court-value">' + esc(currentAreaLayerText(state)) + '</span></div>';
        html += '<div class="court-title-row"><span class="court-label">阶段</span><span class="court-value">' + esc(phaseText(state)) + '</span></div>';
        html += '</div>';
        html += '<p class="court-card-hint">' + routeGoalText(state, route) + '</p>';
        if (route.description) {
            html += '<p class="court-card-hint">' + esc(route.description) + '</p>';
        }
        if (state.inspectorHintText) {
            html += '<p class="court-card-hint">巡界监察: ' + esc(state.inspectorHintText) + '；若被监察使盯上，战力不足会先尝试脱身，每次逃脱概率 ' + num(state.inspectorEscapeRate || 50) + '%。</p>';
        }
        html += '</div>';
        html += renderReturnTransitCard(state);

        if (state.detained) {
            html += '<div class="court-card immortal-card immortal-card--status">';
            html += '<div class="court-card-header">-- ' + esc(state.detentionAreaName || '混天典狱') + ' --</div>';
            html += '<p class="court-card-hint immortal-warning">' + esc(state.detentionText || '你被羁押在混天典狱，需要保释后才能继续探索。') + '</p>';
            html += '<div class="immortal-resource-grid">';
            html += '<div><span>' + esc(state.bailMaterialItemName || '保释仙材') + '</span><b>' + num(state.bailMaterialOwned) + '/' + num(state.bailMaterialRequired) + '</b></div>';
            html += '<div><span>灵石保释</span><b>' + num(state.bailStoneCost) + '</b></div>';
            html += '<div><span>返回小界</span><b>' + esc(state.bailReturnAreaName || '--') + '</b></div>';
            html += '<div><span>逃跑概率</span><b>' + num(state.inspectorEscapeRate || 50) + '%</b></div>';
            html += '</div>';
            html += '<div class="immortal-actions">';
            html += '<button class="btn-icon immortal-secondary-btn" onclick="ImmortalModule.bail(\'material\')"' + (state.canBailWithMaterial ? '' : ' disabled') + '>提交仙材</button>';
            html += '<button class="btn-action btn-court-salary" onclick="ImmortalModule.bail(\'stone\')"' + (state.canBailWithStone ? '' : ' disabled') + '>灵石保释</button>';
            html += '</div>';
            html += '</div>';
        }

        if (state.courtProtectionVisible) {
            html += '<div class="court-card immortal-card">';
            html += '<div class="court-card-header">-- 仙庭庇护 --</div>';
            html += '<div class="immortal-action">';
            html += '<div class="immortal-action__main">';
            html += '<b>' + (state.courtProtectionActive ? '庇护生效中' : '庇护已关闭') + '</b>';
            html += '<span>' + esc(state.courtProtectionEffectText || '') + '</span>';
            html += '<small>默认接受仙庭庇护。主动关闭后，妖兽不再被压制，且无法再次开启。</small>';
            html += '</div>';
            if (state.courtProtectionActive) {
                html += '<button class="btn-icon" onclick="ImmortalModule.disableCourtProtection()">关闭</button>';
            } else {
                html += '<button class="btn-icon" disabled>已关闭</button>';
            }
            html += '</div>';
            if (state.immortalShopHint) {
                html += '<p class="court-card-hint">' + esc(state.immortalShopHint) + '</p>';
                html += '<button class="btn-icon immortal-secondary-btn" onclick="togglePanel(\'shop\')">打开商铺</button>';
            }
            html += '</div>';
        }

        html += '<div class="court-card immortal-card immortal-card--progress">';
        html += '<div class="court-card-header">-- ' + (state.escaped ? '主域经营' : '主域通行') + ' --</div>';
        html += '<div class="immortal-progress"><div class="immortal-progress__fill" style="width:' + pct(state.breakProgress) + '%"></div><span>' + pct(state.breakProgress) + '/100</span></div>';
        if (!state.escaped) {
            html += '<div class="court-card-hint">所有小世界节点均可通过地图移动和探索；主城外围或九霄主域需先打过守关天仙。</div>';
        }
        html += '<div class="court-card-hint">' + esc(state.nextMilestone || '') + '</div>';
        html += '<div class="immortal-milestones">';
        (state.milestones || []).forEach(function (m) {
            html += '<div class="immortal-milestone' + (m.reached ? ' immortal-milestone--done' : '') + '">';
            html += '<b>' + num(m.progress) + '</b><span>' + esc(m.name) + '</span><small>' + esc(m.description) + '</small>';
            html += '</div>';
        });
        html += '</div>';
        html += '<div class="immortal-resource-grid">';
        html += '<div><span>' + esc(state.routeResourceName || '路线资源') + '</span><b>' + num(state.routeResource) + '</b></div>';
        html += '<div><span>' + esc(state.secondaryResourceName || '副资源') + '</span><b>' + num(state.secondaryResource) + '</b></div>';
        html += '<div><span>本周核心</span><b>' + num(state.weeklyCoreUsed) + '/' + num(state.weeklyCoreLimit) + '</b></div>';
        html += '<div><span>额外行动</span><b>' + num(state.weeklyExtraUsed) + '/' + num(state.weeklyExtraLimit) + '</b></div>';
        html += '<div><span>本源污染</span><b>' + pct(state.pollutionValue) + '</b></div>';
        html += '</div>';
        if (!state.escaped) {
            html += '<button class="btn-action btn-trial immortal-challenge-btn" onclick="ImmortalModule.challenge()">挑战守关天仙</button>';
            html += '<p class="court-card-hint">天仙境前期战身 · 战身强度 ' + num(state.bossPowerPreview) + '</p>';
        } else {
            html += '<p class="court-card-hint" style="color:var(--accent-jade)">已完成小世界阶段，当前可经营九霄主域外围，积累仙庭功勋与界源清辉。</p>';
        }
        html += '</div>';

        html += '<div class="court-card immortal-card">';
        html += '<div class="court-card-header">-- ' + (state.escaped ? '主域委托' : '路线委托') + ' --</div>';
        html += '<p class="court-card-hint">' + (state.escaped ? '主域委托用于获取仙庭功勋、界源清辉和日常收益。' : '路线委托是推进主域通行的额外方式，不影响你在小世界探索。') + '</p>';
        if (!state.actions || !state.actions.length) {
            html += '<p class="court-card-hint">暂无可执行行动</p>';
        } else {
            html += '<div class="immortal-action-list">';
            state.actions.forEach(function (a) {
                var disabledAttr = a.disabledReason ? ' disabled' : '';
                html += '<div class="immortal-action">';
                html += '<div class="immortal-action__main">';
                html += '<b>' + esc(a.name) + '</b>';
                html += '<span>' + esc(a.description) + '</span>';
                html += '<small>神识 ' + num(a.spiritCost) + ' · 进度 ' + esc(a.progressText) + ' · ' + esc(a.rewardText) + '</small>';
                if (a.impactText) html += '<small>' + esc(a.impactText) + '</small>';
                if (a.disabledReason) html += '<small class="immortal-action__disabled">' + esc(a.disabledReason) + '</small>';
                html += '</div>';
                html += '<button class="btn-icon" onclick="ImmortalModule.doAction(\'' + escJs(a.id) + '\')"' + disabledAttr + '>执行</button>';
                html += '</div>';
            });
            html += '</div>';
        }
        html += '</div>';

        if (state.contributions && state.contributions.length) {
            html += '<div class="court-card immortal-card">';
            html += '<div class="court-card-header">-- 仙材上缴 --</div>';
            html += '<p class="court-card-hint">上缴仙材可补充通行进度、路线资源或降低污染；守关削弱达到上限后，战身强度只会继续受污染与巡天变化影响。</p>';
            html += '<div class="immortal-action-list">';
            state.contributions.forEach(function (c) {
                var disabledAttr = c.disabledReason ? ' disabled' : '';
                var requiredQuantity = Math.max(1, Number(c.requiredQuantity || 1));
                var maxBatch = Math.floor(Number(c.ownedQuantity || 0) / requiredQuantity);
                html += '<div class="immortal-action">';
                html += '<div class="immortal-action__main">';
                html += '<b>' + esc(c.name) + '</b>';
                html += '<span>' + esc(c.description) + '</span>';
                html += '<small>材料 ' + esc(c.itemName) + ' ' + num(c.ownedQuantity) + '/' + num(c.requiredQuantity) + ' · 获得 ' + esc(c.rewardText) + '</small>';
                if (c.impactText) html += '<small>' + esc(c.impactText) + '</small>';
                if (c.disabledReason) html += '<small class="immortal-action__disabled">' + esc(c.disabledReason) + '</small>';
                html += '</div>';
                html += '<div class="immortal-action__buttons">';
                html += '<button class="btn-icon" onclick="ImmortalModule.contribute(\'' + escJs(c.id) + '\')"' + disabledAttr + '>上缴</button>';
                if (!c.disabledReason && maxBatch > 1) {
                    html += '<button class="btn-icon immortal-secondary-btn" onclick="ImmortalModule.contributeBatch(\'' + escJs(c.id) + '\')">批量</button>';
                }
                html += '</div>';
                html += '</div>';
            });
            html += '</div>';
            html += '</div>';
        }

        if (state.exchanges && state.exchanges.length) {
            html += '<div class="court-card immortal-card">';
            html += '<div class="court-card-header">-- 主域兑换 --</div>';
            html += '<div class="immortal-action-list">';
            state.exchanges.forEach(function (x) {
                var disabledAttr = x.disabledReason ? ' disabled' : '';
                html += '<div class="immortal-action">';
                html += '<div class="immortal-action__main">';
                html += '<b>' + esc(x.name) + '</b>';
                html += '<span>' + esc(x.description) + '</span>';
                html += '<small>消耗 ' + esc(x.costText) + ' · 获得 ' + esc(x.rewardText) + '</small>';
                if (x.disabledReason) html += '<small class="immortal-action__disabled">' + esc(x.disabledReason) + '</small>';
                html += '</div>';
                html += '<button class="btn-icon" onclick="ImmortalModule.exchange(\'' + escJs(x.id) + '\')"' + disabledAttr + '>兑换</button>';
                html += '</div>';
            });
            html += '</div>';
            html += '</div>';
        }

        el.innerHTML = html;
    }

    function showLogs(logs, type) {
        if (!logs || !logs.length || typeof typewriterLogs !== 'function') return;
        var logPanel = document.getElementById('logPanel');
        if (logPanel) logPanel.classList.remove('hidden');
        var logContent = document.getElementById('logContent');
        if (logContent) logContent.innerHTML = '';
        typewriterLogs(logs, type || 'system', 20);
    }

    function saveChallengeCombatLog(result) {
        if (!result || !result.logs || !result.logs.length) return;
        if (typeof window.LocalDB === 'undefined' || !window.LocalDB) return;
        var victory = !!result.victory;
        window.LocalDB.saveCombatLog({
            title: '仙界守关挑战·' + (victory ? '胜' : '败') + '·守关天仙',
            type: 'immortal_guard',
            result: victory ? 'victory' : 'defeat',
            logs: result.logs,
            rewards: victory ? '完成小世界阶段，抵达九霄仙庭主域外围' : '破界进度保留至 90，巡天热度上升'
        }).then(function () {
            if (typeof refreshLocalCombatLogPanelIfOpen === 'function') refreshLocalCombatLogPanelIfOpen();
        });
    }

    async function ascend() {
        if (_busy) return;
        var run = async function () {
            _busy = true;
            try {
                var res = await api.post(API + '/ascend', {});
                if (res && res.code === 200 && res.data) {
                    showToast(res.data.message || (res.data.success ? '飞升成功' : '飞升失败'));
                    render(res.data.state);
                    showLogs(res.data.logs || []);
                    if (typeof loadPlayerInfo === 'function') loadPlayerInfo(true);
                    if (res.data.success && typeof loadMap === 'function') loadMap();
                    if (res.data.success) showAscensionStory(res.data.state);
                } else {
                    showToast((res && res.message) || '飞升失败');
                }
            } finally {
                _busy = false;
            }
        };
        var state = _lastState || {};
        var pityLine = '';
        if (num(state.ascendFailStreak) > 0) {
            pityLine = ' 基础成功率 ' + pct(state.ascendBaseSuccessRate) + '%，接引残韵 +' + pct(state.ascendPityBonus) + '%。';
        }
        var msg = '<p>确认消耗 1 枚' + esc(state.ascendCoordinateItemName || '太初道碑坐标') + '尝试飞升仙界？</p>' +
            '<p style="font-size:12px;color:var(--text-muted);">当前成功率 ' + pct(state.ascendSuccessRate) + '%。' + pityLine + '失败只消耗坐标并损失预留修为 ' + num(state.ascendFailureCultivationLoss) + '，并积累 1 层接引残韵。</p>' +
            '<p style="font-size:12px;color:var(--text-muted);">飞升后的落点与仙界身份将在成功后揭晓；灵渊阵营加成不再提供修为/掉落倍率，只保留为仙界路线来源。</p>' +
            '<p style="font-size:12px;color:var(--text-danger);">飞升成功会解除凡界宗门、师徒、道侣关系和待处理同修道帖；道侣小金库会自动平分返还，若为奇数则飞升者多返还 1 灵石。</p>' +
            '<p style="font-size:12px;color:var(--text-danger);">坊市、拍卖、求购、传功等交易与社交协作将与灵界隔离。仙界妖兽会装备完整功法、技能和仙器，整体难度明显高于灵界，且飞升后无法返回灵界。</p>' +
            '<p style="font-size:12px;color:var(--text-danger);">飞升后会先被分配到小世界探索。探索中可能遇到监察使，战力不足会先尝试逃跑，每次有 50% 概率逃脱，失败才会被押入混天典狱。</p>' +
            '<p style="font-size:12px;color:var(--text-danger);">未选择灵渊派系时，将默认以散修路线飞升。</p>';
        if (typeof gameConfirm === 'function') {
            gameConfirm(msg, run, null, true);
            return;
        }
        await run();
    }

    function showAscensionStory(state) {
        state = state || {};
        var route = state.route || {};
        var routeName = route.name || '孤云散仙';
        var identity = route.identity || '无籍飞升者';
        var areaName = state.currentAreaName || route.startAreaName || '仙界边域';
        var routeHint = '先穿梭小世界节点，配合仙界面板的路线委托与仙材上缴，把主域通行进度推进到 100，再挑战守关天仙进入主城外围和九霄主域。';
        if (route.id === 'jiuxiao') {
            routeHint = '你默认接受仙庭庇护，仙界妖兽数值与战斗修为会被压低。若想恢复完整收益，可在仙界面板关闭庇护，但关闭后无法再次开启。接下来可探索小世界节点，并通过归籍凝丹、档案补正和仙材上缴推进主域通行。';
        } else if (route.id === 'taichu') {
            routeHint = '你携带太初旧因，被投放到小世界坐标网。可先探索净源材料，再通过路线委托和仙材上缴稳定本源，主域通行进度满后挑战守关天仙。';
        } else if (route.id === 'moyuan') {
            routeHint = '你的魔渊旧誓被小世界坐标网暂时压住。可先探索稳定魔蚀，再修复魔垒、压制魔蚀并积累镇渊战魂，主域通行进度满后挑战守关天仙。';
        } else if (route.id === 'sanxiu') {
            routeHint = '你落入小世界缝隙，可先穿梭五处小世界节点，修复古阵、经营走私商路并积累小世界坐标，主域通行进度满后挑战守关天仙。';
        }
        var html = '<div style="line-height:1.8;">' +
            '<p>接引裂隙在身后合拢，灵界因果被仙界法则斩断。你坠入「' + esc(areaName) + '」，仙籍显化为「' + esc(identity) + '」。</p>' +
            '<p>从现在起，灵渊修为与掉落加成不再生效；坊市、拍卖、求购与传功体系也会按仙界 / 灵界隔离。</p>' +
            '<p>九霄仙庭按接引旧例发放了一份首周补给。当前区域商铺已接入仙界 NPC 货架，可补齐路线行动所需的基础仙材。</p>' +
            '<p>探索小世界时可能遇到监察使。若战力不足会先尝试逃跑，每次有 50% 概率逃脱；失败被押入混天典狱后，可在仙界面板提交净源仙玉或灵石保释。</p>' +
            '<p><b style="color:var(--accent-gold);">当前路线: ' + esc(routeName) + '</b></p>' +
            '<p>' + esc(routeHint) + '</p>' +
            '<p>排行榜、玩家画卷与世界传闻仍可跨界查看；拜师、道侣、宗门协作和交易收益不会跨界流通。</p>' +
            '<p style="color:var(--text-danger);">仙界妖兽会携带完整功法、技能与仙器。若状态不足，优先提升装备、技能配置和仙界路线资源。</p>' +
            '</div>';
        if (typeof gameAlert === 'function') {
            gameAlert(html, null, true);
        } else {
            showToast('飞升成功，可探索所有小世界节点；主域通行进度满后可挑战守关天仙');
        }
    }

    async function synthesizeCoordinate() {
        if (_busy) return;
        var state = _lastState || {};
        var run = async function () {
            _busy = true;
            try {
                var res = await api.post(API + '/synthesize-coordinate', {});
                if (res && res.code === 200 && res.data) {
                    showToast(res.data.message || '合成完成');
                    render(res.data.state);
                    showLogs(res.data.logs || []);
                } else {
                    showToast((res && res.message) || '合成失败');
                }
            } finally {
                _busy = false;
            }
        };
        var msg = '<p>确认合成' + esc(state.ascendCoordinateItemName || '太初道碑坐标') + '？</p>' +
            '<p style="font-size:12px;color:var(--text-muted);">本次消耗 ' + esc(state.ascendFragmentItemName || '太初道碑残片') + ' x' + num(state.ascendFragmentRequired || 10) + '，获得 ' + esc(state.ascendCoordinateItemName || '太初道碑坐标') + ' x1。</p>';
        if (typeof gameConfirm === 'function') {
            gameConfirm(msg, run, null, true);
            return;
        }
        await run();
    }

    async function returnLowerWorld() {
        if (_busy) return;
        var state = _lastState || {};
        var coordinateName = state.ascendCoordinateItemName || '太初道碑坐标';
        var run = async function () {
            _busy = true;
            try {
                var res = await api.post(API + '/return-lower-world', {});
                if (res && res.code === 200 && res.data) {
                    showToast(res.data.message || '已返抵灵界');
                    await load();
                    if (typeof loadPlayerInfo === 'function') loadPlayerInfo(true);
                    if (typeof loadMap === 'function') loadMap();
                } else {
                    showToast((res && res.message) || '返灵失败');
                }
            } finally {
                _busy = false;
            }
        };
        var msg = '<p>确认消耗 1 枚' + esc(coordinateName) + '借太初道碑锚点返回灵界？</p>' +
            '<p style="font-size:12px;color:var(--text-muted);">返灵期间只能采购灵界坊市商品，不可使用灵界商铺、上架、拍卖、求购、加入灵界宗门或与灵界修士结为道侣。</p>';
        if (typeof gameConfirm === 'function') {
            gameConfirm(msg, run, null, true);
            return;
        }
        await run();
    }

    async function returnImmortalWorld() {
        if (_busy) return;
        var state = _lastState || {};
        var coordinateName = state.ascendCoordinateItemName || '太初道碑坐标';
        var run = async function () {
            _busy = true;
            try {
                var res = await api.post(API + '/return-immortal-world', {});
                if (res && res.code === 200 && res.data) {
                    showToast(res.data.message || '已返回仙界');
                    await load();
                    if (typeof loadPlayerInfo === 'function') loadPlayerInfo(true);
                    if (typeof loadMap === 'function') loadMap();
                } else {
                    showToast((res && res.message) || '返仙失败');
                }
            } finally {
                _busy = false;
            }
        };
        var msg = '<p>确认消耗 1 枚' + esc(coordinateName) + '返回仙界？</p>' +
            '<p style="font-size:12px;color:var(--text-muted);">只有太初道碑锚点失效后，才能收束返灵因果返回原仙界落点。</p>';
        if (typeof gameConfirm === 'function') {
            gameConfirm(msg, run, null, true);
            return;
        }
        await run();
    }

    async function doAction(actionId) {
        if (_busy) return;
        _busy = true;
        try {
            var res = await api.post(API + '/action', { actionId: actionId });
            if (res && res.code === 200 && res.data) {
                showToast(res.data.message || '行动完成');
                render(res.data.state);
                showLogs(res.data.logs || []);
                if (typeof loadPlayerInfo === 'function') loadPlayerInfo(true, 1);
            } else {
                showToast((res && res.message) || '行动失败');
            }
        } finally {
            _busy = false;
        }
    }

    async function contribute(contributionId, quantity) {
        if (_busy) return;
        var item = findById((_lastState && _lastState.contributions) || [], contributionId) || {};
        var submitQty = Math.max(1, parseInt(quantity || 1, 10) || 1);
        var run = async function () {
            _busy = true;
            try {
                var res = await api.post(API + '/contribute', { contributionId: contributionId, quantity: submitQty });
                if (res && res.code === 200 && res.data) {
                    showToast(res.data.message || '上缴完成');
                    render(res.data.state);
                    showLogs(res.data.logs || []);
                    if (typeof loadPlayerInfo === 'function') loadPlayerInfo(true, 1);
                } else {
                    showToast((res && res.message) || '上缴失败');
                }
            } finally {
                _busy = false;
            }
        };
        var unitCost = Math.max(1, Number(item.requiredQuantity || 1));
        var totalCost = unitCost * submitQty;
        var msg = '<p>' + (submitQty > 1 ? '确认批量上缴' : '确认上缴') + '「' + esc(item.itemName || item.name || '仙材') + '」？</p>' +
            '<p style="font-size:12px;color:var(--text-muted);">本次最多消耗 ' + esc(item.itemName || '仙材') + ' x' + num(totalCost) + '，获得 ' + esc(item.rewardText || '仙界资源') + '。</p>';
        if (submitQty > 1) {
            msg += '<p style="font-size:12px;color:var(--text-muted);">若通行进度、守关削弱或小界记录已达到有效上限，系统只接收有效份数，多余仙材会自动保留。</p>';
        }
        if (typeof gameConfirm === 'function') {
            gameConfirm(msg, run, null, true);
            return;
        }
        await run();
    }

    async function contributeBatch(contributionId) {
        var item = findById((_lastState && _lastState.contributions) || [], contributionId) || {};
        var unitCost = Math.max(1, Number(item.requiredQuantity || 1));
        var maxBatch = Math.floor(Number(item.ownedQuantity || 0) / unitCost);
        if (maxBatch <= 1) {
            await contribute(contributionId, 1);
            return;
        }
        var maxSubmit = Math.min(maxBatch, 999);
        var itemName = item.itemName || item.name || '仙材';
        var msg = '批量上缴「' + itemName + '」\n' +
            '当前最多可上缴 ' + num(maxBatch) + ' 份，单次上限 999 份。\n' +
            '每份消耗 ' + itemName + ' x' + num(unitCost) + '。\n请输入本次上缴份数：';
        if (typeof promptAsync === 'function') {
            var inputOptions = typeof dialogIntegerInputOptions === 'function'
                ? dialogIntegerInputOptions(1, maxSubmit)
                : { type: 'number', inputmode: 'numeric', pattern: '[0-9]*', min: 1, max: maxSubmit, step: 1 };
            var input = await promptAsync(msg, String(maxSubmit), false, inputOptions);
            if (!input) return;
            var qty = parseInt(String(input).replace(/[^0-9]/g, ''), 10);
            if (!qty || qty <= 0) {
                showToast('上缴数量无效');
                return;
            }
            if (qty > maxSubmit) qty = maxSubmit;
            await contribute(contributionId, qty);
            return;
        }
        await contribute(contributionId, maxSubmit);
    }

    async function exchange(recipeId) {
        if (_busy) return;
        var item = findById((_lastState && _lastState.exchanges) || [], recipeId) || {};
        var run = async function () {
            _busy = true;
            try {
                var res = await api.post(API + '/exchange', { recipeId: recipeId });
                if (res && res.code === 200 && res.data) {
                    showToast(res.data.message || '兑换完成');
                    render(res.data.state);
                    showLogs(res.data.logs || []);
                    if (typeof loadPlayerInfo === 'function') loadPlayerInfo(true, 1);
                } else {
                    showToast((res && res.message) || '兑换失败');
                }
            } finally {
                _busy = false;
            }
        };
        var msg = '<p>确认兑换「' + esc(item.name || '主域兑换') + '」？</p>' +
            '<p style="font-size:12px;color:var(--text-muted);">消耗 ' + esc(item.costText || '主域资源') + '，获得 ' + esc(item.rewardText || '兑换奖励') + '。</p>';
        if (typeof gameConfirm === 'function') {
            gameConfirm(msg, run, null, true);
            return;
        }
        await run();
    }

    async function disableCourtProtection() {
        if (_busy) return;
        var run = async function () {
            _busy = true;
            try {
                var res = await api.post(API + '/disable-court-protection', {});
                if (res && res.code === 200 && res.data) {
                    showToast(res.data.message || '已关闭仙庭庇护');
                    render(res.data.state);
                    showLogs(res.data.logs || []);
                } else {
                    showToast((res && res.message) || '关闭失败');
                }
            } finally {
                _busy = false;
            }
        };
        var msg = '<p>确认关闭仙庭庇护？</p>' +
            '<p style="font-size:12px;color:var(--text-muted);">关闭后，仙界妖兽气血、攻击、防御与战斗修为奖励恢复正常。</p>' +
            '<p style="font-size:12px;color:var(--text-danger);">该选择不可逆，之后无法再次开启仙庭庇护。</p>';
        if (typeof gameConfirm === 'function') {
            gameConfirm(msg, run, null, true);
            return;
        }
        await run();
    }

    async function bail(method) {
        if (_busy) return;
        var state = _lastState || {};
        var isMaterial = method === 'material';
        var costText = isMaterial
            ? (esc(state.bailMaterialItemName || '保释仙材') + ' x' + num(state.bailMaterialRequired || 0))
            : ('灵石 ' + num(state.bailStoneCost || 0));
        var run = async function () {
            _busy = true;
            try {
                var res = await api.post(API + '/bail', { method: method });
                if (res && res.code === 200 && res.data) {
                    showToast(res.data.message || '保释成功');
                    render(res.data.state);
                    showLogs(res.data.logs || []);
                    if (typeof loadPlayerInfo === 'function') loadPlayerInfo(true);
                    if (typeof loadMap === 'function') loadMap();
                } else {
                    showToast((res && res.message) || '保释失败');
                }
            } finally {
                _busy = false;
            }
        };
        var msg = '<p>确认提交 ' + costText + ' 从混天典狱保释？</p>' +
            '<p style="font-size:12px;color:var(--text-muted);">保释后会返回小世界继续探索，巡天热度会小幅上升。</p>';
        if (typeof gameConfirm === 'function') {
            gameConfirm(msg, run, null, true);
            return;
        }
        await run();
    }

    async function runChallenge() {
        if (_busy) return;
        _busy = true;
        try {
            var res = await api.post(API + '/challenge', {});
            if (res && res.code === 200 && res.data) {
                showToast(res.data.message || '挑战完成');
                render(res.data.state);
                saveChallengeCombatLog(res.data);
                showLogs(res.data.logs || [], 'battle');
                if (res.data.victory) {
                    if (typeof loadPlayerInfo === 'function') loadPlayerInfo(true);
                    if (typeof loadMap === 'function') loadMap();
                }
            } else {
                showToast((res && res.message) || '挑战失败');
            }
        } finally {
            _busy = false;
        }
    }

    async function challenge() {
        if (_busy) return;
        var state = _lastState || {};
        if (Number(state.breakProgress || 0) < 100) {
            showToast('主域通行进度未满，暂不可挑战守关天仙');
            return;
        }
        var msg = '<p>确认挑战「守关天仙」？</p>' +
            '<p style="font-size:12px;color:var(--text-muted);">战身强度 ' + num(state.bossPowerPreview) + '。失败会将主域通行进度压回 90，并提高巡天热度。</p>';
        if (typeof gameConfirm === 'function') {
            gameConfirm(msg, runChallenge, null, true);
            return;
        }
        await runChallenge();
    }

    return {
        load: load,
        ascend: ascend,
        synthesizeCoordinate: synthesizeCoordinate,
        returnLowerWorld: returnLowerWorld,
        returnImmortalWorld: returnImmortalWorld,
        doAction: doAction,
        contribute: contribute,
        contributeBatch: contributeBatch,
        exchange: exchange,
        bail: bail,
        disableCourtProtection: disableCourtProtection,
        challenge: challenge
    };
})();
