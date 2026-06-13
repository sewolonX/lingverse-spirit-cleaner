/**
 * LingVerse 炼造模块
 * 从 game.js 提取的炼丹/炼器功能
 */

var _craftRefreshTimer = null;
var _currentIncarnationStatus = null;
var _craftRecipeCache = {};
var _craftOpenRequestSeq = 0;
var CRAFT_RECIPE_CACHE_TTL_MS = 15000;
var ALCHEMY_BATCH_CRAFT_CAP = 100;
var ALCHEMY_BATCH_CRAFT_LAST_KEY = 'alchemyBatchCraftLastCount';
var TALISMAN_BATCH_CRAFT_CAP = 50;
var TALISMAN_BATCH_CRAFT_LAST_KEY = 'talismanBatchCraftLastCount';

// 二级 Tab 状态：每种模式独立记忆
var _craftSubtab = { alchemy: null, forge: null, talisman: null };
// 当前模式下的分组结果（含正常分类，秘传图纸单独排末），供二级 Tab 切换时复用
var _craftLastGroups = { alchemy: null, forge: null, talisman: null };
// 当前模式下命中的许愿目标卡片，供二级 Tab 切换时置顶复用
var _craftPinnedHtml = { alchemy: '', forge: '', talisman: '' };

/**
 * 设置炉子信息卡内容（炼丹/炼器/制符共用）
 * opts: { name, actionsHtml, chancesHtml, influenceHtml, spiritWarnText, spiritWarnDanger, masteryHtml }
 */
function setCraftFurnaceCard(opts) {
    var nameEl = document.getElementById('alchemyFurnaceName');
    var actionsEl = document.getElementById('alchemyFurnaceActions');
    var chancesEl = document.getElementById('alchemyGradeChances');
    var influenceEl = document.getElementById('craftInfluenceRow');
    var spiritWarnEl = document.getElementById('alchemySpiritWarn');
    var masteryEl = document.getElementById('forgeMasteryBar');
    if (nameEl) nameEl.innerHTML = opts.name || '未装备炼丹炉';
    if (actionsEl) actionsEl.innerHTML = opts.actionsHtml || '';
    if (chancesEl) chancesEl.innerHTML = opts.chancesHtml || '';
    if (influenceEl) {
        influenceEl.innerHTML = opts.influenceHtml || '';
        influenceEl.style.display = opts.influenceHtml ? 'flex' : 'none';
    }
    if (spiritWarnEl) {
        var text = opts.spiritWarnText || '';
        spiritWarnEl.textContent = text;
        spiritWarnEl.classList.toggle('spirit-warn--danger', !!opts.spiritWarnDanger);
        spiritWarnEl.style.display = text ? '' : 'none';
    }
    if (masteryEl) {
        if (opts.masteryHtml) {
            masteryEl.innerHTML = opts.masteryHtml;
            masteryEl.style.display = 'flex';
        } else {
            masteryEl.style.display = 'none';
            masteryEl.innerHTML = '';
        }
    }
    applyCraftFurnaceCollapseState();
}

function invalidateCraftRecipeCache(tab) {
    if (!tab) {
        _craftRecipeCache = {};
        return;
    }
    delete _craftRecipeCache[tab];
}

async function getCraftRecipesCached(tab, url, forceRefresh) {
    var cached = _craftRecipeCache[tab];
    var now = Date.now();
    if (!forceRefresh && cached && cached.data && now - cached.ts < CRAFT_RECIPE_CACHE_TTL_MS) {
        return { code: 200, data: cached.data, cached: true };
    }
    var res = await api.get(url);
    if (res && res.code === 200) {
        _craftRecipeCache[tab] = { ts: Date.now(), data: res.data };
    }
    return res;
}

function nextCraftOpenRequest() {
    _craftOpenRequestSeq += 1;
    return _craftOpenRequestSeq;
}

function isCraftOpenRequestCurrent(requestSeq, tab) {
    var overlay = document.getElementById('alchemyOverlay');
    return requestSeq === _craftOpenRequestSeq &&
        currentCraftingTab === tab &&
        overlay &&
        !overlay.classList.contains('hidden');
}

var CRAFT_FURNACE_COLLAPSED_KEY = 'craftFurnaceCollapsed';

function isCraftMobileViewport() {
    if (typeof window === 'undefined') return false;
    if (typeof window.matchMedia === 'function') {
        return window.matchMedia('(max-width: 620px)').matches;
    }
    return window.innerWidth <= 620;
}

function getCraftFurnaceCollapsedPreference() {
    var stored = localStorage.getItem(CRAFT_FURNACE_COLLAPSED_KEY);
    if (stored === '1') return true;
    if (stored === '0') return false;
    return isCraftMobileViewport();
}

function syncCraftMobileStatusToggle(collapsed) {
    var bar = document.getElementById('alchemyFurnaceBar');
    var section = document.getElementById('craftStatusSection');
    var inlineToggle = document.getElementById('alchemyFurnaceToggle');
    var mobileToggle = document.getElementById('craftMobileStatusToggle');
    var mobileHint = document.getElementById('craftMobileStatusHint');
    var expanded = !collapsed;
    if (bar) bar.classList.toggle('collapsed', collapsed);
    if (section) section.classList.toggle('craft-status-section--collapsed', collapsed);
    if (inlineToggle) {
        inlineToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        inlineToggle.setAttribute('title', collapsed ? '展开炉火详情' : '收起炉火详情');
    }
    if (mobileToggle) {
        mobileToggle.classList.toggle('is-collapsed', collapsed);
        mobileToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        mobileToggle.setAttribute('aria-label', collapsed ? '展开炉火状态详情' : '收起炉火状态详情');
    }
    if (mobileHint) mobileHint.textContent = collapsed ? '已收起 · 点此展开' : '收起详情';
    var label = bar ? bar.querySelector('.furnace-collapse-label') : null;
    if (label) label.textContent = collapsed ? '展开' : '收起';
}

function setCraftFurnaceCollapsed(collapsed, persist) {
    if (persist) localStorage.setItem(CRAFT_FURNACE_COLLAPSED_KEY, collapsed ? '1' : '0');
    syncCraftMobileStatusToggle(collapsed);
}

function applyCraftFurnaceCollapseState() {
    setCraftFurnaceCollapsed(getCraftFurnaceCollapsedPreference(), false);
}

function toggleCraftFurnaceCollapse() {
    var bar = document.getElementById('alchemyFurnaceBar');
    if (!bar) return;
    var nowCollapsed = !bar.classList.contains('collapsed');
    setCraftFurnaceCollapsed(nowCollapsed, true);
}

function joinCraftHtml(parts) {
    return parts.filter(function (p) { return !!p; }).join('');
}

function escCraftJs(s) {
    return String(s == null ? '' : s)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n');
}

function rawCraftArg(value) {
    return { raw: value };
}

function craftCall(fnName, args) {
    return fnName + '(' + (args || []).map(function (arg) {
        if (arg && typeof arg === 'object' && Object.prototype.hasOwnProperty.call(arg, 'raw')) return arg.raw;
        if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
        return '\'' + escCraftJs(arg) + '\'';
    }).join(', ') + ')';
}

function buildCraftButton(label, extraClass, onclick, opts) {
    opts = opts || {};
    var cls = 'btn-craft' + (extraClass ? ' ' + extraClass : '');
    var attrs = ' class="' + cls + '"';
    if (onclick) attrs += ' onclick="' + escCraft(onclick) + '"';
    if (opts.disabled) attrs += ' disabled';
    if (opts.title) attrs += ' title="' + escCraft(opts.title) + '"';
    return '<button' + attrs + '>' + escCraft(label) + '</button>';
}

function buildCraftActionGroup(buttons) {
    return joinCraftHtml(buttons || []);
}

function captureCraftButtonStateAndDisable() {
    return Array.prototype.slice.call(document.querySelectorAll('.btn-craft')).map(function (button) {
        var state = { button: button, disabled: button.disabled };
        button.disabled = true;
        return state;
    });
}

function restoreCraftButtons(states) {
    (states || []).forEach(function (state) {
        if (!state || !state.button || !document.contains(state.button)) return;
        state.button.disabled = !!state.disabled;
    });
}

function normalizeCraftCountInput(value) {
    return String(value == null ? '' : value)
        .trim()
        .replace(/[０-９]/g, function (ch) {
            return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
        });
}

function parseCraftCountInput(value) {
    var normalized = normalizeCraftCountInput(value);
    if (!/^\d+$/.test(normalized)) return NaN;
    return parseInt(normalized, 10);
}

function craftDialogOverlayClass(extraClass) {
    return 'modal-overlay--top ui-scrollable-modal craft-modal-overlay' + (extraClass ? ' ' + extraClass : '');
}

function showCraftDialog(options) {
    options = options || {};
    var bodyHtml = '<div class="craft-dialog-shell">' +
        '<div class="craft-dialog-layout">' +
        '<section class="craft-dialog-section">' + (options.bodyHtml || '') + '</section>' +
        '</div>' +
        '</div>';
    if (typeof showDecoratedActionDialog === 'function') {
        return showDecoratedActionDialog({
            subtitle: options.subtitle || '炼造',
            valueHtml: options.valueHtml || '',
            descHtml: options.descHtml || '',
            bodyHtml: bodyHtml,
            bodyClass: 'craft-dialog-body craft-dialog-host' + (options.bodyClass ? ' ' + options.bodyClass : ''),
            actionsHtml: options.actionsHtml || '',
            actionClass: 'modal-btn-row craft-dialog-actions' + (options.actionClass ? ' ' + options.actionClass : ''),
            extraClass: craftDialogOverlayClass(options.extraClass)
        });
    }
    if (typeof showModal !== 'function') return null;
    var html = '<div class="modal-header-deco">' +
        '<div class="modal-header-deco__subtitle">' + (options.subtitle || '炼造') + '</div>' +
        (options.descHtml ? '<div class="craft-dialog-desc">' + options.descHtml + '</div>' : '') +
        '</div>' +
        '<div class="modal-body-padded craft-dialog-body craft-dialog-host' + (options.bodyClass ? ' ' + options.bodyClass : '') + '">' +
        bodyHtml +
        (options.actionsHtml ? '<div class="modal-btn-row craft-dialog-actions' + (options.actionClass ? ' ' + options.actionClass : '') + '">' + options.actionsHtml + '</div>' : '') +
        '</div>';
    showModal(html, craftDialogOverlayClass(options.extraClass));
    return document.getElementById('customModal');
}

function craftPromptInputAttrs(options) {
    if (typeof _dialogPromptInputAttrs === 'function') return _dialogPromptInputAttrs(options);
    var opts = options || {};
    var attrs = ['type="' + (opts.type || 'text') + '"'];
    ['inputmode', 'pattern', 'min', 'max', 'step', 'maxlength', 'placeholder'].forEach(function (key) {
        if (opts[key] !== undefined && opts[key] !== null) attrs.push(key + '="' + escCraft(String(opts[key])) + '"');
    });
    return attrs.join(' ');
}

function craftPromptAsync(message, defaultValue, options) {
    return new Promise(function (resolve) {
        var inputId = 'craftPromptInput';
        showCraftDialog({
            subtitle: '炼造输入',
            descHtml: '请确认本次炼造参数',
            bodyHtml: '<div class="craft-dialog-note">' + escCraft(message || '') + '</div>' +
                '<label class="craft-dialog-field" for="' + inputId + '">' +
                '<span>输入</span>' +
                '<input ' + craftPromptInputAttrs(options) + ' id="' + inputId + '" class="app-input" autocomplete="off">' +
                '</label>',
            actionsHtml: '<button type="button" class="modal-btn modal-btn--outline" id="craftPromptCancelBtn">取 消</button>' +
                '<button type="button" class="modal-btn modal-btn--gold" id="craftPromptConfirmBtn">确 定</button>'
        });

        var inputEl = document.getElementById(inputId);
        var cancelBtn = document.getElementById('craftPromptCancelBtn');
        var confirmBtn = document.getElementById('craftPromptConfirmBtn');
        if (!inputEl || !cancelBtn || !confirmBtn) {
            closeModal();
            resolve(null);
            return;
        }
        inputEl.value = defaultValue || '';
        cancelBtn.onclick = function () {
            closeModal();
            resolve(null);
        };
        confirmBtn.onclick = function () {
            var value = inputEl.value;
            closeModal();
            resolve(value);
        };
        inputEl.onkeydown = function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                confirmBtn.click();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelBtn.click();
            }
        };
        setTimeout(function () {
            try {
                inputEl.focus({ preventScroll: true });
            } catch (e) {
                inputEl.focus();
            }
            inputEl.select();
        }, 80);
    });
}

function craftConfirmAsync(message, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
        showCraftDialog({
            subtitle: opts.subtitle || '炼造确认',
            descHtml: opts.descHtml || '请确认本次操作',
            bodyHtml: '<div class="craft-dialog-note craft-dialog-note--confirm">' + escCraft(message || '') + '</div>',
            actionsHtml: '<button type="button" class="modal-btn modal-btn--outline" id="craftConfirmCancelBtn">取 消</button>' +
                '<button type="button" class="modal-btn modal-btn--gold" id="craftConfirmOkBtn">' + escCraft(opts.confirmText || '确 定') + '</button>'
        });
        var cancelBtn = document.getElementById('craftConfirmCancelBtn');
        var okBtn = document.getElementById('craftConfirmOkBtn');
        if (!cancelBtn || !okBtn) {
            closeModal();
            resolve(false);
            return;
        }
        cancelBtn.onclick = function () {
            closeModal();
            resolve(false);
        };
        okBtn.onclick = function () {
            closeModal();
            resolve(true);
        };
    });
}

function requestAlchemyBatchCount(pillName, defaultCount) {
    return new Promise(function (resolve) {
        var safeName = escCraft(pillName || '');
        var html = '<div class="modal-info-card craft-batch-summary">' +
            '<div class="modal-info-card__title">炼制「' + safeName + '」</div>' +
            '<div class="craft-batch-hint">输入本次炼制次数，最多 ' + ALCHEMY_BATCH_CRAFT_CAP + ' 次。</div>' +
            '</div>' +
            '<label class="craft-batch-field">' +
            '<span>炼制次数</span>' +
            '<input type="number" inputmode="numeric" pattern="[0-9]*" min="1" max="' + ALCHEMY_BATCH_CRAFT_CAP + '" step="1" id="alchemyBatchCountInput" class="app-input" autocomplete="off">' +
            '</label>';
        showCraftDialog({
            subtitle: '批量炼制',
            descHtml: '按次数连续开炉',
            bodyHtml: html,
            bodyClass: 'craft-batch-dialog',
            actionsHtml: '<button type="button" class="modal-btn modal-btn--outline" id="alchemyBatchCancelBtn">取 消</button>' +
                '<button type="button" class="modal-btn modal-btn--gold" id="alchemyBatchConfirmBtn">炼 制</button>'
        });

        var inputEl = document.getElementById('alchemyBatchCountInput');
        var cancelBtn = document.getElementById('alchemyBatchCancelBtn');
        var confirmBtn = document.getElementById('alchemyBatchConfirmBtn');
        if (!inputEl || !cancelBtn || !confirmBtn) {
            closeModal();
            resolve(null);
            return;
        }
        inputEl.value = String(defaultCount || 10);

        function closeWith(value) {
            closeModal();
            resolve(value);
        }

        function focusInputNoScroll() {
            try {
                inputEl.focus({ preventScroll: true });
            } catch (e) {
                inputEl.focus();
            }
        }

        cancelBtn.onclick = function () { closeWith(null); };
        confirmBtn.onclick = function () {
            var count = parseCraftCountInput(inputEl.value);
            if (isNaN(count) || count <= 0) {
                showToast('次数不合法');
                focusInputNoScroll();
                return;
            }
            if (count > ALCHEMY_BATCH_CRAFT_CAP) {
                showToast('单次批量上限' + ALCHEMY_BATCH_CRAFT_CAP + '次');
                focusInputNoScroll();
                return;
            }
            closeWith(count);
        };
        inputEl.onkeydown = function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                confirmBtn.click();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelBtn.click();
            }
        };
        setTimeout(function () {
            focusInputNoScroll();
            inputEl.select();
        }, 80);
    });
}

/** 构造炉子操作按钮组 HTML（卸下/更换） */
function buildFurnaceActionsHtml() {
    return buildCraftActionGroup([
        buildCraftButton('卸下', 'btn-craft-sm', craftCall('unequipFurnace')),
        buildCraftButton('更换', 'btn-craft-sm btn-quickbuy', craftCall('showChangeFurnace'))
    ]);
}

