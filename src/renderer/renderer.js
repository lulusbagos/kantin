document.addEventListener('DOMContentLoaded', () => {
    // --- Selektor Elemen DOM ---
    const elements = {
        clock: document.getElementById('clock'),
        date: document.getElementById('date'),
        barcodeInput: document.getElementById('barcode-input'),
        currentSession: document.getElementById('current-session'),
        appTitle: document.getElementById('app-title'),
        connectionStatus: {
            apiDot: document.getElementById('api-status-dot'),
            apiText: document.getElementById('api-status-text'),
            dbDot: document.getElementById('db-status-dot'),
            dbText: document.getElementById('db-status-text'),
        },
        visitorCounts: {
            pagi: document.getElementById('count-pagi'),
            siang: document.getElementById('count-siang'),
            malam: document.getElementById('count-malam'),
        },
        visitorCards: {
            pagi: document.getElementById('card-pagi'),
            siang: document.getElementById('card-siang'),
            malam: document.getElementById('card-malam'),
        },
        scanResult: {
            card: document.getElementById('scan-result-card'),
            placeholder: document.getElementById('scan-placeholder'),
            employeeDetails: document.getElementById('employee-details'),
            statusMessage: document.getElementById('scan-status-message'),
        },
        slideshow: {
            track: document.getElementById('slideshow-track'),
        },
        recentScans: {
            location: document.getElementById('recent-scans-location'),
            content: document.getElementById('recent-scans-content'),
            total: document.getElementById('recent-scans-total'),
        },
        settings: {
            btn: document.getElementById('settings-btn'),
            modal: document.getElementById('settings-modal'),
            closeBtn: document.getElementById('close-settings-btn'),
            tabs: document.querySelectorAll('.settings-tab'),
            tabContents: document.querySelectorAll('.settings-tab-content'),
            appSettingsForm: document.getElementById('app-settings-form'),
            resetThemeBtn: document.getElementById('reset-theme-btn'),
            saveIndicator: document.getElementById('save-indicator'),
            mealPlanDatePicker: document.getElementById('meal-plan-date-picker'),
            mealPlanEditor: document.getElementById('meal-plan-editor'),
            scanHistoryBody: document.getElementById('scan-history-body'),
            errorLogBody: document.getElementById('error-log-body'),
            refreshErrorLogsBtn: document.getElementById('refresh-error-logs-btn'),
        },
        forms: {
            report: document.getElementById('report-form'),
            peakmealReport: document.getElementById('peakmeal-report-form'),
            imageUpload: document.getElementById('image-upload-form'),
            mealPlanUpload: document.getElementById('meal-plan-upload-form'),
        },
        toast: document.getElementById('toast'),
        sound: {
            headerToggleBtn: document.getElementById('header-sound-toggle-btn'),
            headerSoundIcon: document.getElementById('header-sound-icon'),
            headerSoundLabel: document.getElementById('header-sound-label'),
            settingsVoiceCheckbox: document.getElementById('settings-voice-enabled'),
            testVoiceBtn: document.getElementById('btn-test-voice'),
        },
        sync: {
            headerModeBadge: document.getElementById('header-offline-mode-badge'),
            headerQueueBtn: document.getElementById('header-sync-queue-btn'),
            headerQueueCount: document.getElementById('header-queue-count'),
            headerAutoSyncInfo: document.getElementById('header-auto-sync-info'),
            headerSyncCountdown: document.getElementById('header-sync-countdown'),
            autoStatusBadge: document.getElementById('sync-auto-status-badge'),
            lastTime: document.getElementById('sync-last-time'),
            lastTimeAgo: document.getElementById('sync-last-time-ago'),
            nextTime: document.getElementById('sync-next-time'),
            nextCountdown: document.getElementById('sync-next-countdown'),
            offlineCount: document.getElementById('sync-offline-count'),
            employeeCacheCount: document.getElementById('sync-employee-cache-count'),
            syncNowBtn: document.getElementById('btn-sync-now'),
            syncNowSpinner: document.getElementById('sync-now-spinner'),
            syncNowText: document.getElementById('sync-now-text'),
            syncEmployeesBtn: document.getElementById('btn-sync-employees'),
            settingsForm: document.getElementById('sync-settings-form'),
            intervalSelect: document.getElementById('sync-interval-select'),
            autoEnabledCheckbox: document.getElementById('sync-auto-enabled'),
            historyBody: document.getElementById('sync-history-body'),
        },
    };

    let resetScanTimer;
    let currentAppSettings = {};
    let currentLocalConfig = {};
    let currentDeviceInfo = {};
    let isModalOpen = false;

    function getEl(id) {
        return document.getElementById(id);
    }

    // ==========================================
    // Voice Synthesizer & Audio Feedback (Bahasa Indonesia)
    // Sapaan ramah kasir menyebut NAMA DEPAN saja
    // ==========================================
    let isVoiceEnabled = localStorage.getItem('kantin_voice_enabled') !== 'false';

    function updateSoundToggleUI() {
        const icon = elements.sound?.headerSoundIcon;
        const label = elements.sound?.headerSoundLabel;
        const btn = elements.sound?.headerToggleBtn;
        const checkbox = elements.sound?.settingsVoiceCheckbox;

        if (checkbox) checkbox.checked = isVoiceEnabled;
        if (icon) icon.textContent = isVoiceEnabled ? '🔊' : '🔇';
        if (label) label.textContent = isVoiceEnabled ? 'Suara: ON' : 'Suara: OFF';
        if (btn) {
            if (isVoiceEnabled) {
                btn.classList.remove('text-rose-400', 'border-rose-500/30', 'bg-rose-500/10');
                btn.classList.add('text-gray-300', 'border-white/10', 'bg-black/25');
            } else {
                btn.classList.remove('text-gray-300', 'border-white/10', 'bg-black/25');
                btn.classList.add('text-rose-400', 'border-rose-500/30', 'bg-rose-500/10');
            }
        }
    }

    function setVoiceEnabled(enabled) {
        isVoiceEnabled = !!enabled;
        localStorage.setItem('kantin_voice_enabled', isVoiceEnabled ? 'true' : 'false');
        updateSoundToggleUI();
        if (!isVoiceEnabled && ('speechSynthesis' in window)) {
            window.speechSynthesis.cancel();
        }
    }

    /**
     * Ekstraksi Nama Depan saja dari nama lengkap karyawan
     * Mengabaikan singkatan/gelar kehormatan (M., DR., H., HJ., dsb.)
     * Contoh:
     * - 'NISMAWATI' -> 'Nismawati'
     * - 'DICO DJAMAL SH' -> 'Dico'
     * - 'M. SYAIFUL ANWAR' -> 'Syaiful'
     * - 'DR. H. AHMAD SUBARJO' -> 'Ahmad'
     */
    function getFirstName(fullName) {
        if (!fullName || typeof fullName !== 'string') return '';
        const clean = fullName.trim().replace(/\s+/g, ' ');
        if (!clean) return '';

        const tokens = clean.split(' ').map(t => t.replace(/[,]/g, '')).filter(Boolean);
        if (tokens.length === 0) return '';

        const skipPrefixes = new Set([
            'M.', 'MD.', 'MOCH.', 'MUCH.', 'MHD.', 'MOH.', 'MUH.',
            'H.', 'HJ.', 'HAJI', 'HAJJAH',
            'DR.', 'DRS.', 'DRA.', 'IR.', 'PROF.', 'UST.', 'USTADZ',
            'TB.', 'R.', 'RA.', 'RADEN'
        ]);

        let chosen = '';
        for (const t of tokens) {
            const upper = t.toUpperCase().replace(/\.+$/, '');
            const rawUpper = t.toUpperCase();
            if (skipPrefixes.has(rawUpper) || skipPrefixes.has(upper + '.')) {
                continue;
            }
            if (/^[A-Za-z]\.?$/.test(t)) {
                continue;
            }
            chosen = t;
            break;
        }

        if (!chosen) {
            chosen = tokens[0];
        }

        const cleanWord = chosen.replace(/[^a-zA-Z]/g, '');
        if (!cleanWord) return '';
        return cleanWord.charAt(0).toUpperCase() + cleanWord.slice(1).toLowerCase();
    }

    /**
     * Menghasilkan bunyi nada responsif via Web Audio API
     */
    function playTone(type = 'success') {
        if (!isVoiceEnabled) return;
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            const ctx = new AudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);

            if (type === 'success') {
                osc.frequency.setValueAtTime(587.33, ctx.currentTime);
                osc.frequency.setValueAtTime(880, ctx.currentTime + 0.08);
                gain.gain.setValueAtTime(0.12, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.005, ctx.currentTime + 0.22);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.22);
            } else if (type === 'warning') {
                osc.frequency.setValueAtTime(440, ctx.currentTime);
                gain.gain.setValueAtTime(0.15, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.005, ctx.currentTime + 0.28);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.28);
            } else {
                osc.frequency.setValueAtTime(240, ctx.currentTime);
                osc.frequency.setValueAtTime(180, ctx.currentTime + 0.1);
                gain.gain.setValueAtTime(0.18, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.005, ctx.currentTime + 0.3);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.3);
            }
        } catch (_) {}
    }

    let currentVoiceAudio = null;

    if ('speechSynthesis' in window) {
        window.speechSynthesis.onvoiceschanged = () => {
            try { window.speechSynthesis.getVoices(); } catch (_) {}
        };
    }

    /**
     * Fallback ke SpeechSynthesis bawaan browser/sistem jika offline
     */
    function speakFallbackSpeechSynthesis(text) {
        if (!('speechSynthesis' in window)) return;
        try {
            if (window.speechSynthesis.paused) {
                window.speechSynthesis.resume();
            }
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'id-ID';
            utterance.rate = 1.0;
            utterance.pitch = 1.0;

            const voices = window.speechSynthesis.getVoices();
            const idVoice = voices.find(v => 
                (v.lang && (v.lang.toLowerCase() === 'id-id' || v.lang.toLowerCase().startsWith('id'))) ||
                (v.name && v.name.toLowerCase().includes('indonesia'))
            );
            if (idVoice) {
                utterance.voice = idVoice;
            }

            window.speechSynthesis.speak(utterance);
        } catch (err) {
            console.warn('Fallback SpeechSynthesis error:', err);
        }
    }

    /**
     * Mengucapkan pesan suara dalam Bahasa Indonesia yang jernih dan fasih
     * Menggunakan Google Natural Indonesian TTS dengan fallback otomatis ke SpeechSynthesis lokal
     */
    function speakVoice(text) {
        if (!isVoiceEnabled || !text) return;

        try {
            if (currentVoiceAudio) {
                currentVoiceAudio.pause();
                currentVoiceAudio.currentTime = 0;
                currentVoiceAudio = null;
            }

            const encoded = encodeURIComponent(text.trim());
            const audioUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=id&q=${encoded}`;
            const audio = new Audio(audioUrl);
            audio.playbackRate = 1.05;
            currentVoiceAudio = audio;

            audio.play().catch(() => {
                speakFallbackSpeechSynthesis(text);
            });
        } catch (_) {
            speakFallbackSpeechSynthesis(text);
        }
    }

    function formatTimeDisplay(timeVal) {
        if (!timeVal) return '';
        if (typeof timeVal === 'string') {
            let str = timeVal.trim();
            if (str.includes('T')) {
                str = str.split('T')[1];
            } else if (str.includes(' ') && (str.includes('-') || str.includes('/'))) {
                str = str.split(' ')[1];
            }
            return str.split('.')[0].replace('Z', '').substring(0, 8);
        }
        if (timeVal instanceof Date) {
            const hh = String(timeVal.getHours()).padStart(2, '0');
            const mm = String(timeVal.getMinutes()).padStart(2, '0');
            const ss = String(timeVal.getSeconds()).padStart(2, '0');
            return `${hh}:${mm}:${ss}`;
        }
        return String(timeVal);
    }

    function formatDateDisplay(dateVal) {
        if (!dateVal) return '';
        if (typeof dateVal === 'string') {
            if (dateVal.includes('T')) return dateVal.split('T')[0];
            if (dateVal.includes(' ')) return dateVal.split(' ')[0];
            return dateVal.trim();
        }
        if (dateVal instanceof Date) {
            const y = dateVal.getFullYear();
            const m = String(dateVal.getMonth() + 1).padStart(2, '0');
            const d = String(dateVal.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }
        return String(dateVal);
    }
    
    const defaultSettings = {
        background: '#111827',
        border: '#374151',
        theme: '#c026d3'
    };

    function setConnectionPill(dotEl, textEl, label, isConnected) {
        if (!dotEl || !textEl) {
            return;
        }

        dotEl.classList.remove('bg-green-400', 'bg-red-400', 'shadow-[0_0_10px]');
        dotEl.classList.add(isConnected ? 'bg-green-400' : 'bg-red-400');
        if (isConnected) {
            dotEl.classList.add('shadow-[0_0_10px]');
        }

        textEl.textContent = `${label}: ${isConnected ? 'Connected' : 'Disconnected'}`;
        textEl.classList.remove('text-gray-300', 'text-red-300', 'text-green-300');
        textEl.classList.add(isConnected ? 'text-green-300' : 'text-red-300');
    }

    async function refreshConnectionStatus() {
        try {
            const status = await window.api.get('/api/connection-status');
            setConnectionPill(elements.connectionStatus.apiDot, elements.connectionStatus.apiText, 'API', Boolean(status.api));
            setConnectionPill(elements.connectionStatus.dbDot, elements.connectionStatus.dbText, 'DB', Boolean(status.db));
        } catch (error) {
            setConnectionPill(elements.connectionStatus.apiDot, elements.connectionStatus.apiText, 'API', false);
            setConnectionPill(elements.connectionStatus.dbDot, elements.connectionStatus.dbText, 'DB', false);
        }
    }

    // --- Fungsi Inisialisasi ---
    async function initializeDashboard() {
        try {
            const data = await window.api.get('/api/dashboard-data');
            if (data.error) throw new Error(data.message);
            currentAppSettings = data.appSettings || defaultSettings;
            currentLocalConfig = data.localConfig || {};
            currentDeviceInfo = data.deviceInfo || {};
            applyTheme(currentAppSettings);
            updateDashboardUI(data);
        } catch (error) {
            console.error("Gagal memuat data dashboard:", error);
            sendAppLog('ERROR', 'RENDERER:dashboard', error.message);
            showToast(error.message || 'Gagal memuat data dashboard.', 'error');
        } finally {
            await refreshConnectionStatus();
            await loadSyncStatus();
            if (!syncCountdownInterval) {
                syncCountdownInterval = setInterval(updateSyncCountdownUI, 10000);
            }
        }
    }

    // --- Fungsi Pembaruan UI ---
    function updateDashboardUI(data) {
        elements.currentSession.textContent = data.currentSesi || 'N/A';
        if (data.appSettings && data.appSettings.nama) {
            elements.appTitle.textContent = data.appSettings.nama;
        }

        elements.visitorCounts.pagi.textContent = data.visitorCounts['MAKAN PAGI'] || 0;
        elements.visitorCounts.siang.textContent = data.visitorCounts['MAKAN SIANG'] || 0;
        elements.visitorCounts.malam.textContent = data.visitorCounts['MAKAN MALAM'] || 0;

        Object.values(elements.visitorCards).forEach(card => card.classList.remove('ring-2', 'ring-theme', 'shadow-lg', 'shadow-theme'));
        const sessionKey = (data.currentSesi || '').replace(' ', '').toLowerCase();
        const cardId = `card-${sessionKey.replace('makan','')}`;
        if (document.getElementById(cardId)) {
            document.getElementById(cardId).classList.add('ring-2', 'ring-theme', 'shadow-lg', 'shadow-theme');
        }
        
        updateSlideshow(data.menuImages);
        renderRecentScans(data.scanHistory, data.deviceInfo?.lokasi || (currentLocalConfig && currentLocalConfig.lokasi) || (currentAppSettings && currentAppSettings.nama) || 'Area Ini');
    }

    function updateSlideshow(images) {
        const track = elements.slideshow.track;
        track.innerHTML = '';
        if (!images || images.length === 0) {
            track.innerHTML = '<p class="m-auto text-gray-400">Tidak ada gambar menu hari ini.</p>';
            return;
        }
        const allImages = [...images, ...images]; 
        allImages.forEach(img => {
            const item = document.createElement('div');
            item.className = 'slideshow-item h-full';
            const imageUrl = img.url; 
            item.innerHTML = `<img src="${imageUrl}" alt="${img.nama}" class="rounded-lg h-full w-full object-cover" title="${img.nama}">`;
            track.appendChild(item);
        });
    }

    function renderRecentScans(scans, locationName) {
        if (elements.recentScans && elements.recentScans.location) {
            elements.recentScans.location.textContent = locationName || 'Area Ini';
        }

        const content = elements.recentScans?.content;
        if (!content) return;
        content.innerHTML = '';

        if (!Array.isArray(scans) || scans.length === 0) {
            content.innerHTML = '<p class="m-auto text-gray-500 text-center py-6">Belum ada data scan di area ini hari ini.</p>';
            if (elements.recentScans?.total) {
                elements.recentScans.total.textContent = '0 Orang';
            }
            return;
        }

        if (elements.recentScans?.total) {
            elements.recentScans.total.textContent = `${scans.length} Orang`;
        }

        scans.forEach((scan) => {
            const timeStr = formatTimeDisplay(scan.time);
            const rawName = (scan.nama_lengkap || '').trim();
            const name = rawName && rawName !== 'N/A' ? rawName : (scan.nik || 'Karyawan');
            const initials = (name.replace(/[^a-zA-Z0-9\s]/g, '').trim() || 'K').substring(0, 2).toUpperCase();
            const deptStr = [scan.depart, scan.nama_perusahaan].filter(Boolean).join(' • ');

            const item = document.createElement('div');
            item.className = 'flex items-center justify-between p-2.5 rounded-lg bg-gray-800/50 border border-gray-700/60 hover:bg-gray-800/80 transition-all gap-2';
            
            item.innerHTML = `
                <div class="flex items-center gap-2.5 min-w-0 flex-1">
                    <div class="w-8 h-8 rounded-full bg-theme/20 border border-theme/40 flex items-center justify-center text-theme font-bold text-xs flex-shrink-0 shadow-sm">
                        ${initials}
                    </div>
                    <div class="min-w-0 flex-1">
                        <div class="font-semibold text-white text-xs sm:text-sm truncate" title="${name}">${name}</div>
                        <div class="text-[11px] font-mono text-gray-400 truncate">${scan.nik}${deptStr ? ' • ' + deptStr : ''}</div>
                    </div>
                </div>
                <div class="text-right flex-shrink-0">
                    <span class="text-xs font-mono font-semibold text-teal-300 bg-teal-950/70 px-2 py-0.5 rounded border border-teal-800/50">${timeStr}</span>
                    <div class="text-[10px] text-gray-400 mt-0.5 font-medium">${scan.sesi_makan || ''}</div>
                </div>
            `;
            content.appendChild(item);
        });
    }

    function showScanResult(typeOrOptions, messageText, detailsObj) {
        clearTimeout(resetScanTimer);
        const { card, placeholder, employeeDetails } = elements.scanResult;

        let opts = {};
        if (typeof typeOrOptions === 'object' && typeOrOptions !== null) {
            opts = typeOrOptions;
        } else {
            opts = {
                type: typeOrOptions || 'info',
                message: messageText || '',
                details: detailsObj || null
            };
        }

        const type = opts.type || 'info';
        const details = opts.details || null;
        const currentSessionName = opts.sesiMakan || elements.currentSession?.textContent || 'MAKAN';
        const isOffline = !!opts.isOffline;
        const savedRecord = opts.savedRecord || null;

        // Reset status classes
        card.classList.remove('status-info', 'status-success', 'status-warning', 'status-error');
        card.classList.add(`status-${type}`);

        if (details) {
            const initials = (details.nama_lengkap || 'NA')
                .split(' ')
                .filter(Boolean)
                .slice(0, 2)
                .map(s => s[0])
                .join('')
                .toUpperCase() || 'NA';

            const fallbackAvatar = `data:image/svg+xml;utf8,${encodeURIComponent(
                `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160'>
                    <defs>
                        <linearGradient id='avatarGrad' x1='0%' y1='0%' x2='100%' y2='100%'>
                            <stop offset='0%' stop-color='#1e293b'/>
                            <stop offset='100%' stop-color='#0f172a'/>
                        </linearGradient>
                    </defs>
                    <rect width='160' height='160' rx='80' fill='url(#avatarGrad)'/>
                    <text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle'
                        font-family='Inter, -apple-system, sans-serif' font-weight='700' font-size='52' fill='#38bdf8'>${initials}</text>
                </svg>`
            )}`;
            const employeePhoto = details.photo_full_url || fallbackAvatar;

            // Determine Roster Info & Label
            let rosterLabel = '';
            if (opts.rosterNotice) {
                if (typeof opts.rosterNotice === 'string') {
                    rosterLabel = opts.rosterNotice;
                } else if (opts.rosterNotice.message) {
                    rosterLabel = opts.rosterNotice.message;
                } else if (opts.rosterNotice.code) {
                    rosterLabel = `Shift ${opts.rosterNotice.code}`;
                }
            }

            // Extract Shift / Roster from peakmealNotice or raw strings
            let peakmealStatus = null;
            let peakmealMsg = '';
            let rawNoticeStr = '';

            if (typeof opts.peakmealNotice === 'string') {
                rawNoticeStr = opts.peakmealNotice;
                if (rawNoticeStr.includes('DI LUAR PLAN') || rawNoticeStr.includes('belum ada pesanan peakmeal')) {
                    peakmealStatus = 'OUT_OF_PLAN';
                    const matchShift = rawNoticeStr.match(/Status\s*(?:<b>)?([^<\s]+)(?:<\/b>)?/i);
                    if (matchShift && matchShift[1] && !rosterLabel) {
                        rosterLabel = `Shift ${matchShift[1]}`;
                    }
                } else if (rawNoticeStr.includes('SUDAH DIPESANKAN') || rawNoticeStr.includes('sudah mengajukan peacmeal')) {
                    peakmealStatus = 'WRONG_LOCATION';
                }
            } else if (opts.peakmealNotice && typeof opts.peakmealNotice === 'object') {
                peakmealStatus = opts.peakmealNotice.status || null;
                peakmealMsg = opts.peakmealNotice.message || '';
                if (opts.peakmealNotice.rosterLabel && !rosterLabel) {
                    rosterLabel = `Shift ${opts.peakmealNotice.rosterLabel}`;
                }
            }

            // Clean fallback for plain message string
            if (typeof opts.message === 'string' && opts.message.includes('DI LUAR PLAN')) {
                peakmealStatus = 'OUT_OF_PLAN';
                const matchShift = opts.message.match(/Status\s*(?:<b>)?([^<\s]+)(?:<\/b>)?/i);
                if (matchShift && matchShift[1] && !rosterLabel) {
                    rosterLabel = `Shift ${matchShift[1]}`;
                }
            }

            // Timestamp formatting
            const now = new Date();
            const scanTime = formatTimeDisplay(savedRecord?.time) || now.toTimeString().split(' ')[0];

            // Session Icon & Badge Styles
            let sessionIcon = '🍛';
            let sessionBadgeStyle = 'bg-teal-500/20 text-teal-300 border border-teal-500/30';
            const upperSession = (currentSessionName || '').toUpperCase();
            if (upperSession.includes('PAGI')) {
                sessionIcon = '🌅';
                sessionBadgeStyle = 'bg-orange-500/20 text-orange-300 border border-orange-500/30';
            } else if (upperSession.includes('SIANG')) {
                sessionIcon = '☀️';
                sessionBadgeStyle = 'bg-amber-500/20 text-amber-300 border border-amber-500/30';
            } else if (upperSession.includes('MALAM')) {
                sessionIcon = '🌙';
                sessionBadgeStyle = 'bg-blue-500/20 text-blue-300 border border-blue-500/30';
            }

            // Avatar Visual Styles based on status type
            let avatarGlowClass = 'bg-emerald-500/20';
            let avatarBorderClass = 'border-emerald-400/60 ring-4 ring-emerald-500/20';
            let avatarBadgeClass = 'bg-emerald-500';
            let avatarBadgeIcon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>`;

            if (type === 'error') {
                avatarGlowClass = 'bg-rose-500/25';
                avatarBorderClass = 'border-rose-400/70 ring-4 ring-rose-500/25';
                avatarBadgeClass = 'bg-rose-500';
                avatarBadgeIcon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>`;
            } else if (type === 'warning' || peakmealStatus === 'OUT_OF_PLAN') {
                avatarGlowClass = 'bg-amber-500/25';
                avatarBorderClass = 'border-amber-400/70 ring-4 ring-amber-500/25';
                avatarBadgeClass = 'bg-amber-500';
                avatarBadgeIcon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>`;
            }

            // Build Status Card HTML
            let statusCardHtml = '';

            if (opts.status === 'ALREADY_SCANNED') {
                const prevTime = formatTimeDisplay(savedRecord?.time);
                statusCardHtml = `
                    <div class="w-full bg-rose-950/70 border border-rose-500/40 rounded-xl p-3 sm:p-3.5 shadow-lg flex items-center gap-3 text-left animate-fade-in-slide">
                        <div class="w-10 h-10 rounded-lg bg-rose-500/20 border border-rose-500/30 flex items-center justify-center flex-shrink-0 text-rose-400">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                        </div>
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-2 flex-wrap">
                                <span class="text-xs font-bold text-rose-300 uppercase tracking-wider">Sudah Scan</span>
                                <span class="text-[11px] bg-rose-900/80 text-rose-200 px-2 py-0.5 rounded border border-rose-700/50">${upperSession}</span>
                            </div>
                            <p class="text-xs sm:text-sm text-gray-200 font-medium mt-0.5">
                                ${prevTime ? `Karyawan sudah scan sebelumnya pada jam <b>${prevTime}</b>` : `Sudah melakukan scan untuk sesi ${upperSession}`}
                            </p>
                        </div>
                    </div>
                `;
            } else if (opts.status === 'PEAKMEAL_WRONG_LOCATION' || peakmealStatus === 'WRONG_LOCATION') {
                const loc = opts.deliveryLocation || opts.peakmealNotice?.location || '-';
                statusCardHtml = `
                    <div class="w-full bg-rose-950/70 border border-rose-500/40 rounded-xl p-3 sm:p-3.5 shadow-lg flex items-center gap-3 text-left animate-fade-in-slide">
                        <div class="w-10 h-10 rounded-lg bg-rose-500/20 border border-rose-500/30 flex items-center justify-center flex-shrink-0 text-rose-400">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                        </div>
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-2 flex-wrap">
                                <span class="text-xs font-bold text-rose-300 uppercase tracking-wider">Salah Lokasi Scan</span>
                                <span class="text-[11px] bg-rose-900/80 text-rose-200 px-2 py-0.5 rounded border border-rose-700/50">Ditolak</span>
                            </div>
                            <p class="text-xs sm:text-sm text-gray-200 font-medium mt-0.5">
                                Sudah dipesan untuk diantar ke: <b class="text-rose-300 font-semibold underline">${loc}</b>
                            </p>
                        </div>
                    </div>
                `;
            } else if (opts.status === 'ROSTER_OFF_REJECTED' || (opts.rosterNotice && opts.rosterNotice.type === 'error')) {
                statusCardHtml = `
                    <div class="w-full bg-rose-950/70 border border-rose-500/40 rounded-xl p-3 sm:p-3.5 shadow-lg flex items-center gap-3 text-left animate-fade-in-slide">
                        <div class="w-10 h-10 rounded-lg bg-rose-500/20 border border-rose-500/30 flex items-center justify-center flex-shrink-0 text-rose-400">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        </div>
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-2 flex-wrap">
                                <span class="text-xs font-bold text-rose-300 uppercase tracking-wider">Roster OFF</span>
                                <span class="text-[11px] bg-rose-900/80 text-rose-200 px-2 py-0.5 rounded border border-rose-700/50">Scan Ditolak</span>
                            </div>
                            <p class="text-xs sm:text-sm text-gray-200 font-medium mt-0.5">
                                Status roster hari ini tercatat OFF. Silakan konfirmasi ke admin departemen.
                            </p>
                        </div>
                    </div>
                `;
            } else if (opts.status === 'LIMIT_EXCEEDED') {
                statusCardHtml = `
                    <div class="w-full bg-rose-950/70 border border-rose-500/40 rounded-xl p-3 sm:p-3.5 shadow-lg flex items-center gap-3 text-left animate-fade-in-slide">
                        <div class="w-10 h-10 rounded-lg bg-rose-500/20 border border-rose-500/30 flex items-center justify-center flex-shrink-0 text-rose-400 text-lg font-bold">
                            2x
                        </div>
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-2 flex-wrap">
                                <span class="text-xs font-bold text-rose-300 uppercase tracking-wider">Batas Makan Habis</span>
                            </div>
                            <p class="text-xs sm:text-sm text-gray-200 font-medium mt-0.5">
                                Non-residen dibatasi maksimal 2x scan per hari.
                            </p>
                        </div>
                    </div>
                `;
            } else if (opts.status === 'OUT_OF_SESSION') {
                statusCardHtml = `
                    <div class="w-full bg-amber-950/70 border border-amber-500/40 rounded-xl p-3 sm:p-3.5 shadow-lg flex items-center gap-3 text-left animate-fade-in-slide">
                        <div class="w-10 h-10 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center flex-shrink-0 text-amber-400">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        </div>
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-2 flex-wrap">
                                <span class="text-xs font-bold text-amber-300 uppercase tracking-wider">Di Luar Jam Makan</span>
                            </div>
                            <p class="text-xs sm:text-sm text-gray-200 font-medium mt-0.5">
                                Saat ini belum memasuki jam pelayanan makan kantin.
                            </p>
                        </div>
                    </div>
                `;
            } else if (peakmealStatus === 'OUT_OF_PLAN' || type === 'warning') {
                // SUCCESS BUT OUT OF PLAN
                statusCardHtml = `
                    <div class="w-full bg-gradient-to-r from-amber-950/80 to-slate-900/90 border border-amber-500/40 rounded-xl p-3 sm:p-3.5 shadow-lg flex items-center gap-3 text-left animate-fade-in-slide">
                        <div class="w-10 h-10 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center flex-shrink-0 text-amber-400">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                        </div>
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-2 flex-wrap">
                                <span class="text-xs font-bold text-amber-300 uppercase tracking-wider">Di Luar Plan</span>
                                ${rosterLabel ? `<span class="text-[11px] bg-amber-900/80 text-amber-200 px-2 py-0.5 rounded border border-amber-700/50">${rosterLabel}</span>` : ''}
                            </div>
                            <p class="text-xs sm:text-sm text-gray-200 font-medium mt-0.5">
                                Belum ada pesanan Peakmeal untuk ${upperSession}. Dicatat sebagai <b>Di Luar Plan</b>.
                            </p>
                        </div>
                    </div>
                `;
            } else if (type === 'success') {
                // NORMAL SUCCESS
                statusCardHtml = `
                    <div class="w-full bg-gradient-to-r from-emerald-950/80 to-slate-900/90 border border-emerald-500/40 rounded-xl p-3 sm:p-3.5 shadow-lg flex items-center gap-3 text-left animate-fade-in-slide">
                        <div class="w-10 h-10 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center flex-shrink-0 text-emerald-400">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                        </div>
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-2 flex-wrap">
                                <span class="text-xs font-bold text-emerald-300 uppercase tracking-wider">Scan Berhasil</span>
                                ${rosterLabel ? `<span class="text-[11px] bg-emerald-900/80 text-emerald-200 px-2 py-0.5 rounded border border-emerald-700/50">${rosterLabel}</span>` : ''}
                            </div>
                            <p class="text-xs sm:text-sm text-gray-200 font-medium mt-0.5">
                                ${peakmealMsg || 'Silakan menikmati hidangan prasmanan.'}
                            </p>
                        </div>
                    </div>
                `;
            } else {
                // Fallback message card
                statusCardHtml = `
                    <div class="w-full bg-slate-900/80 border border-slate-700/50 rounded-xl p-3 sm:p-3.5 shadow-lg flex items-center gap-3 text-left animate-fade-in-slide">
                        <div class="min-w-0 flex-1">
                            <p class="text-xs sm:text-sm text-gray-200 font-medium">${opts.message || 'Scan diproses'}</p>
                        </div>
                    </div>
                `;
            }

            placeholder.classList.add('hidden');
            employeeDetails.innerHTML = `
                <div class="w-full max-w-xl mx-auto flex flex-col items-center justify-center animate-fade-in-slide py-1">
                    <!-- Top Meta Badges -->
                    <div class="flex items-center justify-center gap-2 mb-3 flex-wrap">
                        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${sessionBadgeStyle}">
                            ${sessionIcon} ${upperSession}
                        </span>
                        ${isOffline ? `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">⚡ Mode Offline</span>` : ''}
                        ${(details.status === 'TAMU' || opts.visitorStatus === 'TAMU') ? `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30">Tamu / Rekanan</span>` : ''}
                        <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-mono text-gray-300 bg-black/40 border border-white/10">
                            <span>🕒</span> ${scanTime}
                        </span>
                    </div>

                    <!-- Avatar with Glow & Status Icon -->
                    <div class="relative mb-3 group">
                        <div class="absolute -inset-1 rounded-full ${avatarGlowClass} opacity-75 blur-sm transition-all duration-300"></div>
                        <img src="${employeePhoto}" alt="Foto Karyawan" class="relative w-24 h-24 sm:w-28 sm:h-28 rounded-full border-2 ${avatarBorderClass} object-cover shadow-2xl bg-slate-900" onerror="this.src='${fallbackAvatar}'">
                        <div class="absolute bottom-0 right-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shadow-lg ${avatarBadgeClass}">
                            ${avatarBadgeIcon}
                        </div>
                    </div>

                    <!-- Employee Name -->
                    <h2 class="text-xl sm:text-2xl lg:text-3xl font-extrabold text-white tracking-tight line-clamp-1 mb-1.5 drop-shadow-md">
                        ${details.nama_lengkap || '-'}
                    </h2>

                    <!-- Identification: NIK & Company -->
                    <div class="flex items-center justify-center gap-2 mb-1.5 flex-wrap">
                        <span class="inline-flex items-center gap-1.5 font-mono text-xs sm:text-sm font-semibold text-slate-200 bg-white/10 px-2.5 py-0.5 rounded-md border border-white/15 shadow-sm">
                            <span class="text-gray-400 text-[10px] font-sans font-normal uppercase">NIK</span> ${details.no_nik || '-'}
                        </span>
                        ${details.nama_perusahaan ? `
                        <span class="inline-flex items-center text-xs sm:text-sm font-medium text-teal-300 bg-teal-950/60 px-2.5 py-0.5 rounded-md border border-teal-500/30 truncate max-w-[280px] shadow-sm">
                            ${details.nama_perusahaan}
                        </span>` : ''}
                    </div>

                    <!-- Department & Position -->
                    <p class="text-xs sm:text-sm text-slate-300 font-medium mb-3 max-w-lg truncate">
                        ${[details.depart, details.posisi].filter(Boolean).join(' • ') || '-'}
                    </p>

                    <!-- Status Notification Card -->
                    ${statusCardHtml}
                </div>
            `;
            employeeDetails.classList.remove('opacity-0', 'max-h-0');
            employeeDetails.style.maxHeight = (employeeDetails.scrollHeight + 40) + "px";
        } else {
            employeeDetails.classList.add('opacity-0', 'max-h-0');
            employeeDetails.style.maxHeight = '0px';
            placeholder.classList.remove('hidden');
            if (elements.scanResult.statusMessage) {
                elements.scanResult.statusMessage.innerHTML = opts.message || 'Scan Barcode Karyawan';
            }
        }

        resetScanTimer = setTimeout(() => {
            showScanResult('info', 'Silakan Scan Barcode Karyawan');
        }, 5000);
    }

    function showToast(message, type = 'success') {
        const toast = elements.toast;
        toast.textContent = message;
        toast.className = `fixed bottom-8 left-1/2 -translate-x-1/2 px-8 py-4 rounded-md text-white font-semibold shadow-lg transition-all duration-300 opacity-100`;
        toast.classList.add(type === 'success' ? 'bg-green-500' : 'bg-red-500');
        
        setTimeout(() => {
            toast.classList.add('opacity-0');
        }, 3000);
    }

    // --- Logika Pengaturan (Settings) ---
    function applyTheme(settings) {
        const root = document.documentElement;
        root.style.setProperty('--bg-color', settings.background || defaultSettings.background);
        root.style.setProperty('--border-color', settings.border || defaultSettings.border);
        root.style.setProperty('--theme-color', settings.theme || defaultSettings.theme);
        root.style.setProperty('--theme-color-light', (settings.theme || defaultSettings.theme) + '80');
        root.style.setProperty('--theme-color-dark', (settings.theme || defaultSettings.theme) + 'B3');
    }

    async function loadScanHistory() {
        try {
            const history = await window.api.get('/api/scan-history');
            if (history.error) throw new Error(history.error);
            const body = elements.settings.scanHistoryBody;
            body.innerHTML = '';
            if (history.length === 0) {
                body.innerHTML = `<tr><td colspan="7" class="text-center text-gray-400 py-4">Belum ada riwayat scan hari ini.</td></tr>`;
                return;
            }
            history.forEach(scan => {
                const timeStr = formatTimeDisplay(scan.time);
                const lokasiStr = scan.lokasi || (currentLocalConfig && currentLocalConfig.lokasi) || (currentAppSettings && currentAppSettings.nama) || '-';
                const scanLocationStr = lokasiStr;
                const row = `
                    <tr class="border-b border-gray-700 hover:bg-gray-800/30 transition-colors">
                        <td class="px-4 py-2 font-mono">${timeStr}</td>
                        <td class="px-4 py-2 font-mono">${scan.nik}</td>
                        <td class="px-4 py-2">${scan.nama_lengkap || 'N/A'}</td>
                        <td class="px-4 py-2">${scan.nama_perusahaan || '-'}</td>
                        <td class="px-4 py-2">${scan.sesi_makan}</td>
                        <td class="px-4 py-2 font-semibold text-theme">${lokasiStr}</td>
                        <td class="px-4 py-2 text-xs font-mono text-gray-300">${scanLocationStr}</td>
                    </tr>
                `;
                body.innerHTML += row;
            });
        } catch (error) {
            showToast(error.message || 'Gagal memuat riwayat scan.', 'error');
        }
    }

    async function sendAppLog(level, source, message, context = null) {
        try {
            await window.api.post('/api/error-logs', {
                level,
                source,
                message,
                context,
            });
        } catch (error) {
            // Silent fail to avoid recursive logging loops.
        }
    }

    async function loadErrorLogs() {
        try {
            const logs = await window.api.get('/api/error-logs?limit=200');
            const body = elements.settings.errorLogBody;
            body.innerHTML = '';

            if (!Array.isArray(logs) || logs.length === 0) {
                body.innerHTML = `<tr><td colspan="4" class="text-center text-gray-400 py-4">Belum ada log error.</td></tr>`;
                return;
            }

            logs.forEach((log) => {
                const timeLabel = new Date(log.timestamp).toLocaleString('id-ID');
                const levelClass = log.level === 'ERROR' ? 'text-red-300' : 'text-green-300';
                const row = `
                    <tr class="border-b border-gray-700 align-top">
                        <td class="px-4 py-2 whitespace-nowrap text-xs text-gray-300">${timeLabel}</td>
                        <td class="px-4 py-2 font-semibold ${levelClass}">${log.level || '-'}</td>
                        <td class="px-4 py-2 text-gray-300">${log.source || '-'}</td>
                        <td class="px-4 py-2 text-gray-200 break-words">${log.message || '-'}</td>
                    </tr>
                `;
                body.innerHTML += row;
            });
        } catch (error) {
            showToast('Gagal memuat log error.', 'error');
        }
    }

    // --- SINKRONISASI OTOMATIS 3 JAM & OFFLINE LOGIC ---
    let currentSyncStatus = null;
    let syncCountdownInterval = null;

    function formatTimeAgo(isoString) {
        if (!isoString) return 'Belum pernah';
        const diffMs = Date.now() - new Date(isoString).getTime();
        const diffMin = Math.floor(diffMs / 60000);
        if (diffMin < 1) return 'Baru saja';
        if (diffMin < 60) return `${diffMin} menit yang lalu`;
        const diffHours = Math.floor(diffMin / 60);
        if (diffHours < 24) return `${diffHours} jam yang lalu`;
        return new Date(isoString).toLocaleDateString('id-ID');
    }

    function formatDateTime(isoString) {
        if (!isoString) return '-';
        try {
            const d = new Date(isoString);
            return d.toLocaleDateString('id-ID', {
                day: '2-digit',
                month: 'short',
                year: 'numeric'
            }) + ' ' + d.toTimeString().split(' ')[0];
        } catch {
            return isoString;
        }
    }

    function updateSyncCountdownUI() {
        if (!currentSyncStatus || !currentSyncStatus.nextSyncTime) {
            if (elements.sync.headerSyncCountdown) elements.sync.headerSyncCountdown.textContent = '3 Jam';
            if (elements.sync.nextCountdown) elements.sync.nextCountdown.textContent = '-';
            return;
        }

        const nextMs = new Date(currentSyncStatus.nextSyncTime).getTime();
        const remainingMs = nextMs - Date.now();

        if (remainingMs <= 0) {
            if (elements.sync.headerSyncCountdown) elements.sync.headerSyncCountdown.textContent = 'Menjalankan...';
            if (elements.sync.nextCountdown) elements.sync.nextCountdown.textContent = 'Sedang proses / sesaat lagi';
            return;
        }

        const totalSec = Math.floor(remainingMs / 1000);
        const hours = Math.floor(totalSec / 3600);
        const mins = Math.floor((totalSec % 3600) / 60);
        const secs = totalSec % 60;

        const timeStr = `${hours > 0 ? hours + 'j ' : ''}${mins}m ${secs}s`;
        if (elements.sync.headerSyncCountdown) elements.sync.headerSyncCountdown.textContent = `${hours}j ${mins}m`;
        if (elements.sync.nextCountdown) elements.sync.nextCountdown.textContent = `${timeStr} lagi`;
    }

    async function loadSyncStatus() {
        try {
            const data = await window.api.get('/api/sync-status');
            currentSyncStatus = data;

            // Update Header Elements
            if (elements.sync.headerModeBadge) {
                if (!data.dbConnected) {
                    elements.sync.headerModeBadge.classList.remove('hidden');
                } else {
                    elements.sync.headerModeBadge.classList.add('hidden');
                }
            }

            if (elements.sync.headerQueueBtn) {
                if (data.offlineQueueCount > 0) {
                    elements.sync.headerQueueBtn.classList.remove('hidden');
                    if (elements.sync.headerQueueCount) {
                        elements.sync.headerQueueCount.textContent = data.offlineQueueCount;
                    }
                } else {
                    elements.sync.headerQueueBtn.classList.add('hidden');
                }
            }

            if (elements.sync.headerAutoSyncInfo) {
                if (data.autoSyncEnabled === false) {
                    elements.sync.headerAutoSyncInfo.classList.add('hidden');
                } else {
                    elements.sync.headerAutoSyncInfo.classList.remove('hidden');
                }
            }

            // Update Tab Elements
            if (elements.sync.lastTime) {
                elements.sync.lastTime.textContent = formatDateTime(data.lastSyncTime);
            }
            if (elements.sync.lastTimeAgo) {
                elements.sync.lastTimeAgo.textContent = formatTimeAgo(data.lastSyncTime);
            }
            if (elements.sync.nextTime) {
                elements.sync.nextTime.textContent = formatDateTime(data.nextSyncTime);
            }
            if (elements.sync.offlineCount) {
                elements.sync.offlineCount.textContent = data.offlineQueueCount || 0;
            }
            if (elements.sync.employeeCacheCount) {
                elements.sync.employeeCacheCount.textContent = (data.cachedEmployeesCount || 0).toLocaleString('id-ID');
            }

            if (elements.sync.intervalSelect) {
                elements.sync.intervalSelect.value = data.intervalHours || 3;
            }
            if (elements.sync.autoEnabledCheckbox) {
                elements.sync.autoEnabledCheckbox.checked = data.autoSyncEnabled !== false;
            }

            if (elements.sync.autoStatusBadge) {
                if (data.autoSyncEnabled !== false) {
                    elements.sync.autoStatusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> Auto Sync ${data.intervalHours || 3} Jam Aktif`;
                    elements.sync.autoStatusBadge.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
                } else {
                    elements.sync.autoStatusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-gray-400"></span> Auto Sync Nonaktif`;
                    elements.sync.autoStatusBadge.className = 'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-gray-500/20 text-gray-400 border border-gray-500/30';
                }
            }

            updateSyncCountdownUI();
            renderSyncHistory(data.history || []);
        } catch (err) {
            console.warn('Gagal memuat status sinkronisasi:', err.message);
        }
    }

    function renderSyncHistory(history) {
        if (!elements.sync.historyBody) return;
        if (!history || history.length === 0) {
            elements.sync.historyBody.innerHTML = '<tr><td colspan="6" class="px-4 py-4 text-gray-500 text-center">Belum ada riwayat sinkronisasi.</td></tr>';
            return;
        }

        elements.sync.historyBody.innerHTML = history.map(item => {
            const isSuccess = item.status === 'SUCCESS';
            const statusBadge = isSuccess
                ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">SUKSES</span>'
                : '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">GAGAL</span>';

            let sourceLabel = 'Otomatis 3 Jam';
            if (item.source === 'ADMIN_MANUAL') sourceLabel = 'Manual Admin';
            if (item.source === 'RECONNECT') sourceLabel = 'Rekoneksi Jaringan';

            return `
                <tr class="hover:bg-slate-800/40 transition-colors">
                    <td class="px-4 py-2.5 text-gray-300 font-mono">${formatDateTime(item.timestamp)}</td>
                    <td class="px-4 py-2.5 text-cyan-300 font-semibold">${sourceLabel}</td>
                    <td class="px-4 py-2.5">${statusBadge}</td>
                    <td class="px-4 py-2.5 text-amber-300 font-bold">${item.offlineScansSynced || 0}</td>
                    <td class="px-4 py-2.5 text-purple-300 font-bold">${(item.employeesCached || 0).toLocaleString('id-ID')}</td>
                    <td class="px-4 py-2.5 text-gray-400 truncate max-w-xs" title="${item.message || '-'}">${item.message || '-'}</td>
                </tr>
            `;
        }).join('');
    }

    async function triggerManualSync() {
        const btn = elements.sync.syncNowBtn;
        const spinner = elements.sync.syncNowSpinner;
        const text = elements.sync.syncNowText;

        if (btn) {
            btn.disabled = true;
            btn.classList.add('opacity-75', 'cursor-not-allowed');
        }
        if (spinner) spinner.classList.add('animate-spin');
        if (text) text.textContent = 'Menyinkronkan...';

        try {
            showToast('Memulai sinkronisasi offline ke server...', 'info');
            const res = await window.api.post('/api/sync-now');
            if (res.error) throw new Error(res.error);

            if (res.status === 'SUCCESS' || res.offlineScansSynced !== undefined) {
                showToast(`Sinkronisasi berhasil! ${res.offlineScansSynced || 0} scan terkirim, ${res.employeesCached || 0} data karyawan diperbarui.`, 'success');
            } else {
                showToast(res.message || 'Sinkronisasi selesai.', 'info');
            }

            await loadSyncStatus();
            await initializeDashboard();
        } catch (err) {
            console.error('Gagal sinkronisasi manual:', err);
            showToast(err.message || 'Gagal sinkronisasi. Periksa jaringan ke server.', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.classList.remove('opacity-75', 'cursor-not-allowed');
            }
            if (spinner) spinner.classList.remove('animate-spin');
            if (text) text.textContent = '⚡ Sinkronkan Sekarang';
        }
    }

    async function triggerEmployeeSync() {
        const btn = elements.sync.syncEmployeesBtn;
        if (btn) {
            btn.disabled = true;
            btn.classList.add('opacity-75');
        }
        try {
            showToast('Mengunduh data karyawan terbaru dari server...', 'info');
            const res = await window.api.post('/api/sync-employees');
            if (res.error) throw new Error(res.error);
            showToast(`Master data karyawan berhasil diperbarui (${res.total || 0} karyawan).`, 'success');
            await loadSyncStatus();
        } catch (err) {
            showToast(err.message || 'Gagal memperbarui master karyawan.', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.classList.remove('opacity-75');
            }
        }
    }

    function setupSettingsModal() {
        elements.settings.tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                elements.settings.tabs.forEach(t => t.classList.remove('active-tab'));
                tab.classList.add('active-tab');

                elements.settings.tabContents.forEach(content => content.classList.add('hidden'));
                const activeTabContent = document.getElementById(`tab-${tab.dataset.tab}`);
                if (activeTabContent) {
                    activeTabContent.classList.remove('hidden');
                }

                if (tab.dataset.tab === 'riwayat') {
                    loadScanHistory();
                }

                if (tab.dataset.tab === 'log') {
                    loadErrorLogs();
                }

                if (tab.dataset.tab === 'sinkronisasi') {
                    loadSyncStatus();
                }
            });
        });

        elements.settings.refreshErrorLogsBtn?.addEventListener('click', () => {
            loadErrorLogs();
        });

        elements.settings.appSettingsForm.querySelectorAll('input[type="color"]').forEach(input => {
            input.addEventListener('input', () => {
                const formData = new FormData(elements.settings.appSettingsForm);
                const settingsPreview = Object.fromEntries(formData.entries());
                applyTheme(settingsPreview);
            });
        });

        elements.settings.appSettingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const settingsData = {
                nama: getEl('app-name')?.value || '',
                lokasi: getEl('app-location')?.value || '',
                description: getEl('app-description')?.value || '',
                theme: getEl('theme-color')?.value || defaultSettings.theme,
                background: currentAppSettings.background || defaultSettings.background,
                border: currentAppSettings.border || defaultSettings.border
            };
            try {
                const result = await window.api.post('/api/settings', settingsData);
                if (result.error) throw new Error(result.error);
                
                const indicator = elements.settings.saveIndicator;
                indicator.classList.remove('opacity-0');
                setTimeout(() => {
                    indicator.classList.add('opacity-0');
                }, 2000);

                initializeDashboard();
            } catch (error) {
                showToast(error.message || 'Gagal menyimpan pengaturan.', 'error');
            }
        });
        
        elements.settings.resetThemeBtn.addEventListener('click', () => {
            const themeInput = getEl('theme-color');
            if (themeInput) themeInput.value = defaultSettings.theme;

            currentAppSettings = {
                ...currentAppSettings,
                theme: defaultSettings.theme,
                background: defaultSettings.background,
                border: defaultSettings.border
            };
            applyTheme(defaultSettings);
            showToast('Tema dikembalikan ke default.');
        });

        elements.settings.mealPlanDatePicker?.addEventListener('change', async (e) => {
            const tanggal = e.target.value;
            if (!tanggal) return;
            try {
                const plans = await window.api.get(`/api/meal-plans?tanggal=${tanggal}`);
                if (plans.error) throw new Error(plans.error);
                renderMealPlanEditor(tanggal, plans);
            } catch (error) {
                showToast(error.message || 'Gagal mengambil data meal plan.', 'error');
            }
        });

        elements.settings.btn.addEventListener('click', () => {
            isModalOpen = true;
            const today = getDateInputValue();
            if (elements.settings.mealPlanDatePicker) {
                elements.settings.mealPlanDatePicker.value = today;
                elements.settings.mealPlanDatePicker.dispatchEvent(new Event('change'));
            }
            
            const appNameInput = getEl('app-name');
            const appLocationInput = getEl('app-location');
            const appDescriptionInput = getEl('app-description');
            const themeInput = getEl('theme-color');
            const pcNameEl = getEl('device-pc-name');
            const ipAddrEl = getEl('device-ip-addr');

            if (appNameInput) appNameInput.value = currentAppSettings.nama || '';
            if (appLocationInput) appLocationInput.value = currentLocalConfig.lokasi || currentDeviceInfo.lokasi || '';
            if (appDescriptionInput) appDescriptionInput.value = currentAppSettings.description || '';
            if (themeInput) themeInput.value = currentAppSettings.theme || defaultSettings.theme;
            if (pcNameEl) pcNameEl.textContent = currentDeviceInfo.hostname || '-';
            if (ipAddrEl) ipAddrEl.textContent = currentDeviceInfo.lokasi || currentLocalConfig.lokasi || '-';

            elements.settings.modal.classList.remove('hidden');
        });

        // Event listener untuk tombol Sinkronkan Manual
        elements.sync.syncNowBtn?.addEventListener('click', () => {
            triggerManualSync();
        });

        // Event listener untuk tombol Perbarui Cache Karyawan
        elements.sync.syncEmployeesBtn?.addEventListener('click', () => {
            triggerEmployeeSync();
        });

        // Event listener untuk quick sync button di Header
        // Event listener untuk tombol suara di Header & Settings
        elements.sound?.headerToggleBtn?.addEventListener('click', () => {
            setVoiceEnabled(!isVoiceEnabled);
            showToast(isVoiceEnabled ? 'Suara sapaan aktif (ON)' : 'Suara dimatikan (MUTE)', isVoiceEnabled ? 'success' : 'info');
            if (isVoiceEnabled) {
                playTone('success');
                speakVoice('Suara diaktifkan.');
            }
        });

        elements.sound?.settingsVoiceCheckbox?.addEventListener('change', (e) => {
            setVoiceEnabled(e.target.checked);
        });

        elements.sound?.testVoiceBtn?.addEventListener('click', () => {
            playTone('success');
            speakVoice('Silakan makan, Nismawati.');
        });
        updateSoundToggleUI();

        elements.sync.headerQueueBtn?.addEventListener('click', () => {
            triggerManualSync();
        });

        // Form pengaturan interval sinkronisasi
        elements.sync.settingsForm?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const intervalHours = parseInt(elements.sync.intervalSelect?.value, 10) || 3;
            const autoSyncEnabled = elements.sync.autoEnabledCheckbox?.checked !== false;

            try {
                const res = await window.api.post('/api/sync-settings', { intervalHours, autoSyncEnabled });
                if (res.error) throw new Error(res.error);
                showToast(`Pengaturan tersimpan: Sinkronisasi otomatis setiap ${intervalHours} jam.`, 'success');
                await loadSyncStatus();
            } catch (err) {
                showToast(err.message || 'Gagal menyimpan pengaturan sinkronisasi.', 'error');
            }
        });

        elements.settings.closeBtn.addEventListener('click', () => {
            isModalOpen = false;
            applyTheme(currentAppSettings);
            elements.settings.modal.classList.add('hidden');
        });
    }

    function renderMealPlanEditor(tanggal, plans) {
        const editor = elements.settings.mealPlanEditor;
        if (!editor) return;
        editor.innerHTML = '';
        const sessions = ['MAKAN PAGI', 'MAKAN SIANG', 'MAKAN MALAM'];
        const fields = [
            { key: 'starch', label: 'Karbohidrat' }, { key: 'main_course_1', label: 'Lauk Utama 1' },
            { key: 'main_course_2', label: 'Lauk Utama 2' }, { key: 'side_dish', label: 'Lauk Pendamping' },
            { key: 'vegetables', label: 'Sayuran' }, { key: 'condiment', label: 'Sambal/Bumbu' },
            { key: 'fruit_kantin', label: 'Buah Kantin' }, { key: 'fruit_packmeal', label: 'Buah Packmeal' },
            { key: 'beverage', label: 'Minuman' }
        ];

        sessions.forEach(sesi => {
            const plan = (plans || []).find(p => p.sesi_makan === sesi) || {};
            let fieldHtml = '';
            fields.forEach(field => {
                fieldHtml += `
                    <div class="grid grid-cols-1 sm:grid-cols-5 gap-2 items-center">
                        <label class="text-sm text-gray-400 sm:col-span-1">${field.label}</label>
                        <input type="text" name="${field.key}_nama" placeholder="Nama" value="${plan[`${field.key}_nama`] || ''}" class="sm:col-span-2 bg-gray-800 p-2 rounded text-sm">
                        <input type="number" name="${field.key}_gram" placeholder="Gr" value="${plan[`${field.key}_gram`] || ''}" class="bg-gray-800 p-2 rounded text-sm">
                        <input type="number" name="${field.key}_kalori" placeholder="Kkal" value="${plan[`${field.key}_kalori`] || ''}" class="bg-gray-800 p-2 rounded text-sm">
                    </div>`;
            });

            const formHtml = `
                <form class="card space-y-3 meal-plan-form" data-sesi="${sesi}" data-tanggal="${tanggal}">
                    <h4 class="text-lg font-bold text-theme">${sesi}</h4>
                    ${fieldHtml}
                    <button type="submit" class="w-full mt-2 bg-theme bg-theme-hover text-white font-bold py-2 px-4 rounded-lg">Simpan ${sesi}</button>
                </form>
            `;
            editor.innerHTML += formHtml;
        });

        document.querySelectorAll('.meal-plan-form').forEach(form => {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                const planData = Object.fromEntries(formData.entries());
                planData.tanggal = e.target.dataset.tanggal;
                planData.sesi_makan = e.target.dataset.sesi;
                
                let total_calorie = 0;
                for (const [key, value] of formData.entries()) {
                    if (key.endsWith('_kalori') && value) {
                        total_calorie += parseInt(value, 10);
                    }
                }
                planData.total_calorie = total_calorie;

                try {
                    const result = await window.api.post('/api/meal-plan', planData);
                    if (result.error) throw new Error(result.error);
                    showToast(result.message);
                    initializeDashboard();
                } catch (error) {
                    showToast(error.message || 'Gagal menyimpan meal plan.', 'error');
                }
            });
        });
    }

    // --- Event Listeners ---
    function setupEventListeners() {
        const SCAN_MAX_INTERVAL_MS = 45;
        const SCAN_MIN_LENGTH = 6;
        let lastKeyTimestamp = 0;
        let scanIntervals = [];

        function resetScanMetrics() {
            lastKeyTimestamp = 0;
            scanIntervals = [];
        }

        function looksLikeScannerInput(scanValue) {
            if (!scanValue || scanValue.length < SCAN_MIN_LENGTH) {
                return false;
            }

            if (scanIntervals.length === 0) {
                return false;
            }

            const maxInterval = Math.max(...scanIntervals);
            return maxInterval <= SCAN_MAX_INTERVAL_MS;
        }

        async function submitScan(nik) {
            try {
                const response = await window.api.post('/api/scan', { nik });
                if (response.error) throw new Error(response.message);

                // Ambil Nama Depan saja untuk sapaan suara (Voice Synthesizer)
                const rawEmpName = response.data?.nama_lengkap || response.data?.nama || response.savedRecord?.nama_lengkap || '';
                const firstName = getFirstName(rawEmpName);

                if (response.status === 'SUCCESS') {
                    const isOutOfPlan = response.isOutOfPlan ||
                        (typeof response.peakmealNotice === 'string' && response.peakmealNotice.includes('DI LUAR PLAN')) ||
                        (response.peakmealNotice && response.peakmealNotice.status === 'OUT_OF_PLAN');

                    const scanType = isOutOfPlan ? 'warning' : (response.rosterNotice?.type === 'error' ? 'error' : 'success');

                    if (isOutOfPlan) {
                        playTone('warning');
                        speakVoice(firstName ? `${firstName}, di luar plan. Silakan makan.` : 'Di luar plan. Silakan makan.');
                    } else {
                        playTone('success');
                        speakVoice(firstName ? `Silakan makan, ${firstName}.` : 'Silakan makan.');
                    }

                    showScanResult({
                        type: scanType,
                        status: response.status,
                        sesiMakan: response.sesiMakan || elements.currentSession?.textContent || 'MAKAN',
                        message: response.message,
                        details: response.data,
                        peakmealNotice: response.peakmealNotice,
                        rosterNotice: response.rosterNotice,
                        savedRecord: response.savedRecord,
                        isOffline: response.isOffline || response.savedRecord?.offline,
                        visitorStatus: response.visitorStatus
                    });
                    initializeDashboard();
                } else if (response.status === 'ALREADY_SCANNED') {
                    playTone('error');
                    speakVoice(firstName ? `${firstName}, Anda sudah scan sesi ini.` : 'Anda sudah scan sesi ini.');
                    sendAppLog('ERROR', 'SCAN', response.message, {
                        status: response.status,
                        nik,
                    });
                    showScanResult({
                        type: 'error',
                        status: 'ALREADY_SCANNED',
                        message: response.message,
                        details: response.data,
                        savedRecord: response.savedRecord,
                        sesiMakan: elements.currentSession?.textContent
                    });
                } else if (response.status === 'PEAKMEAL_WRONG_LOCATION') {
                    playTone('error');
                    const loc = (response.deliveryLocation || '').replace(/[-_]/g, ' ').trim() || 'lokasi lain';
                    speakVoice(firstName ? `${firstName}, pesanan Anda di ${loc}.` : `Pesanan Anda di ${loc}.`);
                    sendAppLog('ERROR', 'SCAN', response.message, {
                        status: response.status,
                        nik,
                    });
                    showScanResult({
                        type: 'error',
                        status: 'PEAKMEAL_WRONG_LOCATION',
                        message: response.message,
                        details: response.data,
                        deliveryLocation: response.deliveryLocation,
                        peakmealNotice: response.peakmealNotice
                    });
                } else if (response.status === 'ROSTER_OFF_REJECTED') {
                    playTone('error');
                    speakVoice(firstName ? `${firstName}, jadwal Anda sedang libur.` : 'Jadwal Anda sedang libur.');
                    sendAppLog('ERROR', 'SCAN', response.message, {
                        status: response.status,
                        nik,
                    });
                    showScanResult({
                        type: 'error',
                        status: 'ROSTER_OFF_REJECTED',
                        message: response.message,
                        details: response.data,
                        rosterNotice: response.rosterNotice
                    });
                } else if (response.status === 'LIMIT_EXCEEDED') {
                    playTone('error');
                    speakVoice(firstName ? `${firstName}, batas makan hari ini sudah habis.` : 'Batas makan hari ini sudah habis.');
                    sendAppLog('ERROR', 'SCAN', response.message, {
                        status: response.status,
                        nik,
                    });
                    showScanResult({
                        type: 'error',
                        status: 'LIMIT_EXCEEDED',
                        message: response.message,
                        details: response.data
                    });
                } else if (response.status === 'OUT_OF_SESSION') {
                    playTone('warning');
                    speakVoice('Di luar jam makan.');
                    sendAppLog('ERROR', 'SCAN', response.message, {
                        status: response.status,
                        nik,
                    });
                    showScanResult({
                        type: 'warning',
                        status: 'OUT_OF_SESSION',
                        message: response.message,
                        details: response.data
                    });
                } else {
                    playTone('error');
                    speakVoice('Barcode tidak terdaftar.');
                    sendAppLog('ERROR', 'SCAN', response.message || 'Scan gagal', {
                        status: response.status,
                        nik,
                    });
                    showScanResult({
                        type: 'error',
                        status: response.status || 'ERROR',
                        message: response.message || 'Scan gagal',
                        details: response.data || null
                    });
                }
            } catch (error) {
                console.error('Scan error:', error);
                playTone('error');
                speakVoice('Scan gagal.');
                sendAppLog('ERROR', 'SCAN', error.message || 'Terjadi kesalahan server', { nik });
                showScanResult({
                    type: 'error',
                    status: 'ERROR',
                    message: error.message || 'Terjadi kesalahan server'
                });
            }
        }

        function focusInput() {
            if (!isModalOpen && elements.barcodeInput) {
                elements.barcodeInput.focus();
            }
        }
        focusInput();
        window.addEventListener('click', focusInput);

        elements.barcodeInput.addEventListener('keydown', async (e) => {
            if (isModalOpen) {
                return;
            }

            const now = Date.now();

            if (e.key === 'Enter') {
                e.preventDefault();
                const nik = elements.barcodeInput.value.trim();

                if (!nik) {
                    resetScanMetrics();
                    return;
                }

                if (!looksLikeScannerInput(nik)) {
                    playTone('error');
                    speakVoice('Gunakan scanner barcode.');
                    sendAppLog('ERROR', 'SCAN', 'Input manual ditolak. Gunakan scanner barcode.', { nik });
                    showScanResult('error', 'Input manual tidak diperbolehkan. Gunakan scanner barcode.');
                    elements.barcodeInput.value = '';
                    resetScanMetrics();
                    return;
                }

                await submitScan(nik);
                elements.barcodeInput.value = '';
                resetScanMetrics();
                return;
            }

            if (e.key.length === 1) {
                if (lastKeyTimestamp > 0) {
                    scanIntervals.push(now - lastKeyTimestamp);
                }
                lastKeyTimestamp = now;
                return;
            }

            if (e.key === 'Backspace' || e.key === 'Delete') {
                resetScanMetrics();
            }
        });

        elements.barcodeInput.addEventListener('paste', (e) => {
            e.preventDefault();
            sendAppLog('ERROR', 'SCAN', 'Paste ditolak. Gunakan scanner barcode.');
            showScanResult('error', 'Paste tidak diperbolehkan. Gunakan scanner barcode.');
            elements.barcodeInput.value = '';
            resetScanMetrics();
        });

        elements.settings.modal.addEventListener('click', (e) => {
            if (e.target === elements.settings.modal) {
                isModalOpen = false;
                applyTheme(currentAppSettings);
                elements.settings.modal.classList.add('hidden');
            }
        });

        elements.forms.report?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const startDate = e.target.querySelector('#start-date').value;
            const endDate = e.target.querySelector('#end-date').value;
            try {
                const { blob, filename } = await window.api.download(`/api/download-report?startDate=${startDate}&endDate=${endDate}`);
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
                showToast('Laporan berhasil diunduh.');
            } catch (error) {
                console.error('Gagal download laporan:', error);
                showToast('Gagal download laporan.', 'error');
            }
        });

        elements.forms.peakmealReport?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const startDate = e.target.querySelector('#peakmeal-start-date').value;
            const endDate = e.target.querySelector('#peakmeal-end-date').value;
            const maxDate = getDateInputValue(3);
            if (endDate > maxDate) {
                showToast('Tanggal pengajuan maksimal sampai 3 hari ke depan.', 'error');
                return;
            }
            if (startDate > endDate) {
                showToast('Tanggal awal tidak boleh lebih besar dari tanggal akhir.', 'error');
                return;
            }
            try {
                const { blob, filename } = await window.api.download(`/api/download-peakmeal-report?startDate=${startDate}&endDate=${endDate}`);
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
                showToast('Laporan pengajuan peak meal/snack berhasil diunduh.');
            } catch (error) {
                console.error('Gagal download laporan pengajuan peakmeal/snack:', error);
                showToast('Gagal download laporan pengajuan peak meal/snack.', 'error');
            }
        });

        elements.forms.imageUpload?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const imageInput = e.target.querySelector('#image-file');
            const imageFile = imageInput.files[0];
            const tanggal = e.target.querySelector('#image-date').value;
            const nama = e.target.querySelector('#image-name').value;

            if (!imageFile || !tanggal || !nama) {
                showToast('Harap isi semua field dan pilih file gambar.', 'error');
                return;
            }

            const reader = new FileReader();
            reader.onload = async () => {
                const fileBuffer = reader.result;
                try {
                    const result = await window.api.uploadWithIpc('upload-image', {
                        fileBuffer: Buffer.from(fileBuffer),
                        fileName: imageFile.name,
                        tanggal,
                        nama
                    });

                    if (!result.success) throw new Error(result.message);
                    
                    showToast(result.message || 'Gambar berhasil diupload.');
                    initializeDashboard();
                    e.target.reset();
                } catch (error) {
                    console.error('Gagal upload gambar:', error);
                    showToast(error.message || 'Gagal upload gambar.', 'error');
                }
            };
            reader.onerror = (error) => {
                console.error('File reading error:', error);
                showToast('Gagal membaca file.', 'error');
            };
            reader.readAsArrayBuffer(imageFile);
        });

        elements.forms.mealPlanUpload?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const mealPlanInput = e.target.querySelector('#meal-plan-file');
            const mealPlanFile = mealPlanInput.files[0];

            if (!mealPlanFile) {
                showToast('Silakan pilih file Excel terlebih dahulu.', 'error');
                return;
            }

            const formData = new FormData();
            formData.append('mealPlanFile', mealPlanFile);

            try {
                const result = await window.api.upload('/api/upload-meal-plan', formData);
                if(result.error) throw new Error(result.error);
                showToast(result.message || 'Meal plan berhasil diupload.');
                initializeDashboard();
                e.target.reset();
            } catch (error) {
                console.error('Gagal upload meal plan:', error);
                showToast(error.message || 'Gagal upload meal plan.', 'error');
            }
        });
    }

    // --- Jam & Tanggal ---
    function updateTime() {
        const now = new Date();
        const timeString = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).replace(/\./g, ':');
        const dateString = now.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        elements.clock.textContent = timeString;
        elements.date.textContent = dateString;
    }

    function getDateInputValue(addDays = 0) {
        const date = new Date();
        date.setDate(date.getDate() + addDays);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function setDefaultReportDates() {
        const today = getDateInputValue();
        const peakmealMaxDate = getDateInputValue(3);
        ['start-date', 'end-date', 'peakmeal-start-date', 'peakmeal-end-date'].forEach(id => {
            const input = document.getElementById(id);
            if (input && !input.value) {
                input.value = today;
            }
        });
        ['peakmeal-start-date', 'peakmeal-end-date'].forEach(id => {
            const input = document.getElementById(id);
            if (input) {
                input.max = peakmealMaxDate;
            }
        });
    }

    // --- Jalankan Aplikasi ---
    updateTime();
    setDefaultReportDates();
    setInterval(updateTime, 1000);
    setInterval(initializeDashboard, 300000); // Refresh data setiap 5 menit
    setInterval(refreshConnectionStatus, 15000);

    window.addEventListener('error', (event) => {
        sendAppLog('ERROR', 'RENDERER:window.onerror', event.message, {
            filename: event.filename,
            line: event.lineno,
            column: event.colno,
        });
    });

    window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        const message = reason instanceof Error ? reason.message : String(reason);
        sendAppLog('ERROR', 'RENDERER:unhandledrejection', message);
    });

    initializeDashboard();
    setupEventListeners();
    setupSettingsModal();
    showScanResult('info', 'Silakan Scan Barcode Karyawan');
});
