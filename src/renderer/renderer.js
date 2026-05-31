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
        mealPlan: {
            session: document.getElementById('meal-plan-session'),
            content: document.getElementById('meal-plan-content'),
            totalCalories: document.getElementById('total-calories'),
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
            imageUpload: document.getElementById('image-upload-form'),
            mealPlanUpload: document.getElementById('meal-plan-upload-form'),
        },
        toast: document.getElementById('toast'),
    };

    let resetScanTimer;
    let currentAppSettings = {};
    let isModalOpen = false;

    function getEl(id) {
        return document.getElementById(id);
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
            applyTheme(currentAppSettings);
            updateDashboardUI(data);
        } catch (error) {
            console.error("Gagal memuat data dashboard:", error);
            sendAppLog('ERROR', 'RENDERER:dashboard', error.message);
            showToast(error.message || 'Gagal memuat data dashboard.', 'error');
        } finally {
            await refreshConnectionStatus();
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
        if(document.getElementById(cardId)) {
            document.getElementById(cardId).classList.add('ring-2', 'ring-theme', 'shadow-lg', 'shadow-theme');
        }
        
        updateSlideshow(data.menuImages);
        updateMealPlan(data.mealPlan, data.currentSesi);
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

    function updateMealPlan(plan, session) {
        elements.mealPlan.session.textContent = session;
        const content = elements.mealPlan.content;
        content.innerHTML = '';

        if (!plan) {
            content.innerHTML = '<p class="m-auto text-gray-400">Tidak ada meal plan untuk sesi ini.</p>';
            elements.mealPlan.totalCalories.textContent = '0 kkal';
            return;
        }

        const menuItems = [
            { nama: plan.starch_nama, gram: plan.starch_gram, kalori: plan.starch_kalori },
            { nama: plan.main_course_1_nama, gram: plan.main_course_1_gram, kalori: plan.main_course_1_kalori },
            { nama: plan.main_course_2_nama, gram: plan.main_course_2_gram, kalori: plan.main_course_2_kalori },
            { nama: plan.side_dish_nama, gram: plan.side_dish_gram, kalori: plan.side_dish_kalori },
            { nama: plan.vegetables_nama, gram: plan.vegetables_gram, kalori: plan.vegetables_kalori },
            { nama: plan.condiment_nama, gram: plan.condiment_gram, kalori: plan.condiment_kalori },
            { nama: plan.fruit_kantin_nama, gram: plan.fruit_kantin_gram, kalori: plan.fruit_kantin_kalori },
            { nama: plan.beverage_nama, gram: plan.beverage_gram, kalori: plan.beverage_kalori },
        ];

        let totalCalories = 0;
        menuItems.forEach(item => {
            if (item.nama) {
                const detail = `${item.gram || '?'} gr / ${item.kalori || '?'} kkal`;
                content.innerHTML += `<div class="flex justify-between items-center"><span class="text-gray-300">${item.nama}</span><span class="font-semibold text-white">${detail}</span></div>`;
                totalCalories += parseInt(item.kalori) || 0;
            }
        });
        elements.mealPlan.totalCalories.textContent = `${plan.total_calorie || totalCalories} kkal`;
    }

    function showScanResult(type, message, details = null) {
        clearTimeout(resetScanTimer);
        const { card, placeholder, employeeDetails } = elements.scanResult;
        
        card.classList.remove('status-info', 'status-success', 'status-error');
        card.classList.add(`status-${type}`);
        
        if (details) {
            const initials = (details.nama_lengkap || 'NA').substring(0, 2).toUpperCase();
            const fallbackAvatar = `data:image/svg+xml;utf8,${encodeURIComponent(
                `<svg xmlns='http://www.w3.org/2000/svg' width='150' height='150'>
                    <rect width='100%' height='100%' fill='#1f2937'/>
                    <text x='50%' y='52%' dominant-baseline='middle' text-anchor='middle'
                        font-family='Inter, Arial, sans-serif' font-size='48' fill='white'>${initials}</text>
                </svg>`
            )}`;
            const employeePhoto = details.photo_full_url || fallbackAvatar;
            placeholder.classList.add('hidden');
            employeeDetails.innerHTML = `
                <img src="${employeePhoto}" alt="Foto Karyawan" class="w-32 h-32 rounded-full border-4 border-white/20 object-cover mx-auto mb-4" onerror="this.src='${fallbackAvatar}'">
                <h2 class="text-3xl font-bold">${details.nama_lengkap}</h2>
                <p class="text-lg opacity-80">${details.no_nik}</p>
                <p class="mt-2 text-md">${details.depart} / ${details.posisi}</p>
                <div class="mt-4 text-xl font-bold bg-black/20 px-4 py-2 rounded-lg">${message}</div>
            `;
            employeeDetails.classList.remove('opacity-0', 'max-h-0');
            employeeDetails.style.maxHeight = employeeDetails.scrollHeight + "px";
        } else {
            employeeDetails.classList.add('opacity-0', 'max-h-0');
            employeeDetails.style.maxHeight = '0px';
            placeholder.classList.remove('hidden');
            elements.scanResult.statusMessage.textContent = message;
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
                body.innerHTML = `<tr><td colspan="5" class="text-center text-gray-400 py-4">Belum ada riwayat scan hari ini.</td></tr>`;
                return;
            }
            history.forEach(scan => {
                const row = `
                    <tr class="border-b border-gray-700">
                        <td class="px-4 py-2 font-mono">${scan.time}</td>
                        <td class="px-4 py-2">${scan.nik}</td>
                        <td class="px-4 py-2">${scan.nama_lengkap || 'N/A'}</td>
                        <td class="px-4 py-2">${scan.nama_perusahaan || '-'}</td>
                        <td class="px-4 py-2">${scan.sesi_makan}</td>
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

    function setupSettingsModal() {
        elements.settings.tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                elements.settings.tabs.forEach(t => t.classList.remove('active-tab'));
                tab.classList.add('active-tab');

                elements.settings.tabContents.forEach(content => content.classList.add('hidden'));
                const activeTabContent = document.getElementById(`tab-${tab.dataset.tab}`);
                activeTabContent.classList.remove('hidden');

                if (tab.dataset.tab === 'riwayat') {
                    loadScanHistory();
                }

                if (tab.dataset.tab === 'log') {
                    loadErrorLogs();
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

        elements.settings.mealPlanDatePicker.addEventListener('change', async (e) => {
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
            const today = new Date().toISOString().split('T')[0];
            elements.settings.mealPlanDatePicker.value = today;
            elements.settings.mealPlanDatePicker.dispatchEvent(new Event('change'));
            
            const appNameInput = getEl('app-name');
            const appDescriptionInput = getEl('app-description');
            const themeInput = getEl('theme-color');

            if (appNameInput) appNameInput.value = currentAppSettings.nama || '';
            if (appDescriptionInput) appDescriptionInput.value = currentAppSettings.description || '';
            if (themeInput) themeInput.value = currentAppSettings.theme || defaultSettings.theme;

            elements.settings.modal.classList.remove('hidden');
        });

        elements.settings.closeBtn.addEventListener('click', () => {
            isModalOpen = false;
            applyTheme(currentAppSettings);
            elements.settings.modal.classList.add('hidden');
        });
    }

    function renderMealPlanEditor(tanggal, plans) {
        const editor = elements.settings.mealPlanEditor;
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
            const plan = plans.find(p => p.sesi_makan === sesi) || {};
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

                if (response.status === 'SUCCESS') {
                    const extraMessages = [];
                    if (response.peakmealNotice) extraMessages.push(response.peakmealNotice);
                    if (response.rosterNotice && response.rosterNotice.message) extraMessages.push(response.rosterNotice.message);

                    const message = extraMessages.length > 0
                        ? `${response.message} | ${extraMessages.join(' | ')}`
                        : response.message;

                    const scanType = response.rosterNotice?.type === 'error' ? 'error' : 'success';
                    showScanResult(scanType, message, response.data);
                    initializeDashboard();
                } else if (response.status === 'ALREADY_SCANNED' || response.status === 'OUT_OF_SESSION') {
                    sendAppLog('ERROR', 'SCAN', response.message, {
                        status: response.status,
                        nik,
                    });
                    showScanResult('error', response.message, response.data);
                } else {
                    sendAppLog('ERROR', 'SCAN', response.message || 'Scan gagal', {
                        status: response.status,
                        nik,
                    });
                    showScanResult('error', response.message);
                }
            } catch (error) {
                console.error('Scan error:', error);
                sendAppLog('ERROR', 'SCAN', error.message || 'Terjadi kesalahan server', { nik });
                showScanResult('error', error.message || 'Terjadi kesalahan server');
            }
        }

        function focusInput() {
            if (!isModalOpen) {
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

        elements.forms.report.addEventListener('submit', async (e) => {
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

        elements.forms.imageUpload.addEventListener('submit', async (e) => {
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

        elements.forms.mealPlanUpload.addEventListener('submit', async (e) => {
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

    // --- Jalankan Aplikasi ---
    updateTime();
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