/** 构造熟练度行 HTML */
function buildMasteryHtml(label, lvl, masteryMaxLevel, cur, need, infoOnclick) {
    var icon = ' <i style="cursor:pointer;font-style:normal;color:var(--text-gold)" onclick="' + infoOnclick + '">ⓘ</i>';
    if (masteryMaxLevel) {
        return '<span class="mastery-label">' + label + ' Lv.' + lvl + ' (已满级)' + icon + '</span>' +
            '<div class="mastery-progress"><div class="mastery-fill" style="width:100%"></div></div>';
    }
    var pct = Math.min(100, Math.floor((cur || 0) / (need || 1) * 100));
    return '<span class="mastery-label">' + label + ' Lv.' + lvl + icon + '</span>' +
        '<div class="mastery-progress"><div class="mastery-fill" style="width:' + pct + '%"></div></div>' +
        '<span class="mastery-exp">' + (cur || 0) + '/' + (need || 1) + '</span>';
}

/** 渲染品阶概率 chip 列 */
function buildChancesHtml(gradeChances) {
    if (!gradeChances || gradeChances.length === 0) return '';
    return gradeChances.map(function (c, i) {
        var pct = c % 1 === 0 ? c.toString() : c.toFixed(1);
        return '<span class="chance-tag rarity-' + (i + 1) + '">' + getRarityName(i + 1) + ' ' + pct + '%</span>';
    }).join('');
}

function buildCraftInfluenceHtml(items) {
    if (!items || items.length === 0) return '';
    return items.map(function (it) {
        var tone = it.tone === 'positive' ? 'positive' : (it.tone === 'negative' ? 'negative' : 'neutral');
        var detail = it.detail || '';
        return '<span class="craft-influence-chip craft-influence-chip--' + tone + '" title="' + escCraft(detail) + '">' +
            '<b>' + escCraft(it.label || '') + '</b>' +
            (detail ? '<small>' + escCraft(detail) + '</small>' : '') +
        '</span>';
    }).join('');
}

/** 构造材料 chip 列 HTML */
function buildMatsHtml(materials) {
    if (!materials || materials.length === 0) return '';
    return materials.map(function (m) {
        var cls = m.have >= m.need ? 'mat-ok' : 'mat-lack';
        return '<span class="' + cls + '">' + escCraft(m.name) + ' ' + m.have + '/' + m.need + '</span>';
    }).join('');
}

/** 构造灵力/神识消耗 chip 组 */
function buildCostChipsHtml(mpCost, spiritCost) {
    var html = '';
    if (mpCost > 0) html += '<span class="recipe-mp-cost">灵 ' + mpCost + '</span>';
    if (spiritCost > 0) html += '<span class="recipe-mp-cost recipe-cost-spirit">神 ' + spiritCost + '</span>';
    if (!html) return '';
    return '<span class="recipe-cost-chips">' + html + '</span>';
}

function buildRecipeDescHtml(label, text) {
    if (!text) return '';
    return '<div class="recipe-desc"><span class="recipe-desc-label">' + escCraft(label) + '</span>' + escCraft(text) + '</div>';
}

function getAlchemyDescriptionFallback(recipe) {
    var category = recipe.category || '';
    var name = recipe.pillName || '此丹';
    var fallbackMap = {
        HEAL_HP: '服用后恢复气血。',
        HEAL_MP: '服用后恢复灵力。',
        PET_HEAL_HP: '喂给指定灵宠恢复其气血。',
        PET_HEAL_MP: '喂给指定灵宠恢复其灵力。',
        PET_HEAL_BOTH: '喂给指定灵宠同时恢复气血与灵力。',
        PET_CULTIVATION: '喂给指定灵宠增加修为经验。',
        HEAL_SPIRIT: '服用后恢复神识。',
        CULTIVATION: '服用后增长修为。',
        BREAKTHROUGH: '破境时服用，可提高突破成功率。',
        COMBAT_ATK: '下次战斗前服用，可临时提升攻击。',
        COMBAT_DEF: '下次战斗前服用，可临时提升防御。',
        SPECIAL_ANTIDOTE: '可解寻常毒瘴。',
        SPECIAL_PERMANENT_HP: '服用后永久提升气血上限。',
        SPECIAL_PERMANENT_ATK: '服用后永久提升攻击。',
        SPECIAL_MEDITATION: '冥想前服用，可提升修炼收益。',
        SPECIAL_FIVE_ROOT: '服用后获得五行通灵之效。',
        ENCOUNTER_BOOST: '探索前服用，可提高遇妖概率。',
        ENCOUNTER_REPEL: '探索前服用，可降低遇妖概率。',
        RESTORE_LIFESPAN: '服用后弥合已折损寿元。',
        INCARNATION_CULTIVATION: '仅身外化身可服用，可增长化身修为。'
    };
    return recipe.description || recipe.effectDescription || recipe.desc || recipe.effect || fallbackMap[category] || (name + '的药性尚待品鉴。');
}

/**
 * 构造"配方境界"徽章：显示配方对应的境界；当配方低于玩家境界 2 阶以上时加"无经验"警告。
 * mode: 'forge' 目前后端会把熟练度归零（ForgeService.isStageTooHigh）；
 *       'talisman' 后端暂未归零，但作为同类刷经验参考也标注，便于玩家挑同境界或仅低 1 阶的配方。
 */
function buildStageBadgeHtml(minStage, mode, minRealmLevel) {
    if (!minStage || minStage <= 0) return '';
    var stageName = '';
    if (typeof formatRealmRequirement === 'function') {
        stageName = formatRealmRequirement(minStage, minRealmLevel);
    } else {
        stageName = (typeof REALM_NAMES !== 'undefined' && REALM_NAMES[minStage]) ? REALM_NAMES[minStage] : '';
    }
    if (!stageName) return '';
    var playerStage = window._playerRealmStage;
    var tooLow = false;
    if (typeof playerStage === 'number' && (mode === 'forge' || mode === 'talisman')) {
        tooLow = minStage < playerStage - 1;
    }
    var cls = 'recipe-stage-badge' + (tooLow ? ' recipe-stage-badge-low' : '');
    if (mode === 'forge' && tooLow) {
        return '<span class="' + cls + '" title="低于你当前境界 2 阶以上，炼器熟练度无获取">' + stageName + '</span>' +
            '<span class="recipe-no-exp">无经验</span>';
    }
    if (mode === 'talisman' && tooLow) {
        return '<span class="' + cls + '" title="低于你当前境界 2 阶以上，不建议用于刷符道熟练度">' + stageName + '</span>' +
            '<span class="recipe-no-exp">低阶</span>';
    }
    return '<span class="' + cls + '">' + stageName + '</span>';
}

function getCraftRecipeStageOrder(stage) {
    var playerStage = window._playerRealmStage;
    if (typeof playerStage !== 'number') return 0;
    var recipeStage = (typeof stage === 'number') ? stage : 0;
    if (recipeStage === playerStage) return 0;
    if (recipeStage < playerStage) return 1;
    return 2;
}

function compareCraftRecipesByRealm(a, b) {
    var playerStage = window._playerRealmStage;
    if (typeof playerStage !== 'number') return 0;
    var as = (typeof a.minStage === 'number') ? a.minStage : 0;
    var bs = (typeof b.minStage === 'number') ? b.minStage : 0;
    var ag = getCraftRecipeStageOrder(as);
    var bg = getCraftRecipeStageOrder(bs);
    if (ag !== bg) return ag - bg;
    if (ag === 0) {
        var al = (typeof a.minRealmLevel === 'number') ? a.minRealmLevel : 0;
        var bl = (typeof b.minRealmLevel === 'number') ? b.minRealmLevel : 0;
        if (al !== bl) return bl - al;
    } else if (ag === 1) {
        if (as !== bs) return bs - as;
    } else {
        if (as !== bs) return as - bs;
    }
    var ar = a.rarity || 0;
    var br = b.rarity || 0;
    if (ar !== br) return br - ar;
    return escCraft(a.pillName || a.name || '').localeCompare(escCraft(b.pillName || b.name || ''));
}

/**
 * 通用配方卡片 HTML（各模式按需提供 statTagsHtml / rateRowHtml / descHtml）
 * fields: { name, isBlueprint, disabled, extraClass, extraBadgesHtml, mpCost, spiritCost, stageBadgeHtml, statTagsHtml, descHtml, rateRowHtml, matsHtml, btnHtml, typeLabel, kindLabel }
 */
function buildCraftCardHtml(fields) {
    var rowCls = 'craft-card' +
        (fields.extraClass ? ' ' + fields.extraClass : '') +
        (fields.isBlueprint ? ' craft-card-blueprint' : '') +
        (fields.disabled ? ' craft-card-disabled' : '');
    var badges = joinCraftHtml([
        fields.extraBadgesHtml || '',
        fields.kindLabel ? '<span class="recipe-kind-badge">' + escCraft(fields.kindLabel) + '</span>' : '',
        fields.isBlueprint ? '<span class="bp-badge">秘传</span>' : '',
        fields.typeLabel ? '<span class="recipe-type-badge">' + escCraft(fields.typeLabel) + '</span>' : '',
        fields.stageBadgeHtml || ''
    ]);
    return '<article class="' + rowCls + '">' +
        '<div class="craft-card-topline">' +
            '<div class="craft-card-title-wrap">' +
                '<div class="recipe-name">' + escCraft(fields.name) + '</div>' +
                (badges ? '<div class="recipe-badges">' + badges + '</div>' : '') +
            '</div>' +
            buildCostChipsHtml(fields.mpCost, fields.spiritCost) +
        '</div>' +
        (fields.descHtml ? '<div class="craft-card-desc-row">' + fields.descHtml + '</div>' : '') +
        '<div class="craft-card-content">' +
            (fields.statTagsHtml ? '<div class="forge-stat-tags">' + fields.statTagsHtml + '</div>' : '') +
            (fields.rateRowHtml || '') +
            (fields.matsHtml ? '<div class="recipe-mats"><span class="recipe-mats-label">材料</span>' + fields.matsHtml + '</div>' : '') +
        '</div>' +
        (fields.btnHtml ? '<div class="craft-card-actions">' + fields.btnHtml + '</div>' : '') +
        '</article>';
}

function buildWishTargetBadgeHtml(progress) {
    var pct = parseInt(progress, 10);
    if (isNaN(pct)) pct = 0;
    pct = Math.max(0, Math.min(100, pct));
    return '<span class="recipe-wish-badge">许愿目标 ' + pct + '%</span>';
}

function getCraftWishTargetRecipeId(wishItemId) {
    if (!wishItemId) return '';
    var text = String(wishItemId).trim();
    var splitAt = text.lastIndexOf('_');
    if (splitAt <= 0 || splitAt >= text.length - 1) return '';
    var grade = parseInt(text.slice(splitAt + 1), 10);
    if (!isFinite(grade) || grade < 1 || grade > 5) return '';
    return text.slice(0, splitAt);
}

function isCraftWishTargetRecipe(tab, recipe, wishItemId) {
    var recipeId = getCraftRecipeId(tab, recipe);
    if (!recipeId || !wishItemId) return false;
    return getCraftWishTargetRecipeId(wishItemId) === recipeId;
}

function renderCraftPinnedRecipe(mode, html) {
    if (typeof html === 'string') _craftPinnedHtml[mode] = html;
    var pinnedEl = document.getElementById('craftPinnedRecipes');
    if (!pinnedEl) return;
    var pinnedHtml = _craftPinnedHtml[mode] || '';
    pinnedEl.innerHTML = pinnedHtml;
    pinnedEl.style.display = pinnedHtml ? 'flex' : 'none';
}

/**
 * 渲染二级 Tab + 配方列表
 * mode: 'alchemy' | 'forge' | 'talisman'
 * grouped: { 分类名: [{ html }] } —— html 已是单条配方的完整 HTML
 * pinnedHtml: 当前许愿目标的置顶配方卡，可为空字符串
 */
function renderCraftRecipes(mode, grouped, pinnedHtml) {
    _craftLastGroups[mode] = grouped;
    if (typeof pinnedHtml === 'string') _craftPinnedHtml[mode] = pinnedHtml;
    renderCraftPinnedRecipe(mode);
    var subtabsEl = document.getElementById('craftSubtabs');
    var listEl = document.getElementById('alchemyRecipes');
    var keys = Object.keys(grouped).sort(function (a, b) {
        if (a === '秘传图纸') return 1;
        if (b === '秘传图纸') return -1;
        return 0;
    });
    if (keys.length === 0) {
        if (subtabsEl) { subtabsEl.style.display = 'none'; subtabsEl.innerHTML = ''; }
        if (listEl) listEl.innerHTML = (_craftPinnedHtml[mode] || '') ? '' : '<div class="craft-empty">当前境界暂无可用配方</div>';
        return;
    }
    // 单一分类时不显示二级 Tab
    if (keys.length === 1) {
        if (subtabsEl) { subtabsEl.style.display = 'none'; subtabsEl.innerHTML = ''; }
        if (listEl) listEl.innerHTML = grouped[keys[0]].map(function (e) { return e.html; }).join('');
        return;
    }
    // 多分类：渲染二级 Tab
    var active = _craftSubtab[mode];
    if (!active || keys.indexOf(active) < 0) {
        active = keys[0];
        _craftSubtab[mode] = active;
    }
    if (subtabsEl) {
        subtabsEl.style.display = 'flex';
        subtabsEl.innerHTML = keys.map(function (k) {
            var cls = 'craft-subtab' + (k === active ? ' active' : '');
            var count = grouped[k].length;
            return '<button class="' + cls + '" data-craft-mode="' + escCraft(mode) + '" data-craft-key="' + escCraft(k) + '">' +
                escCraft(k) + '<span class="craft-subtab-count">·' + count + '</span></button>';
        }).join('');
        if (!subtabsEl._craftDelegated) {
            subtabsEl.addEventListener('click', function (ev) {
                var btn = ev.target.closest('button[data-craft-key]');
                if (!btn || !subtabsEl.contains(btn)) return;
                setCraftSubtab(btn.getAttribute('data-craft-mode'), btn.getAttribute('data-craft-key'));
            });
            subtabsEl._craftDelegated = true;
        }
    }
    if (listEl) listEl.innerHTML = (grouped[active] || []).map(function (e) { return e.html; }).join('');
}

function setCraftSubtab(mode, key) {
    _craftSubtab[mode] = key;
    var grouped = _craftLastGroups[mode];
    if (grouped) renderCraftRecipes(mode, grouped);
}

function scheduleCraftRefresh(tab) {
    setCraftRefreshNote(tab, '正在同步材料状态...');
    if (_craftRefreshTimer) clearTimeout(_craftRefreshTimer);
    _craftRefreshTimer = setTimeout(function () {
        var overlay = document.getElementById('alchemyOverlay');
        if (overlay && !overlay.classList.contains('hidden') && currentCraftingTab === tab) {
            openCrafting(tab, { forceRefresh: true, backgroundRefresh: true });
        }
    }, 0);
}

function getCraftRecipeId(tab, recipe) {
    if (!recipe) return '';
    return tab === 'alchemy' ? recipe.pillId : recipe.recipeId;
}

function getCraftResultCount(result, requestedCount) {
    var count = parseInt(result && result.craftCount, 10);
    if (!isNaN(count) && count > 0) return count;
    count = parseInt(requestedCount, 10);
    return (!isNaN(count) && count > 0) ? count : 1;
}

function syncCraftRecipeLocalAvailability(tab, recipe) {
    if (!recipe || !recipe.materials) return;
    var ready = recipe.materials.every(function (m) {
        return (parseInt(m.have, 10) || 0) >= (parseInt(m.need, 10) || 0);
    });
    var craftFlag = tab === 'forge' ? 'canForge' : 'canCraft';
    if (!ready) {
        if (recipe[craftFlag] || !recipe.disableReason || recipe.disableReason === 'no_materials') {
            recipe.disableReason = 'no_materials';
        }
        recipe[craftFlag] = false;
        recipe.canQuickBuy = false;
        recipe.quickBuyCost = 0;
    } else if (recipe.disableReason === 'no_materials') {
        recipe[craftFlag] = true;
        recipe.disableReason = '';
    }
}

