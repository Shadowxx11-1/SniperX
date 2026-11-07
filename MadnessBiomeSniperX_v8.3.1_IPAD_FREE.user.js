// ==UserScript==
// @name         Madness BiomeSniperX iPad (Free Userscripts)
// @namespace    https://tampermonkey.net/
// @version      8.3.2
// @description  Free Userscripts-compatible iPad Safari edition. 2-minute default Join Lock, touch-friendly panel and tap-to-open Roblox handoff.
// @match        https://discord.com/*
// @match        https://ptb.discord.com/*
// @match        https://canary.discord.com/*
// @match        https://web.roblox.com/share*
// @match        https://web.roblox.com/games/*
// @match        https://www.roblox.com/share*
// @match        https://www.roblox.com/share-links*
// @match        https://www.roblox.com/games/*
// @match        https://www.roblox.com/*/games/*
// @run-at       document-start
// @noframes
// @grant        GM_xmlhttpRequest
// @connect      discord.com
// @inject-into  content
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '8.3.2 iPad · Userscripts';
    // iPadOS Safari may report itself as macOS when "Request Desktop Website" is active.
    const IS_IPAD = /iPad/i.test(navigator.userAgent || '') ||
        (navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1);

    // ===================== SETTINGS =====================
    // Biome selection, rules and filters are edited from the on-screen panel and saved automatically.
    const CONFIG = {
        negators: [
            'not', 'no', 'nope', 'nah', 'never', 'non', 'isnt', 'wasnt',
            'arent', 'aint', 'without', 'dont', 'doesnt', 'didnt', 'cant',
            'cannot', 'wont', 'neither'
        ],
        ignoreWords: [
            'fake', 'fakes', 'false', 'ended', 'ending', 'expired',
            'gone', 'dead', 'late', 'despawned', 'notreal', 'over', 'finished',
            'inactive', 'unreal', 'vanished', 'disappeared', 'notactive',
            'notavailable'
        ],
        realWords: ['real', 'actually', 'legit', 'true'],

        defaults: {
            joinLockMs: 120000,     // Default: 2 minutes after an automatic launch; changeable in Rules.
            maxAgeSec: 45,          // never open a message older than this (0 = off)
            sound: true,
            fallbackScanMs: 1500,   // safety-net full scan interval
            settleMs: 500,          // wait after opening a channel before treating visible messages as old
            typoMode: 'balanced',   // strict | balanced | aggressive
            priorityPick: true,     // if several links arrive together, open only the rarest
            bypassLockRare: false,  // let very rare biomes override the join lock
            spamGuard: true,        // pause after a burst of launches (troll flood protection)
            clockSync: true,        // one tiny same-origin request to measure the PC/server clock offset
            scanEmbeds: false,      // also read bot embeds (experimental)
            webhookEnabled: false,
            panelWidth: 400,
            theme: 'blue'
        },
        enabledAtStart: true,
        panelOpenAtStart: !IS_IPAD,
        debug: true,
        convertNormalGameLinks: false
    };
    // ====================================================

    const enc = encodeURIComponent;
    const log = (...args) => CONFIG.debug && console.log('[Sniper]', ...args);

    // ---------- Roblox web link -> roblox:// ----------
    function toRobloxProtocol(href) {
        let url;
        try { url = new URL(href, location.href); } catch (e) { return null; }
        if (!/^(www\.|web\.)?roblox\.com$/i.test(url.hostname)) return null;

        const path = url.pathname.replace(/\/+$/, '');
        const q = url.searchParams;

        if (path === '/share' || path === '/share-links') {
            const code = q.get('code'), type = q.get('type');
            if (code && type) return `roblox://navigation/share_links?code=${enc(code)}&type=${enc(type)}`;
        }

        const m = path.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?games\/(\d+)/i);
        if (m) {
            const placeId = m[1];
            const privateCode = q.get('privateServerLinkCode');
            if (privateCode) return `roblox://placeID=${placeId}&linkCode=${enc(privateCode)}`;
            const instanceId = q.get('gameInstanceId');
            if (instanceId) return `roblox://experiences/start?placeId=${placeId}&gameInstanceId=${enc(instanceId)}`;
            if (CONFIG.convertNormalGameLinks) return `roblox://experiences/start?placeId=${placeId}`;
        }
        return null;
    }

    // <<ENGINE
    // =========================================================
    // BİYOM KATEGORİLERİ VE ANAHTAR KELİMELER
    // kw biçimi: [kelime, en kısa gerçek önek, uyumluluk alanı]
    // pri: öncelik (yüksek = önce açılır). Aynı anda iki link gelirse yüksek olan seçilir.
    // =========================================================
    const GROUPS = [
        { id: 'main', title: '🌦 MAIN BIOMES' },
        { id: 'rare', title: '💎 RARE BIOMES' },
        { id: 'event', title: '🎃 EVENT BIOMES' },
        { id: 'boss', title: '👑 BOSS' }
    ];

    const BIOMES = [
        { id: 'normal', g: 'main', name: 'Normal', def: false, pri: 1, kw: [['normal', 6, 99]] },
        { id: 'windy', g: 'main', name: 'Windy', def: false, pri: 10, kw: [['windy', 4, 99]] },
        { id: 'snowy', g: 'main', name: 'Snowy', def: false, pri: 10, kw: [['snowy', 4, 99]] },
        { id: 'rainy', g: 'main', name: 'Rainy', def: false, pri: 10, kw: [['rainy', 4, 99]] },
        { id: 'sandstorm', g: 'main', name: 'Sandstorm', def: false, pri: 15, kw: [['sandstorm', 4, 7]] },
        { id: 'hell', g: 'main', name: 'Hell', def: false, pri: 25, kw: [['hell', 4, 99]] },
        { id: 'starfall', g: 'main', name: 'Starfall', def: false, pri: 25, kw: [['starfall', 4, 7]] },
        { id: 'heaven', g: 'main', name: 'Heaven', def: false, pri: 30, kw: [['heaven', 4, 7]] },
        { id: 'lostforest', g: 'main', name: 'Lost Forest', def: false, pri: 20, kw: [['lostforest', 5, 8]] },
        { id: 'corruption', g: 'main', name: 'Corruption', def: false, pri: 30, kw: [['corruption', 4, 8]] },
        { id: 'null', g: 'main', name: 'Null', def: false, pri: 35, kw: [['null', 4, 99]] },

        { id: 'glitched', g: 'rare', name: 'Glitched', def: true, pri: 100, kw: [['glitch', 4, 5]] },
        { id: 'dreamspace', g: 'rare', name: 'Dreamspace', def: true, pri: 100, kw: [['dreamspace', 5, 6]] },
        { id: 'cyberspace', g: 'rare', name: 'Cyberspace', def: true, pri: 95, kw: [['cyberspace', 5, 6]] },
        { id: 'singularity', g: 'rare', name: 'Singularity', def: true, pri: 90, kw: [['singularity', 5, 6]] },
        { id: 'radiant', g: 'rare', name: 'The Radiant Forest', def: true, pri: 80, kw: [['radiantforest', 6, 9], ['radiant', 6, 99]] },

        { id: 'pumpkinmoon', g: 'event', name: 'Pumpkin Moon', def: false, pri: 55, kw: [['pumpkinmoon', 4, 7]] },
        { id: 'graveyard', g: 'event', name: 'Graveyard', def: false, pri: 50, kw: [['graveyard', 5, 8]] },
        { id: 'blazingsun', g: 'event', name: 'Blazing Sun', def: false, pri: 45, kw: [['blazingsun', 4, 7]] },
        { id: 'bloodrain', g: 'event', name: 'Blood Rain', def: false, pri: 50, kw: [['bloodrain', 5, 8]] },
        { id: 'aurora', g: 'event', name: 'Aurora', def: false, pri: 45, kw: [['aurora', 5, 7]] },
        { id: 'eggland', g: 'event', name: 'Eggland', def: false, pri: 40, kw: [['eggland', 4, 7]] },
        { id: 'incinerator', g: 'event', name: 'Incinerator', def: false, pri: 40, kw: [['incinerator', 4, 7]] },

        // 'boss' tam kelime takma adıdır; yalnızca Sinister seçiliyken etkindir.
        { id: 'sinister', g: 'boss', name: 'Sinister', def: true, pri: 70,
            kw: [['sinister', 5, 6], ['boss', 4, 99]] }
    ];

    // Hazır seçim profilleri
    const PRESETS = [
        { id: 'default', name: 'Defaults', ids: BIOMES.filter(b => b.def).map(b => b.id) },
        { id: 'rare', name: 'Rare only', ids: BIOMES.filter(b => b.g === 'rare').map(b => b.id) },
        { id: 'halloween', name: 'Halloween', ids: ['pumpkinmoon', 'graveyard', 'bloodrain', 'sinister'] },
        { id: 'events', name: 'All events', ids: BIOMES.filter(b => b.g === 'event' || b.g === 'boss').map(b => b.id) },
        { id: 'all', name: 'Everything', ids: BIOMES.map(b => b.id) },
        { id: 'none', name: 'Clear', ids: [] }
    ];

    function buildKeywords(selectedIds, customWords) {
        const selectedSet = new Set(selectedIds);
        const output = [];

        for (const biome of BIOMES) {
            if (!selectedSet.has(biome.id)) continue;
            for (const [word, minPrefix, typoFrom] of biome.kw) {
                output.push({ id: biome.id, label: biome.name, word, minPrefix, typoFrom, pri: biome.pri });
            }
        }

        for (const rawWord of customWords || []) {
            const phrase = String(rawWord).toLowerCase()
                .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
            const word = phrase.replace(/\s/g, '');
            if (word.length >= 3) {
                output.push({ id: 'custom', label: phrase, word, minPrefix: word.length, exactOnly: true, pri: 60 });
            }
        }
        return output;
    }

    // Sıradan İngilizce kelimeler: bunlar yazım hatası (bulanık) eşleşmesiyle biyom sanılmaz.
    // Liste, 275 bin kelimelik sözlük taramasıyla üretildi ve doğrulandı.
    const COMMON_WORDS = new Set(["adjuror", "antigravity", "antiradical", "arcadian", "asuror", "asurors", "aurar", "aureola", "auroraly", "aurorean", "bagings", "baizing", "bakings", "baladin", "balading", "balancings", "balating", "balding", "balings", "balking", "balkings", "balming", "barings", "batings", "beading", "beadings", "beaming", "beamings", "beaning", "bearing", "bearings", "beating", "beatings", "bedazing", "begazing", "belacing", "belating", "belaying", "biasing", "biasings", "blabing", "blabings", "blacking", "blackings", "blading", "bladings", "blaging", "blagings", "blahing", "blain", "blaming", "blanding", "blanking", "blankings", "blaring", "blarting", "blasting", "blastings", "blating", "blauding", "blawing", "blazon", "blazoning", "blazonings", "blazons", "bleachings", "blearing", "bleating", "bleatings", "blebing", "blebings", "bleding", "bledings", "bleping", "blesing", "blesings", "bleting", "blining", "bliping", "blising", "bliting", "blitzing", "bloating", "bloatings", "blobing", "blodfin", "blodier", "bloding", "blodings", "blodred", "blodrot", "blods", "blodstain", "blodstains", "blody", "bloging", "blogings", "bloming", "blonder", "bloping", "bloting", "blotings", "blowing", "blowings", "blubing", "blueing", "blueings", "blufing", "bluings", "bluming", "bluring", "boaking", "boating", "boatings", "bozings", "bracing", "bracings", "brading", "braging", "bragings", "braking", "braning", "brasing", "braving", "braying", "brazing", "brezing", "buzings", "bwazi", "caber", "cabers", "cablers", "cambers", "clabers", "clobers", "clubers", "cober", "cobers", "coblers", "coemption", "coemptions", "cofunction", "combers", "combustion", "comutation", "conception", "conduction", "coniption", "coniptions", "consumption", "contraption", "coption", "copulation", "corection", "corections", "corelation", "coreption", "coreptions", "corneti", "cornu", "coronation", "corotation", "corugation", "corugations", "corupted", "corupter", "coruptible", "coruptibly", "coruptionist", "coruptly", "coruscation", "coverup", "crabers", "cribers", "croup", "cuber", "cubers", "cumbers", "curbers", "cybersex", "cyborgs", "cyclers", "cyder", "cyders", "cyphers", "derhams", "dirdams", "dirhams", "drams", "dread", "dreads", "dreamles", "dreamt", "dreamy", "drear", "dreares", "drears", "egplant", "eland", "elfland", "garagey", "garvey", "garveys", "gelande", "glift", "glint", "glits", "glitz", "grace", "grade", "gradely", "grame", "grape", "grapery", "grapey", "grate", "graved", "gravel", "gravels", "gravely", "graven", "graver", "gravers", "gravest", "graveward", "gravida", "gravies", "gravity", "gravs", "gravure", "gravy", "graze", "greave", "greaved", "greaves", "greve", "grove", "haven", "headend", "headmen", "heale", "heame", "heare", "hearken", "hearten", "heathen", "heaved", "heavenly", "heaver", "heavers", "heaves", "heavier", "heavies", "heaving", "heavy", "helve", "incantator", "incarcerator", "incense", "incenser", "incenter", "inching", "inchpin", "incinerating", "incinerations", "incise", "incised", "incises", "incisor", "incite", "incited", "inciter", "inciters", "incites", "incline", "inclined", "incliner", "incliners", "inclines", "incomer", "inconie", "inconue", "inditer", "infiltrator", "ingener", "ingenerate", "ingine", "ingines", "inkines", "inosine", "insaner", "insider", "insigne", "insinew", "insinuator", "intenerate", "intine", "intines", "intoner", "intwine", "invigorator", "inviter", "nonbearing", "nonconduction", "nonconsumption", "noncorelation", "nonormal", "norma", "normalcy", "norman", "normans", "normas", "nosebands", "nosines", "nosings", "plump", "pumping", "pumpion", "pumpking", "pumpkings", "pumpkinsed", "pumps", "radial", "radiale", "radials", "radialy", "radiance", "radiancy", "radians", "radiantly", "radiata", "radiate", "radiator", "radical", "radicand", "radicant", "radioman", "rainforest", "rampant", "reliant", "resiant", "roadman", "saidest", "saids", "saidst", "sandabs", "sandals", "sandeks", "sanders", "sandhis", "sandiest", "sandles", "sandlot", "sandpit", "sandshoe", "sandspur", "sandstone", "sandstones", "sandworm", "sandy", "saned", "sanes", "sanest", "sangs", "sants", "sards", "sawdust", "scand", "scarf", "sebands", "secularity", "sends", "sensist", "sexangular", "shand", "shands", "shinies", "shiniest", "sienite", "siliest", "similarity", "simis", "simonist", "simular", "sinds", "sines", "sinful", "sinfuly", "singe", "sings", "singularise", "singularised", "singularises", "singularism", "singularisms", "singularist", "singularists", "singularities", "singularize", "singularized", "singularizes", "singularly", "singularnes", "singulars", "singulary", "singult", "singults", "sinhs", "sinisterity", "sinisterly", "sinisternes", "sinkiest", "sinks", "sinopis", "sinuate", "sinus", "siris", "sisiest", "sitar", "sizeist", "siziest", "sizist", "sizists", "skinful", "skinies", "skiniest", "slaister", "slangular", "snarf", "snifter", "solands", "songful", "songster", "spatfal", "specularity", "spinies", "spiniest", "spinmeister", "spinster", "spinula", "stadial", "stair", "stand", "standes", "stands", "stare", "stark", "starn", "stars", "start", "startful", "stary", "stear", "sternal", "stingbul", "straf", "strands", "stratal", "subangular", "subminister", "sumands", "suniest", "sunis", "swarf", "swinish", "synds"]);

    // =========================================================
    // METİN ANALİZİ
    // - Kısaltma/önek (singu -> Singularity), ek (glitched, glitchy)
    // - Yazım hatası: strict / balanced / aggressive
    // - Olumsuz, sahte, bitmiş mesajları engelleme ("not cyber", "glitch ended")
    // - Acele ifadeleri olumlu sayma ("dont miss glitch")
    // =========================================================
    function makeAnalyzer(CFG) {
        const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };
        const collapse = value => value.replace(/(.)\1+/g, '$1');
        const MODE = ['strict', 'balanced', 'aggressive'].includes(CFG.typoMode) ? CFG.typoMode : 'balanced';

        // Çift harfi anlamlı olan kısa kelimeler (hell/heel, boss) bozulmasın diye korunur.
        const PRESERVE = ['boss', 'hell'];
        const preserveRes = PRESERVE.map(word => {
            const runs = word.match(/(.)\1*/g) || [];
            const body = runs.map(run => run.length > 1 ? run[0] + '{2,}' : run[0] + '+').join('');
            return [new RegExp('^' + body + '$'), word];
        });
        const normalizeToken = value => {
            for (const [re, word] of preserveRes) if (re.test(value)) return word;
            return collapse(value);
        };

        // Damerau-Levenshtein (bitişik harf yer değiştirmesi dahil), erken çıkışlı.
        function distance(a, b, max) {
            const n = a.length, m = b.length;
            if (Math.abs(n - m) > max) return max + 1;
            if (!n) return m;
            if (!m) return n;
            const inf = n + m;
            const d = Array.from({ length: n + 2 }, () => new Array(m + 2).fill(0));
            d[0][0] = inf;
            for (let i = 0; i <= n; i++) { d[i + 1][0] = inf; d[i + 1][1] = i; }
            for (let j = 0; j <= m; j++) { d[0][j + 1] = inf; d[1][j + 1] = j; }
            const lastSeen = Object.create(null);
            for (let i = 1; i <= n; i++) {
                let lastMatchColumn = 0;
                for (let j = 1; j <= m; j++) {
                    const previousRow = lastSeen[b[j - 1]] || 0;
                    const previousColumn = lastMatchColumn;
                    let cost = 1;
                    if (a[i - 1] === b[j - 1]) { cost = 0; lastMatchColumn = j; }
                    d[i + 1][j + 1] = Math.min(
                        d[i][j] + cost,
                        d[i + 1][j] + 1,
                        d[i][j + 1] + 1,
                        d[previousRow][previousColumn] + (i - previousRow - 1) + 1 + (j - previousColumn - 1)
                    );
                }
                lastSeen[a[i - 1]] = i;
            }
            return d[n + 1][m + 1];
        }

        const maxTypos = len => (len < 6 ? 0 : len <= 7 ? 1 : len <= 12 ? 2 : 3);
        // Yanlış harfle başlayan kelimeler (minister -> sinister) eşleşmez; ilk iki harf yer değiştirebilir.
        const opens = (token, full) => token[0] === full[0] || (token[0] === full[1] && token[1] === full[0]);
        const SUFFIXES = new Set(['s', 'es', 'ed', 'y', 'ing']);

        const KW = (CFG.keywords || []).map(keyword => {
            const rawWord = String(keyword.word).toLowerCase();
            const full = PRESERVE.includes(rawWord) ? rawWord : collapse(rawWord);
            const requestedPrefix = Number(keyword.minPrefix) || 3;
            return {
                label: keyword.label,
                full,
                pri: Number(keyword.pri) || 0,
                minPrefix: Math.max(3, Math.min(requestedPrefix, full.length)),
                exactOnly: keyword.exactOnly === true
            };
        });

        const NEG = (CFG.negators || []).map(word => collapse(String(word).toLowerCase()));
        const IGN = (CFG.ignoreWords || []).map(word => collapse(String(word).toLowerCase()));
        const REAL = (CFG.realWords || []).map(word => collapse(String(word).toLowerCase()));
        const NEG_SET = new Set(NEG), IGN_SET = new Set(IGN), REAL_SET = new Set(REAL);
        const BLOCK_LIST = NEG.concat(IGN);
        const BLOCK_SET = new Set(BLOCK_LIST);

        function inList(token, set, list) {
            if (!token) return false;
            if (set.has(token)) return true;
            if (token.length >= 6) {
                for (const word of list) {
                    if (word.length >= 6 && Math.abs(word.length - token.length) <= 1 && distance(token, word, 1) <= 1) return true;
                }
            }
            return false;
        }
        const isNeg = token => inList(token, NEG_SET, NEG);
        const isIgn = token => inList(token, IGN_SET, IGN);
        const isBlock = token => inList(token, BLOCK_SET, BLOCK_LIST);

        const memo = new Map();
        function matchKeyword(token, fullOnly = false) {
            const key = (fullOnly ? '1' : '0') + token;
            if (memo.has(key)) return memo.get(key);
            const result = matchUncached(token, fullOnly);
            if (memo.size > 4000) memo.clear();
            memo.set(key, result);
            return result;
        }

        function matchUncached(token, fullOnly) {
            const fuzzyOk = MODE !== 'strict' && !COMMON_WORDS.has(token);
            for (const keyword of KW) {
                const full = keyword.full;
                if (token === full) return keyword;
                if (keyword.exactOnly) continue;

                if (!fullOnly) {
                    // Kısaltma: singu -> singularity, glit -> glitch
                    if (token.length >= keyword.minPrefix && token.length < full.length && full.startsWith(token)) return keyword;
                    // Ek: glitched, glitchy, glitches, cyberspaces
                    if (full.length >= 5 && token.length > full.length && token.startsWith(full) &&
                        SUFFIXES.has(token.slice(full.length))) return keyword;
                }

                if (!fuzzyOk) continue;

                // Tam kelimeye yakın yazım hatası: glicth, cybrspace, dreamspce
                const allowed = maxTypos(full.length);
                if (allowed && token.length >= keyword.minPrefix && Math.abs(token.length - full.length) <= 1 &&
                    opens(token, full) && distance(token, full, allowed) <= allowed) return keyword;

                if (fullOnly) continue;

                // Dengeli mod: bozuk yazılmış kısaltma (cybrsp -> cybersp)
                if (token.length >= 6 && full.length >= 7 && opens(token, full)) {
                    const top = Math.min(full.length - 1, token.length + 1);
                    for (let len = Math.max(keyword.minPrefix, token.length - 1); len <= top; len++) {
                        if (distance(token, full.slice(0, len), 1) <= 1) return keyword;
                    }
                }

                // Agresif mod: çok bozuk yazımlar (cyybeber -> cyber)
                if (MODE === 'aggressive' && token.length >= 5 && full.length >= 6 && opens(token, full)) {
                    const allow = token.length <= 6 ? 1 : token.length <= 9 ? 2 : 3;
                    for (let len = keyword.minPrefix; len <= full.length; len++) {
                        if (Math.abs(token.length - len) <= allow && distance(token, full.slice(0, len), allow) <= allow) return keyword;
                    }
                }
            }
            return null;
        }

        function tokenize(raw) {
            const normalized = String(raw || '')
                .replace(/https?:\/\/\S+/gi, ' ')
                .replace(/İ/g, 'i').replace(/ı/g, 'i')
                .toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/['’`´]/g, '');
            return normalized
                .split(/[^a-z0-9@$]+/)
                .filter(Boolean)
                .map(token => {
                    if (!/[a-z]/.test(token)) return '';
                    return normalizeToken(token.replace(/[013457@$]/g, char => LEET[char]).replace(/[^a-z]/g, ''));
                })
                .filter(Boolean);
        }

        // Token'lar harf tekrarsız tutulduğu için kümeler de aynı biçimde hazırlanır (miss -> mis).
        const toSet = list => new Set(list.map(word => collapse(word)));
        const CONNECTORS = toSet(['but', 'however', 'although', 'yet', 'and', 'while', 'also', 'then']);
        const FILLERS = toSet([
            'is', 'are', 'was', 'were', 'has', 'have', 'had', 'seems', 'looks', 'already', 'just', 'now',
            'totally', 'completely', 'basically', 'currently', 'really', 'actually', 'been', 'got', 'its',
            'too', 'to', 'so', 'very', 'way', 'alr', 'prob', 'probably', 'maybe', 'kinda', 'pretty',
            'almost', 'long', 'be', 'it', 'this', 'that', 'here', 'there'
        ]);
        // "dont miss", "cant miss", "wont last" = acele et (olumlu)
        const URGE = toSet(['miss', 'missing', 'sleep', 'skip', 'wait', 'forget', 'lose', 'ignore', 'hesitate', 'delay', 'waste', 'last', 'stop']);
        const OVER_OK = toSet(['here', 'there', 'at', 'in', 'on', 'by', 'the', 'this']);

        function negationReason(tokens, start, end) {
            // Keyword'den ÖNCE gelen olumsuzluk
            for (let i = start - 1; i >= Math.max(0, start - 3); i--) {
                const word = tokens[i];
                if (CONNECTORS.has(word)) break;
                if (isIgn(word) && tokens[i - 1] && isNeg(tokens[i - 1])) { i--; continue; }   // "not fake glitch"
                if (isNeg(word) && URGE.has(tokens[i + 1])) continue;                           // "dont miss glitch"
                if (isBlock(word)) return 'preceded by "' + word + '"';
            }

            // Keyword'den SONRA gelen durum ifadeleri
            for (let i = end + 1; i <= Math.min(tokens.length - 1, end + 4); i++) {
                const word = tokens[i];
                if (CONNECTORS.has(word)) break;

                if (isIgn(word)) {
                    if (word === 'over' && OVER_OK.has(tokens[i + 1])) continue;                // "glitch over here"
                    const previous = tokens[i - 1], previousTwo = tokens[i - 2];
                    if (isNeg(previous) || (previous === 'longer' && previousTwo === 'no')) return null;
                    return 'followed by "' + word + '"';
                }

                if (word === 'no' && tokens[i + 1] === 'longer') return 'followed by "no longer"';

                if (isNeg(word)) {
                    if (REAL_SET.has(tokens[i + 1])) return 'followed by "' + word + ' ' + tokens[i + 1] + '"';
                    if (isIgn(tokens[i + 1]) || URGE.has(tokens[i + 1])) return null;           // "not gone", "dont miss"
                    break;
                }

                if (!FILLERS.has(word)) break;
            }
            return null;
        }

        function analyze(raw) {
            const tokens = tokenize(raw);
            const hits = [];
            if (!KW.length) return { tokens, hits, snipe: false, word: null, pri: 0 };

            for (let i = 0; i < tokens.length; i++) {
                const token = tokens[i];
                const attachedNegative = /^(not|non|no|fake|anti)(.{3,})$/.exec(token);
                if (attachedNegative) {
                    const negativeMatch = matchKeyword(attachedNegative[2]);
                    if (negativeMatch) {
                        hits.push({ word: negativeMatch.label, pri: negativeMatch.pri, negated: true, why: 'attached negation: ' + token });
                        continue;
                    }
                }

                let match = matchKeyword(token);
                let end = i;
                if (!match && !isBlock(token)) {
                    for (let count = 2; count <= 3 && i + count - 1 < tokens.length && !match; count++) {
                        const parts = tokens.slice(i, i + count);
                        if (parts.slice(1).some(part => matchKeyword(part))) break;
                        const joinedMatch = matchKeyword(parts.join(''), true);
                        if (joinedMatch) { match = joinedMatch; end = i + count - 1; }
                    }
                }
                if (!match) continue;

                const why = negationReason(tokens, i, end);
                hits.push({ word: match.label, pri: match.pri, negated: Boolean(why), why: why || '' });
                i = end;
            }

            let best = null;
            for (const hit of hits) if (!hit.negated && (!best || hit.pri > best.pri)) best = hit;
            return { tokens, hits, snipe: Boolean(best), word: best ? best.word : null, pri: best ? best.pri : 0 };
        }

        return { analyze, tokenize };
    }
    // ENGINE>>

    // =========================================================
    // DISCORD RUNTIME
    // =========================================================
    if (/(^|\.)discord\.com$/i.test(location.hostname)) {

        const pageWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

        // Single-instance guard: a duplicate copy would launch Roblox twice.
        if (pageWin.__madnessSniperX) {
            console.warn('[Sniper] v' + pageWin.__madnessSniperX + ' is already running; this copy (v' + VERSION + ') stays disabled.');
            return;
        }
        pageWin.__madnessSniperX = VERSION;

        // ---------- Persistent storage (Userscripts-compatible) ----------
        // Userscripts supports async GM.getValue/setValue, whereas this engine's
        // settings access is intentionally synchronous. Use namespaced localStorage
        // so settings/history persist without a Tampermonkey-only storage API.
        const memory = Object.create(null);
        const STORAGE_PREFIX = 'madness_sniperx_userscripts_';
        const store = {
            get(key, fallback) {
                try {
                    const raw = localStorage.getItem(STORAGE_PREFIX + key);
                    if (raw !== null) return JSON.parse(raw);
                } catch (error) {
                    console.warn('[Sniper] local settings read failed:', key, error);
                }
                return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : fallback;
            },
            set(key, value) {
                memory[key] = value;
                try {
                    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
                } catch (error) {
                    console.warn('[Sniper] local settings write failed:', key, error);
                }
            }
        };

        const D = CONFIG.defaults;

        // v8.1 migration: v8.0 shipped with Join Lock off by default (0).
        // Convert that legacy default to 60 seconds once; users can still choose Off in Rules.
        if (!store.get('joinLockMigrationV81', false)) {
            const previousLock = store.get('joinLockMs', null);
            if (previousLock === null || Number(previousLock) === 0) store.set('joinLockMs', D.joinLockMs);
            store.set('joinLockMigrationV81', true);
        }

        // v8.3.2 migration: upgrade the previous automatic 1-minute default to 2 minutes.
        // A deliberately disabled lock (0) or any other custom duration is preserved.
        if (!store.get('joinLockMigrationV832', false)) {
            const savedLock = store.get('joinLockMs', null);
            if (Number(savedLock) === 60000) store.set('joinLockMs', D.joinLockMs);
            if (savedLock === null) store.set('joinLockMs', D.joinLockMs);
            store.set('joinLockMigrationV832', true);
        }

        const clampNum = (value, fallback, min, max) => {
            const n = Number(value);
            return Math.min(max, Math.max(min, Number.isFinite(n) ? n : fallback));
        };
        const pickOne = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
        const readList = key => {
            const value = store.get(key, []);
            return Array.isArray(value) ? value.map(item => String(item).trim().toLowerCase()).filter(Boolean) : [];
        };

        const settings = {
            joinLockMs: clampNum(store.get('joinLockMs', D.joinLockMs), D.joinLockMs, 0, 3600000),
            maxAgeSec: clampNum(store.get('maxAgeSec', D.maxAgeSec), D.maxAgeSec, 0, 600),
            sound: store.get('sound', D.sound) !== false,
            fallbackScanMs: clampNum(store.get('fallbackScanMs', D.fallbackScanMs), D.fallbackScanMs, 1000, 10000),
            settleMs: clampNum(store.get('settleMs', D.settleMs), D.settleMs, 200, 3000),
            typoMode: pickOne(store.get('typoMode', D.typoMode), ['strict', 'balanced', 'aggressive'], D.typoMode),
            priorityPick: store.get('priorityPick', D.priorityPick) !== false,
            bypassLockRare: store.get('bypassLockRare', D.bypassLockRare) === true,
            spamGuard: store.get('spamGuard', D.spamGuard) !== false,
            clockSync: store.get('clockSync', D.clockSync) !== false,
            scanEmbeds: store.get('scanEmbeds', D.scanEmbeds) === true,
            webhookEnabled: store.get('webhookEnabled', D.webhookEnabled) === true,
            webhookUrl: String(store.get('webhookUrl', '') || ''),
            panelWidth: clampNum(store.get('panelWidth', D.panelWidth), D.panelWidth, 300, 520),
            theme: pickOne(store.get('theme', D.theme), ['blue', 'purple', 'dark'], D.theme),
            onlyChannels: readList('onlyChannels'),
            blockUsers: readList('blockUsers'),
            allowUsers: readList('allowUsers')
        };

        const knownIds = new Set(BIOMES.map(biome => biome.id));
        const savedSelection = store.get('sel', null);
        const selected = new Set(Array.isArray(savedSelection)
            ? savedSelection.filter(id => knownIds.has(id))
            : BIOMES.filter(biome => biome.def).map(biome => biome.id));
        let custom = Array.isArray(store.get('custom', [])) ? store.get('custom', []).map(String) : [];

        let analyzer = null;
        function rebuildAnalyzer() {
            analyzer = makeAnalyzer({
                negators: CONFIG.negators, ignoreWords: CONFIG.ignoreWords, realWords: CONFIG.realWords,
                typoMode: settings.typoMode, keywords: buildKeywords([...selected], custom)
            });
        }
        rebuildAnalyzer();

        const state = {
            enabled: CONFIG.enabledAtStart,
            channelId: null,
            channelSince: Date.now(),
            ready: false,
            firstSeenAt: 0,
            baseline: 0n,
            baselineCount: 0,
            lastLaunch: 0,
            lastMutationAt: 0,
            lastSnipe: null,
            skew: 0,
            clockState: 'pending',
            newLinks: 0,
            launched: 0,
            pausedUntil: 0,
            joinLockUntil: Number(store.get('joinLockUntil', 0)) || 0,
            joinLockUpdatedAt: Number(store.get('joinLockUpdatedAt', 0)) || 0
        };
        const done = new Set();            // finished message ids
        const texts = new Map();           // message id -> last analysed fingerprint
        const launchedKeys = new Map();    // roblox:// link -> launch time (dedupe, also shared across tabs)
        const recentLaunches = [];         // timestamps for the spam guard
        const logs = [];
        let history = Array.isArray(store.get('history', [])) ? store.get('history', []) : [];
        let webhookStatus = '';
        let pendingEls = new Set();

        // ---------- Cross-tab coordination (two Discord tabs never double-launch) ----------
        let channelBus = null;
        try {
            if (typeof BroadcastChannel === 'function') {
                channelBus = new BroadcastChannel('madness-sniperx');
                channelBus.onmessage = event => {
                    const data = event && event.data;
                    if (!data || typeof data !== 'object') return;

                    if (data.type === 'launched' && typeof data.key === 'string') {
                        launchedKeys.set(data.key, Date.now());
                    }
                    if ((data.type === 'launched' || data.type === 'lock') && Number.isFinite(Number(data.lockUntil))) {
                        syncJoinLock(data.lockUntil, Number(data.lockUpdatedAt) || Date.now(), false);
                        renderAll();
                    }
                };
            }
        } catch (_) { channelBus = null; }
        const busPost = message => { try { if (channelBus) channelBus.postMessage(message); } catch (_) {} };

        // Keep Join Lock state consistent across every Discord tab. A timestamp
        // prevents an older broadcast from re-applying a lock after it was released.
        function syncJoinLock(until, updatedAt = Date.now(), broadcast = false) {
            const stamp = Number(updatedAt) || Date.now();
            if (stamp < state.joinLockUpdatedAt) return false;

            state.joinLockUntil = Math.max(0, Number(until) || 0);
            state.joinLockUpdatedAt = stamp;
            store.set('joinLockUntil', state.joinLockUntil);
            store.set('joinLockUpdatedAt', stamp);

            if (broadcast) {
                busPost({ type: 'lock', lockUntil: state.joinLockUntil, lockUpdatedAt: stamp });
            }
            return true;
        }

        // ---------- Clock sync (PC clock vs Discord server clock) ----------
        async function syncClock() {
            if (!settings.clockSync) { state.skew = 0; state.clockState = 'off'; return; }
            try {
                const t0 = Date.now();
                const response = await fetch('/robots.txt?_=' + t0, { cache: 'no-store', credentials: 'omit' });
                const t1 = Date.now();
                const header = response.headers.get('date');
                const server = Date.parse(header) + Number(response.headers.get('age') || 0) * 1000;
                if (!header || !Number.isFinite(server)) throw new Error('no date header');
                state.skew = (server + 500) - (t0 + t1) / 2;
                state.clockState = 'synced';
                log('Clock offset (server - PC):', Math.round(state.skew) + 'ms');
            } catch (error) {
                state.skew = 0;
                state.clockState = 'unsynced (assuming PC clock is right)';
            }
        }

        // ---------- Launching ----------
        let launchAnchor = null;
        let ipadPendingLaunch = null;
        let ipadOpenButton = null;

        function hideIPadOpenButton(clearPending = false) {
            if (ipadOpenButton) ipadOpenButton.hidden = true;
            if (clearPending) ipadPendingLaunch = null;
        }

        function showIPadOpenButton(candidate, detectedAt, t0) {
            if (!IS_IPAD) return;

            if (ipadPendingLaunch) {
                const old = ipadPendingLaunch.candidate;
                const shouldReplace = settings.priorityPick
                    ? (candidate.pri > old.pri || (candidate.pri === old.pri && candidate.id > old.id))
                    : candidate.id > old.id;
                if (!shouldReplace) return;
            }

            ipadPendingLaunch = { candidate, detectedAt, t0 };

            if (!ipadOpenButton) {
                ipadOpenButton = document.createElement('button');
                ipadOpenButton.type = 'button';
                ipadOpenButton.className = 'rbsx-ipad-launch';
                ipadOpenButton.addEventListener('click', () => {
                    const pending = ipadPendingLaunch;
                    if (!pending) return;

                    const ageNow = pending.candidate.age + (Date.now() - pending.detectedAt) / 1000;
                    if (settings.maxAgeSec > 0 && ageNow > settings.maxAgeSec) {
                        hideIPadOpenButton(true);
                        addLog('fail', 'The detected Roblox link expired before it was opened.');
                        return;
                    }

                    const candidateToOpen = pending.candidate;
                    hideIPadOpenButton(true);
                    const started = performance.now();
                    const opened = launch(candidateToOpen.proto, true);
                    if (!opened) {
                        showIPadOpenButton(candidateToOpen, Date.now(), started);
                        addLog('fail', 'Safari could not start the Roblox app handoff. Tap OPEN ROBLOX again.');
                        return;
                    }
                    recordLaunch(candidateToOpen, Date.now(), started);
                });
            }

            ipadOpenButton.textContent = '🚀 TAP TO OPEN ' + String(candidate.word || 'ROBLOX').toUpperCase();
            const host = document.body || document.documentElement;
            if (ipadOpenButton.parentNode !== host) host.appendChild(ipadOpenButton);
            ipadOpenButton.hidden = false;
        }

        function launch(proto, userInitiated = false) {
            log('Launching Roblox:', proto);

            // On iPadOS, an external-app URL should be navigated from an actual
            // tap. Background MutationObserver callbacks do not carry user activation.
            if (IS_IPAD && userInitiated) {
                try {
                    window.location.href = proto;
                    return true;
                } catch (_) {
                    return false;
                }
            }

            try {
                if (!launchAnchor) {
                    launchAnchor = document.createElement('a');
                    launchAnchor.style.display = 'none';
                    launchAnchor.rel = 'noopener';
                    launchAnchor.addEventListener('click', event => event.stopPropagation());
                    (document.body || document.documentElement).appendChild(launchAnchor);
                }
                launchAnchor.href = proto;
                launchAnchor.click();
                return true;
            } catch (_) {
                try { location.href = proto; return true; } catch (__) { return false; }
            }
        }

        // Manual click: no new tab, straight into Roblox.
        const clickHandler = event => {
            if (event.type === 'click' && event.button !== 0) return;
            if (event.type === 'auxclick' && event.button !== 1) return;
            const anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
            if (!anchor) return;
            const proto = toRobloxProtocol(anchor.href);
            if (!proto) return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            hideIPadOpenButton(true);
            launch(proto, true);
        };
        window.addEventListener('click', clickHandler, true);
        window.addEventListener('auxclick', clickHandler, true);

        function beep(priority) {
            if (!settings.sound) return;
            try {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (!AudioCtx) return;
                const ctx = beep.ctx || (beep.ctx = new AudioCtx());
                if (ctx.state === 'suspended') ctx.resume();
                const tones = priority >= 90 ? [880, 1175, 1568] : priority >= 50 ? [880, 1175] : [740];
                tones.forEach((frequency, index) => {
                    const osc = ctx.createOscillator(), gain = ctx.createGain();
                    const start = ctx.currentTime + index * 0.11;
                    osc.frequency.value = frequency; gain.gain.value = 0.05;
                    osc.connect(gain); gain.connect(ctx.destination);
                    osc.start(start); osc.stop(start + 0.09);
                });
            } catch (_) {}
        }

        // ---------- Discord webhook (optional, user-owned; sends no links or user names) ----------
        function validateWebhookUrl(value) {
            try {
                const url = new URL(String(value || '').trim());
                if (url.protocol !== 'https:' || !/^(ptb\.|canary\.)?discord\.com$/.test(url.hostname) ||
                    url.username || url.password || url.search || url.hash ||
                    !/^\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+\/?$/.test(url.pathname)) return null;
                url.pathname = url.pathname.replace(/\/$/, '');
                return url.toString();
            } catch (_) { return null; }
        }

        function setWebhookStatus(text) {
            webhookStatus = text;
            if (ui.webhookStatus) setText(ui.webhookStatus, text);
        }

        let lastWebhookAt = 0;
        function sendWebhook(options = {}) {
            const isTest = options.test === true;
            if (!isTest && !settings.webhookEnabled) return false;
            const url = validateWebhookUrl(settings.webhookUrl);
            if (!url) { setWebhookStatus('Invalid or missing Discord webhook URL'); return false; }
            if (typeof GM_xmlhttpRequest !== 'function') { setWebhookStatus('GM_xmlhttpRequest unavailable · check Tampermonkey permissions'); return false; }
            const now = Date.now();
            if (!isTest && now - lastWebhookAt < 1000) return false;   // never hammer the webhook
            lastWebhookAt = now;

            const processing = Number.isFinite(options.processMs) ? Math.max(0, options.processMs) : 0;
            const content = isTest
                ? '🧪 **Madness BiomeSniperX v' + VERSION + ' webhook test**\nWebhook delivery is working.'
                : '🚀 **Roblox launch request dispatched**\n' +
                  '**Biome:** ' + String(options.biome || 'Unknown').slice(0, 80) + '\n' +
                  '**Detected at:** ' + new Date().toISOString() + '\n' +
                  '**Local processing:** ' + processing.toFixed(2) + ' ms\n' +
                  '_This confirms only that the launch request was sent; it does not confirm an in-game server join._';
            try {
                GM_xmlhttpRequest({
                    method: 'POST', url, headers: { 'Content-Type': 'application/json' },
                    data: JSON.stringify({ content }), timeout: 5000,
                    onload: response => setWebhookStatus(response.status >= 200 && response.status < 300
                        ? (isTest ? 'Test message delivered ✓' : 'Launch-request report delivered ✓')
                        : 'Webhook HTTP error: ' + response.status),
                    onerror: () => setWebhookStatus('Webhook network error'),
                    ontimeout: () => setWebhookStatus('Webhook timed out · game launch is unaffected')
                });
                setWebhookStatus(isTest ? 'Sending test message…' : 'Sending launch-request report…');
                return true;
            } catch (error) {
                setWebhookStatus('Webhook request could not start');
                return false;
            }
        }

        // ---------- Helpers ----------
        const currentChannelId = () => {
            const m = /^\/channels\/(?:@me|\d+)\/(\d+)/.exec(location.pathname);
            return m ? m[1] : null;
        };
        const channelAllowed = () => !settings.onlyChannels.length || settings.onlyChannels.includes(state.channelId);

        function checkChannel() {
            const id = currentChannelId();
            if (id === state.channelId) return false;
            state.channelId = id;
            state.ready = false;
            state.firstSeenAt = 0;
            state.baseline = 0n;
            state.baselineCount = 0;
            state.channelSince = Date.now();
            pendingEls = new Set();
            log('Channel changed:', id);
            return true;
        }

        // li id: chat-messages-<channelId>-<messageId> (older clients: just <messageId>)
        function parseLi(li) {
            const m = /^chat-messages-(?:(\d+)-)?(\d+)$/.exec(li.id);
            if (!m || m[2].length < 16) return null;
            try { return { channel: m[1] || null, id: BigInt(m[2]) }; } catch (_) { return null; }
        }

        function messageTimeMs(parsed) {
            return Number(parsed.id >> 22n) + 1420070400000;   // Discord snowflake -> UTC send time
        }

        function ageSec(parsed) {
            return (Date.now() + state.skew - messageTimeMs(parsed)) / 1000;
        }

        function findRobloxLink(root) {
            for (const anchor of root.querySelectorAll('a[href]')) {
                const proto = toRobloxProtocol(anchor.href);
                if (proto) return { proto, href: anchor.href };
            }
            return null;
        }

        // Author of a message (grouped messages have no header, so walk up to the previous one).
        function authorOf(li) {
            let node = li;
            for (let i = 0; i < 40 && node; i++) {
                const name = node.querySelector && (node.querySelector('h3 [id^="message-username-"]') || node.querySelector('[id^="message-username-"]'));
                if (name) return (name.textContent || '').trim();
                node = node.previousElementSibling;
            }
            return '';
        }

        function userBlocked(author) {
            const name = String(author || '').toLowerCase();
            if (!name) return false;   // unknown author: never block (fail open)
            if (settings.allowUsers.length && !settings.allowUsers.some(entry => name.includes(entry))) return true;
            return settings.blockUsers.some(entry => name.includes(entry));
        }

        // Message text + first Roblox link. Roblox's own link-preview card is ignored on purpose.
        function readMessage(li) {
            const content = li.querySelector('[id^="message-content-"]');
            const accessories = settings.scanEmbeds ? li.querySelector('[id^="message-accessories-"]') : null;
            if (!content && !accessories) return null;

            let text = content ? (content.textContent || '') : '';
            let link = content ? findRobloxLink(content) : null;
            if (accessories) {
                const embedLink = findRobloxLink(accessories);
                const isPreviewOfSameLink = Boolean(link && embedLink && link.proto === embedLink.proto);
                if (!isPreviewOfSameLink) {
                    text += ' ' + (accessories.textContent || '');
                    if (!link) link = embedLink;
                }
            }
            return link ? { text, proto: link.proto } : null;
        }

        function verdict(text) {
            const r = analyzer.analyze(text);
            if (r.snipe) return '✅ OPENS (' + r.word + ')';
            if (r.hits.length) return '⛔ BLOCKED (' + r.hits.map(h => h.why).filter(Boolean).join('; ') + ')';
            return '· no match (for the selected biomes)';
        }
        pageWin.sniperTest = text => { const v = verdict(text); console.log('[Sniper test]', JSON.stringify(text), '→', v); return v; };
        pageWin.sniperStatus = () => ({
            version: VERSION, enabled: state.enabled, channelId: state.channelId, ready: state.ready,
            selected: [...selected], custom: custom.slice(), launched: state.launched, newLinks: state.newLinks,
            joinLockUntil: state.joinLockUntil, clock: state.clockState, skewMs: Math.round(state.skew),
            typoMode: settings.typoMode, webhookConfigured: Boolean(validateWebhookUrl(settings.webhookUrl))
        });

        // ---------- Activity log + history ----------
        const LABELS = {
            snipe: ['🚀 LAUNCHED', '#57f287'], pending: ['👆 TAP TO OPEN', '#4da3ff'], block: ['⛔ BLOCKED', '#ff6b6b'], none: ['· no match', '#8b98a9'],
            dup: ['↺ duplicate', '#8b98a9'], lock: ['🔒 join lock', '#ffb454'], off: ['⏸ paused', '#ffb454'],
            skip: ['⇣ lower priority', '#ffb454'], spam: ['🛑 spam guard', '#ff6b6b'],
            user: ['🚫 user filter', '#ff6b6b'], fail: ['⚠ launch failed', '#ff6b6b']
        };

        function addLog(kind, text, proto, author) {
            logs.unshift({ kind, text, proto: proto || '', author: author || '', t: new Date() });
            if (logs.length > 14) logs.pop();
            log(kind, text);
            renderLogs();
        }

        function pushHistory(entry) {
            history.unshift(entry);
            if (history.length > 40) history.length = 40;
            store.set('history', history);
            renderHistory();
        }

        // ---------- Detection pipeline ----------
        function evaluate(li, now) {
            const parsed = parseLi(li);
            if (!parsed) { done.add(li.id); return null; }
            if (parsed.channel && parsed.channel !== state.channelId) return null;

            // Only process messages sent AFTER this channel became active.
            // Do not compare against the highest visible ID after a settling delay:
            // that can swallow a genuinely new message which arrives during loading.
            if (messageTimeMs(parsed) < state.channelSince + state.skew) {
                done.add(li.id);
                return null;
            }

            const age = ageSec(parsed);
            if (settings.maxAgeSec && age > settings.maxAgeSec) { done.add(li.id); return null; }

            const message = readMessage(li);
            if (!message) return null;                       // not rendered yet / no link: look again later

            const fingerprint = message.proto + '|' + message.text;
            if (texts.get(li.id) === fingerprint) return null;
            if (!texts.has(li.id)) state.newLinks++;
            texts.set(li.id, fingerprint);

            const preview = message.text.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 70) || '(link only)';
            const result = analyzer.analyze(message.text);
            if (!result.snipe) {
                addLog(result.hits.length ? 'block' : 'none',
                    result.hits.length ? preview + ' → ' + result.hits.map(h => h.why).filter(Boolean).join('; ') : preview);
                return null;
            }

            done.add(li.id);
            return {
                id: parsed.id, age, proto: message.proto, word: result.word, pri: result.pri,
                preview, author: authorOf(li)
            };
        }

        function canLaunch(candidate, now, alreadyLaunchedInBatch) {
            if (!state.enabled) return 'off';
            if (userBlocked(candidate.author)) return 'user';

            for (const [key, at] of launchedKeys) if (now - at > 15 * 60 * 1000) launchedKeys.delete(key);
            if (launchedKeys.has(candidate.proto)) return 'dup';

            if (settings.spamGuard) {
                while (recentLaunches.length && now - recentLaunches[0] > 20000) recentLaunches.shift();
                if (now < state.pausedUntil) return 'spam';
                if (recentLaunches.length >= 4) { state.pausedUntil = now + 30000; return 'spam'; }
            }

            if (settings.priorityPick && alreadyLaunchedInBatch) return 'skip';

            const lockActive = state.joinLockUntil > now;
            const canBypass = settings.bypassLockRare && candidate.pri >= 90;
            if (lockActive && !canBypass) return 'lock';
            return 'ok';
        }

        function recordLaunch(candidate, now, t0) {
            const processMs = Math.max(0, performance.now() - t0);

            launchedKeys.set(candidate.proto, now);
            recentLaunches.push(now);
            state.lastLaunch = now;
            state.launched++;
            if (settings.joinLockMs > 0) {
                syncJoinLock(now + settings.joinLockMs, now, false);
            }
            busPost({
                type: 'launched',
                key: candidate.proto,
                lockUntil: state.joinLockUntil,
                lockUpdatedAt: state.joinLockUpdatedAt
            });
            beep(candidate.pri);
            state.lastSnipe = { word: candidate.word, at: now, ageSec: candidate.age, processMs };
            addLog('snipe', '"' + candidate.word + '" · ' + candidate.preview +
                ' · ' + candidate.age.toFixed(1) + 's old · ' + processMs.toFixed(1) + 'ms', candidate.proto, candidate.author);
            pushHistory({ t: now, biome: candidate.word, user: candidate.author, ageSec: Math.round(candidate.age * 10) / 10, ms: Math.round(processMs * 10) / 10 });
            sendWebhook({ biome: candidate.word, processMs });
        }

        function doLaunch(candidate, now, t0) {
            if (IS_IPAD) {
                // Queue the best match and wait for an explicit Safari tap.
                // Join Lock starts only after the tap actually requests the app handoff.
                showIPadOpenButton(candidate, now, t0);
                addLog('pending', '"' + candidate.word + '" detected · tap the OPEN ROBLOX button to continue', candidate.proto, candidate.author);
                return;
            }

            const ok = launch(candidate.proto);            // launch first; bookkeeping after
            if (!ok) { addLog('fail', candidate.word + ' · ' + candidate.preview, candidate.proto, candidate.author); return; }
            recordLaunch(candidate, now, t0);
        }

        function dispatch(candidates, now, t0) {
            if (!candidates.length) return;
            candidates.sort((a, b) => {
                if (settings.priorityPick && b.pri !== a.pri) return b.pri - a.pri;
                return b.id > a.id ? 1 : b.id < a.id ? -1 : 0;     // newest first
            });
            let launchedInBatch = false;
            for (const candidate of candidates) {
                const verdictKind = canLaunch(candidate, now, launchedInBatch);
                if (verdictKind !== 'ok') {
                    addLog(verdictKind, '"' + candidate.word + '" · ' + candidate.preview, candidate.proto, candidate.author);
                    continue;
                }
                doLaunch(candidate, now, t0);
                launchedInBatch = true;
            }
        }

        function processPending(t0) {
            const items = [...pendingEls];
            pendingEls = new Set();
            const now = Date.now();
            const candidates = [];
            for (const li of items) {
                if (!li.isConnected || done.has(li.id)) continue;
                const candidate = evaluate(li, now);
                if (candidate) candidates.push(candidate);
            }
            dispatch(candidates, now, t0);
        }

        // Let Discord finish its initial render, but classify old/new messages by
        // their own Snowflake timestamps rather than the newest ID visible after a delay.
        // This prevents a real-time message arriving during channel loading from being
        // swallowed into the old-message baseline.
        function establishBaseline(items, now) {
            let maxOld = 0n, visibleCount = 0, oldCount = 0;
            const openedAt = state.channelSince + state.skew;

            for (const li of items) {
                const parsed = parseLi(li);
                if (!parsed || (parsed.channel && parsed.channel !== state.channelId)) continue;
                visibleCount++;

                if (messageTimeMs(parsed) < openedAt) {
                    oldCount++;
                    if (parsed.id > maxOld) maxOld = parsed.id;
                }
            }

            if (visibleCount > 0 && !state.firstSeenAt) {
                state.firstSeenAt = now;
                setTimeout(safeScan, settings.settleMs + 30);
            }

            if (visibleCount > 0 && now - state.firstSeenAt >= settings.settleMs) {
                state.baseline = maxOld;       // diagnostic only; never used to reject new messages
                state.baselineCount = oldCount;
                state.ready = true;
                log('Monitor ready:', oldCount, 'older messages ignored; newer messages remain eligible');
                setTimeout(safeScan, 0);
            } else if (visibleCount === 0 && now - state.channelSince >= 5000) {
                // Empty channel: timestamp filtering still protects against delayed history.
                state.baseline = 0n;
                state.baselineCount = 0;
                state.ready = true;
                log('Monitor ready on empty channel');
                setTimeout(safeScan, 0);
            }
        }

        // Safety-net full scan (the MutationObserver is the fast path).
        function scan() {
            const t0 = performance.now();
            checkChannel();
            if (!state.channelId || !channelAllowed()) return;
            const now = Date.now();
            const items = document.querySelectorAll('li[id^="chat-messages-"]');
            if (!state.ready) { establishBaseline(items, now); return; }

            const candidates = [];
            for (const li of items) {
                if (done.has(li.id)) continue;
                const candidate = evaluate(li, now);
                if (candidate) candidates.push(candidate);
            }
            dispatch(candidates, now, t0);

            if (done.size > 6000) {          // keep the newest half
                const keep = [...done].slice(-3000);
                done.clear(); keep.forEach(id => done.add(id));
            }
            if (texts.size > 6000) texts.clear();
        }
        function safeScan() { try { scan(); } catch (error) { console.error('[Sniper] scan error', error); } }

        // ---------- Fast path: MutationObserver -> per-message queue -> microtask ----------
        function collectMessages(node, bucket) {
            if (!node) return;
            const element = node.nodeType === 1 ? node : node.parentElement;
            if (!element) return;
            const li = element.closest ? element.closest('li[id^="chat-messages-"]') : null;
            if (li) { bucket.add(li); return; }
            if (node.nodeType !== 1) return;
            if (node.tagName === 'OL' || node.tagName === 'UL' || node.tagName === 'DIV') {
                node.querySelectorAll('li[id^="chat-messages-"]').forEach(item => bucket.add(item));
            }
        }

        // childList: only the ADDED nodes (a new message must not re-queue the whole list);
        // changes inside an existing message (edits, embeds) are caught through closest().
        function collectFromRecord(record, bucket) {
            if (record.type === 'characterData') { collectMessages(record.target, bucket); return; }
            const target = record.target;
            const inside = target && target.closest ? target.closest('li[id^="chat-messages-"]') : null;
            if (inside) bucket.add(inside);
            for (const added of record.addedNodes) collectMessages(added, bucket);
        }

        let microScheduled = false, pendingT0 = 0;
        function scheduleProcess(t0) {
            if (!pendingT0) pendingT0 = t0;
            if (microScheduled) return;
            microScheduled = true;
            queueMicrotask(() => {
                microScheduled = false;
                const startedAt = pendingT0; pendingT0 = 0;
                try { processPending(startedAt); } catch (error) { console.error('[Sniper] process error', error); }
            });
        }

        function onMutations(mutations) {
            const t0 = performance.now();
            if (ui.root && mutations.every(record => ui.root.contains(record.target))) return;   // our own panel
            state.lastMutationAt = Date.now();
            checkChannel();
            if (!state.channelId || !channelAllowed()) return;
            if (!state.ready) { safeScan(); return; }

            let found = false;
            for (const record of mutations) {
                if (ui.root && ui.root.contains(record.target)) continue;
                const before = pendingEls.size;
                collectFromRecord(record, pendingEls);
                if (pendingEls.size > before) found = true;
            }
            if (found) scheduleProcess(t0);
        }

        // ---------- Self-test (engine integrity check) ----------
        const SELF_TESTS = [
            ['glitch', true], ['gLİTCHEDdd', true], ['glicth', true], ['cyber space', true], ['dreamscape', true],
            ['singu', true], ['sinsstere', true], ['boss', true], ['dont miss glitch', true], ['not fake glitch', true],
            ['not cyber', false], ['glitch ended', false], ['fake dreamspace', false], ['glitch too late', false],
            ['no singularity', false], ['minister', false], ['sister', false], ['single', false], ['blood rain', false], ['hello', false]
        ];
        function runSelfTest() {
            const test = makeAnalyzer({
                negators: CONFIG.negators, ignoreWords: CONFIG.ignoreWords, realWords: CONFIG.realWords, typoMode: 'balanced',
                keywords: buildKeywords(['glitched', 'dreamspace', 'cyberspace', 'singularity', 'sinister'], [])
            });
            const failed = SELF_TESTS.filter(([text, expected]) => test.analyze(text).snipe !== expected).map(([text]) => text);
            return failed.length ? '⚠ ' + (SELF_TESTS.length - failed.length) + '/' + SELF_TESTS.length + ' passed · failed: ' + failed.join(', ')
                                 : '✅ ' + SELF_TESTS.length + '/' + SELF_TESTS.length + ' engine tests passed';
        }

        // ---------- UI ----------
        const ui = { boxes: {}, panes: {}, tabs: {} };
        const THEMES = {
            blue: ['#0b1d35', '#102b4e', '#28558c', '#4da3ff'],
            purple: ['#1c1035', '#32165a', '#7541a5', '#b07cff'],
            dark: ['#111827', '#1f2937', '#4b5563', '#9ca3af']
        };
        const CSS = `
.rbsx-badge{position:fixed;right:16px;bottom:76px;z-index:2147483000;padding:6px 12px;border-radius:16px;color:#fff;font:12px/1.2 Segoe UI,Arial,sans-serif;cursor:pointer;user-select:none;box-shadow:0 2px 8px rgba(0,0,0,.45)}
.rbsx-panel{position:fixed;right:16px;bottom:112px;z-index:2147483000;max-width:calc(100vw - 32px);max-height:76vh;display:none;flex-direction:column;border:1px solid var(--bd);border-radius:12px;background:linear-gradient(155deg,var(--bg1),var(--bg2));color:#e6edf7;font:12px/1.4 Segoe UI,Arial,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.6);overflow:hidden}
.rbsx-panel.open{display:flex}
.rbsx-head{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--bd);font-weight:700;font-size:13px}
.rbsx-head .sp{flex:1}
.rbsx-strip{display:flex;flex-wrap:wrap;gap:4px;padding:6px 10px;border-bottom:1px solid var(--bd)}
.rbsx-chip{background:rgba(255,255,255,.08);border-radius:10px;padding:1px 8px;white-space:nowrap}
.rbsx-tabs{display:flex;border-bottom:1px solid var(--bd)}
.rbsx-tab{flex:1;padding:6px 2px;text-align:center;cursor:pointer;color:#9fb3cc;user-select:none}
.rbsx-tab.on{color:#fff;background:rgba(255,255,255,.08);box-shadow:inset 0 -2px 0 var(--ac)}
.rbsx-body{overflow:auto;padding:8px 10px}
.rbsx-pane{display:none}.rbsx-pane.on{display:block}
.rbsx-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:5px 0}
.rbsx-row>span{flex:1}
.rbsx-gt{margin:9px 0 3px;font-weight:700;color:#b9c9de}
.rbsx-grid{display:grid;grid-template-columns:1fr 1fr;gap:2px 8px}
.rbsx-chk{cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rbsx-btn{padding:3px 9px;border:0;border-radius:6px;background:var(--ac);color:#04101f;font-weight:700;cursor:pointer;font-size:11px}
.rbsx-btn.gray{background:rgba(255,255,255,.14);color:#e6edf7}
.rbsx-in,.rbsx-sel,.rbsx-ta{box-sizing:border-box;padding:4px 6px;border-radius:6px;border:1px solid var(--bd);background:rgba(0,0,0,.35);color:#fff;font:12px Segoe UI,Arial,sans-serif}
.rbsx-in,.rbsx-ta{width:100%}.rbsx-ta{min-height:46px;resize:vertical}
.rbsx-tag{display:inline-block;background:rgba(255,255,255,.1);border-radius:10px;padding:1px 8px;margin:3px 3px 0 0}
.rbsx-tag b{cursor:pointer;margin-left:5px;color:#ff6b6b}
.rbsx-log div{margin:3px 0;word-break:break-word}
.rbsx-dim{opacity:.65}
.rbsx-panel details{margin:8px 0}.rbsx-panel summary{cursor:pointer;font-weight:700}

/* iPadOS touch layout: compact badge, full-width panel, and a clear app-handoff button. */
@media (pointer: coarse), (max-width: 820px) {
  .rbsx-badge{
    right:12px; bottom:76px; min-height:44px; box-sizing:border-box;
    display:flex; align-items:center; padding:10px 14px;
    max-width:calc(100vw - 24px); font-size:13px; touch-action:manipulation;
  }
  .rbsx-panel{
    left:10px; right:10px; bottom:68px;
    width:calc(100vw - 20px)!important; max-width:none;
    max-height:78vh; max-height:78dvh; border-radius:16px;
  }
  .rbsx-head{min-height:44px; padding:10px 12px; font-size:14px}
  .rbsx-tabs{position:sticky; top:0; z-index:2}
  .rbsx-tab{min-height:46px; display:flex; align-items:center; justify-content:center; font-size:12px}
  .rbsx-body{padding:11px 12px; -webkit-overflow-scrolling:touch}
  .rbsx-row{gap:8px; align-items:center; flex-wrap:wrap}
  .rbsx-btn{min-height:40px; padding:9px 12px; font-size:12px; touch-action:manipulation}
  .rbsx-in,.rbsx-sel,.rbsx-ta{min-height:42px; font-size:16px; padding:9px}
  .rbsx-chk{min-height:38px; display:flex; align-items:center; font-size:13px}
  .rbsx-chk input{width:19px; height:19px; margin-right:8px}
  .rbsx-grid{gap:6px 10px}
  .rbsx-ipad-launch{
    position:fixed; z-index:2147483647; left:50%; bottom:14px;
    transform:translateX(-50%); min-height:52px; min-width:220px;
    max-width:calc(100vw - 28px); padding:13px 22px;
    border:1px solid rgba(255,255,255,.3); border-radius:26px;
    background:#2563eb; color:#fff; box-shadow:0 6px 24px rgba(0,0,0,.45);
    font:700 14px -apple-system,BlinkMacSystemFont,Arial,sans-serif;
    touch-action:manipulation;
  }
  .rbsx-ipad-launch[hidden]{display:none}
}
`;

        function el(tag, props, ...kids) {
            const node = document.createElement(tag);
            if (props) for (const key in props) {
                if (key === 'class') node.className = props[key];
                else if (key.startsWith('on')) node.addEventListener(key.slice(2), props[key]);
                else node[key] = props[key];
            }
            for (const kid of kids) if (kid != null) node.append(kid);
            return node;
        }
        function setText(node, text) { if (node && node.textContent !== text) node.textContent = text; }

        function saveSetting(key, value) {
            settings[key] = value;
            store.set(key, value);
            if (key === 'typoMode') rebuildAnalyzer();
            if (key === 'scanEmbeds' || key === 'typoMode') texts.clear();
            if (key === 'theme' || key === 'panelWidth') applyTheme();
            if (key === 'joinLockMs' && value === 0) releaseLock();
            if (key === 'clockSync') syncClock();
            renderAll();
        }
        function saveList(key, text) {
            const list = String(text || '').split(/[,\n]+/).map(item => item.trim().toLowerCase()).filter(Boolean);
            settings[key] = [...new Set(list)];
            store.set(key, settings[key]);
            renderAll();
        }
        function releaseLock() {
            syncJoinLock(0, Date.now(), true);
            renderAll();
        }

        function applySelection() {
            store.set('sel', [...selected]);
            store.set('custom', custom);
            rebuildAnalyzer();
            texts.clear();
            renderAll();
        }
        function setSelection(ids) {
            selected.clear(); ids.forEach(id => selected.add(id));
            for (const id in ui.boxes) ui.boxes[id].checked = selected.has(id);
            applySelection();
        }
        function toggleSniper() { state.enabled = !state.enabled; renderAll(); }

        function selectControl(key, options, parse) {
            const select = el('select', { class: 'rbsx-sel', onchange: () => saveSetting(key, parse(select.value)) },
                ...options.map(([value, label]) => el('option', { value: String(value), textContent: label })));
            select.value = String(settings[key]);
            ui['sel_' + key] = select;
            return select;
        }
        const asBool = value => value === 'true';
        const row = (label, control) => el('div', { class: 'rbsx-row' }, el('span', { textContent: label }), control);

        function renderCustom() {
            if (!ui.customList) return;
            ui.customList.replaceChildren(...custom.map(word => el('span', { class: 'rbsx-tag' }, word,
                el('b', { textContent: '✕', title: 'Remove', onclick: () => { custom = custom.filter(item => item !== word); renderCustom(); applySelection(); } }))));
        }
        function addCustom() {
            const phrase = ui.customIn.value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
            ui.customIn.value = '';
            if (phrase.replace(/\s/g, '').length < 3 || custom.includes(phrase)) return;
            custom.push(phrase); renderCustom(); applySelection();
        }

        function renderLogs() {
            if (!ui.log) return;
            ui.log.replaceChildren(...logs.map(entry => {
                const [name, color] = LABELS[entry.kind];
                const line = el('div', null,
                    el('span', { style: 'color:' + color + ';font-weight:700', textContent: name + ' ' }),
                    el('span', { class: 'rbsx-dim', textContent: entry.t.toLocaleTimeString() + '  ' }),
                    el('span', { textContent: entry.text }));
                if (entry.proto) line.append(' ', el('button', { class: 'rbsx-btn', textContent: 'Open', onclick: () => launch(entry.proto, true) }));
                if (entry.author) line.append(' ', el('button', { class: 'rbsx-btn gray', textContent: 'Block user', onclick: () => {
                    saveList('blockUsers', [...settings.blockUsers, entry.author.toLowerCase()].join(','));
                    ui.blockTa.value = settings.blockUsers.join(', ');
                } }));
                return line;
            }));
        }
        function renderHistory() {
            if (!ui.history) return;
            ui.history.replaceChildren(...history.map(item => el('div', { class: 'rbsx-dim',
                textContent: new Date(item.t).toLocaleTimeString() + ' · ' + item.biome + (item.user ? ' · ' + item.user : '') +
                    ' · ' + item.ageSec + 's old · ' + item.ms + 'ms' })));
            if (!history.length) ui.history.textContent = 'No launches yet.';
        }

        function monitorText() {
            if (!state.channelId) return 'idle';
            if (!channelAllowed()) return 'paused (channel not allowed)';
            if (!state.ready) return 'loading…';
            return 'watching';
        }
        function applyTheme() {
            if (!ui.panel) return;
            const p = THEMES[settings.theme] || THEMES.blue;
            const s = ui.panel.style;
            s.setProperty('--bg1', p[0]); s.setProperty('--bg2', p[1]); s.setProperty('--bd', p[2]); s.setProperty('--ac', p[3]);
            s.width = settings.panelWidth + 'px';
        }

        function renderAll() {
            if (!ui.badge) return;
            const now = Date.now();
            const count = selected.size + custom.length;
            const lockLeft = Math.max(0, state.joinLockUntil - now);
            const paused = now < state.pausedUntil;

            setText(ui.badge, (!state.enabled ? '⏸ Sniper: OFF' : paused ? '🛑 Sniper: spam pause' : '🎯 Sniper: ON') + ' · ' + count);
            ui.badge.style.background = !count ? '#a33' : paused ? '#a33' : state.enabled ? '#1f8b4c' : '#5b6574';
            setText(ui.toggleBtn, state.enabled ? 'Turn off (Alt+S)' : 'Turn on (Alt+S)');

            setText(ui.chipMonitor, '● ' + monitorText());
            setText(ui.chipLock, lockLeft ? '🔒 ' + Math.ceil(lockLeft / 1000) + 's' : '🔓 free');
            setText(ui.chipLast, state.lastSnipe ? '🚀 ' + state.lastSnipe.word + ' · ' + state.lastSnipe.processMs.toFixed(1) + 'ms' : '🚀 –');
            setText(ui.chipClock, '🕒 ' + (state.clockState === 'synced' ? 'synced' : state.clockState === 'off' ? 'off' : 'unsynced'));

            setText(ui.sumBiomes, count ? 'Selected: ' + count : 'NOTHING SELECTED');
            setText(ui.stChan, 'Channel: ' + (state.channelId || '–') + (state.channelId && !channelAllowed() ? ' ✗ not allowed' : ''));
            setText(ui.stReady, 'Monitor: ' + monitorText() + (state.ready ? ' · ' + state.baselineCount + ' older messages ignored' : ''));
            setText(ui.stClock, 'Clock: ' + state.clockState + ' (' + (state.skew / 1000).toFixed(1) + 's offset)');
            setText(ui.stCount, 'New links: ' + state.newLinks + ' · Launched: ' + state.launched);
            setText(ui.stEvents, 'Last page change: ' + (state.lastMutationAt ? Math.round((now - state.lastMutationAt) / 1000) + 's ago' : '–'));
            setText(ui.lockBtn, lockLeft ? 'Release join lock (Alt+L)' : 'Join lock is free');
            ui.lockBtn.disabled = lockLeft <= 0;
            ui.lockBtn.title = lockLeft > 0 ? 'Release the active Join Lock in every Discord tab' : 'No active Join Lock';
        }

        function buildUI() {
            if (ui.root || !document.body) return;

            ui.badge = el('div', { class: 'rbsx-badge', title: 'Show / hide panel (Alt+P)', onclick: () => ui.panel.classList.toggle('open') });
            ui.toggleBtn = el('button', { class: 'rbsx-btn', onclick: toggleSniper });

            ui.chipMonitor = el('span', { class: 'rbsx-chip' });
            ui.chipLock = el('span', { class: 'rbsx-chip' });
            ui.chipLast = el('span', { class: 'rbsx-chip' });
            ui.chipClock = el('span', { class: 'rbsx-chip' });

            // --- Tab: Biomes ---
            const biomePane = el('div', { class: 'rbsx-pane on' });
            ui.sumBiomes = el('b');
            biomePane.append(el('div', { class: 'rbsx-row' }, ui.sumBiomes,
                el('span', null, ...PRESETS.map(preset => el('button', { class: 'rbsx-btn gray', style: 'margin:0 3px 3px 0', textContent: preset.name, onclick: () => setSelection(preset.ids) })))));
            for (const group of GROUPS) {
                biomePane.append(el('div', { class: 'rbsx-gt', textContent: group.title }));
                const grid = el('div', { class: 'rbsx-grid' });
                for (const biome of BIOMES.filter(item => item.g === group.id)) {
                    const box = el('input', { type: 'checkbox', checked: selected.has(biome.id),
                        onchange: () => { box.checked ? selected.add(biome.id) : selected.delete(biome.id); applySelection(); } });
                    ui.boxes[biome.id] = box;
                    grid.append(el('label', { class: 'rbsx-chk', title: biome.name }, box, ' ' + biome.name));
                }
                biomePane.append(grid);
            }

            // --- Tab: Keywords ---
            const keywordPane = el('div', { class: 'rbsx-pane' });
            ui.customIn = el('input', { class: 'rbsx-in', placeholder: 'Add your own word or phrase (e.g. clockwork) + Enter',
                onkeydown: event => { event.stopPropagation(); if (event.key === 'Enter') addCustom(); } });
            ui.customList = el('div');
            ui.testIn = el('input', { class: 'rbsx-in', style: 'margin-top:6px', placeholder: 'Test a message: e.g. singu  /  not cyber  /  dont miss glitch',
                onkeydown: event => event.stopPropagation(),
                oninput: () => setText(ui.testOut, ui.testIn.value.trim() ? verdict(ui.testIn.value) : '') });
            ui.testOut = el('div', { class: 'rbsx-row rbsx-dim' });
            keywordPane.append(el('div', { class: 'rbsx-gt', textContent: '✏️ Your own words (exact words or phrases)' }), ui.customIn, ui.customList,
                el('div', { class: 'rbsx-gt', textContent: '🧪 Message tester' }), ui.testIn, ui.testOut);

            // --- Tab: Rules ---
            const rulesPane = el('div', { class: 'rbsx-pane' });
            ui.channelIn = el('input', { class: 'rbsx-in', value: settings.onlyChannels.join(', '), placeholder: 'empty = every channel',
                onkeydown: event => event.stopPropagation(), onchange: () => saveList('onlyChannels', ui.channelIn.value) });
            ui.blockTa = el('textarea', { class: 'rbsx-ta', value: settings.blockUsers.join(', '), placeholder: 'names to ignore (trolls, fake-link posters)',
                onkeydown: event => event.stopPropagation(), onchange: () => saveList('blockUsers', ui.blockTa.value) });
            ui.allowTa = el('textarea', { class: 'rbsx-ta', value: settings.allowUsers.join(', '), placeholder: 'if filled, ONLY these names can trigger a launch',
                onkeydown: event => event.stopPropagation(), onchange: () => saveList('allowUsers', ui.allowTa.value) });
            ui.lockBtn = el('button', { class: 'rbsx-btn gray', onclick: releaseLock });
            rulesPane.append(
                row('Typo tolerance', selectControl('typoMode', [['strict', 'Strict'], ['balanced', 'Balanced'], ['aggressive', 'Aggressive']], String)),
                row('Several links at once', selectControl('priorityPick', [[true, 'Open only the rarest'], [false, 'Open newest first']], asBool)),
                row('Join lock after launch', selectControl('joinLockMs', [[0, 'Off'], [30000, '30 s'], [60000, '1 min'], [120000, '2 min'], [300000, '5 min'], [600000, '10 min']], Number)),
                row('Rare biomes override lock', selectControl('bypassLockRare', [[false, 'No'], [true, 'Yes']], asBool)),
                row('', ui.lockBtn),
                row('Ignore messages older than', selectControl('maxAgeSec', [[0, 'Off'], [15, '15 s'], [30, '30 s'], [45, '45 s'], [90, '90 s']], Number)),
                row('Spam guard (pause after 4 launches / 20 s)', selectControl('spamGuard', [[true, 'On'], [false, 'Off']], asBool)),
                row('Read bot embeds (experimental)', selectControl('scanEmbeds', [[false, 'Off'], [true, 'On']], asBool)),
                el('div', { class: 'rbsx-gt', textContent: '📍 Only watch these channel IDs' }), ui.channelIn,
                el('div', { class: 'rbsx-row' }, el('span', { class: 'rbsx-dim', textContent: 'Current channel is shown on the status line.' }),
                    el('button', { class: 'rbsx-btn gray', textContent: 'Use current', onclick: () => { if (state.channelId) { ui.channelIn.value = state.channelId; saveList('onlyChannels', state.channelId); } } })),
                el('div', { class: 'rbsx-gt', textContent: '🚫 Blocked users' }), ui.blockTa,
                el('div', { class: 'rbsx-gt', textContent: '✅ Trusted users only (optional)' }), ui.allowTa);

            // --- Tab: Activity ---
            const activityPane = el('div', { class: 'rbsx-pane' });
            ui.log = el('div', { class: 'rbsx-log' });
            ui.history = el('div');
            activityPane.append(ui.log, el('details', null, el('summary', { textContent: '📜 Launch history (saved)' }), ui.history));

            // --- Tab: Settings ---
            const settingsPane = el('div', { class: 'rbsx-pane' });
            ui.stChan = el('div', { class: 'rbsx-dim' }); ui.stReady = el('div', { class: 'rbsx-dim' });
            ui.stClock = el('div', { class: 'rbsx-dim' }); ui.stCount = el('div', { class: 'rbsx-dim' }); ui.stEvents = el('div', { class: 'rbsx-dim' });
            ui.selfOut = el('div', { class: 'rbsx-row' });
            ui.webhookIn = el('input', { class: 'rbsx-in', type: 'password', value: settings.webhookUrl, placeholder: 'https://discord.com/api/webhooks/…',
                autocomplete: 'off', onkeydown: event => event.stopPropagation(),
                onchange: () => { settings.webhookUrl = ui.webhookIn.value.trim(); store.set('webhookUrl', settings.webhookUrl); } });
            ui.webhookStatus = el('div', { class: 'rbsx-dim', textContent: webhookStatus });
            ui.ioTa = el('textarea', { class: 'rbsx-ta', placeholder: 'Settings JSON (webhook URL is never exported)', onkeydown: event => event.stopPropagation() });
            ui.ioOut = el('div', { class: 'rbsx-dim' });
            settingsPane.append(
                el('div', { class: 'rbsx-gt', textContent: '📊 Status' }),
                ...(IS_IPAD ? [el('div', {
                    class: 'rbsx-dim',
                    textContent: 'iPad Safari mode: detected links wait for a tap. Press the blue OPEN ROBLOX button to hand off to the Roblox app.'
                })] : []),
                ui.stChan, ui.stReady, ui.stClock, ui.stCount, ui.stEvents,
                el('div', { class: 'rbsx-gt', textContent: '🛠 Tools' }),
                el('div', { class: 'rbsx-row' },
                    el('button', { class: 'rbsx-btn', textContent: 'Run engine self-test', onclick: () => setText(ui.selfOut, runSelfTest()) }),
                    el('button', { class: 'rbsx-btn gray', textContent: 'Test Roblox launch', onclick: () => launch('roblox://', true) })),
                ui.selfOut,
                row('Sound', selectControl('sound', [[true, 'On'], [false, 'Off']], asBool)),
                row('Clock sync', selectControl('clockSync', [[true, 'On (recommended)'], [false, 'Off']], asBool)),
                row('Wait after opening a channel', selectControl('settleMs', [[300, '0.3 s'], [500, '0.5 s'], [700, '0.7 s'], [1000, '1 s']], Number)),
                row('Safety scan interval', selectControl('fallbackScanMs', [[1000, '1 s'], [1500, '1.5 s'], [3000, '3 s'], [5000, '5 s']], Number)),
                row('Theme', selectControl('theme', [['blue', 'Ocean blue'], ['purple', 'Neon purple'], ['dark', 'Stealth dark']], String)),
                row('Panel width', selectControl('panelWidth', [[340, 'Compact'], [400, 'Normal'], [480, 'Wide']], Number)),
                el('div', { class: 'rbsx-gt', textContent: '🔔 Discord webhook (optional)' }),
                row('Send launch reports', selectControl('webhookEnabled', [[false, 'Off'], [true, 'On']], asBool)),
                ui.webhookIn,
                el('div', { class: 'rbsx-row' }, ui.webhookStatus, el('button', { class: 'rbsx-btn gray', textContent: 'Send test', onclick: () => sendWebhook({ test: true }) })),
                el('div', { class: 'rbsx-gt', textContent: '💾 Backup' }), ui.ioTa,
                el('div', { class: 'rbsx-row' },
                    el('button', { class: 'rbsx-btn gray', textContent: 'Export', onclick: () => {
                        const copy = Object.assign({}, settings); delete copy.webhookUrl;
                        ui.ioTa.value = JSON.stringify({ v: 8, sel: [...selected], custom, settings: copy });
                        setText(ui.ioOut, 'Exported. Copy the text above.');
                    } }),
                    el('button', { class: 'rbsx-btn gray', textContent: 'Import', onclick: () => importSettings(ui.ioTa.value) })),
                ui.ioOut,
                el('div', { class: 'rbsx-dim', style: 'margin-top:8px', textContent: 'Hotkeys: Alt+S on/off · Alt+L release lock · Alt+P show/hide panel' }));

            const names = [['biomes', '🧬 Biomes', biomePane], ['keywords', '✏ Words', keywordPane], ['rules', '🛡 Rules', rulesPane], ['activity', '📜 Activity', activityPane], ['settings', '⚙ Settings', settingsPane]];
            const tabs = el('div', { class: 'rbsx-tabs' });
            for (const [id, label, pane] of names) {
                ui.panes[id] = pane;
                ui.tabs[id] = el('div', { class: 'rbsx-tab' + (id === 'biomes' ? ' on' : ''), textContent: label, onclick: () => showTab(id) });
                tabs.append(ui.tabs[id]);
            }
            function showTab(id) { for (const key in ui.panes) { ui.panes[key].classList.toggle('on', key === id); ui.tabs[key].classList.toggle('on', key === id); } }

            ui.panel = el('div', { class: 'rbsx-panel' + (CONFIG.panelOpenAtStart ? ' open' : '') },
                el('div', { class: 'rbsx-head' }, '🎯 Madness BiomeSniperX v' + VERSION, el('span', { class: 'sp' }), ui.toggleBtn),
                el('div', { class: 'rbsx-strip' }, ui.chipMonitor, ui.chipLock, ui.chipLast, ui.chipClock),
                tabs,
                el('div', { class: 'rbsx-body' }, biomePane, keywordPane, rulesPane, activityPane, settingsPane));
            ui.root = el('div', null, el('style', { textContent: CSS }), ui.badge, ui.panel);
            document.body.append(ui.root);
            applyTheme(); renderCustom(); renderLogs(); renderHistory(); renderAll();
        }

        function importSettings(text) {
            try {
                const data = JSON.parse(text);
                if (!data || typeof data !== 'object') throw new Error('bad format');
                if (Array.isArray(data.sel)) setSelection(data.sel.filter(id => knownIds.has(id)));
                if (Array.isArray(data.custom)) { custom = data.custom.map(String).slice(0, 60); renderCustom(); applySelection(); }
                const incoming = data.settings || {};
                const ranges = { joinLockMs: [0, 3600000], maxAgeSec: [0, 600], fallbackScanMs: [1000, 10000], settleMs: [200, 3000], panelWidth: [300, 520] };
                for (const key in ranges) if (key in incoming) saveSetting(key, clampNum(incoming[key], D[key], ranges[key][0], ranges[key][1]));
                for (const key of ['sound', 'priorityPick', 'bypassLockRare', 'spamGuard', 'clockSync', 'scanEmbeds', 'webhookEnabled']) if (key in incoming) saveSetting(key, incoming[key] === true);
                if (['strict', 'balanced', 'aggressive'].includes(incoming.typoMode)) saveSetting('typoMode', incoming.typoMode);
                if (['blue', 'purple', 'dark'].includes(incoming.theme)) saveSetting('theme', incoming.theme);
                for (const key of ['onlyChannels', 'blockUsers', 'allowUsers']) if (Array.isArray(incoming[key])) saveList(key, incoming[key].join(','));
                ui.channelIn.value = settings.onlyChannels.join(', ');
                ui.blockTa.value = settings.blockUsers.join(', ');
                ui.allowTa.value = settings.allowUsers.join(', ');
                for (const key in ui) if (key.startsWith('sel_') && ui[key] && settings[key.slice(4)] !== undefined) ui[key].value = String(settings[key.slice(4)]);
                setText(ui.ioOut, 'Imported ✓');
            } catch (error) { setText(ui.ioOut, 'Import failed: invalid JSON'); }
        }

        window.addEventListener('keydown', event => {
            if (!event.altKey) return;
            if (event.code === 'KeyS') { event.preventDefault(); toggleSniper(); }
            else if (event.code === 'KeyL') { event.preventDefault(); releaseLock(); }
            else if (event.code === 'KeyP' && ui.panel) { event.preventDefault(); ui.panel.classList.toggle('open'); }
        }, true);

        // ---------- Start ----------
        const boot = setInterval(() => {
            if (!document.body || !document.getElementById('app-mount')) return;
            clearInterval(boot);
            buildUI();
            syncClock();
            setInterval(syncClock, 30 * 60 * 1000);
            new MutationObserver(onMutations).observe(document.body, { childList: true, subtree: true, characterData: true });

            // Safety net + watchdog: full scan even if no mutation fired (e.g. throttled or re-rendered tab).
            let lastFallback = 0;
            setInterval(() => {
                const now = Date.now();
                if (now - lastFallback >= settings.fallbackScanMs) { lastFallback = now; safeScan(); }
                renderAll();
            }, 500);
            document.addEventListener('visibilitychange', () => { if (!document.hidden) safeScan(); });
            window.addEventListener('focus', safeScan);
            log('Madness BiomeSniperX v' + VERSION + ' ready · test with sniperTest("singu")');
        }, 100);

        return;
    }

    // =========================================================
    // ROBLOX PAGE (fallback): stop loading, hand over to the app
    // =========================================================
    const proto = toRobloxProtocol(location.href);
    if (!proto) return;

    try { window.stop(); } catch (e) {}
    location.href = proto;

    setTimeout(function () {
        const root = document.documentElement;
        while (root.firstChild) root.removeChild(root.firstChild);
        const head = document.createElement('head');
        const title = document.createElement('title');
        title.textContent = 'Opening Roblox…';
        head.appendChild(title);
        const body = document.createElement('body');
        body.style.cssText = 'margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:#232527;color:#fff;font-family:Arial,sans-serif';
        const message = document.createElement('div');
        message.textContent = 'Opening Roblox… if nothing happens, press the button.';
        const button = document.createElement('button');
        button.textContent = 'Open Roblox';
        button.style.cssText = 'padding:14px 32px;font-size:18px;border:0;border-radius:8px;background:#335fff;color:#fff;cursor:pointer';
        button.addEventListener('click', () => { location.href = proto; });
        body.append(message, button);
        root.append(head, body);
    }, 500);
})();