function applyCraftBatchCacheUpdate(tab, recipeId, craftCount) {
    var cached = _craftRecipeCache[tab];
    var data = cached && cached.data;
    var recipes = data && data.recipes;
    if (!recipes || !recipes.length || !recipeId || craftCount <= 0) return false;

    var selected = recipes.find(function (r) { return getCraftRecipeId(tab, r) === recipeId; });
    if (!selected || !selected.materials || !selected.materials.length) return false;

    var consumedByTemplate = {};
    selected.materials.forEach(function (m) {
        var need = parseInt(m.need, 10) || 0;
        if (!m.templateId || need <= 0) return;
        consumedByTemplate[m.templateId] = (consumedByTemplate[m.templateId] || 0) + need * craftCount;
    });

    var hasConsumed = Object.keys(consumedByTemplate).length > 0;
    if (!hasConsumed) return false;

    recipes.forEach(function (recipe) {
        if (!recipe.materials) return;
        var touched = false;
        recipe.materials.forEach(function (m) {
            var used = consumedByTemplate[m.templateId] || 0;
            if (used <= 0) return;
            m.have = Math.max(0, (parseInt(m.have, 10) || 0) - used);
            touched = true;
        });
        if (touched) syncCraftRecipeLocalAvailability(tab, recipe);
    });
    cached.ts = Date.now();
    return true;
}

function syncCraftAfterBatchSuccess(tab, recipeId, result, requestedCount) {
    var craftCount = getCraftResultCount(result, requestedCount);
    if (!applyCraftBatchCacheUpdate(tab, recipeId, craftCount)) {
        scheduleCraftRefresh(tab);
        return false;
    }
    setCraftRefreshNote(tab, '材料状态已同步，正在刷新炼造状态...');
    openCrafting(tab, { forceRefresh: true, backgroundRefresh: true });
    return true;
}

function refreshCraftAfterFurnaceChange() {
    var overlay = document.getElementById('alchemyOverlay');
    if (!overlay || overlay.classList.contains('hidden') || typeof openCrafting !== 'function') return false;
    var tab = currentCraftingTab || 'alchemy';
    if (tab !== 'alchemy' && tab !== 'forge') return false;
    invalidateCraftRecipeCache(tab);
    setCraftRefreshNote(tab, '丹炉已更换，正在同步炉火状态...');
    openCrafting(tab, { forceRefresh: true, backgroundRefresh: true });
    return true;
}

function refreshCraftAfterQuickBuy(type) {
    if (type === 'alchemy' || type === 'forge' || type === 'talisman') {
        invalidateCraftRecipeCache(type);
        setCraftRefreshNote(type, '材料已补齐，正在同步配方状态...');
        openCrafting(type, { forceRefresh: true, backgroundRefresh: true });
    } else if (type === 'incarnation_condense' || type === 'incarnation_refine') {
        openIncarnation();
    } else {
        invalidateCraftRecipeCache('forge');
        setCraftRefreshNote('forge', '材料已补齐，正在同步配方状态...');
        openCrafting('forge', { forceRefresh: true, backgroundRefresh: true });
    }
}

// HTML 转义，防止 XSS（textContent 不会编码 " 和 '，需手动补，避免越出 onclick="" 属性）
function escCraft(s) {
    var el = document.createElement('div');
    el.textContent = s;
    return el.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderIncarnationResourceBar(label, value, max, fillCls) {
    var safeMax = Math.max(0, max || 0);
    var safeValue = Math.max(0, Math.min(value || 0, safeMax || (value || 0)));
    var pct = safeMax > 0 ? Math.max(0, Math.min(100, Math.round(safeValue * 100 / safeMax))) : 0;
    return '<div class="inc-res-block">' +
        '<div class="inc-res-row"><span>' + escCraft(label) + '</span><span>' + safeValue + '/' + safeMax + '</span></div>' +
        '<div class="inc-res-track"><div class="inc-res-fill ' + fillCls + '" style="width:' + pct + '%"></div></div>' +
        '</div>';
}

function formatIncarnationDuration(seconds) {
    if (!seconds || seconds <= 0) return '已回满';
    var totalMinutes = Math.ceil(seconds / 60);
    var hours = Math.floor(totalMinutes / 60);
    var minutes = totalMinutes % 60;
    if (hours > 0 && minutes > 0) return hours + '小时' + minutes + '分钟';
    if (hours > 0) return hours + '小时';
    return Math.max(1, totalMinutes) + '分钟';
}

function renderIncarnationStatChip(label, value, gain, tone) {
    var cls = 'inc-preview-chip' + (tone ? ' inc-preview-chip--' + tone : '');
    return '<div class="' + cls + '">' +
        '<div class="inc-preview-chip__label">' + escCraft(label) + '</div>' +
        '<div class="inc-preview-chip__value">' + value + (gain > 0 ? ' <span class="inc-preview-gain">+' + gain + '</span>' : '') + '</div>' +
        '</div>';
}

function formatIncarnationCraftTime(ts) {
    if (!ts || ts <= 0) return '尚无记录';
    var diff = Date.now() - ts;
    if (diff < 0) diff = 0;
    var sec = Math.floor(diff / 1000);
    if (sec < 60) return '刚刚';
    var min = Math.floor(sec / 60);
    if (min < 60) return min + ' 分钟前';
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + ' 小时前';
    var day = Math.floor(hr / 24);
    if (day < 30) return day + ' 天前';
    var d = new Date(ts);
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function renderIncarnationSection(title, bodyHtml, extraClass) {
    return '<section class="inc-section' + (extraClass ? ' ' + extraClass : '') + '">' +
        (title ? '<div class="inc-section-title"><span>' + escCraft(title) + '</span></div>' : '') +
        '<div class="inc-section-body">' + bodyHtml + '</div>' +
        '</section>';
}

function renderIncarnationMetaPill(label, value) {
    return '<span class="inc-meta-item"><b>' + escCraft(label) + '</b><em>' + escCraft(value) + '</em></span>';
}

function renderIncarnationHero(status, opts) {
    opts = opts || {};
    var metaHtml = opts.metaHtml || '';
    return '<section class="inc-hero' + (opts.stateClass ? ' ' + opts.stateClass : '') + '">' +
        '<div class="inc-hero-main">' +
            '<div class="inc-hero-kicker">' + escCraft(opts.kicker || '身外化身 · 神念名牒') + '</div>' +
            '<div class="inc-title">' + (opts.titleHtml || escCraft(status && status.name ? status.name : '身外化身')) + '</div>' +
            (opts.subtitle ? '<div class="inc-subtitle">' + opts.subtitle + '</div>' : '') +
            (metaHtml ? '<div class="inc-meta-strip">' + metaHtml + '</div>' : '') +
        '</div>' +
        (opts.actionsHtml ? '<div class="inc-action-stack">' + opts.actionsHtml + '</div>' : '') +
        (opts.extraHtml ? '<div class="inc-hero-detail">' + opts.extraHtml + '</div>' : '') +
        '</section>';
}

function renderIncarnationMaterials(materials, emptyText) {
    var html = (materials || []).map(function (m) {
        var cls = m.have >= m.need ? 'mat-ok' : 'mat-lack';
        return '<span class="' + cls + '">' + escCraft(m.name) + ' ' + m.have + '/' + m.need + '</span>';
    }).join('');
    return '<div class="inc-mats">' + (html || '<span class="inc-empty-line">' + escCraft(emptyText || '暂无额外材料') + '</span>') + '</div>';
}

function incarnationNum(value) {
    var n = Number(value);
    return isFinite(n) ? n : 0;
}

function incarnationFormat(value) {
    if (typeof formatNumber === 'function') return formatNumber(value);
    return String(incarnationNum(value));
}

function incarnationFinalStat(status, baseKey, bonusKey, finalKey) {
    status = status || {};
    var finalValue = incarnationNum(status[finalKey]);
    if (finalValue > 0) return finalValue;
    return incarnationNum(status[baseKey]) + incarnationNum(status[bonusKey]);
}

function renderIncarnationVitals(status) {
    status = status || {};
    var combatAttack = incarnationFinalStat(status, 'attack', 'equipBonusAttack', 'combatAttack');
    var combatDefense = incarnationFinalStat(status, 'defense', 'equipBonusDefense', 'combatDefense');
    var combatMaxHp = incarnationNum(status.combatMaxHp || status.maxHp);
    var combatMaxSpirit = incarnationNum(status.combatMaxSpirit || status.maxSpirit);
    var currentHp = incarnationNum(status.hp);
    var items = [
        { label: '攻击', value: incarnationFormat(combatAttack), bonus: status.equipBonusAttack || 0, tone: 'atk' },
        { label: '防御', value: incarnationFormat(combatDefense), bonus: status.equipBonusDefense || 0, tone: 'def' },
        { label: '当前气血', value: incarnationFormat(currentHp) + '/' + incarnationFormat(combatMaxHp), bonus: status.equipBonusHp || 0, tone: 'hp' },
        { label: '神识上限', value: incarnationFormat(combatMaxSpirit), bonus: status.equipBonusSpirit || 0, tone: 'def' }
    ];
    var grid = '<div class="inc-vital-grid">' + items.map(function (item) {
        return '<div class="inc-vital-chip inc-vital-chip--' + item.tone + '">' +
            '<span class="inc-vital-chip__label">' + item.label + '</span>' +
            '<strong>' + item.value + (item.bonus ? '<em>+' + item.bonus + '</em>' : '') + '</strong>' +
            '</div>';
    }).join('') + '</div>';
    var breakdown = '<div class="inc-empty-line" style="margin-top:6px;">装备/天纹：攻 +' + incarnationFormat(status.equipBonusAttack || 0) +
        '　防 +' + incarnationFormat(status.equipBonusDefense || 0) +
        '　血 +' + incarnationFormat(status.equipBonusHp || 0) +
        '　神 +' + incarnationFormat(status.equipBonusSpirit || 0) + '</div>';
    return grid + breakdown;
}

function renderIncarnationRecoveryGrid(recovery) {
    recovery = recovery || {};
    return '<div class="inc-recovery-grid">' +
        '<div class="inc-recovery-item"><span>灵力恢复</span><strong>每小时 ' + (recovery.mpPerHour || 0) + ' 点</strong><small>回满约需 ' + formatIncarnationDuration(recovery.mpFullSeconds || 0) + '</small></div>' +
        '<div class="inc-recovery-item"><span>神识恢复</span><strong>每小时 ' + (recovery.spiritPerHour || 0) + ' 点</strong><small>回满约需 ' + formatIncarnationDuration(recovery.spiritFullSeconds || 0) + '</small></div>' +
        '</div>';
}

function renderIncarnationRefineInlineCard(status, quickBtn, preview) {
    var atMax = (status.refineLevel || 0) >= (status.maxRefineLevel || 0);
    var targetText = atMax
        ? '已至当前上限'
        : ('下次祭炼 · Lv.' + ((preview && preview.targetRefineLevel) || ((status.refineLevel || 0) + 1)));
    var previewHtml = preview
        ? '<div class="inc-refine-inline-preview">' +
            '<div class="inc-refine-inline-subtitle">属性预览</div>' +
            '<div class="inc-preview-grid">' +
                renderIncarnationStatChip('气血', preview.hp, preview.hpGain, 'hp') +
                renderIncarnationStatChip('灵力', preview.mp, preview.mpGain, 'mp') +
                renderIncarnationStatChip('攻击', preview.attack, preview.attackGain, 'atk') +
                renderIncarnationStatChip('防御', preview.defense, preview.defenseGain, 'def') +
                renderIncarnationStatChip('神识', preview.spirit, preview.spiritGain, 'spirit') +
            '</div>' +
        '</div>'
        : '<div class="inc-empty-line">当前暂无下一层祭炼预览</div>';

    return '<div class="inc-refine-inline-card">' +
        '<div class="inc-refine-inline-head">' +
            '<div>' +
                '<div class="inc-refine-inline-title">祭炼</div>' +
                '<div class="inc-refine-inline-target">' + escCraft(targetText) + '</div>' +
            '</div>' +
            (quickBtn || '') +
        '</div>' +
        (atMax
            ? '<div class="inc-cost-line inc-cost-line--muted">化身已祭炼至当前上限，待后续上限开放后方可继续。</div>'
            : '<div class="inc-cost-line">消耗：' + (status.refineStoneCost || 0) + ' 灵石 / ' + (status.refineCultivationCost || 0) + ' 修为</div>' +
                renderIncarnationMaterials(status.refineMaterials, '当前无需额外材料') +
                previewHtml) +
        '</div>';
}

function renderIncarnationCraftStatsCard(status) {
    var count = status.craftCount || 0;
    var mpUsed = status.totalMpUsed || 0;
    var spiritUsed = status.totalSpiritUsed || 0;
    var lastSummary = status.lastCraftSummary || '';
    var lastAt = status.lastCraftAt || 0;
    var lastLine = (count > 0 && (lastSummary || lastAt))
        ? (escCraft(lastSummary || '一次代工') + ' · ' + formatIncarnationCraftTime(lastAt))
        : '尚未代工';
    return renderIncarnationSection('代工功劳簿',
        '<div class="inc-section-note">仅统计化身实际出力的炼造</div>' +
        '<div class="inc-stats-grid">' +
        '<div class="inc-stat-chip"><div class="inc-stat-chip__label">总代工次数</div><div class="inc-stat-chip__value inc-stat-chip__value--gold">' + count + '</div></div>' +
        '<div class="inc-stat-chip"><div class="inc-stat-chip__label">累计耗灵</div><div class="inc-stat-chip__value inc-stat-chip__value--jade">' + mpUsed + '</div></div>' +
        '<div class="inc-stat-chip"><div class="inc-stat-chip__label">累计耗神</div><div class="inc-stat-chip__value inc-stat-chip__value--gold">' + spiritUsed + '</div></div>' +
        '</div>' +
        '<div class="inc-last-line"><span>最近一次：</span>' + lastLine + '</div>',
        'inc-section--ledger');
}

function renderIncarnationGuideCards(status) {
    var guideHtml = '<div class="inc-guides">' +
        '<div class="inc-guide-item"><div class="inc-guide-title">化身定位</div>' +
        '<div class="inc-guide-body">分担炼丹、炼器、制符的灵力与神识消耗；受邀护道时会以自身气血、灵力、装备与化身技能独立出战。</div></div>' +
        '<div class="inc-guide-item"><div class="inc-guide-title">恢复规则</div>' +
        '<div class="inc-guide-body">化身灵力每小时恢复最大值的10%，化身神识每小时恢复最大值的5%。祭炼成功后，化身会回到满状态。</div></div>' +
        '<div class="inc-guide-item"><div class="inc-guide-title">灵躯说明</div>' +
        '<div class="inc-guide-body">初始面板为化神前期白板修士的一半，祭炼层数越高，气血、灵力、攻防与神识会同步增长；化身自创技能与本体技能池互不占位。</div></div>' +
        '</div>';
    if (status && status.note) {
        guideHtml += '<div class="inc-note">' + escCraft(status.note) + '</div>';
    }
    return renderIncarnationSection('化身说明', guideHtml, 'inc-section--guide');
}

function setCraftingTabActive(tab) {
    var tabs = {
        alchemy: document.getElementById('tabAlchemy'),
        forge: document.getElementById('tabForge'),
        talisman: document.getElementById('tabTalisman'),
        aspect: document.getElementById('tabAspect'),
        incarnation: document.getElementById('tabIncarnation')
    };
    Object.keys(tabs).forEach(function (key) {
        var el = tabs[key];
        if (!el) return;
        var active = key === tab;
        el.classList.toggle('active', active);
        el.setAttribute('aria-selected', active ? 'true' : 'false');
    });
}

function setCraftPanelMeta(tab) {
    var section = document.getElementById('craftRecipeSection');
    if (section) section.setAttribute('data-craft-tab', tab || '');
}

function setCraftRefreshNote(tab, text) {
    if (currentCraftingTab !== tab) return;
}

function restoreCraftButtonsAfterBackgroundRefresh() {
    document.querySelectorAll('.btn-craft').forEach(function (b) { b.disabled = false; });
}

function handleCraftBackgroundRefreshError(tab, message) {
    setCraftPanelMeta(tab);
    restoreCraftButtonsAfterBackgroundRefresh();
    showToast(message || '材料状态同步失败');
}

function hideIncarnationCraftPanel() {
    var panel = document.getElementById('incarnationCraftPanel');
    if (!panel) return;
    panel.style.display = 'none';
    panel.innerHTML = '';
}

function hideCraftAspectPanel() {
    var panel = document.getElementById('craftAspectPanel');
    if (!panel) return;
    panel.style.display = 'none';
    panel.innerHTML = '';
}

function showCraftRecipeLayout() {
    var statusSection = document.getElementById('craftStatusSection');
    var recipeSection = document.getElementById('craftRecipeSection');
    var furnaceBar = document.getElementById('alchemyFurnaceBar');
    var recipes = document.getElementById('alchemyRecipes');
    if (statusSection) statusSection.style.display = '';
    if (recipeSection) recipeSection.style.display = '';
    if (furnaceBar) furnaceBar.style.display = '';
    if (recipes) recipes.style.display = '';
    hideIncarnationCraftPanel();
    hideCraftAspectPanel();
    setCraftPanelMeta(currentCraftingTab);
}

function getCraftLoadingLabel(tab) {
    if (tab === 'forge') return '感应器谱';
    if (tab === 'talisman') return '感应符图';
    return '感应丹方';
}

function showCraftRecipeLoading(tab, message) {
    currentCraftingTab = tab || 'alchemy';
    var overlay = document.getElementById('alchemyOverlay');
    var subtabs = document.getElementById('craftSubtabs');
    var listEl = document.getElementById('alchemyRecipes');
    var wishBar = document.getElementById('wishSlotBar');
    showCraftRecipeLayout();
    renderCraftPinnedRecipe(currentCraftingTab, '');
    setCraftingTabActive(currentCraftingTab);
    if (subtabs) {
        subtabs.style.display = 'none';
        subtabs.innerHTML = '';
    }
    if (wishBar) wishBar.style.display = 'none';
    setCraftFurnaceCard({
        name: getCraftLoadingLabel(currentCraftingTab),
        actionsHtml: '',
        chancesHtml: '',
        influenceHtml: '',
        spiritWarnText: message || '正在读取配方与材料状态',
        spiritWarnDanger: false,
        masteryHtml: ''
    });
    if (listEl) {
        listEl.innerHTML = '<div class="craft-loading-state" role="status">' +
            '<span class="craft-loading-state__dot"></span>' +
            '<span class="craft-loading-state__text">' + escCraft(message || '正在读取炼造数据...') + '</span>' +
            '</div>';
    }
    if (overlay) overlay.classList.remove('hidden');
}

function showIncarnationTabLayout() {
    var wishBar = document.getElementById('wishSlotBar');
    var statusSection = document.getElementById('craftStatusSection');
    var recipeSection = document.getElementById('craftRecipeSection');
    var furnaceBar = document.getElementById('alchemyFurnaceBar');
    var recipes = document.getElementById('alchemyRecipes');
    var subtabs = document.getElementById('craftSubtabs');
    if (statusSection) statusSection.style.display = 'none';
    if (recipeSection) recipeSection.style.display = 'none';
    if (wishBar) wishBar.style.display = 'none';
    if (furnaceBar) furnaceBar.style.display = 'none';
    if (recipes) recipes.style.display = 'none';
    if (subtabs) subtabs.style.display = 'none';
    hideCraftAspectPanel();
}

function showIncarnationLoading() {
    currentCraftingTab = 'incarnation';
    var overlay = document.getElementById('alchemyOverlay');
    var panel = document.getElementById('incarnationCraftPanel');
    showIncarnationTabLayout();
    setCraftingTabActive('incarnation');
    if (panel) {
        panel.style.display = 'block';
        panel.innerHTML = '<div class="inc-panel-card">' +
            '<div class="craft-loading-state" role="status">' +
            '<span class="craft-loading-state__dot"></span>' +
            '<span class="craft-loading-state__text">正在感应化身状态...</span>' +
            '</div>' +
            '</div>';
    }
    if (overlay) overlay.classList.remove('hidden');
}

async function openIncarnation() {
    var requestSeq = nextCraftOpenRequest();
    showIncarnationLoading();
    var res = await api.get('/api/game/incarnation/status');
    if (!isCraftOpenRequestCurrent(requestSeq, 'incarnation')) return;
    if (res.code !== 200) {
        closeAlchemy();
        showToast(res.message || '化身状态感应失败');
        return;
    }
    applyIncarnationStatusUpdate(res.data);
}

function applyIncarnationStatusUpdate(status) {
    if (!status) return false;
    var overlay = document.getElementById('alchemyOverlay');
    showIncarnationTabLayout();
    renderIncarnationCraftPanel(status);
    setCraftingTabActive('incarnation');
    if (overlay) overlay.classList.remove('hidden');
    currentCraftingTab = 'incarnation';
    return true;
}

async function toggleIncarnationCraftDelegation(enabled) {
    try {
        var res = await api.post('/api/game/incarnation/toggle-craft', { enabled: !!enabled });
        if (res.code === 200) {
            showToast(enabled ? '化身已掌炉，本体冥想中亦可炼造' : '本体亲自掌炉，冥想中无法炼造');
            if (!applyIncarnationStatusUpdate(res.data)) openCrafting(currentCraftingTab);
        } else {
            showToast(res.message || '切换失败');
        }
    } catch (e) {
        showToast(e.message || '切换失败');
    }
}
window.toggleIncarnationCraftDelegation = toggleIncarnationCraftDelegation;

function showCraftAspectTabLayout() {
    var wishBar = document.getElementById('wishSlotBar');
    var statusSection = document.getElementById('craftStatusSection');
    var recipeSection = document.getElementById('craftRecipeSection');
    var furnaceBar = document.getElementById('alchemyFurnaceBar');
    var recipes = document.getElementById('alchemyRecipes');
    var subtabs = document.getElementById('craftSubtabs');
    if (statusSection) statusSection.style.display = 'none';
    if (recipeSection) recipeSection.style.display = 'none';
    if (wishBar) wishBar.style.display = 'none';
    if (furnaceBar) furnaceBar.style.display = 'none';
    if (recipes) recipes.style.display = 'none';
    if (subtabs) subtabs.style.display = 'none';
    hideIncarnationCraftPanel();
    var panel = document.getElementById('craftAspectPanel');
    if (panel) panel.style.display = 'block';
}

function buildCraftAspectSlotHtml(type, item) {
    var slotNameMap = { weapon: '主手', armor: '服饰', accessory: '法器', ring: '须弥戒', furnace: '炼丹炉' };
    var name = slotNameMap[type] || type;
    if (!item) {
        return '<div class="equip-slot empty" id="craftEquipSlot-' + escCraft(type) + '" onclick="handleCraftAspectSlotClick(\'' + escCraftJs(type) + '\')">' +
            '<span class="slot-name">' + escCraft(name) + '</span><span class="equip-name-text empty-text">未装备</span></div>';
    }
    var isNatalArtifact = !!item.isNatalArtifact;
    var wearHtml = '';
    if (!isNatalArtifact && item.wearRate && item.wearRate > 0) {
        var wearPct = (item.wearRate / 100).toFixed(2);
        var wearColor = item.wearRate >= 5000 ? 'var(--text-red)' : item.wearRate >= 2500 ? 'var(--accent-orange)' : 'var(--accent-gold)';
        wearHtml = '<span class="equip-wear-badge" style="color:' + wearColor + '">破损' + wearPct + '%</span>';
    }
    if (isNatalArtifact) {
        var natalDriveCost = typeof getNatalDriveSpiritCost === 'function' ? getNatalDriveSpiritCost(item) : 0;
        var natalDrive = item.driveCostPercent > 0
            ? '<span class="equip-wear-badge" style="color:var(--accent-orange)">超限神识 ' + (natalDriveCost > 0 ? ((typeof formatNumber === 'function' ? formatNumber(natalDriveCost) : String(natalDriveCost)) + '点/场') : ((typeof formatNatalPercent === 'function' ? formatNatalPercent(item.driveCostPercent) : item.driveCostPercent) + '%')) + '</span>'
            : '';
        wearHtml = '<span class="equip-wear-badge">本命 · 吞噬 ' + (item.devourCount || 0) + ' 次</span>' + natalDrive;
    }
    var metaHtml = (typeof buildEquipInlineMetaHtml === 'function') ? buildEquipInlineMetaHtml(item) : '';
    return '<div class="equip-slot has-item rarity-' + (item.rarity || 1) + '" id="craftEquipSlot-' + escCraft(type) + '" data-item-id="' + (item.id || '') + '" onclick="handleCraftAspectSlotClick(\'' + escCraftJs(type) + '\')">' +
        '<span class="slot-name">' + escCraft(name) + '</span>' +
        '<div class="equip-info"><span class="equip-name-text" style="color:var(--rarity-' + (item.rarity || 1) + ')">' + escCraft(item.name || '') + '</span>' + metaHtml + wearHtml + '</div>' +
        '</div>';
}

function renderCraftAspectPanel() {
    var panel = document.getElementById('craftAspectPanel');
    if (!panel) return;
    var overlay = document.getElementById('alchemyOverlay');
    var visible = overlay && !overlay.classList.contains('hidden') && currentCraftingTab === 'aspect';
    if (!visible) return;

    if (!Array.isArray(_equipGridCache) && typeof loadEquipGridSummary === 'function') {
        loadEquipGridSummary(false);
    }
    if (!_natalArtifactCache && !_natalArtifactPending && typeof loadNatalArtifactSlot === 'function') {
        loadNatalArtifactSlot();
    }

    var equippedItems = {};
    var gridItems = Array.isArray(_equipGridCache)
        ? _equipGridCache
        : (typeof buildEquipGridItemsFromInventory === 'function' ? buildEquipGridItemsFromInventory(_inventoryCache) : []);
    (gridItems || []).forEach(function (item) {
        var safeType = (item.type || '').toLowerCase();
        if (['weapon', 'armor', 'accessory', 'ring', 'furnace'].indexOf(safeType) !== -1) equippedItems[safeType] = item;
    });

    var slotHtml = ['weapon', 'armor', 'accessory', 'ring', 'furnace'].map(function (type) {
        return buildCraftAspectSlotHtml(type, equippedItems[type]);
    }).join('');
    panel.innerHTML = '<div class="inc-panel-card craft-aspect-panel">' +
        '<div class="inc-section">' +
        '<div class="inc-section-title">法相穿搭</div>' +
        '<div class="equip-grid craft-aspect-grid">' + slotHtml + '</div>' +
        '<div class="craft-aspect-actions">' +
        buildCraftButton('一键换装', 'btn-craft-sm', craftCall('openEquipLoadoutModal')) +
        buildCraftButton('一键修复', 'btn-craft-sm btn-quickbuy', craftCall('repairAllEquipment')) +
        '</div>' +
        '</div>' +
        '<div class="inc-section">' +
        '<div class="inc-section-title">本命养炼</div>' +
        '<div id="craftNatalArtifactSlot" class="natal-artifact-slot"></div>' +
        '</div>' +
        '</div>';
    if (typeof renderNatalArtifactSlot === 'function') {
        renderNatalArtifactSlot(_natalArtifactCache || { exists: false, playerStage: 0 });
    }
}

function handleCraftAspectSlotClick(type) {
    if (typeof handleEquipSlotClick === 'function') handleEquipSlotClick(type, 'craft');
}

function renderIncarnationCraftPanel(status) {
    var panel = document.getElementById('incarnationCraftPanel');
    if (!panel) return;
    _currentIncarnationStatus = status || null;
    if (!status) {
        panel.style.display = 'none';
        panel.innerHTML = '';
        return;
    }

    if (!status.realmUnlocked) {
        panel.innerHTML = '<div class="inc-panel-card">' +
            renderIncarnationHero(status, {
                stateClass: 'inc-hero--locked',
                kicker: '化身名牒 · 未开卷',
                titleHtml: '身外化身',
                subtitle: '化神期解锁，可分担炼丹、炼器、制符的灵力与神识消耗。',
                actionsHtml: buildCraftButton('化神期解锁', '', null, { disabled: true })
            }) +
            renderIncarnationGuideCards(status) +
            '</div>';
        panel.style.display = 'block';
        return;
    }

    if (!status.isCondensed) {
        var condenseLack = (status.condenseMaterials || []).some(function (m) { return m.have < m.need; });
        var condenseQuickBtn = condenseLack
            ? '<div class="inc-inline-actions">' + buildCraftButton('一键补齐', 'btn-quickbuy', craftCall('quickBuyMats', ['incarnation_condense', '', rawCraftArg('this'), 1])) + '</div>'
            : '';
        panel.innerHTML = '<div class="inc-panel-card">' +
            renderIncarnationHero(status, {
                stateClass: 'inc-hero--forming',
                kicker: '化身名牒 · 待凝练',
                titleHtml: '身外化身',
                subtitle: '尚未凝练。凝成后将以' + escCraft(status.realmName || '化神期前期') + '白板一半的面板代你持炉演法。',
                metaHtml: renderIncarnationMetaPill('起始面板', '化神白板 50%'),
                actionsHtml: buildCraftButton('凝练化身', '', status.canCondense ? craftCall('condenseIncarnation') : null, { disabled: !status.canCondense })
            }) +
            renderIncarnationSection('凝练所需',
                '<div class="inc-cost-line">凝练消耗：' + (status.condenseStoneCost || 0) + ' 灵石</div>' +
                renderIncarnationMaterials(status.condenseMaterials, '暂无额外材料') +
                condenseQuickBtn,
                'inc-section--materials') +
            renderIncarnationGuideCards(status) +
            '</div>';
        panel.style.display = 'block';
        return;
    }

    var refineAtMax = (status.refineLevel || 0) >= (status.maxRefineLevel || 0);
    var refineLack = (status.refineMaterials || []).some(function (m) { return m.have < m.need; });
    var refineQuickBtn = (!refineAtMax && refineLack)
        ? '<div class="inc-inline-actions">' + buildCraftButton('一键补齐', 'btn-quickbuy', craftCall('quickBuyMats', ['incarnation_refine', '', rawCraftArg('this'), 1])) + '</div>'
        : '';
    var refineBtnText = refineAtMax ? '已至上限' : '祭炼化身';
    var recovery = status.recovery || {};
    var preview = status.nextRefinePreview;

    var btBtn = status.atPlayerRealmCap
        ? buildCraftButton('已至本体同阶', '', null, { disabled: true, title: '化身境界不得超越本体' })
        : (status.canBreakthrough
            ? buildCraftButton('突破', '', craftCall('breakthroughIncarnation'))
            : buildCraftButton('突破', '', null, { disabled: true, title: '化身修为不足' }));
    var cultPillBtn = buildCraftButton('服用修为丹', 'btn-batch', craftCall('openIncarnationPillPicker'));
    var titleHtml = escCraft(status.name || '身外化身') +
        buildCraftButton('改名', 'btn-craft-sm btn-batch', craftCall('renameIncarnation'));

    panel.innerHTML = '<div class="inc-panel-card">' +
        renderIncarnationHero(status, {
            stateClass: 'inc-hero--ready',
            kicker: '化身名牒 · 已入册',
            titleHtml: titleHtml,
            subtitle: '持炉演法，优先分担炼造时的灵力与神识消耗。',
            metaHtml: joinCraftHtml([
                renderIncarnationMetaPill('境界', status.realmName || '化神期前期'),
                renderIncarnationMetaPill('祭炼', (status.refineLevel || 0) + '/' + (status.maxRefineLevel || 0)),
                renderIncarnationMetaPill('成长', '+' + (status.bonusPercent || 0) + '%')
            ]),
            actionsHtml: buildCraftActionGroup([
                buildCraftButton(refineBtnText, '', status.canRefine ? craftCall('refineIncarnation') : null, { disabled: !status.canRefine }),
                btBtn
            ]),
            extraHtml: renderIncarnationRefineInlineCard(status, refineQuickBtn, preview)
        }) +
        (status.atPlayerRealmCap
            ? renderIncarnationSection('', '<div class="inc-cost-line inc-cost-line--muted">化身修为 ' + (status.cultivation || 0) + ' · 已至本体同阶，待本体破境后方可再进</div>', 'inc-section--cultivation')
            : renderIncarnationResourceBar('化身修为', status.cultivation || 0, status.cultivationNeeded || 0, 'inc-res-fill--spirit')) +
        '<div class="inc-inline-actions">' + cultPillBtn + '</div>' +
        renderIncarnationSection('战斗面板', renderIncarnationVitals(status), 'inc-section--vitals') +
        renderIncarnationEquipSection(status) +
        renderIncarnationCustomSkillSection(status) +
        renderIncarnationSection('炼造资源',
            '<label class="inc-craft-toggle" style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-secondary);margin-bottom:8px;cursor:pointer;">' +
                '<input type="checkbox" ' + (status.craftEnabled ? 'checked' : '') +
                    ' onchange="toggleIncarnationCraftDelegation(this.checked)" />' +
                '<span>化身<b style="color:var(--text-gold);">掌炉</b>：' +
                    (status.craftEnabled
                        ? '由化身代行炼造，本体冥想中亦可开炉'
                        : '本体亲自掌炉，炼造耗本体灵力/神识，冥想中无法开炉') +
                '</span>' +
            '</label>' +
            renderIncarnationResourceBar('化身灵力', status.mp || 0, status.maxMp || 0, 'inc-res-fill--mp') +
            renderIncarnationResourceBar('化身神识', status.spirit || 0, status.maxSpirit || 0, 'inc-res-fill--spirit') +
            renderIncarnationRecoveryGrid(recovery),
            'inc-section--resources') +
        renderIncarnationCraftStatsCard(status) +
        renderIncarnationGuideCards(status) +
        '</div>';
    panel.style.display = 'block';
    if (typeof loadIncarnationCustomSkills === 'function') {
        loadIncarnationCustomSkills();
    }
}

var INC_SLOT_LABELS = { weapon: '兵刃', armor: '护甲', accessory: '饰物' };

function buildIncarnationEquipBadges(eq) {
    var badges = '';
    if (eq.refineLevel > 0) badges += '<span class="refine-badge">+' + eq.refineLevel + '</span>';
    if (eq.isNatal) badges += '<span class="natal-badge">[本命]</span>';
    return badges;
}

function buildIncarnationAffixHtml(eq, inline) {
    if (!eq || !eq.extension) return '';
    try {
        var ext = JSON.parse(eq.extension);
        if (ext && ext.affix && ext.affix.name) {
            return inline
                ? '<span class="inc-equip-affix inc-equip-affix--inline">【先天·' + escCraft(ext.affix.name) + '】</span>'
                : '<div class="inc-equip-affix">【先天·' + escCraft(ext.affix.name) + '】</div>';
        }
    } catch (e) {}
    return '';
}

function effectiveIncarnationEquipStats(eq) {
    if (!eq) return eq;
    return Object.assign({}, eq, {
        attackBonus: incarnationNum(eq.effectiveAttackBonus || eq.attackBonus),
        defenseBonus: incarnationNum(eq.effectiveDefenseBonus || eq.defenseBonus),
        hpBonus: incarnationNum(eq.effectiveHpBonus || eq.hpBonus),
        spiritBonus: incarnationNum(eq.effectiveSpiritBonus || eq.spiritBonus)
    });
}

function buildIncarnationInscriptionBonusText(eq) {
    var parts = [];
    var atk = incarnationNum(eq && eq.inscriptionAttackBonus);
    var def = incarnationNum(eq && eq.inscriptionDefenseBonus);
    var hp = incarnationNum(eq && eq.inscriptionHpBonus);
    var spirit = incarnationNum(eq && eq.inscriptionSpiritBonus);
    if (atk) parts.push('攻 +' + incarnationFormat(atk));
    if (def) parts.push('防 +' + incarnationFormat(def));
    if (hp) parts.push('血 +' + incarnationFormat(hp));
    if (spirit) parts.push('神 +' + incarnationFormat(spirit));
    return parts.length ? '<div class="inc-equip-affix">天纹加成：' + parts.join('　') + '</div>' : '';
}

function renderIncarnationEquipSection(status) {
    if (!status || !status.isCondensed) return '';
    var eqMap = {};
    (status.equipment || []).forEach(function (e) { eqMap[e.slot] = e; });
    var slots = ['weapon', 'armor', 'accessory'];
    var cells = slots.map(function (s) {
        var eq = eqMap[s];
        if (eq && eq.itemId) {
            var displayEq = effectiveIncarnationEquipStats(eq);
            var statsHtml = (typeof buildStatsHtml === 'function') ? buildStatsHtml(displayEq) : '';
            var statText = statsHtml ? '<div class="inc-equip-stats">' + statsHtml + '</div>' : '';
            var badges = buildIncarnationEquipBadges(eq);
            var affixHtml = buildIncarnationAffixHtml(eq);
            var inscBonusHtml = buildIncarnationInscriptionBonusText(eq);
            var inscHtml = (typeof formatInscriptionsHtml === 'function') ? formatInscriptionsHtml(eq) : '';
            var inscBlock = inscHtml ? '<div class="inc-equip-inscriptions">' + inscHtml + '</div>' : '';
            return '<div class="inc-equip-cell inc-equip-cell--filled">' +
                '<div class="inc-equip-slot-label">' + (INC_SLOT_LABELS[s] || s) + '</div>' +
                '<div class="inc-equip-name rarity-' + (eq.rarity || 1) + '">' + escCraft(eq.name) + badges + '</div>' +
                statText +
                affixHtml +
                inscBonusHtml +
                inscBlock +
                '<div class="inc-equip-actions">' +
                    '<button type="button" class="inc-equip-mini-btn inc-equip-mini-btn--orange" onclick="' + escCraft(craftCall('openIncarnationRefinePanel', [eq.itemId])) + '">祭炼</button>' +
                    '<button type="button" class="inc-equip-mini-btn inc-equip-mini-btn--purple" onclick="' + escCraft(craftCall('openIncarnationInscriptionPanel', [eq.itemId])) + '">铭文</button>' +
                    '<button type="button" class="inc-equip-mini-btn inc-equip-mini-btn--danger" onclick="' + escCraft(craftCall('unequipIncarnationSlot', [s])) + '">卸下</button>' +
                '</div>' +
                '</div>';
        }
        return '<button type="button" class="inc-equip-cell inc-equip-cell--empty" onclick="' + escCraft(craftCall('openIncarnationEquipPicker', [s])) + '">' +
            '<div class="inc-equip-slot-label">' + (INC_SLOT_LABELS[s] || s) + '</div>' +
            '<div class="inc-equip-empty-text">空</div>' +
            '<div class="inc-equip-hint">点击装备</div>' +
            '</button>';
    });
    var toolbar =
        '<div class="inc-equip-toolbar">' +
            buildCraftButton('本体互换', 'btn-craft-sm btn-batch', craftCall('swapIncarnationBodyEquipment')) +
        '</div>';
    return renderIncarnationSection('化身装备', toolbar + '<div class="inc-equip-grid">' + cells.join('') + '</div>', 'inc-section--equip');
}

function renderIncarnationCustomSkillSection(status) {
    if (!status || !status.isCondensed) return '';
    var toolbar =
        '<div class="inc-equip-toolbar">' +
            buildCraftButton('创建化身技能', 'btn-craft-sm btn-batch', craftCall('showCreateCustomSkill', ['incarnation'])) +
        '</div>';
    var body =
        toolbar +
        '<div class="inc-section-note" style="margin-bottom:8px;">化身拥有独立自创技能池，消耗本体储物中的空白卷轴与洗炼石，最多装备 1 门参与化身护道；不触发本源共鸣。</div>' +
        '<div id="incarnationCustomSkillList" class="technique-list">' +
            '<p class="technique-empty">正在感应化身术法...</p>' +
        '</div>';
    return renderIncarnationSection('化身自创技能', body, 'inc-section--custom-skill');
}

function openIncarnationRefinePanel(itemId) {
    if (typeof showRefinePanel !== 'function') {
        showToast('祭炼功能暂不可用');
        return;
    }
    showRefinePanel(itemId);
}

function openIncarnationInscriptionPanel(itemId) {
    if (typeof showInscriptionPanel !== 'function') {
        showToast('铭文功能暂不可用');
        return;
    }
    showInscriptionPanel(itemId);
}

async function openIncarnationEquipPicker(slot) {
    var res = await api.get('/api/game/incarnation/available-equip?slot=' + slot);
    var list = (res && res.data) || [];
    var label = INC_SLOT_LABELS[slot] || slot;
    if (!list.length) {
        showToast('背包中没有可装备的' + label);
        return;
    }
    var rows = list.map(function (item) {
        var statsHtml = (typeof buildStatsHtml === 'function') ? buildStatsHtml(item) : '';
        var statText = statsHtml ? '<span class="modal-action-btn__cost craft-dialog-choice__stats">' + statsHtml + '</span>' : '';
        var badges = buildIncarnationEquipBadges(item);
        var affixHtml = buildIncarnationAffixHtml(item, true);
        var inscHtml = (typeof formatInscriptionsHtml === 'function') ? formatInscriptionsHtml(item) : '';
        var inscBlock = inscHtml ? '<span class="craft-dialog-choice__inscriptions">' + inscHtml + '</span>' : '';
        var extras = (affixHtml || inscBlock)
            ? '<span class="craft-dialog-choice__extra">' + affixHtml + inscBlock + '</span>'
            : '';
        return '<button type="button" class="modal-action-btn craft-dialog-choice craft-dialog-choice--equip inc-equip-picker-option" ' +
            'onclick="doEquipIncarnation(' + item.itemId + ')">' +
            '<span class="craft-dialog-choice__main">' +
                '<span class="modal-action-btn__text rarity-' + (item.rarity || 1) + '">' + escCraft(item.name) + badges + '</span>' +
                statText +
            '</span>' +
            extras +
            '</button>';
    }).join('');
    showCraftDialog({
        subtitle: '装备' + escCraft(label),
        descHtml: '化身穿戴',
        bodyHtml: '<div class="modal-info-card craft-dialog-summary inc-equip-picker-summary">选择一件装备给化身穿戴。当前槽位已有装备时将自动替换。<span>' + list.length + ' 件可选</span></div>' +
            '<div class="modal-action-list craft-dialog-list craft-dialog-list--equip inc-equip-picker-list">' + rows + '</div>',
        bodyClass: 'inc-equip-picker-body',
        extraClass: 'inc-equip-picker-modal',
        actionsHtml: '<button class="modal-btn modal-btn--outline modal-btn--full" onclick="closeModal()">取 消</button>'
    });
}

async function doEquipIncarnation(itemId) {
    var btns = document.querySelectorAll('.btn-craft');
    btns.forEach(function (b) { b.disabled = true; });
    try {
        var res = await api.post('/api/game/incarnation/equip', { itemId: itemId });
        closeModal();
        showToast((res.data && res.data.message) || res.message || '装备完成');
        if (res.code === 200) {
            if (!applyIncarnationStatusUpdate(res.data && res.data.status)) openCrafting(currentCraftingTab);
            loadInventory();
        }
    } finally {
        btns.forEach(function (b) { b.disabled = false; });
    }
}

async function unequipIncarnationSlot(slot) {
    var ok = await craftConfirmAsync('确认从化身卸下该装备？', { subtitle: '卸下化身装备', confirmText: '确认卸下' });
    if (!ok) return;
    var btns = document.querySelectorAll('.btn-craft');
    btns.forEach(function (b) { b.disabled = true; });
    try {
        var res = await api.post('/api/game/incarnation/unequip', { slot: slot });
        showToast((res.data && res.data.message) || res.message || '已卸下');
        if (res.code === 200) {
            if (!applyIncarnationStatusUpdate(res.data && res.data.status)) openCrafting(currentCraftingTab);
            loadInventory();
        }
    } finally {
        btns.forEach(function (b) { b.disabled = false; });
    }
}

async function swapIncarnationBodyEquipment() {
    var ok = await craftConfirmAsync('确认互换本体与化身当前穿戴的武器、防具、饰品？\n\n须弥戒和炼丹炉不会参与互换。', { subtitle: '互换装备', confirmText: '确认互换' });
    if (!ok) return;
    var btns = document.querySelectorAll('.btn-craft');
    btns.forEach(function (b) { b.disabled = true; });
    try {
        var res = await api.post('/api/game/incarnation/swap-equipment', {});
        showToast((res.data && res.data.message) || res.message || '互换完成');
        if (res.code === 200) {
            if (!applyIncarnationStatusUpdate(res.data && res.data.status)) openCrafting(currentCraftingTab);
            if (typeof loadEquipGridSummary === 'function') loadEquipGridSummary(true);
            if (typeof loadInventory === 'function') loadInventory();
            if (typeof loadPlayerInfo === 'function') loadPlayerInfo();
        }
    } finally {
        btns.forEach(function (b) { b.disabled = false; });
    }
}

async function refreshIncarnationStatusPanel() {
    if (currentCraftingTab !== 'incarnation') return;
    var overlay = document.getElementById('alchemyOverlay');
    if (!overlay || overlay.classList.contains('hidden')) return;
    try {
        var res = await api.get('/api/game/incarnation/status');
        if (res.code === 200 && res.data) applyIncarnationStatusUpdate(res.data);
    } catch (e) {}
}

async function renameIncarnation() {
    var currentName = (_currentIncarnationStatus && _currentIncarnationStatus.name) || '身外化身';
    var maxNameLength = (_currentIncarnationStatus && _currentIncarnationStatus.maxNameLength) || 8;
    var name = await craftPromptAsync('为身外化身赐名（1-' + maxNameLength + '字）：', currentName, { maxlength: maxNameLength });
    if (name == null) return;

    var btns = document.querySelectorAll('.btn-craft');
    btns.forEach(function (b) { b.disabled = true; });
    try {
        var res = await api.post('/api/game/incarnation/rename', { name: name });
        showToast((res.data && res.data.message) || res.message || '改名完成');
        if (res.code === 200 && !applyIncarnationStatusUpdate(res.data && res.data.status)) openCrafting(currentCraftingTab);
    } finally {
        btns.forEach(function (b) { b.disabled = false; });
    }
}

async function condenseIncarnation() {
    var btns = document.querySelectorAll('.btn-craft');
    btns.forEach(function (b) { b.disabled = true; });
    try {
        var res = await api.post('/api/game/incarnation/condense', {});
        showToast((res.data && res.data.message) || res.message || '凝练完成');
        if (res.code === 200 && !applyIncarnationStatusUpdate(res.data && res.data.status)) openCrafting(currentCraftingTab);
        loadPlayerInfo();
        loadInventory();
    } finally {
        btns.forEach(function (b) { b.disabled = false; });
    }
}

async function refineIncarnation() {
    var btns = document.querySelectorAll('.btn-craft');
    btns.forEach(function (b) { b.disabled = true; });
    try {
        var res = await api.post('/api/game/incarnation/refine', {});
        showToast((res.data && res.data.message) || res.message || '祭炼完成');
        if (res.code === 200 && !applyIncarnationStatusUpdate(res.data && res.data.status)) openCrafting(currentCraftingTab);
        loadPlayerInfo();
        loadInventory();
    } finally {
        btns.forEach(function (b) { b.disabled = false; });
    }
}

async function breakthroughIncarnation() {
    var ok = await craftConfirmAsync('化身将尝试突破至下一境界，消耗化身修为。确认继续？', { subtitle: '化身突破', confirmText: '继续突破' });
    if (!ok) return;
    var btns = document.querySelectorAll('.btn-craft');
    btns.forEach(function (b) { b.disabled = true; });
    try {
        var res = await api.post('/api/game/incarnation/breakthrough', {});
        showToast((res.data && res.data.message) || res.message || '突破完成');
        if (res.code === 200 && !applyIncarnationStatusUpdate(res.data && res.data.status)) openCrafting(currentCraftingTab);
    } finally {
        btns.forEach(function (b) { b.disabled = false; });
    }
}

async function openIncarnationPillPicker() {
    var res = await api.get('/api/game/incarnation/cultivation-pills');
    var list = (res && res.data) || [];
    if (!list.length) {
        showToast('背包内没有修为丹药');
        return;
    }
    list.sort(function (a, b) {
        var ra = a.rarity || 0, rb = b.rarity || 0;
        if (rb !== ra) return rb - ra;
        return escCraft(a.name).localeCompare(escCraft(b.name));
    });
    var rows = list.map(function (p) {
        var rarityCls = 'rarity-' + (p.rarity || 1);
        var qty = Math.max(1, parseInt(p.quantity, 10) || 1);
        var inputId = 'incarnationPillQty_' + p.itemId;
        return '<div class="modal-action-btn craft-dialog-choice craft-dialog-choice--compact" style="height:auto;min-height:48px;display:grid;grid-template-columns:minmax(0,1fr) 88px 64px;gap:8px;align-items:center;">' +
            '<span class="modal-action-btn__text ' + rarityCls + '">' + escCraft(p.name) + '<small style="display:block;color:var(--text-muted);font-size:11px;font-weight:400;">' + escCraft(p.category) + ' · 库存 ' + qty + '</small></span>' +
            '<input type="number" inputmode="numeric" pattern="[0-9]*" min="1" max="' + qty + '" step="1" value="1" id="' + inputId + '" class="app-input" style="height:32px;text-align:center;padding:4px 6px;" onclick="event.stopPropagation()">' +
            '<button type="button" class="btn-action" style="height:32px;padding:0 10px;font-size:12px;" onclick="doConsumeIncarnationPillFromInput(' + p.itemId + ', \'' + inputId + '\')">服用</button>' +
            '</div>';
    }).join('');
    showCraftDialog({
        subtitle: '化身服药',
        descHtml: '丹药修为将 1:1 计入化身修为',
        bodyHtml: '<div class="modal-info-card craft-dialog-summary">输入数量后服用指定修为丹，也可一键吸纳全部。</div>' +
            '<div class="modal-action-list craft-dialog-list">' + rows + '</div>',
        actionsHtml: '<button class="modal-btn modal-btn--outline" onclick="closeModal()">取 消</button>' +
            '<button class="modal-btn modal-btn--gold" onclick="doConsumeIncarnationPillAll()">一键服用</button>'
    });
}

function doConsumeIncarnationPillFromInput(itemId, inputId) {
    var input = document.getElementById(inputId);
    var max = parseInt(input && input.max, 10);
    var qty = parseInt(input && input.value, 10);
    if (!Number.isFinite(qty) || qty < 1) qty = 1;
    if (Number.isFinite(max) && max > 0) qty = Math.min(qty, max);
    if (input) input.value = qty;
    doConsumeIncarnationPill(itemId, qty);
}

async function doConsumeIncarnationPill(itemId, quantity) {
    closeModal();
    if (!itemId) return;
    var qty = Math.max(1, parseInt(quantity, 10) || 1);
    try {
        var r = await api.post('/api/game/incarnation/consume-pill', { itemId: itemId, quantity: qty });
        showToast((r.data && r.data.message) || r.message || '服药完成');
        if (r.code === 200) {
            if (!applyIncarnationStatusUpdate(r.data && r.data.status)) openCrafting(currentCraftingTab);
            loadInventory();
        }
    } catch (e) {
        showToast(e.message || '服药失败');
    }
}

async function doConsumeIncarnationPillAll() {
    closeModal();
    try {
        var r = await api.post('/api/game/incarnation/consume-pill-all', {});
        showToast((r.data && r.data.message) || r.message || '服药完成');
        if (r.code === 200) {
            if (!applyIncarnationStatusUpdate(r.data && r.data.status)) openCrafting(currentCraftingTab);
            loadInventory();
        }
    } catch (e) {
        showToast(e.message || '服药失败');
    }
}

// ===== 炼丹系统 =====

var PILL_CATEGORY_NAMES = {
    'HEAL_HP': '回血丹药', 'HEAL_MP': '回灵丹药', 'HEAL_SPIRIT': '回神识丹药',
    'BREAKTHROUGH': '突破丹药',
    'COMBAT_ATK': '战斗丹(攻)', 'COMBAT_DEF': '战斗丹(防)',
    'SPECIAL_ANTIDOTE': '解毒丹', 'SPECIAL_PERMANENT_HP': '永久HP丹',
    'SPECIAL_PERMANENT_ATK': '永久攻击丹', 'SPECIAL_MEDITATION': '清心丹',
    'SPECIAL_FIVE_ROOT': '五行通灵丹',
    'ENCOUNTER_BOOST': '招妖丹药', 'ENCOUNTER_REPEL': '避妖丹药',
    'RESTORE_LIFESPAN': '延寿丹药',
    'INCARNATION_CULTIVATION': '化身修为丹药',
    'PET_HEAL_HP': '灵兽丹药', 'PET_HEAL_MP': '灵兽丹药', 'PET_HEAL_BOTH': '灵兽丹药', 'PET_CULTIVATION': '灵兽丹药'
};

async function openAlchemy(options) {
    var opts = options || {};
    var forceRefresh = !!opts.forceRefresh;
    var backgroundRefresh = !!opts.backgroundRefresh;
    currentCraftingTab = 'alchemy';
    var requestSeq = nextCraftOpenRequest();
    if (!backgroundRefresh) {
        showCraftRecipeLoading('alchemy', '正在读取丹方与材料状态...');
    }
    var res = await getCraftRecipesCached('alchemy', '/api/game/alchemy/recipes', forceRefresh);
    if (!isCraftOpenRequestCurrent(requestSeq, 'alchemy')) return;
    if (res.code !== 200) {
        if (backgroundRefresh) {
            handleCraftBackgroundRefreshError('alchemy', res.message || '丹方材料同步失败');
            return;
        }
        closeAlchemy();
        showToast(res.message || '练气期以上方可炼丹');
        return;
    }
    var data = res.data;
    var overlay = document.getElementById('alchemyOverlay');
    showCraftRecipeLayout();

    // 炉子信息卡
    var spiritWarnText = data.furnace
        ? (data.spiritLow ? '神识虚弱，极品率降低' : '每次炼丹按丹方境界扣除固定神识')
        : '未装备炼丹炉，请前往储物装备';
    var masteryHtml = '';
    if (data.furnace) {
        var lvl = data.alchemyMasteryLevel || 0;
        masteryHtml = buildMasteryHtml('丹道', lvl, !!data.masteryMaxLevel,
            data.masteryExpInLevel, data.masteryExpForNext,
            'showAlchemyMasteryModal(' + lvl + ')');
    }
    setCraftFurnaceCard({
        name: data.furnace ? escCraft(data.furnace) : '未装备炼丹炉',
        actionsHtml: data.furnace ? buildFurnaceActionsHtml() : '',
        chancesHtml: data.furnace ? buildChancesHtml(data.gradeChances) : '',
        influenceHtml: data.furnace ? buildCraftInfluenceHtml(data.influenceItems) : '',
        spiritWarnText: spiritWarnText,
        spiritWarnDanger: !!data.spiritLow,
        masteryHtml: masteryHtml
    });

    // 分组渲染
    var grouped = {};
    var pinnedWishHtml = '';
    data.recipes.slice().sort(compareCraftRecipesByRealm).forEach(function (r) {
        var cat = r.isBlueprint ? '秘传图纸' : (PILL_CATEGORY_NAMES[r.category] || r.category);
        var isWishTarget = isCraftWishTargetRecipe('alchemy', r, data.wishItemId);

        var btnHtml = '';
        if (r.canCraft) {
            btnHtml = buildCraftActionGroup([
                buildCraftButton('炼制', '', craftCall('craftPill', [r.pillId])),
                buildCraftButton('×N', 'btn-batch', craftCall('batchCraftPill', [r.pillId, r.pillName]), { title: '批量炼制' })
            ]);
            if (r.canQuickBuy) {
                btnHtml += buildCraftButton('补充(' + r.quickBuyCost + ')', 'btn-quickbuy', craftCall('quickBuyMats', ['alchemy', r.pillId, rawCraftArg('this')]));
            }
        } else if (r.disableReason === 'stage_low') {
            btnHtml = buildCraftButton(r.unlockStageName || '境界不足', '', null, { disabled: true });
        } else if (r.disableReason === 'furnace_low') {
            btnHtml = buildCraftButton('炉子等级不足', '', null, { disabled: true });
        } else if (r.disableReason === 'need_furnace') {
            btnHtml = buildCraftButton('需炼丹炉', '', null, { disabled: true });
        } else if (r.disableReason === 'no_mp') {
            btnHtml = buildCraftButton('灵力不足', '', null, { disabled: true });
        } else if (r.disableReason === 'no_materials' && r.canQuickBuy) {
            btnHtml = buildCraftButton('补充(' + r.quickBuyCost + ')', 'btn-quickbuy', craftCall('quickBuyMats', ['alchemy', r.pillId, rawCraftArg('this')]));
        } else {
            btnHtml = buildCraftButton('材料不足', '', null, { disabled: true });
        }

        var html = buildCraftCardHtml({
            name: r.pillName,
            isBlueprint: r.isBlueprint,
            disabled: !r.canCraft,
            extraClass: isWishTarget ? 'craft-card--wish-target' : '',
            extraBadgesHtml: isWishTarget ? buildWishTargetBadgeHtml(data.wishProgress) : '',
            kindLabel: r.isBlueprint ? '秘传丹方' : '丹方',
            typeLabel: cat,
            mpCost: r.mpCost,
            spiritCost: r.spiritCost,
            descHtml: buildRecipeDescHtml('药性', getAlchemyDescriptionFallback(r)),
            matsHtml: buildMatsHtml(r.materials),
            btnHtml: btnHtml
        });
        if (isWishTarget) {
            pinnedWishHtml = html;
        } else {
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push({ html: html });
        }
    });

    renderCraftRecipes('alchemy', grouped, pinnedWishHtml);
    overlay.classList.remove('hidden');
    renderWishBar(data, data.recipes);
    setCraftingTabActive('alchemy');
}

function closeAlchemy() {
    document.getElementById('alchemyOverlay').classList.add('hidden');
}

function showAlchemyMasteryModal(lvl) {
    if (typeof showModal !== 'function') return;
    var html = '<div class="modal-info-card modal-info-card--jade">' +
        '<div class="modal-info-card__title modal-info-card__title--jade">✦ 每级特权</div>' +
        '<div class="modal-feat-list">' +
        '<div class="modal-feat-row"><span class="modal-feat-icon modal-feat-icon--jade">◈</span><span>神识与手续费消耗 <b style="color:var(--text-jade);">-5%</b></span></div>' +
        '<div class="modal-feat-row"><span class="modal-feat-icon modal-feat-icon--jade">◈</span><span>触发双出丹几率 <b style="color:var(--text-jade);">+1.5%</b></span></div>' +
        '</div>' +
        '</div>' +
        '<div class="modal-info-card">' +
        '<div class="modal-info-card__title">✦ 当前加成</div>' +
        '<div class="modal-feat-list">' +
        '<div class="modal-feat-row"><span class="modal-feat-icon modal-feat-icon--jade">◈</span><span>神识/手续费减免: <b style="color:var(--text-jade);">-' + (lvl * 5) + '%</b></span></div>' +
        '<div class="modal-feat-row"><span class="modal-feat-icon modal-feat-icon--jade">◈</span><span>双出丹几率: <b style="color:var(--text-jade);">' + (lvl * 1.5).toFixed(1) + '%</b></span></div>' +
        '</div>' +
        '</div>';
    showCraftDialog({
        subtitle: '丹道特权详情',
        valueHtml: '<span class="modal-header-deco__num">Lv.' + lvl + '</span>',
        descHtml: '通过查阅丹方、升起炉火，你对丹道的理解日益加深。',
        bodyHtml: html,
        actionsHtml: '<button class="modal-btn modal-btn--outline modal-btn--full" onclick="closeModal()">关闭</button>'
    });
}

function showDecoratedModal(title, bodyHtml) {
    showCraftDialog({
        subtitle: title,
        bodyHtml: bodyHtml,
        bodyClass: 'craft-mastery-dialog',
        actionsHtml: '<button class="modal-btn modal-btn--outline modal-btn--full" onclick="closeModal()">关闭</button>'
    });
}

function showForgeMasteryModal(lvl) {
    var gradeExp = [
        {name: '普通', exp: 5, cls: 'rarity-1'},
        {name: '优良', exp: 7, cls: 'rarity-2'},
        {name: '稀有', exp: 9, cls: 'rarity-3'},
        {name: '史诗', exp: 13, cls: 'rarity-4'},
        {name: '传说', exp: 15, cls: 'rarity-5'}
    ];
    var cumulatives = [0, 100, 300, 700, 1500, 3100, 6300, 12700, 25500, 51100, 102300];
    var levelNeeds = [0, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600, 51200];
    var gradeRows = gradeExp.map(function(g) {
        return '<span class="' + g.cls + '">' + g.name + '</span> +' + g.exp;
    }).join('&emsp;');
    var lvText = lvl >= 10 ? '满级' : ('Lv.' + lvl + ' → Lv.' + (lvl + 1));
    var nextExp = lvl < 10 ? levelNeeds[lvl + 1] : '-';
    var bonusRows = '<div class="modal-feat-row"><span class="modal-feat-icon">' + icon('sword', { size: 16 }) + '</span><div>传说概率 <span style="color:var(--text-jade);">+' + (lvl * 0.2).toFixed(1) + '%</span></div></div>' +
        '<div class="modal-feat-row"><span class="modal-feat-icon">' + icon('shield', { size: 16 }) + '</span><div>史诗概率 <span style="color:var(--text-jade);">+' + (lvl * 0.5).toFixed(1) + '%</span></div></div>' +
        '<div class="modal-feat-row"><span class="modal-feat-icon">' + icon('sparkle', { size: 16 }) + '</span><div>稀有概率 <span style="color:var(--text-jade);">+' + (lvl * 0.8).toFixed(1) + '%</span></div></div>';
    var lvRows = '';
    for (var i = 1; i <= 10; i++) {
        var cur = (i === lvl + 1 && lvl < 10) ? ' style="color:var(--text-gold);font-weight:bold"' : '';
        lvRows += '<tr' + cur + '><td>' + i + '</td><td>' + cumulatives[i] + '</td><td>' + levelNeeds[i] + '</td></tr>';
    }
    var body = '<div class="modal-info-card">' +
        '<div class="modal-info-card__title">锻造经验（按产出品质）</div>' +
        '<div style="font-size:12px;line-height:1.8;">' + gradeRows + '</div>' +
        '<div style="font-size:11px;color:var(--text-muted);margin-top:6px;">升级进度：' + lvText + '（需 ' + nextExp + ' 经验）</div>' +
        '</div>' +
        '<div class="modal-info-card">' +
        '<div class="modal-info-card__title">当前加成 (Lv.' + lvl + ')</div>' +
        '<div class="modal-feat-list">' + bonusRows + '</div>' +
        '</div>' +
        '<div class="modal-info-card">' +
        '<div class="modal-info-card__title">等级经验表</div>' +
        '<table style="width:100%;font-size:12px;border-collapse:collapse;">' +
        '<tr style="border-bottom:1px solid var(--border-color);"><th style="text-align:left;padding:3px 0;">等级</th><th style="text-align:right;padding:3px 0;">累计</th><th style="text-align:right;padding:3px 0;">本级</th></tr>' +
        lvRows +
        '</table>' +
        '</div>' +
        '<div class="modal-info-card">' +
        '<div class="modal-info-card__title">获取规则</div>' +
        '<div class="modal-feat-list">' +
        '<div class="modal-feat-row"><span class="modal-feat-icon">' + icon('hammer', { size: 16 }) + '</span><div>锻造时按产出品质获得经验</div></div>' +
        '<div class="modal-feat-row"><span class="modal-feat-icon">' + icon('warn', { size: 16 }) + '</span><div>低于角色境界2阶+不给经验，低1阶减半</div></div>' +
        '<div class="modal-feat-row"><span class="modal-feat-icon">' + icon('flag', { size: 16 }) + '</span><div>满级后不再获取经验</div></div>' +
        '</div></div>';
    showDecoratedModal('✦ 器 道 境 界 ✦', body);
}

function showTalismanMasteryModal(lvl) {
    var stageNames = ['', '练气', '筑基', '金丹', '元婴', '化神'];
    var stageExp = [0, 2, 4, 7, 12, 20];
    var gradeRows = '';
    for (var s = 1; s <= 5; s++) {
        gradeRows += '<span style="color:var(--text-muted);">' + stageNames[s] + '符</span> +' + stageExp[s];
        if (s < 5) gradeRows += '&emsp;';
    }
    var cumulatives = [0];
    var levelNeeds = [0];
    var sum = 0;
    for (var i = 1; i <= 10; i++) {
        var need = i * 100;
        levelNeeds.push(need);
        sum += need;
        cumulatives.push(sum);
    }
    var lvText = lvl >= 10 ? '满级' : ('Lv.' + lvl + ' → Lv.' + (lvl + 1));
    var nextExp = lvl < 10 ? levelNeeds[lvl + 1] : '-';
    var bonusRows = '<div class="modal-feat-row"><span class="modal-feat-icon">✓</span><div>制符成功率 <span style="color:var(--text-jade);">+' + (lvl * 2) + '%</span></div></div>' +
        '<div class="modal-feat-row"><span class="modal-feat-icon">↑</span><div>品阶偏移 <span style="color:var(--text-jade);">+' + (lvl * 2).toFixed(1) + '</span></div></div>';
    var lvRows = '';
    for (var i = 1; i <= 10; i++) {
        var cur = (i === lvl + 1 && lvl < 10) ? ' style="color:var(--text-gold);font-weight:bold"' : '';
        lvRows += '<tr' + cur + '><td>' + i + '</td><td>' + cumulatives[i] + '</td><td>' + levelNeeds[i] + '</td></tr>';
    }
    var body = '<div class="modal-info-card">' +
        '<div class="modal-info-card__title">制符经验（按配方境界）</div>' +
        '<div style="font-size:12px;line-height:1.8;">' + gradeRows + '</div>' +
        '<div style="font-size:11px;color:var(--text-muted);margin-top:6px;">升级进度：' + lvText + '（需 ' + nextExp + ' 经验）</div>' +
        '</div>' +
        '<div class="modal-info-card">' +
        '<div class="modal-info-card__title">当前加成 (Lv.' + lvl + ')</div>' +
        '<div class="modal-feat-list">' + bonusRows + '</div>' +
        '</div>' +
        '<div class="modal-info-card">' +
        '<div class="modal-info-card__title">等级经验表</div>' +
        '<table style="width:100%;font-size:12px;border-collapse:collapse;">' +
        '<tr style="border-bottom:1px solid var(--border-color);"><th style="text-align:left;padding:3px 0;">等级</th><th style="text-align:right;padding:3px 0;">累计</th><th style="text-align:right;padding:3px 0;">本级</th></tr>' +
        lvRows +
        '</table>' +
        '</div>' +
        '<div class="modal-info-card">' +
        '<div class="modal-info-card__title">获取规则</div>' +
        '<div class="modal-feat-list">' +
        '<div class="modal-feat-row"><span class="modal-feat-icon">' + icon('scroll', { size: 16 }) + '</span><div>成功制符按配方境界获得经验，失败+1</div></div>' +
        '<div class="modal-feat-row"><span class="modal-feat-icon">' + icon('warn', { size: 16 }) + '</span><div>低于角色境界2阶+不给经验</div></div>' +
        '<div class="modal-feat-row"><span class="modal-feat-icon">' + icon('flag', { size: 16 }) + '</span><div>满级后不再获取经验</div></div>' +
        '</div></div>';
    showDecoratedModal('✦ 符 道 境 界 ✦', body);
}

async function craftPill(pillId) {
    var btns = captureCraftButtonStateAndDisable();

    try {
        var res = await api.post('/api/game/alchemy/craft', { pillId: pillId });
        if (res.code === 200 && res.data) {
            var d = res.data;
            showToast(d.message);
            scheduleCraftRefresh('alchemy');
            loadPlayerInfo();
            loadInventory();
            await typewriterLog(d.message, 'alchemy', 30);
        } else {
            showToast(res.message || '炼丹失败');
        }
    } finally {
        restoreCraftButtons(btns);
    }
}

async function batchCraftPill(pillId, pillName) {
    var lastCount = parseInt(localStorage.getItem(ALCHEMY_BATCH_CRAFT_LAST_KEY), 10);
    if (isNaN(lastCount) || lastCount <= 0) lastCount = 10;
    lastCount = Math.min(lastCount, ALCHEMY_BATCH_CRAFT_CAP);

    var count = await requestAlchemyBatchCount(pillName, lastCount);
    if (!count) return;
    localStorage.setItem(ALCHEMY_BATCH_CRAFT_LAST_KEY, String(count));

    var btns = captureCraftButtonStateAndDisable();

    try {
        var res = await api.post('/api/game/alchemy/batch-craft', { pillId: pillId, count: count });
        if (res.code === 200 && res.data) {
            var d = res.data;
            showToast(d.message);
            syncCraftAfterBatchSuccess('alchemy', pillId, d, count);
            loadPlayerInfo();
            loadInventory();
            await typewriterLog(d.message, 'alchemy', 20);
        } else {
            showToast(res.message || '批量炼丹失败');
        }
    } finally {
        restoreCraftButtons(btns);
    }
}

async function quickBuyMats(type, id, btnEl, fixedAmount) {
    var amount;
    if (typeof fixedAmount === 'number' && fixedAmount > 0) {
        amount = fixedAmount;
    } else {
        var amountStr = await craftPromptAsync("请输入要补齐多少份材料：", "1", dialogIntegerInputOptions(1, null));
        if (!amountStr) return;
        amount = parseInt(amountStr);
        if (isNaN(amount) || amount <= 0) {
            showToast("数量不合法");
            return;
        }
    }

    var previewRes = await api.post('/api/game/craft/quick-buy-mats', { type: type, id: id, amount: amount, preview: true });
    if (previewRes.code === 200 && previewRes.data && previewRes.data.totalCost != null) {
        var totalEst = previewRes.data.totalCost;
        var confirmMsg = typeof fixedAmount === 'number'
            ? "预计总费用约 " + totalEst + " 灵石，确认补充？"
            : "预计总费用约 " + totalEst + " 灵石（" + amount + "份），确认补充？";
        var ok = await craftConfirmAsync(confirmMsg, { subtitle: '补齐材料', confirmText: '确认补充' });
        if (!ok) return;
    } else if (previewRes.code !== 200) {
        showToast(previewRes.message || '无法预估费用');
        return;
    }

    var btns = document.querySelectorAll('.btn-craft');
    btns.forEach(function (b) { b.disabled = true; });

    var res = await api.post('/api/game/craft/quick-buy-mats', { type: type, id: id, amount: amount });
    if (res.code === 200) {
        var msg = (res.data && res.data.message) ? res.data.message : '材料一键齐补成功！';
        showToast(msg);
        refreshCraftAfterQuickBuy(type);
        loadPlayerInfo();
        loadInventory();
    } else {
        showToast(res.message || '补充失败');
        btns.forEach(function (b) { b.disabled = false; });
    }
}

// ===== 炼造系统 tab 切换 =====

var currentCraftingTab = 'alchemy';

function openCrafting(tab, options) {
    currentCraftingTab = tab || 'alchemy';
    if (currentCraftingTab === 'forge') {
        openForge(options);
    } else if (currentCraftingTab === 'aspect') {
        openCraftAspect();
    } else if (currentCraftingTab === 'incarnation') {
        openIncarnation();
    } else if (currentCraftingTab === 'talisman') {
        openTalisman(options);
    } else {
        openAlchemy(options);
    }
}

function switchCraftingTab(tab) {
    openCrafting(tab);
}

async function openCraftAspect() {
    currentCraftingTab = 'aspect';
    var overlay = document.getElementById('alchemyOverlay');
    showCraftAspectTabLayout();
    setCraftingTabActive('aspect');
    if (overlay) overlay.classList.remove('hidden');
    if (typeof loadEquipGridSummary === 'function') loadEquipGridSummary(false);
    if (typeof loadNatalArtifactSlot === 'function') loadNatalArtifactSlot();
    renderCraftAspectPanel();
}

// ===== 炼器系统 =====

var FORGE_SLOT_NAMES = { 'weapon': '武器', 'armor': '防具', 'accessory': '饰品', 'ring': '储物戒', 'furnace': '炼丹炉' };

async function openForge(options) {
    var opts = options || {};
    var forceRefresh = !!opts.forceRefresh;
    var backgroundRefresh = !!opts.backgroundRefresh;
    currentCraftingTab = 'forge';
    var requestSeq = nextCraftOpenRequest();
    if (!backgroundRefresh) {
        showCraftRecipeLoading('forge', '正在读取器谱与材料状态...');
    }
    var res = await getCraftRecipesCached('forge', '/api/game/forge/recipes', forceRefresh);
    if (!isCraftOpenRequestCurrent(requestSeq, 'forge')) return;
    if (res.code !== 200) {
        if (backgroundRefresh) {
            handleCraftBackgroundRefreshError('forge', res.message || '器谱材料同步失败');
            return;
        }
        closeAlchemy();
        showToast(res.message || '练气期以上方可炼器');
        return;
    }
    var data = res.data;
    var overlay = document.getElementById('alchemyOverlay');
    showCraftRecipeLayout();

    var spiritWarnText = data.furnace
        ? (data.spiritLow ? '神识虚弱，极品率降低' : '每次锻造按配方境界扣除固定神识')
        : '未装备炼丹炉，请前往储物装备';
    var masteryHtml = '';
    if (data.furnace) {
        var lvl = data.forgeMasteryLevel || 0;
        masteryHtml = buildMasteryHtml('器道', lvl, !!data.masteryMaxLevel,
            data.masteryExpInLevel, data.masteryExpForNext,
            'showForgeMasteryModal(' + lvl + ')');
    }
    setCraftFurnaceCard({
        name: data.furnace ? escCraft(data.furnace) : '未装备炼丹炉',
        actionsHtml: data.furnace ? buildFurnaceActionsHtml() : '',
        chancesHtml: data.furnace ? buildChancesHtml(data.gradeChances) : '',
        influenceHtml: data.furnace ? buildCraftInfluenceHtml(data.influenceItems) : '',
        spiritWarnText: spiritWarnText,
        spiritWarnDanger: !!data.spiritLow,
        masteryHtml: masteryHtml
    });

    var grouped = {};
    var pinnedWishHtml = '';
    data.recipes.slice().sort(compareCraftRecipesByRealm).forEach(function (r) {
        var slotName = r.isBlueprint ? '秘传图纸' : (FORGE_SLOT_NAMES[r.slot] || r.slot);
        var isWishTarget = isCraftWishTargetRecipe('forge', r, data.wishItemId);

        var statTags = '';
        if (r.baseAttack > 0) statTags += '<span class="forge-stat-tag forge-stat-atk">攻+' + r.baseAttack + '</span>';
        if (r.baseDefense > 0) statTags += '<span class="forge-stat-tag forge-stat-def">防+' + r.baseDefense + '</span>';
        if (r.baseHp > 0) statTags += '<span class="forge-stat-tag forge-stat-hp">HP+' + r.baseHp + '</span>';
        if (r.baseSpirit > 0) statTags += '<span class="forge-stat-tag forge-stat-spr">神+' + r.baseSpirit + '</span>';
        if (r.baseCapacity > 0) statTags += '<span class="forge-stat-tag forge-stat-cap">容+' + r.baseCapacity + '</span>';

        var btnHtml = '';
        if (r.canForge) {
            btnHtml = buildCraftActionGroup([
                buildCraftButton('锻造', '', craftCall('forgeItem', [r.recipeId])),
                buildCraftButton('×N', 'btn-batch', craftCall('batchForgeItem', [r.recipeId, r.name]), { title: '批量锻造' })
            ]);
            if (r.canQuickBuy) {
                btnHtml += buildCraftButton('补充(' + r.quickBuyCost + ')', 'btn-quickbuy', craftCall('quickBuyMats', ['forge', r.recipeId, rawCraftArg('this')]));
            }
        } else if (r.disableReason === 'stage_low') {
            btnHtml = buildCraftButton(r.unlockStageName || '境界不足', '', null, { disabled: true });
        } else if (r.disableReason === 'furnace_low') {
            btnHtml = buildCraftButton('炉子等级不足', '', null, { disabled: true });
        } else if (r.disableReason === 'need_furnace') {
            btnHtml = buildCraftButton('需炼丹炉', '', null, { disabled: true });
        } else if (r.disableReason === 'no_mp') {
            btnHtml = buildCraftButton('灵力不足', '', null, { disabled: true });
        } else if (r.disableReason === 'no_materials' && r.canQuickBuy) {
            btnHtml = buildCraftButton('补充(' + r.quickBuyCost + ')', 'btn-quickbuy', craftCall('quickBuyMats', ['forge', r.recipeId, rawCraftArg('this')]));
        } else {
            btnHtml = buildCraftButton('材料不足', '', null, { disabled: true });
        }

        var html = buildCraftCardHtml({
            name: r.name,
            isBlueprint: r.isBlueprint,
            disabled: !r.canForge,
            extraClass: isWishTarget ? 'craft-card--wish-target' : '',
            extraBadgesHtml: isWishTarget ? buildWishTargetBadgeHtml(data.wishProgress) : '',
            kindLabel: r.isBlueprint ? '秘传器谱' : '器谱',
            typeLabel: slotName,
            mpCost: r.mpCost,
            spiritCost: r.spiritCost,
            stageBadgeHtml: buildStageBadgeHtml(r.minStage, 'forge', r.minRealmLevel),
            statTagsHtml: statTags,
            matsHtml: buildMatsHtml(r.materials),
            btnHtml: btnHtml
        });
        if (isWishTarget) {
            pinnedWishHtml = html;
        } else {
            if (!grouped[slotName]) grouped[slotName] = [];
            grouped[slotName].push({ html: html });
        }
    });

    renderCraftRecipes('forge', grouped, pinnedWishHtml);
    overlay.classList.remove('hidden');
    renderWishBar(data, data.recipes);
    setCraftingTabActive('forge');
}

async function forgeItem(recipeId) {
    var btns = document.querySelectorAll('.btn-craft');
    btns.forEach(function (b) { b.disabled = true; });

    var res = await api.post('/api/game/forge/craft', { recipeId: recipeId });
    if (res.code === 200 && res.data) {
        var d = res.data;
        showToast(d.message);
        await typewriterLog(d.message, 'forge', 30);
        scheduleCraftRefresh('forge');
        loadPlayerInfo();
    } else {
        showToast(res.message || '锻造失败');
        btns.forEach(function (b) { b.disabled = false; });
    }
}

async function batchForgeItem(recipeId, recipeName) {
    var countStr = await craftPromptAsync('批量锻造「' + recipeName + '」，请输入次数 (1-50)：', '10', dialogIntegerInputOptions(1, 50));
    if (!countStr) return;
    var count = parseInt(countStr);
    if (isNaN(count) || count <= 0) { showToast('次数不合法'); return; }
    if (count > 50) { showToast('单次批量上限50次'); return; }

    var ok = await craftConfirmAsync('将批量锻造「' + recipeName + '」' + count + ' 次，确认？', { subtitle: '批量锻造', confirmText: '开始锻造' });
    if (!ok) return;

    var btns = document.querySelectorAll('.btn-craft');
    btns.forEach(function (b) { b.disabled = true; });

    var res = await api.post('/api/game/forge/batch-craft', { recipeId: recipeId, count: count });
    if (res.code === 200 && res.data) {
        var d = res.data;
        showToast(d.message);
        syncCraftAfterBatchSuccess('forge', recipeId, d, count);
        await typewriterLog(d.message, 'forge', 20);
        loadPlayerInfo();
    } else {
        showToast(res.message || '批量锻造失败');
        btns.forEach(function (b) { b.disabled = false; });
    }
}

// ===== 制符系统 =====
var TALISMAN_CATEGORY_NAMES = { 'ATTACK': '攻伐符箓', 'DEFENSE': '防御符箓', 'UTILITY': '功能符箓' };

async function openTalisman(options) {
    var opts = options || {};
    var forceRefresh = !!opts.forceRefresh;
    var backgroundRefresh = !!opts.backgroundRefresh;
    currentCraftingTab = 'talisman';
    var requestSeq = nextCraftOpenRequest();
    if (!backgroundRefresh) {
        showCraftRecipeLoading('talisman', '正在读取符图与材料状态...');
    }
    var res = await getCraftRecipesCached('talisman', '/api/game/talisman/recipes', forceRefresh);
    if (!isCraftOpenRequestCurrent(requestSeq, 'talisman')) return;
    if (res.code !== 200) {
        if (backgroundRefresh) {
            handleCraftBackgroundRefreshError('talisman', res.message || '符图材料同步失败');
            return;
        }
        closeAlchemy();
        showToast(res.message || '练气期以上方可制符');
        return;
    }
    var data = res.data;
    var overlay = document.getElementById('alchemyOverlay');
    showCraftRecipeLayout();

    setCraftFurnaceCard({
        name: '制符无需丹炉',
        actionsHtml: '',
        chancesHtml: (data.gradeChances && data.gradeChances.length === 5) ? buildChancesHtml(data.gradeChances) : '',
        spiritWarnText: data.spiritLow ? '神识虚弱，成功率与极品率降低' : '引灵草为纸，引妖兽精血为墨；按符箓境界扣除固定神识',
        spiritWarnDanger: !!data.spiritLow,
        masteryHtml: buildMasteryHtml('符道', data.talismanMasteryLevel || 0, !!data.masteryMaxLevel,
            data.masteryExpInLevel, data.masteryExpForNext,
            'showTalismanMasteryModal(' + (data.talismanMasteryLevel || 0) + ')')
    });

    var recipes = (data.recipes || []).slice().reverse();

    var grouped = {};
    var pinnedWishHtml = '';
    recipes.forEach(function (r) {
        var cat = r.isBlueprint ? '秘传图纸' : (TALISMAN_CATEGORY_NAMES[r.category] || r.category || '其它');
        var isWishTarget = isCraftWishTargetRecipe('talisman', r, data.wishItemId);

        var btnHtml = '';
        if (r.canCraft) {
            btnHtml = buildCraftActionGroup([
                buildCraftButton('绘制', '', craftCall('craftTalisman', [r.recipeId])),
                buildCraftButton('×N', 'btn-batch', craftCall('batchCraftTalisman', [r.recipeId, r.name]), { title: '批量绘制' })
            ]);
            if (r.canQuickBuy) {
                btnHtml += buildCraftButton('补充(' + r.quickBuyCost + ')', 'btn-quickbuy', craftCall('quickBuyMats', ['talisman', r.recipeId, rawCraftArg('this')]));
            }
        } else if (r.disableReason === 'stage_low') {
            btnHtml = buildCraftButton(r.unlockStageName || '境界不足', '', null, { disabled: true });
        } else if (r.disableReason === 'no_mp') {
            btnHtml = buildCraftButton('灵力不足', '', null, { disabled: true });
        } else if (r.disableReason === 'no_materials' && r.canQuickBuy) {
            btnHtml = buildCraftButton('补充(' + r.quickBuyCost + ')', 'btn-quickbuy', craftCall('quickBuyMats', ['talisman', r.recipeId, rawCraftArg('this')]));
        } else {
            btnHtml = buildCraftButton('材料不足', '', null, { disabled: true });
        }

        var ratePct = Math.min(100, Math.max(0, typeof r.successRate === 'number' ? Math.floor(r.successRate * 100) : Math.floor((r.baseSuccessRate || 0) * 100)));
        var failPct = 100 - ratePct;
        var rateLevelCls = ratePct >= 80 ? '' : (ratePct >= 50 ? ' warn' : ' danger');
        var rateRowHtml = '<div class="recipe-rate-row">' +
            '<span class="recipe-rate-success' + rateLevelCls + '">成功 ' + ratePct + '%</span>' +
            (failPct > 0 ? '<span class="recipe-rate-fail">失败 ' + failPct + '%</span>' : '') +
            '</div>';

        var html = buildCraftCardHtml({
            name: r.name,
            isBlueprint: r.isBlueprint,
            disabled: !r.canCraft,
            extraClass: isWishTarget ? 'craft-card--wish-target' : '',
            extraBadgesHtml: isWishTarget ? buildWishTargetBadgeHtml(data.wishProgress) : '',
            kindLabel: r.isBlueprint ? '秘传符图' : '符图',
            typeLabel: cat,
            mpCost: r.mpCost,
            spiritCost: r.spiritCost,
            stageBadgeHtml: buildStageBadgeHtml(r.minStage, 'talisman'),
            descHtml: buildRecipeDescHtml('效果', r.description),
            rateRowHtml: rateRowHtml,
            matsHtml: buildMatsHtml(r.materials),
            btnHtml: btnHtml
        });
        if (isWishTarget) {
            pinnedWishHtml = html;
        } else {
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push({ html: html });
        }
    });

    renderCraftRecipes('talisman', grouped, pinnedWishHtml);
    renderWishBar(data, recipes);
    setCraftingTabActive('talisman');
    overlay.classList.remove('hidden');
}

async function craftTalisman(recipeId) {
    var btns = document.querySelectorAll('.btn-craft');
    btns.forEach(function (b) { b.disabled = true; });

    try {
        var res = await api.post('/api/game/talisman/craft', { recipeId: recipeId });
        if (res.code === 200 && res.data) {
            showToast(res.data.message);
            await typewriterLog(res.data.message, 'talisman', 30);
            scheduleCraftRefresh('talisman');
            loadPlayerInfo();
            loadInventory();
        } else {
            showToast(res.message || '制符失败');
            scheduleCraftRefresh('talisman');
        }
    } finally {
        btns.forEach(function (b) { b.disabled = false; });
    }
}

async function batchCraftTalisman(recipeId, recipeName) {
    var lastCount = parseInt(localStorage.getItem(TALISMAN_BATCH_CRAFT_LAST_KEY), 10);
    if (isNaN(lastCount) || lastCount <= 0) lastCount = 10;
    lastCount = Math.min(lastCount, TALISMAN_BATCH_CRAFT_CAP);

    var countStr = await craftPromptAsync('批量绘制「' + recipeName + '」，请输入次数(1-' + TALISMAN_BATCH_CRAFT_CAP + ')：', String(lastCount), dialogIntegerInputOptions(1, TALISMAN_BATCH_CRAFT_CAP));
    if (!countStr) return;
    var count = parseInt(countStr);
    if (isNaN(count) || count <= 0) { showToast('次数不合法'); return; }
    if (count > TALISMAN_BATCH_CRAFT_CAP) { showToast('单次上限' + TALISMAN_BATCH_CRAFT_CAP + '次'); return; }

    var ok = await craftConfirmAsync('批量绘制「' + recipeName + '」' + count + '次，确认？', { subtitle: '批量绘制', confirmText: '开始绘制' });
    if (!ok) return;
    localStorage.setItem(TALISMAN_BATCH_CRAFT_LAST_KEY, String(count));

    var btns = document.querySelectorAll('.btn-craft');
    btns.forEach(function (b) { b.disabled = true; });

    try {
        var res = await api.post('/api/game/talisman/batch-craft', { recipeId: recipeId, count: count });
        if (res.code === 200 && res.data) {
            showToast(res.data.message);
            syncCraftAfterBatchSuccess('talisman', recipeId, res.data, count);
            await typewriterLog(res.data.message, 'talisman', 20);
            loadPlayerInfo();
            loadInventory();
        } else {
            showToast(res.message || '批量绘制失败');
        }
    } finally {
        btns.forEach(function (b) { b.disabled = false; });
    }
}

// ===== 许愿槽系统 (保底) =====
var _lastCraftingRecipes = []; // 保存当前面板的 recipes 引用以供挑选目标

function renderWishBar(data, recipes) {
    _lastCraftingRecipes = recipes; // save globally
    var bar = document.getElementById('wishSlotBar');
    if (!bar) return;
    
    // Check if the current system is supported. (Assuming all shared response DTOs have wishItemName & wishProgress)
    if (typeof data.wishProgress !== 'undefined') {
        bar.style.display = 'block';
        var nameEl = document.getElementById('wishTargetName');
        var pctEl = document.getElementById('wishTargetPct');
        var fillEl = document.getElementById('wishProgressBar');
        
        nameEl.innerHTML = '<span style="color:' + getRarityColor(data.wishItemRarity || 1) + '">' + escCraft(data.wishItemName || '未指定') + '</span>';
        
        var pct = data.wishProgress || 0;
        pctEl.textContent = pct + '%';
        fillEl.style.width = pct + '%';
        
        // 样式变化
        if (pct >= 100) {
            pctEl.style.color = '#ffeb3b';
            fillEl.style.background = 'linear-gradient(90deg, #ffeb3b, #fff5cc)';
            nameEl.textContent += " (下次必定大成功!)";
        } else {
            pctEl.style.color = '';
            fillEl.style.background = '';
        }
    } else {
        bar.style.display = 'none';
    }
}

function isWishTargetBaseId(baseId) {
    return !!baseId && (
        baseId.indexOf('pill_') === 0 ||
        baseId.indexOf('forge_') === 0 ||
        baseId.indexOf('talisman_') === 0 ||
        baseId.indexOf('bp_pill_') === 0 ||
        baseId.indexOf('bp_forge_') === 0 ||
        baseId.indexOf('bp_talisman_') === 0
    );
}

function getWishTargetFromRecipe(r) {
    if (!r || r.slot === 'furnace') return null;
    var targetId = r.produces || r.pillId || r.recipeId;
    var itemName = r.pillName || r.name || r.talismanName || r.displayName;
    if (!isWishTargetBaseId(targetId) || !itemName) return null;
    return {
        targetId: targetId,
        itemName: itemName,
        rarity: r.rarity || 1
    };
}

function buildWishSelectionContent(recipes) {
    var html = '';
    var targetCount = 0;
    // 遍历当前 _lastCraftingRecipes 构建展示；炼丹炉不参与许愿保底
    (recipes || []).forEach(function(r) {
        var target = getWishTargetFromRecipe(r);
        if (!target) return;
        var targetId = target.targetId;
        var itemName = target.itemName;
        var targetColor = target.rarity ? getRarityColor(target.rarity) : 'var(--text-color)';
        var nameHtml = '<span style="color:' + targetColor + ';">' + escCraft(itemName) + '</span>';
        
        var optionsHtml = '';
        [2, 3, 4, 5].forEach(function(q) {
            var qName = getRarityName(q);
            var qColor = getRarityColor(q);
            var fullId = targetId + '_' + q;
            var fullName = itemName + '(' + qName + ')';
            optionsHtml += '<option value="'+escCraft(fullId)+'" data-name="'+escCraft(fullName)+'" data-color="'+qColor+'">' + qName + '</option>';
        });

        targetCount++;
        html += '<div class="wish-target-row">'
              + '<div class="wish-target-main">'
              + '<div class="wish-target-name">' + nameHtml + '</div>'
              + '</div>'
              + '<div class="wish-target-controls">'
              + '<select class="wish-quality-select" aria-label="目标品质">' + optionsHtml + '</select>'
              + '<button class="wish-target-choose wish-target-btn" title="设为许愿目标" data-id="'+escCraft(targetId + '_2')+'" data-name="'+escCraft(itemName + '(' + getRarityName(2) + ')')+'">设为许愿</button>'
              + '</div>'
              + '</div>';
    });
    return { html: html, targetCount: targetCount };
}

async function loadWishSelectionRecipesForCurrentTab() {
    var tab = currentCraftingTab || 'alchemy';
    var endpoint = tab === 'forge'
        ? '/api/game/forge/recipes'
        : tab === 'talisman'
            ? '/api/game/talisman/recipes'
            : tab === 'alchemy'
                ? '/api/game/alchemy/recipes'
                : '';
    if (!endpoint) return _lastCraftingRecipes || [];

    try {
        var res = await api.get(endpoint);
        if (res.code === 200 && res.data && Array.isArray(res.data.recipes)) {
            _lastCraftingRecipes = res.data.recipes;
            return _lastCraftingRecipes;
        }
    } catch (e) {
        console.warn('load wish selection recipes failed:', e);
    }
    return _lastCraftingRecipes || [];
}

async function openWishSelection() {
    var overlay = document.getElementById('wishSelectOverlay');
    var listEl = document.getElementById('wishSelectList');
    if (!overlay || !listEl) return;

    overlay.classList.remove('hidden');
    listEl.innerHTML = '<div class="wish-empty-state">正在加载可许愿目标...</div>';

    var html = '';
    var targetCount = 0;
    try {
        var recipes = await loadWishSelectionRecipesForCurrentTab();
        var content = buildWishSelectionContent(recipes);
        html = content.html;
        targetCount = content.targetCount;
    } catch (e) {
        console.warn('open wish selection failed:', e);
    }

    if (!html) {
        html = '<div class="wish-empty-state">当前炼造页暂无可许愿目标<br><span>请切换到具体配方页后再选择</span></div>';
    }
    
    listEl.innerHTML = html;
    var summaryText = document.querySelector('.wish-select-summary__text');
    if (summaryText) {
        summaryText.textContent = targetCount > 0
            ? '当前页可选 ' + targetCount + ' 个目标，失败累积气运至 100% 触发'
            : '失败累积气运，100% 锁定目标品质';
    }
    listEl.querySelectorAll('.wish-quality-select').forEach(function(sel) {
        var syncBtn = function() {
            var opt = sel.options[sel.selectedIndex];
            var btn = sel.parentElement ? sel.parentElement.querySelector('.wish-target-btn') : null;
            if (!opt || !btn) return;
            btn.setAttribute('data-id', opt.value);
            btn.setAttribute('data-name', opt.getAttribute('data-name') || '');
            sel.style.color = opt.getAttribute('data-color') || '';
            sel.style.borderColor = opt.getAttribute('data-color') || '';
        };
        syncBtn();
        sel.addEventListener('change', syncBtn);
    });
    listEl.querySelectorAll('.wish-target-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            selectWishTarget(this.getAttribute('data-id'), this.getAttribute('data-name'));
        });
    });
}

function closeWishSelection() {
    var overlay = document.getElementById('wishSelectOverlay');
    if (overlay) overlay.classList.add('hidden');
}

function getCurrentWishBranch() {
    if (currentCraftingTab === 'forge' || currentCraftingTab === 'talisman') return currentCraftingTab;
    return 'alchemy';
}

async function selectWishTarget(targetId, targetName) {
    var branch = getCurrentWishBranch();
    var msg = targetId ? '确定将许愿目标锁定为「' + targetName + '」吗？\n(注意：只会清空当前分支积攒的许愿进度！)' : '确定要清空当前分支许愿目标吗？(注意：只会清空当前分支积攒的许愿进度！)';
    var ok = await craftConfirmAsync(msg, { subtitle: '锁定许愿目标', confirmText: targetId ? '锁定目标' : '清空目标' });
    if (!ok) return;
    
    var res = await api.post('/api/game/crafting/wish', { targetId: targetId, branch: branch });
    if (res.code === 200) {
        showToast('许愿目标已更新');
        closeWishSelection();
        // 刷新目前所在的制作面版
        invalidateCraftRecipeCache(currentCraftingTab);
        openCrafting(currentCraftingTab);
    } else {
        showToast(res.message || '许愿失败');
    }
}

// ===== 更换丹炉弹窗 =====
var FURNACE_STAGE_MAP = {
    'furnace_fanfire': '练气期',
    'furnace_lingyan': '筑基期',
    'furnace_zijin': '金丹期',
    'furnace_xuanyang': '元婴期',
    'furnace_taixu': '化神期',
    'furnace_hundun': '炼虚期',
    'furnace_tiandao': '合道期',
    'furnace_hongmeng': '大乘期',
    'furnace_jiexian': '渡劫期'
};

function getFurnaceStageName(templateId) {
    // template_id 格式: furnace_xxx_quality, 去掉末尾 _数字 得到类型前缀
    var prefix = templateId.replace(/_\d+$/, '');
    return FURNACE_STAGE_MAP[prefix] || '';
}

async function showChangeFurnace() {
    // 确保储物数据已加载
    if (!_inventoryCache || _inventoryCache.length === 0) {
        try {
            var invRes = await api.get('/api/game/inventory');
            if (invRes.code === 200 && invRes.data) _inventoryCache = invRes.data;
        } catch (e) { /* ignore */ }
    }

    var furnaces = (_inventoryCache || []).filter(function(i) {
        return i.type === 'furnace' && !i.isEquipped;
    });

    if (furnaces.length === 0) {
        showToast('储物中没有其他丹炉可更换');
        return;
    }

    var rows = furnaces.map(function(f) {
        var color = getRarityColor(f.rarity);
        var rarityName = getRarityName(f.rarity);
        var stageName = getFurnaceStageName(f.templateId);
        var stageTag = stageName ? '<span class="craft-furnace-stage">' + escCraft(stageName) + '</span>' : '';
        return '<div class="craft-dialog-choice craft-furnace-option">' +
            '<div class="craft-furnace-option__main">' +
            '<div class="craft-furnace-option__name" style="color:' + color + ';">' + escCraft(f.name) + stageTag + '</div>' +
            '<div class="craft-furnace-option__meta">' + escCraft(rarityName) + ' 炼丹炉</div>' +
            '</div>' +
            buildCraftButton('装备', 'btn-craft-sm btn-craft-fixed', craftCall('doChangeFurnace', [f.id])) +
            '</div>';
    }).join('');

    showCraftDialog({
        subtitle: '更换炼丹炉',
        descHtml: '选择要装备的丹炉',
        bodyHtml: '<div class="modal-info-card modal-info-card--jade craft-dialog-summary">储物中未装备的炼丹炉会显示在这里，装备后立即用于炼丹。</div>' +
            '<div class="craft-dialog-list craft-furnace-list">' + rows + '</div>',
        actionsHtml: '<button class="modal-btn modal-btn--outline modal-btn--full" id="changeFurnaceCancelBtn">取消</button>'
    });

    document.getElementById('changeFurnaceCancelBtn').onclick = function() {
        closeModal();
    };
}

async function doChangeFurnace(itemId) {
    closeDecoratedActionDialog();

    await equipFurnace(itemId);
}
