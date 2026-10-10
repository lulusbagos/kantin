// --- Import Modul yang Dibutuhkan ---
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const ExcelJS = require('exceljs');
const fs = require('fs').promises; // Gunakan fs.promises
const fsSync = require('fs');
const os = require('os');
const sql = require('mssql');
const db = require('./database-utils'); // Database utilities

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}
const LOCAL_IP_ADDRESS = getLocalIP();
const HOSTNAME = os.hostname() || 'CLIENT-PC';
const envPath = app.isPackaged
    ? path.join(process.resourcesPath, '.env')
    : path.resolve(__dirname, '..', '.env');
require('dotenv').config({ path: envPath });
const HR_SCAN_API_BASE = 'https://indexsafemission_api.indexim.id/api/MinePermit/kantin/scan';
const ONEEV_BASE_URL = process.env.ONEEV_BASE_URL || 'https://oneev.indexim.id';
const EMPLOYEE_PHOTO_ENDPOINT = `${ONEEV_BASE_URL}/Employee/PhotoByNik`;
const EMPLOYEE_PHOTO_SECRET = process.env.EMPLOYEE_PHOTO_SECRET || 'hanyalulusyangtahu';
const UPLOADS_DIR = path.join(app.getPath('userData'), 'uploads');
const LOCAL_CONFIG_PATH = path.join(app.getPath('userData'), 'local_config.json');
const OFFICE_PEAKMEAL_LOCATIONS = [
    'KANTIN OFFICE 12 PRASMANAN',
    'KANTIN OFFICE 33 PRASMANAN'
];

function normalizeLocationName(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, ' ');
}

function getCanonicalLocation(value) {
    const norm = normalizeLocationName(value);
    if (!norm) return '';

    const has12 = /\b12\b/.test(norm) || norm.includes('KM 12') || norm.includes('KM12');
    const has33 = /\b33\b/.test(norm) || norm.includes('KM 33') || norm.includes('KM33');

    if (has12 && !has33 && (norm.includes('OFFICE') || norm.includes('KANTIN') || norm.includes('PRASMANAN'))) {
        return 'KANTIN OFFICE 12 PRASMANAN';
    }

    if (has33 && !has12 && (norm.includes('OFFICE') || norm.includes('KANTIN') || norm.includes('PRASMANAN'))) {
        return 'KANTIN OFFICE 33 PRASMANAN';
    }

    return norm;
}

function getOfficePeakmealLocation(value) {
    const canonical = getCanonicalLocation(value);
    return OFFICE_PEAKMEAL_LOCATIONS.find(location => location === canonical) || null;
}

function isSameDeliveryLocation(orderedLocation, scanLocation) {
    const ordered = normalizeLocationName(orderedLocation);
    const scan = normalizeLocationName(scanLocation);
    if (!ordered || !scan) return false;

    // 1. Exact match setelah normalisasi
    if (ordered === scan) return true;

    // 2. Canonical match (misal pesanan "KANTIN OFFICE 12 PRASMANAN" dan setting desktop "Kantin Office 12")
    const canonOrdered = getCanonicalLocation(ordered);
    const canonScan = getCanonicalLocation(scan);
    if (canonOrdered && canonScan && canonOrdered === canonScan) {
        return true;
    }

    // Hindari salah silang antara angka 12 dan 33
    const orderedHas12 = /\b12\b/.test(ordered) || ordered.includes('KM 12');
    const orderedHas33 = /\b33\b/.test(ordered) || ordered.includes('KM 33');
    const scanHas12 = /\b12\b/.test(scan) || scan.includes('KM 12');
    const scanHas33 = /\b33\b/.test(scan) || scan.includes('KM 33');

    if ((orderedHas12 && scanHas33) || (orderedHas33 && scanHas12)) {
        return false;
    }

    // 3. Substring match jika tidak bertentangan angka 12/33
    if (ordered.length >= 4 && scan.length >= 4) {
        if (ordered.includes(scan) || scan.includes(ordered)) {
            return true;
        }
    }

    return false;
}

function isSpecialBuffetAllowedRoster(roster) {
    if (!roster) return false;
    const kode = normalizeLocationName(roster.roster_kode || roster.roster_status_raw);
    const ket = normalizeLocationName(roster.roster_keterangan);
    return kode === 'OFF 13:1' || ket === 'OFF 13:1' || kode.includes('13:1') || ket.includes('13:1');
}

function isAllowedMealRoster(roster) {
    const kategori = normalizeLocationName(roster?.roster_kategori);
    return kategori === 'WORK' || isSpecialBuffetAllowedRoster(roster);
}

function ensureUploadsDirectory() {
    if (!fsSync.existsSync(UPLOADS_DIR)) {
        fsSync.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
}

// --- Konfigurasi Database (SQL Server) ---
const sqlConfig = {
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    authentication: {
        type: 'default',
        options: {
            userName: process.env.DB_USER,
            password: process.env.DB_PASSWORD
        }
    },
    options: {
        encrypt: false,
        trustServerCertificate: true
    }
};

let pool;
let autoReloadInterval = null;
const appLogs = [];
const MAX_APP_LOGS = 500;

function writeAppLog(level, source, message, context = null) {
    const entry = {
        timestamp: new Date().toISOString(),
        level: (level || 'ERROR').toUpperCase(),
        source: source || 'SYSTEM',
        message: message || 'Unknown error',
        context
    };

    appLogs.unshift(entry);
    if (appLogs.length > MAX_APP_LOGS) {
        appLogs.length = MAX_APP_LOGS;
    }
}

const OFFLINE_QUEUE_PATH = path.join(app.getPath('userData'), 'offline_scans.json');
const CACHED_EMPLOYEES_PATH = path.join(app.getPath('userData'), 'cached_employees.json');

async function getCachedEmployees() {
    try {
        const data = await fs.readFile(CACHED_EMPLOYEES_PATH, 'utf8');
        return JSON.parse(data) || {};
    } catch {
        return {};
    }
}

async function saveToEmployeeCache(scanCode, employeeData) {
    try {
        const cache = await getCachedEmployees();
        cache[scanCode] = {
            ...employeeData,
            cachedAt: new Date().toISOString()
        };
        await fs.writeFile(CACHED_EMPLOYEES_PATH, JSON.stringify(cache, null, 2), 'utf8');
    } catch (err) {
        console.error('Gagal menulis ke cache karyawan:', err);
    }
}

async function getOfflineQueue() {
    try {
        const data = await fs.readFile(OFFLINE_QUEUE_PATH, 'utf8');
        return JSON.parse(data) || [];
    } catch {
        return [];
    }
}

async function saveToOfflineQueue(scan) {
    try {
        const queue = await getOfflineQueue();
        // Cek duplikasi di queue untuk mencegah entry ganda
        const isDuplicate = queue.some(q => q.nik === scan.nik && q.date === scan.date && q.sesi === scan.sesi);
        if (!isDuplicate) {
            queue.push(scan);
            await fs.writeFile(OFFLINE_QUEUE_PATH, JSON.stringify(queue, null, 2), 'utf8');
            writeAppLog('WARNING', 'OFFLINE', `Scan NIK ${scan.nik} disimpan secara lokal (antrean offline).`);
        }
    } catch (err) {
        console.error('Gagal menulis ke antrean offline:', err);
    }
}

let isSyncingScans = false;

async function syncOfflineScans() {
    if (isSyncingScans) return;
    if (!pool || !pool.connected) return;

    try {
        const queue = await getOfflineQueue();
        if (queue.length === 0) return;

        isSyncingScans = true;
        const appLocation = await getEffectiveLocation();
        writeAppLog('INFO', 'OFFLINE', `Memulai sinkronisasi ${queue.length} data scan offline ke database...`);
        console.log(`[Offline Sync] Starting sync for ${queue.length} items...`);

        const remaining = [];
        for (const scan of queue) {
            try {
                // Cek duplikasi di DB untuk mencegah double insert
                const existing = await db.getExistingScan(pool, scan.nik, scan.date, scan.sesi);
                if (!existing) {
                    await db.recordScan(pool, scan.nik, scan.date, scan.sesi, scan.time, scan.status, scan.ip_address || LOCAL_IP_ADDRESS, scan.lokasi || appLocation, scan.nama_pc || HOSTNAME);
                }
                writeAppLog('INFO', 'OFFLINE', `Sinkronisasi sukses: NIK ${scan.nik} terkirim ke database.`);
            } catch (err) {
                console.error(`Gagal mensinkronkan NIK ${scan.nik}:`, err.message);
                // Simpan kembali ke queue jika gagal
                remaining.push(scan);
            }
        }

        if (remaining.length === 0) {
            try {
                await fs.unlink(OFFLINE_QUEUE_PATH);
            } catch {}
        } else {
            await fs.writeFile(OFFLINE_QUEUE_PATH, JSON.stringify(remaining, null, 2), 'utf8');
        }
    } catch (syncErr) {
        console.error('Offline sync runtime error:', syncErr);
    } finally {
        isSyncingScans = false;
    }
}

// Sync raw barcode scans from last 7 days with HR API
async function syncBarcodeScansFor7Days() {
    if (!pool || !pool.connected) return { success: false, message: 'Database offline' };

    try {
        writeAppLog('INFO', 'SYNC', 'Memulai sinkronisasi barcode NIK 7 hari terakhir...');
        const request = pool.request();
        const scans = await request.query(`
            SELECT pid, nik, tanggal, sesi_makan, time, status
            FROM tbl_m_pengunjung_kantin
            WHERE CAST(tanggal AS DATE) BETWEEN DATEADD(day, -7, GETDATE()) AND GETDATE()
              AND LEN(nik) > 12
              AND (nik LIKE '1%' OR nik LIKE 'R1%')
        `);

        if (scans.recordset.length === 0) {
            writeAppLog('INFO', 'SYNC', 'Tidak ada data barcode yang perlu disinkronkan.');
            return { success: true, count: 0 };
        }

        let updatedCount = 0;
        let deletedCount = 0;
        let failCount = 0;

        for (const scan of scans.recordset) {
            const pid = scan.pid;
            const barcode = scan.nik;
            const uppercaseBarcode = barcode.toUpperCase().replace(/^R/, '');
            
            try {
                const apiEmployee = await getEmployeeFromHrScanApi(uppercaseBarcode);
                if (apiEmployee) {
                    const realNik = apiEmployee.no_nik;
                    const isIndexim = isIndeximCompany(apiEmployee);
                    const newStatus = isIndexim ? 'SUCCESS' : 'TAMU';

                    try {
                        const updateRequest = pool.request();
                        updateRequest.input('pid', pid);
                        updateRequest.input('realNik', realNik);
                        updateRequest.input('status', newStatus);
                        
                        await updateRequest.query(`
                            UPDATE tbl_m_pengunjung_kantin
                            SET nik = @realNik, status = @status
                            WHERE pid = @pid
                        `);
                        updatedCount++;
                    } catch (updateErr) {
                        // Jika error UQ_Pengunjung / duplicate, hapus record scan duplikat
                        if (updateErr.number === 2601 || updateErr.number === 2627 || updateErr.message.includes('UNIQUE') || updateErr.message.includes('duplicate')) {
                            console.log(`[Sync] Duplicate scan detected for PID ${pid}. Deleting...`);
                            const deleteRequest = pool.request();
                            deleteRequest.input('pid', pid);
                            await deleteRequest.query('DELETE FROM tbl_m_pengunjung_kantin WHERE pid = @pid');
                            deletedCount++;
                        } else {
                            throw updateErr;
                        }
                    }
                } else {
                    failCount++;
                }
            } catch (err) {
                console.error(`Gagal sinkronisasi barcode NIK ${barcode}:`, err.message);
                failCount++;
            }
        }

        writeAppLog('INFO', 'SYNC', `Sinkronisasi barcode selesai. Diupdate: ${updatedCount}, Dihapus (Duplikat): ${deletedCount}, Gagal: ${failCount}`);
        return { success: true, updatedCount, deletedCount, failCount };
    } catch (err) {
        console.error('Runtime error during barcode sync:', err);
        writeAppLog('ERROR', 'SYNC', err.message);
        throw err;
    }
}

// --- AUTO SYNC (3 JAM) & OFFLINE ENGINE ---
let isFullSyncing = false;
let autoSyncIntervalTimer = null;
let backgroundReconnectTimer = null;
let isReconnecting = false;
const MAX_SYNC_HISTORY = 20;

async function attemptDbReconnect() {
    if (pool && pool.connected) return true;
    if (isReconnecting) return false;
    isReconnecting = true;
    try {
        console.log('[DB Reconnect] Mencoba menyambungkan kembali ke database SQL Server...');
        if (pool) {
            try { await pool.close(); } catch {}
        }
        pool = new sql.ConnectionPool(sqlConfig);
        await pool.connect();
        console.log('[DB Reconnect] Berhasil terhubung kembali ke SQL Server!');
        writeAppLog('INFO', 'DB', 'Koneksi ke database SQL Server berhasil dipulihkan.');
        await db.ensureComplianceScanTable(pool);
        await db.ensureScanTableColumns(pool);
        return true;
    } catch (err) {
        console.warn('[DB Reconnect] Percobaan koneksi kembali belum berhasil:', err.message);
        return false;
    } finally {
        isReconnecting = false;
    }
}

async function syncActiveEmployeesToCache() {
    if (!pool || !pool.connected) {
        return { success: false, count: 0, message: 'Database offline' };
    }

    try {
        const employees = await db.getAllActiveEmployees(pool);
        if (!employees || employees.length === 0) {
            return { success: true, count: 0, message: 'Tidak ada data karyawan yang diperoleh dari database.' };
        }

        const cache = await getCachedEmployees();
        let addedCount = 0;
        let updatedCount = 0;

        for (const emp of employees) {
            const rawNik = (emp.no_nik || '').toString().trim();
            if (!rawNik) continue;

            const existing = cache[rawNik];
            const empData = {
                no_nik: rawNik,
                nama_lengkap: emp.nama_lengkap || 'Karyawan',
                nama_perusahaan: emp.nama_perusahaan || 'INDEXIM',
                depart: emp.depart || '-',
                posisi: emp.posisi || '-',
                status_residence: emp.status_residence || '',
                cachedAt: new Date().toISOString()
            };

            if (existing) {
                updatedCount++;
            } else {
                addedCount++;
            }

            cache[rawNik] = empData;
            const cleanDigits = rawNik.replace(/\D/g, '');
            if (cleanDigits && cleanDigits !== rawNik) {
                cache[cleanDigits] = empData;
            }
        }

        await fs.writeFile(CACHED_EMPLOYEES_PATH, JSON.stringify(cache, null, 2), 'utf8');
        writeAppLog('INFO', 'SYNC_EMPLOYEES', `Cache master karyawan offline berhasil diperbarui. Total: ${Object.keys(cache).length} karyawan.`);
        return {
            success: true,
            total: Object.keys(cache).length,
            added: addedCount,
            updated: updatedCount,
            message: `Cache offline diperbarui (${Object.keys(cache).length} karyawan)`
        };
    } catch (err) {
        console.error('Gagal memperbarui cache karyawan offline:', err);
        writeAppLog('ERROR', 'SYNC_EMPLOYEES', err.message);
        return { success: false, count: 0, error: err.message };
    }
}

async function runFullSync(options = {}) {
    const source = options.source || 'AUTO_SCHEDULE'; // 'AUTO_SCHEDULE', 'ADMIN_MANUAL', 'RECONNECT'
    if (isFullSyncing) {
        return {
            success: false,
            message: 'Sinkronisasi sedang berlangsung, harap tunggu hingga selesai.'
        };
    }

    isFullSyncing = true;
    const startTime = new Date();
    writeAppLog('INFO', 'SYNC', `[${source}] Memulai proses sinkronisasi menyeluruh (Offline Queue & Master Karyawan)...`);

    const result = {
        source,
        startTime: startTime.toISOString(),
        offlineScansSynced: 0,
        offlineScansRemaining: 0,
        employeesCached: 0,
        barcodesUpdated: 0,
        status: 'SUCCESS',
        message: ''
    };

    try {
        if (!pool || !pool.connected) {
            const reconnected = await attemptDbReconnect();
            if (!reconnected) {
                throw new Error('Database server tidak terhubung (offline). Sinkronisasi ditunda.');
            }
        }

        // 1. Sinkronisasi Data Scan Offline ke SQL Server
        const queueBefore = await getOfflineQueue();
        if (queueBefore.length > 0) {
            await syncOfflineScans();
            const queueAfter = await getOfflineQueue();
            result.offlineScansSynced = Math.max(0, queueBefore.length - queueAfter.length);
            result.offlineScansRemaining = queueAfter.length;
        }

        // 2. Sinkronisasi Master Data Karyawan ke Cache Offline
        try {
            const empRes = await syncActiveEmployeesToCache();
            if (empRes && empRes.success) {
                result.employeesCached = empRes.total || 0;
            }
        } catch (empErr) {
            console.warn('Gagal cache master karyawan saat full sync:', empErr.message);
        }

        // 3. Sinkronisasi Barcode NIK 7 hari terakhir
        try {
            const barcodeRes = await syncBarcodeScansFor7Days();
            if (barcodeRes && barcodeRes.success) {
                result.barcodesUpdated = barcodeRes.updatedCount || 0;
            }
        } catch (bcErr) {
            console.warn('Barcode sync 7 days warning:', bcErr.message);
        }

        result.endTime = new Date().toISOString();
        result.message = `Sinkronisasi berhasil! ${result.offlineScansSynced} scan terkirim, ${result.employeesCached} data karyawan diperbarui.`;
        writeAppLog('INFO', 'SYNC', `[${source}] ${result.message}`);

        // Update localConfig lastSyncTime & nextSyncTime
        const cfg = await getLocalConfig();
        const now = new Date();
        cfg.lastSyncTime = now.toISOString();
        const intervalHours = cfg.syncIntervalHours !== undefined ? cfg.syncIntervalHours : 3;
        cfg.nextSyncTime = new Date(now.getTime() + intervalHours * 3600000).toISOString();

        if (!cfg.syncHistory) cfg.syncHistory = [];
        cfg.syncHistory.unshift({
            source,
            timestamp: now.toISOString(),
            status: 'SUCCESS',
            offlineScansSynced: result.offlineScansSynced,
            employeesCached: result.employeesCached,
            message: result.message
        });
        if (cfg.syncHistory.length > MAX_SYNC_HISTORY) {
            cfg.syncHistory.length = MAX_SYNC_HISTORY;
        }
        await saveLocalConfig(cfg);

    } catch (err) {
        result.status = 'ERROR';
        result.endTime = new Date().toISOString();
        result.message = err.message || 'Sinkronisasi gagal.';
        writeAppLog('ERROR', 'SYNC', `[${source}] Gagal: ${result.message}`);

        const cfg = await getLocalConfig();
        if (!cfg.syncHistory) cfg.syncHistory = [];
        cfg.syncHistory.unshift({
            source,
            timestamp: new Date().toISOString(),
            status: 'ERROR',
            offlineScansSynced: 0,
            employeesCached: 0,
            message: result.message
        });
        if (cfg.syncHistory.length > MAX_SYNC_HISTORY) {
            cfg.syncHistory.length = MAX_SYNC_HISTORY;
        }
        await saveLocalConfig(cfg);
    } finally {
        isFullSyncing = false;
    }

    return result;
}

async function setupAutoSyncScheduler() {
    if (autoSyncIntervalTimer) {
        clearInterval(autoSyncIntervalTimer);
        autoSyncIntervalTimer = null;
    }

    const cfg = await getLocalConfig();
    const intervalHours = cfg.syncIntervalHours !== undefined ? cfg.syncIntervalHours : 3;
    const isAutoSyncEnabled = cfg.autoSyncEnabled !== undefined ? cfg.autoSyncEnabled : true;

    if (!isAutoSyncEnabled || intervalHours <= 0) {
        console.log('[Auto-Sync] Fitur auto-sync dinonaktifkan di pengaturan lokal.');
        return;
    }

    const intervalMs = intervalHours * 60 * 60 * 1000;
    console.log(`[Auto-Sync] Terjadwal otomatis setiap ${intervalHours} jam (${intervalMs} ms).`);

    const now = Date.now();
    const lastSync = cfg.lastSyncTime ? new Date(cfg.lastSyncTime).getTime() : 0;
    const elapsed = now - lastSync;

    if (elapsed >= intervalMs || !cfg.lastSyncTime) {
        console.log('[Auto-Sync] Jadwal 3 jam terpenuhi atau baru pertama kali, menjadwalkan sync awal...');
        setTimeout(async () => {
            await runFullSync({ source: 'AUTO_SCHEDULE' });
        }, 5000);
    }

    autoSyncIntervalTimer = setInterval(async () => {
        console.log(`[Auto-Sync] Interval ${intervalHours} jam terpicu, menjalankan sinkronisasi otomatis...`);
        await runFullSync({ source: 'AUTO_SCHEDULE' });
    }, intervalMs);
}

// Initialize SQL Server Connection Pool
async function initializeDatabase() {
    try {
        pool = new sql.ConnectionPool(sqlConfig);
        await pool.connect();
        console.log('Successfully connected to SQL Server database.');
        writeAppLog('INFO', 'DB', 'Successfully connected to SQL Server database.');

        await db.ensureComplianceScanTable(pool);
        await db.ensureScanTableColumns(pool);
        
        // Coba sinkronisasi antrean offline yang belum terkirim
        syncOfflineScans().catch(err => console.error('Gagal sinkronisasi awal offline scans:', err));
        
        return true;
    } catch (err) {
        console.warn('Koneksi ke SQL Server tidak dapat dibuat saat startup (Mode Offline Aktif):', err.message);
        writeAppLog('WARNING', 'DB', `Koneksi SQL Server gagal saat startup. Aplikasi berjalan dalam Mode Offline. ${err.message}`, {
            server: process.env.DB_SERVER,
            database: process.env.DB_DATABASE
        });
        pool = null;
        return false;
    }
}

async function getLocalConfig() {
    try {
        const data = await fs.readFile(LOCAL_CONFIG_PATH, 'utf8');
        return JSON.parse(data) || {};
    } catch {
        return {};
    }
}

async function saveLocalConfig(cfg) {
    try {
        await fs.writeFile(LOCAL_CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
    } catch (e) {
        console.warn('Gagal menyimpan local config:', e.message);
    }
}

async function getAppLocationName() {
    if (pool && pool.connected) {
        try {
            const settings = await db.getAppSettings(pool);
            if (settings && settings.nama && settings.nama.trim()) {
                return settings.nama.trim();
            }
        } catch (e) {
            console.warn('Gagal mengambil nama aplikasi untuk lokasi scan:', e.message);
        }
    }
    return 'XAFETARIA';
}

async function getEffectiveLocation() {
    const localCfg = await getLocalConfig();
    if (localCfg.lokasi && localCfg.lokasi.trim()) {
        return localCfg.lokasi.trim();
    }
    return await getAppLocationName();
}

// --- Konfigurasi Express API Server ---
const api = express();
api.use(cors());
api.use(express.json());
ensureUploadsDirectory();
api.use('/images', express.static(UPLOADS_DIR));

// --- Konfigurasi Multer (hanya untuk import Excel) ---
const mealPlanUpload = multer({ dest: UPLOADS_DIR });

let mainWindow;

function createWindow() {
    const iconPath = path.join(__dirname, 'renderer/assets/app-logo.jpeg');
    const windowOptions = {
        width: 1280,
        height: 800,
        minWidth: 1024,
        minHeight: 768,
        fullscreen: true,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        }
    };

    // Fallback aman: icon hanya diset jika file tersedia.
    if (fsSync.existsSync(iconPath)) {
        windowOptions.icon = iconPath;
    }

    mainWindow = new BrowserWindow({
        ...windowOptions
    });

    mainWindow.loadFile('src/renderer/index.html');
    if (autoReloadInterval) {
        clearInterval(autoReloadInterval);
    }

    autoReloadInterval = setInterval(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            writeAppLog('INFO', 'SYSTEM', 'Auto reload aplikasi setiap 2 jam dijalankan.');
            mainWindow.reload();
        }
    }, 2 * 60 * 60 * 1000);
    // mainWindow.webContents.openDevTools(); 
}

function isIndeximCompany(karyawan) {
    const companyName = (karyawan.nama_perusahaan || '').toUpperCase();
    return companyName.includes('PT INDEXIM COALINDO');
}

function buildRosterNotice(roster) {
    if (!roster) {
        return null;
    }

    const kategori = (roster.roster_kategori || '').trim().toUpperCase();
    const kode = (roster.roster_kode || '').trim().toUpperCase();

    if (isSpecialBuffetAllowedRoster(roster)) {
        return { type: 'success', message: 'Roster OFF 13:1 (Boleh Prasmanan)', code: kode, category: kategori };
    }

    if (kategori === 'WORK') {
        const label = kode ? `Shift ${kode}` : 'Roster Sesuai';
        return { type: 'success', message: label, code: kode, category: kategori };
    }

    if (kategori === 'OFF' || kode === 'OFF') {
        return { type: 'error', message: 'Sedang OFF • Perlu Konfirmasi', code: kode, category: kategori };
    }

    return { type: 'info', message: kode ? `Shift ${kode}` : 'Roster Terdata', code: kode, category: kategori };
}

async function getEmployeeFromHrScanApi(scanValue) {
    const encodedScanValue = encodeURIComponent(scanValue);
    const url = `${HR_SCAN_API_BASE}/${encodedScanValue}`;
    
    // Set 2.5 seconds timeout limit to prevent hanging on slow network
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    try {
        const response = await fetch(url, { 
            method: 'GET',
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`Gagal menghubungi API HR. HTTP ${response.status}`);
        }

        const payload = await response.json();
        if (payload.status !== 200 || !Array.isArray(payload.data) || payload.data.length === 0) {
            return null;
        }

        const raw = payload.data[0];
        return {
            no_nik: raw.noNik || null,
            nama_lengkap: raw.namaLengkap || '-',
            nama_perusahaan: raw.namaPerusahaan || '-',
            depart: raw.depart || '-',
            posisi: raw.posisi || '-',
            level: raw.level || '-'
        };
    } catch (err) {
        clearTimeout(timeoutId);
        console.warn('API HR fetch timed out or failed:', err.message);
        return null;
    }
}

// Background photo downloader (FTP and Fallback API)
function downloadPhotoInBackground(noNik, idPersonal, urlFoto, localPath) {
    Promise.resolve().then(async () => {
        const crypto = require('crypto');
        const { exec } = require('child_process');
        const path = require('path');
        const fs = require('fs').promises;

        const hash = crypto.createHash('md5').update(String(idPersonal)).digest('hex');
        const ftpPaths = [
            `/karyawan/${hash}/${urlFoto}`,
            `/foto/1/${urlFoto}`,
            `/karyawan/${urlFoto}`
        ];

        const ftpUser = 'onedb_kary';
        const ftpPass = 'x0r4ngIDC#apps@2023';
        const ftpHost = '192.168.125.234';
        const ftpPort = '21';

        let downloaded = false;
        for (const ftpPath of ftpPaths) {
            const ftpUrl = `ftp://${ftpHost}:${ftpPort}${ftpPath}`;
            const tempPath = path.join(UPLOADS_DIR, `temp_bg_${noNik}_${urlFoto}`);
            const curlCmd = `curl.exe --connect-timeout 5 -u "${ftpUser}:${ftpPass}" "${ftpUrl}" -o "${tempPath}"`;

            const success = await new Promise((resolve) => {
                exec(curlCmd, async (err) => {
                    if (err) {
                        try { await fs.unlink(tempPath); } catch {}
                        resolve(false);
                    } else {
                        try {
                            const stats = await fs.stat(tempPath);
                            if (stats.size > 0) {
                                await fs.rename(tempPath, localPath);
                                resolve(true);
                            } else {
                                try { await fs.unlink(tempPath); } catch {}
                                resolve(false);
                            }
                        } catch {
                            resolve(false);
                        }
                    }
                });
            });

            if (success) {
                downloaded = true;
                break;
            }
        }

        if (downloaded) {
            writeAppLog('INFO', 'PHOTO', `[BG] Berhasil mengunduh foto NIK ${noNik} dari FTP.`);
            return;
        }

        // Fallback ke API eksternal lama via internet
        try {
            const params = new URLSearchParams({
                no_nik: noNik,
                secret_key: EMPLOYEE_PHOTO_SECRET
            });

            const response = await fetch(`${EMPLOYEE_PHOTO_ENDPOINT}?${params.toString()}`, { method: 'GET' });
            if (response.ok) {
                const payload = await response.json();
                if (payload.success && payload.photo_url) {
                    const extPhotoUrl = `${ONEEV_BASE_URL}${payload.photo_url}`;
                    const downloadRes = await fetch(extPhotoUrl);
                    if (downloadRes.ok) {
                        const buffer = Buffer.from(await downloadRes.arrayBuffer());
                        await fs.writeFile(localPath, buffer);
                        writeAppLog('INFO', 'PHOTO', `[BG] Berhasil mengunduh foto NIK ${noNik} dari Fallback API.`);
                    }
                }
            }
        } catch (fallbackErr) {
            console.error('[BG] Fallback API foto gagal:', fallbackErr.message);
        }
    }).catch(err => {
        console.error('[BG] Background photo downloader error:', err);
    });
}

async function getEmployeePhotoByNik(noNik) {
    if (!noNik) {
        return { success: false, source: 'none', photo_url: null, photo_full_url: null };
    }

    try {
        // 1. Query ke database ONE_DB_MITRA.dbo.tbl_t_karyawan
        if (pool && pool.connected) {
            const request = pool.request();
            request.input('no_nik', noNik);
            const dbResult = await request.query(`
                SELECT TOP 1 id_personal, path_foto 
                FROM ONE_DB_MITRA.dbo.tbl_t_karyawan 
                WHERE no_nik = @no_nik
            `);

            if (dbResult.recordset && dbResult.recordset.length > 0) {
                const idPersonal = dbResult.recordset[0].id_personal;
                const pathFoto = dbResult.recordset[0].path_foto;

                if (idPersonal && pathFoto) {
                    const path = require('path');
                    const fs = require('fs').promises;

                    const urlFoto = path.basename(pathFoto); // Mengambil nama file asli dari path_foto
                    const localFilename = `photo_${noNik}_${urlFoto}`;
                    const localPath = path.join(UPLOADS_DIR, localFilename);
                    const port = process.env.SERVER_PORT || 3001;
                    const photoUrl = `/images/${localFilename}`;
                    const photoFullUrl = `http://localhost:${port}${photoUrl}`;

                    // Hapus file cache lama/usang yang diawali dengan `photo_${noNik}` tapi tidak sama dengan `localFilename`
                    try {
                        const files = await fs.readdir(UPLOADS_DIR);
                        const prefix = `photo_${noNik}`;
                        for (const file of files) {
                            if (file.startsWith(prefix) && file !== localFilename) {
                                try {
                                    await fs.unlink(path.join(UPLOADS_DIR, file));
                                    writeAppLog('INFO', 'PHOTO', `Menghapus cache foto usang: ${file}`);
                                } catch (delErr) {
                                    console.warn(`Gagal menghapus cache lama ${file}:`, delErr.message);
                                }
                            }
                        }
                    } catch (readErr) {
                        // ignore jika folder kosong
                    }

                    // Cek jika file sudah ada di local cache
                    let fileExists = false;
                    try {
                        await fs.access(localPath);
                        fileExists = true;
                    } catch {
                        // File belum diunduh
                    }

                    if (fileExists) {
                        return {
                            success: true,
                            no_nik: noNik,
                            karyawan_id: idPersonal,
                            source: 'local_cache',
                            photo_url: photoUrl,
                            photo_full_url: photoFullUrl
                        };
                    }

                    // Cache miss: Mulai download di background tanpa memblokir proses scan
                    writeAppLog('INFO', 'PHOTO', `Cache miss untuk foto NIK ${noNik}. Memulai unduhan di background.`);
                    downloadPhotoInBackground(noNik, idPersonal, urlFoto, localPath);
                    
                    return {
                        success: false,
                        no_nik: noNik,
                        karyawan_id: idPersonal,
                        source: 'none_cache_miss',
                        photo_url: null,
                        photo_full_url: null
                    };
                }
            }
        }
    } catch (err) {
        console.warn('Gagal mengambil foto secara lokal (DB):', err.message);
        writeAppLog('WARNING', 'PHOTO', `Pencarian database foto gagal: ${err.message}.`);
    }

    return { success: false, source: 'none', photo_url: null, photo_full_url: null };
}

function buildScanCandidates(scanValue) {
    const raw = (scanValue || '').trim();
    const compact = raw.replace(/\s+/g, '');
    const digitsOnly = compact.replace(/\D/g, '');

    const candidates = [raw, compact];

    // Support scanner payload with mixed characters (prefix/suffix).
    if (digitsOnly.length >= 8) {
        candidates.push(digitsOnly);
    }

    return [...new Set(candidates.filter(Boolean))];
}

function isPlainNik11(value) {
    return /^\d{11}$/.test((value || '').trim());
}

async function getEmployeeForScan(scanValue) {
    const candidates = buildScanCandidates(scanValue);

    for (const candidate of candidates) {
        let localEmployee = null;
        let apiEmployee = null;
        let cachedEmployee = null;

        if (pool && pool.connected) {
            try {
                localEmployee = await db.getEmployeeFromKantinView(pool, candidate);
            } catch (err) {
                console.warn('Gagal membaca karyawan dari view lokal (offline):', err.message);
            }
        }

        if (localEmployee) {
            return { employee: localEmployee, source: 'VIEW', matchedBy: candidate };
        }

        // Cek dari local JSON cache jika database master tidak punya
        try {
            const cache = await getCachedEmployees();
            if (cache[candidate]) {
                cachedEmployee = cache[candidate];
            }
        } catch (err) {
            console.warn('Gagal membaca cache lokal:', err.message);
        }

        if (cachedEmployee) {
            return { employee: cachedEmployee, source: 'LOCAL_CACHE', matchedBy: candidate };
        }

        try {
            apiEmployee = await getEmployeeFromHrScanApi(candidate);
        } catch (err) {
            console.warn('Gagal menghubungi API HR (offline):', err.message);
        }

        if (apiEmployee) {
            // Simpan ke cache agar ke depannya bisa langsung diakses jika API mati
            await saveToEmployeeCache(candidate, apiEmployee);
            return { employee: apiEmployee, source: 'API', matchedBy: candidate };
        }
    }

    return { employee: null, source: null, matchedBy: null };
}

// =================================================================
// --- API Endpoints (Updated for SQL Server) ---
// =================================================================

// GET /api/connection-status - API and database health status
api.get('/api/connection-status', async (req, res) => {
    const status = {
        api: true,
        db: false
    };

    try {
        if (pool && pool.connected) {
            await pool.request().query('SELECT 1 AS ok');
            status.db = true;
        }
    } catch (err) {
        console.warn('Database health check warning:', err.message);
    }

    res.json(status);
});

// GET /api/error-logs - Error/application logs for tracing
api.get('/api/error-logs', (req, res) => {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requestedLimit)
        ? Math.min(Math.max(requestedLimit, 1), MAX_APP_LOGS)
        : 200;

    res.json(appLogs.slice(0, limit));
});

// POST /api/error-logs - Accept logs from renderer process
api.post('/api/error-logs', (req, res) => {
    const { level, source, message, context } = req.body || {};
    writeAppLog(level || 'ERROR', source || 'RENDERER', message || 'Client error', context || null);
    res.status(201).json({ success: true });
});

// GET /api/dashboard-data - Main dashboard data
api.get('/api/dashboard-data', async (req, res) => {
    const today = db.getTodayDate();
    const localConfig = await getLocalConfig();

    // Check if database is online
    if (pool && pool.connected) {
        try {
            const currentSesi = await db.getCurrentMealSession(pool);
            const visitorCounts = await db.getVisitorCounts(pool, today);
            const mealPlan = await db.getMealPlan(pool, today, currentSesi);
            const menuImages = await db.getMenuImages(pool, today);
            const appSettings = await db.getAppSettings(pool);
            const appLocation = await getEffectiveLocation();
            let scanHistory = await db.getScanHistory(pool, 25, appLocation);
            
            // Gabungkan data scan offline yang belum sinkron ke bagian atas history
            try {
                const queue = await getOfflineQueue();
                if (queue.length > 0) {
                    const offlineScans = queue
                        .filter(q => !q.lokasi || q.lokasi === appLocation)
                        .map(q => ({
                            nik: q.nik,
                            nama_lengkap: q.nama_lengkap || 'Offline Karyawan (Belum Sinkron)',
                            nama_perusahaan: q.nama_perusahaan || 'UNKNOWN (Offline)',
                            depart: q.depart || 'OFFLINE',
                            time: q.time,
                            sesi_makan: q.sesi,
                            status: q.status,
                            lokasi: q.lokasi || appLocation,
                            nama_pc: q.nama_pc || HOSTNAME,
                            ip_address: q.ip_address || LOCAL_IP_ADDRESS
                        })).reverse();
                    scanHistory = [...offlineScans, ...scanHistory].slice(0, 25);
                }
            } catch (queueErr) {
                console.warn('Gagal menggabungkan antrean offline ke history:', queueErr.message);
            }

            const port = process.env.SERVER_PORT || 3001;
            const menuImagesWithUrl = menuImages.map(img => ({
                ...img,
                url: `http://localhost:${port}/images/${path.basename(img.path)}`
            }));

            return res.json({
                currentSesi,
                visitorCounts,
                mealPlan: mealPlan || null,
                menuImages: menuImagesWithUrl,
                appSettings: appSettings || null,
                localConfig,
                deviceInfo: {
                    hostname: HOSTNAME,
                    ip: LOCAL_IP_ADDRESS,
                    lokasi: appLocation
                },
                scanHistory: scanHistory || [],
                dbOnline: true
            });
        } catch (err) {
            console.warn('Gagal memuat data dashboard dari database:', err.message);
            writeAppLog('WARNING', 'API:/api/dashboard-data', `Koneksi database bermasalah saat loading dashboard: ${err.message}`);
        }
    }

    // Fallback Offline Mode (DB Offline)
    const now = new Date();
    const currentHour = now.getHours();
    let currentSesi = 'DILUAR JAM MAKAN';
    if (currentHour >= 5 && currentHour < 10) {
        currentSesi = 'MAKAN PAGI';
    } else if (currentHour >= 11 && currentHour < 15) {
        currentSesi = 'MAKAN SIANG';
    } else if (currentHour >= 17 && currentHour < 21) {
        currentSesi = 'MAKAN MALAM';
    }

    const appLocation = localConfig.lokasi || 'XAFETARIA';
    let offlineScans = [];
    try {
        const queue = await getOfflineQueue();
        offlineScans = queue.map(q => ({
            nik: q.nik,
            nama_lengkap: q.nama_lengkap || 'Offline Karyawan',
            nama_perusahaan: q.nama_perusahaan || 'UNKNOWN (Offline)',
            depart: q.depart || 'OFFLINE',
            time: q.time,
            sesi_makan: q.sesi,
            status: q.status,
            lokasi: q.lokasi || appLocation,
            nama_pc: q.nama_pc || HOSTNAME,
            ip_address: q.ip_address || LOCAL_IP_ADDRESS
        })).reverse().slice(0, 10);
    } catch (err) {
        console.warn('Gagal memuat data offline untuk history dashboard offline:', err.message);
    }

    res.json({
        currentSesi,
        visitorCounts: {
            'MAKAN PAGI': 0,
            'MAKAN SIANG': 0,
            'MAKAN MALAM': 0
        },
        mealPlan: null,
        menuImages: [],
        appSettings: null,
        localConfig,
        deviceInfo: {
            hostname: HOSTNAME,
            ip: LOCAL_IP_ADDRESS,
            lokasi: appLocation
        },
        scanHistory: offlineScans,
        dbOnline: false
    });
});

// POST /api/scan - Process employee barcode scan
api.post('/api/scan', async (req, res) => {
    const { nik: scannedCode } = req.body;
    if (!scannedCode || scannedCode.trim() === '') {
        return res.status(400).json({ status: 'ERROR', message: 'Kode QR/NIK tidak boleh kosong.' });
    }

    try {
        const cleanScannedCode = scannedCode.trim().toUpperCase();
        // Hybrid lookup: local view first, then HR API fallback
        const lookup = await getEmployeeForScan(cleanScannedCode);
        let karyawan = lookup.employee;
        let source = lookup.source || 'OFFLINE_FALLBACK';
        let matchedBy = lookup.matchedBy || cleanScannedCode;

        if (!karyawan) {
            // Jika database offline dan internet offline, tetap izinkan scan jika format inputnya berupa NIK (min 4 digit)
            if (!pool || !pool.connected) {
                const cleanCode = cleanScannedCode;
                if (cleanCode.length >= 4) {
                    karyawan = {
                        no_nik: cleanCode,
                        nama_lengkap: 'Offline Karyawan',
                        nama_perusahaan: 'UNKNOWN (Offline)',
                        depart: 'OFFLINE',
                        posisi: 'OFFLINE',
                        photo_source: 'none',
                        photo_url: null,
                        photo_full_url: null
                    };
                    source = 'OFFLINE_FALLBACK';
                    matchedBy = cleanCode;
                } else {
                    return res.status(404).json({ status: 'NOT_FOUND', message: 'Kode scan tidak valid atau karyawan tidak ditemukan.' });
                }
            } else {
                return res.status(404).json({ status: 'NOT_FOUND', message: 'Kode scan tidak valid atau karyawan tidak ditemukan.' });
            }
        }

        const nikKaryawan = karyawan.no_nik;
        
        // Ambil foto karyawan sedini mungkin agar status error (seperti OUT_OF_SESSION) juga bisa menampilkan foto
        let photoInfo = { success: false, source: 'none', photo_url: null, photo_full_url: null };
        if (pool && pool.connected && source !== 'OFFLINE_FALLBACK') {
            try {
                photoInfo = await getEmployeePhotoByNik(nikKaryawan);
            } catch (photoErr) {
                console.warn('Photo lookup warning:', photoErr.message);
            }
        }
        
        // Tempelkan informasi foto ke object karyawan
        karyawan.photo_source = photoInfo.source || 'none';
        karyawan.photo_url = photoInfo.photo_url || null;
        karyawan.photo_full_url = photoInfo.photo_full_url || null;

        // Get current session
        const now = new Date();
        const currentTime = now.toTimeString().split(' ')[0];
        const today = db.getTodayDate();
        let sesiMakan = 'DILUAR JAM MAKAN';

        if (pool && pool.connected) {
            try {
                sesiMakan = await db.getCurrentMealSession(pool);
            } catch (sessionErr) {
                console.warn('Gagal membaca sesi makan dari database:', sessionErr.message);
            }
        }

        // Fallback sesi makan menggunakan jam lokal PC jika database offline!
        if (sesiMakan === 'DILUAR JAM MAKAN' || !pool || !pool.connected) {
            const currentHour = now.getHours();
            if (currentHour >= 5 && currentHour < 10) {
                sesiMakan = 'MAKAN PAGI';
            } else if (currentHour >= 11 && currentHour < 15) {
                sesiMakan = 'MAKAN SIANG';
            } else if (currentHour >= 17 && currentHour < 21) {
                sesiMakan = 'MAKAN MALAM';
            }
        }

        const isIndexim = isIndeximCompany(karyawan);
        const visitorStatus = isIndexim ? 'SUCCESS' : 'TAMU';
        
        if (sesiMakan === 'DILUAR JAM MAKAN') {
            return res.status(400).json({ status: 'OUT_OF_SESSION', message: 'Di Luar Jam Makan', data: karyawan });
        }

        // Check if already scanned
        let existingScan = null;
        if (pool && pool.connected) {
            try {
                existingScan = await db.getExistingScan(pool, nikKaryawan, today, sesiMakan);
            } catch (dbErr) {
                console.warn('Gagal cek scan duplikat di DB:', dbErr.message);
            }
        }

        // Cek juga di antrean offline lokal agar tidak dobel scan offline
        if (!existingScan) {
            try {
                const queue = await getOfflineQueue();
                const localDup = queue.find(q => q.nik === nikKaryawan && q.date === today && q.sesi === sesiMakan);
                if (localDup) {
                    existingScan = {
                        nik: localDup.nik,
                        tanggal: localDup.date,
                        sesi_makan: localDup.sesi,
                        time: localDup.time,
                        status: localDup.status,
                        offline: true
                    };
                }
            } catch (err) {
                console.warn('Gagal membaca antrean offline lokal untuk pengecekan duplikasi:', err.message);
            }
        }

        if (existingScan) {
            return res.status(409).json({
                status: 'ALREADY_SCANNED',
                message: `Sudah Scan Untuk ${sesiMakan}`,
                data: karyawan,
                savedRecord: existingScan
            });
        }

        const appLocation = await getEffectiveLocation();
        const configuredOfficeLocation = getOfficePeakmealLocation(appLocation);
        let preScanNotice = null;

        if (pool && pool.connected) {
            let roster = null;

            try {
                roster = await db.getTodayRosterByNik(pool, nikKaryawan, today);
                const rosterKategori = (roster?.roster_kategori || '').trim().toUpperCase();
                const rosterKode = (roster?.roster_kode || roster?.roster_status_raw || '').trim().toUpperCase();

                if ((rosterKategori === 'OFF' || rosterKode === 'OFF') && !isSpecialBuffetAllowedRoster(roster)) {
                    const message = `Scan ditolak. Roster ${rosterKode || 'OFF'} pada ${today}. Silakan konfirmasi ke admin departemen.`;
                    await db.recordComplianceViolation(pool, {
                        nik: nikKaryawan,
                        nama_lengkap: karyawan.nama_lengkap,
                        nama_perusahaan: karyawan.nama_perusahaan,
                        departemen: karyawan.depart,
                        tanggal: today,
                        sesi_makan: sesiMakan,
                        jam_scan: currentTime,
                        alasan: message,
                        roster_kode: roster?.roster_kode || roster?.roster_status_raw || 'OFF',
                        roster_keterangan: roster?.roster_keterangan || null,
                        roster_kategori: roster?.roster_kategori || 'OFF',
                        lokasi_scan: appLocation,
                        kategori_pelanggaran: 'ROSTER_OFF',
                        scan_status: 'REJECTED',
                        ip_address: LOCAL_IP_ADDRESS
                    });

                    return res.status(403).json({
                        status: 'ROSTER_OFF_REJECTED',
                        message,
                        data: karyawan,
                        rosterNotice: { type: 'error', message }
                    });
                }
            } catch (rosterErr) {
                console.warn('Validasi roster dilewati karena data roster tidak tersedia/error:', rosterErr.message);
                writeAppLog('WARNING', 'ROSTER_SCAN', 'Validasi roster dilewati, scan tetap dilanjutkan.', {
                    nik: nikKaryawan,
                    sesiMakan,
                    today,
                    error: rosterErr.message
                });
            }

            try {
                const peakmeal = await db.getTodayPeakmealByNik(pool, nikKaryawan, today, sesiMakan);
                if (peakmeal) {
                    const lokasi = peakmeal.lokasi_pengantaran || '-';
                    const isLocationMatch = isSameDeliveryLocation(lokasi, appLocation) ||
                        (configuredOfficeLocation && isSameDeliveryLocation(lokasi, configuredOfficeLocation));
                    if (!isLocationMatch) {
                        const rosterLabel = roster?.roster_kode || roster?.roster_keterangan || 'WORK';
                        const plainMessage = `User ${karyawan.nama_lengkap || '-'} (${nikKaryawan}) Status ${rosterLabel}. SUDAH DIPESANKAN di area ${lokasi}. Scan di ${appLocation} ditolak.`;
                        const message = `Sudah dipesankan di area ${lokasi}. Scan ditolak.`;
                        await db.recordComplianceViolation(pool, {
                            nik: nikKaryawan,
                            nama_lengkap: karyawan.nama_lengkap,
                            nama_perusahaan: karyawan.nama_perusahaan,
                            departemen: karyawan.depart,
                            tanggal: today,
                            sesi_makan: sesiMakan,
                            jam_scan: currentTime,
                            alasan: plainMessage,
                            roster_kode: roster?.roster_kode || roster?.roster_status_raw || null,
                            roster_keterangan: roster?.roster_keterangan || null,
                            roster_kategori: roster?.roster_kategori || null,
                            peakmeal_id: peakmeal.id,
                            lokasi_pengantaran: lokasi,
                            lokasi_scan: appLocation,
                            kategori_pelanggaran: 'SALAH_LOKASI_PESANAN',
                            status_pengajuan: peakmeal.status || null,
                            scan_status: 'REJECTED',
                            ip_address: LOCAL_IP_ADDRESS
                        });

                        return res.status(403).json({
                            status: 'PEAKMEAL_WRONG_LOCATION',
                            message,
                            data: karyawan,
                            deliveryLocation: lokasi,
                            peakmealNotice: {
                                status: 'WRONG_LOCATION',
                                location: lokasi,
                                message: `Sudah dipesan di area ${lokasi}`
                            }
                        });
                    }
                } else {
                    if (isAllowedMealRoster(roster) && !isSpecialBuffetAllowedRoster(roster)) {
                        const rosterLabel = roster?.roster_kode || roster?.roster_keterangan || 'WORK';
                        const plainMessage = `User ${karyawan.nama_lengkap || '-'} (${nikKaryawan}) Status ${rosterLabel} tetapi belum ada pesanan peakmeal untuk ${sesiMakan}. Dicatat sebagai DI LUAR PLAN.`;
                        preScanNotice = {
                            status: 'OUT_OF_PLAN',
                            rosterLabel: rosterLabel,
                            sesiMakan: sesiMakan,
                            message: `Belum ada pesanan peakmeal untuk ${sesiMakan}. Dicatat sebagai DI LUAR PLAN.`
                        };
                        await db.recordComplianceViolation(pool, {
                            nik: nikKaryawan,
                            nama_lengkap: karyawan.nama_lengkap,
                            nama_perusahaan: karyawan.nama_perusahaan,
                            departemen: karyawan.depart,
                            tanggal: today,
                            sesi_makan: sesiMakan,
                            jam_scan: currentTime,
                            alasan: plainMessage,
                            roster_kode: roster?.roster_kode || roster?.roster_status_raw || null,
                            roster_keterangan: roster?.roster_keterangan || null,
                            roster_kategori: roster?.roster_kategori || null,
                            lokasi_scan: appLocation,
                            kategori_pelanggaran: 'DI_LUAR_PLAN',
                            scan_status: 'OUT_OF_PLAN',
                            ip_address: LOCAL_IP_ADDRESS
                        });
                    }
                }
            } catch (peakmealErr) {
                console.error('Gagal validasi peakmeal sebelum scan:', peakmealErr);
                writeAppLog('ERROR', 'PEAKMEAL_SCAN', peakmealErr.message, { nik: nikKaryawan, sesiMakan, today });
                return res.status(500).json({
                    status: 'PEAKMEAL_CHECK_FAILED',
                    message: 'Gagal validasi peakmeal. Scan tidak disimpan untuk mencegah data tidak valid.',
                    data: karyawan
                });
            }
        }

        // Check if employee is NON RESIDENCE and enforce limit of max 2 scans per day (hanya jika DB online)
        let statusResidence = '';
        if (pool && pool.connected) {
            try {
                const resRequest = pool.request();
                resRequest.input('nik', nikKaryawan);
                const resResult = await resRequest.query(`
                    SELECT TOP 1 status_residence 
                    FROM ONE_DB_MITRA.dbo.vw_m_karyawan_aktif 
                    WHERE no_nik = @nik
                `);
                if (resResult.recordset && resResult.recordset.length > 0) {
                    statusResidence = resResult.recordset[0].status_residence || '';
                }
            } catch (dbErr) {
                console.warn('Gagal mengambil status_residence dari ONE_DB_MITRA:', dbErr.message);
            }
        }

        const cleanNik = (nikKaryawan || '').trim();
        const cleanStatus = (statusResidence || '').toUpperCase().trim();
        let isNonRes = false;

        if (cleanNik === '26051871136' || cleanNik === 'M01939') {
            isNonRes = false;
        } else if (cleanNik === '40123088') {
            isNonRes = true;
        } else if (cleanStatus === 'NON MESS') {
            isNonRes = true;
        }

        if (isNonRes && pool && pool.connected) {
            try {
                const countRequest = pool.request();
                countRequest.input('nik', nikKaryawan);
                countRequest.input('date', today);
                const countResult = await countRequest.query(`
                    SELECT COUNT(*) AS scan_count 
                    FROM tbl_m_pengunjung_kantin 
                    WHERE nik = @nik AND CAST(tanggal AS DATE) = CAST(@date AS DATE)
                `);
                const todayScanCount = countResult.recordset[0].scan_count || 0;

                if (todayScanCount >= 2) {
                    return res.status(403).json({
                        status: 'LIMIT_EXCEEDED',
                        message: 'Batas Makan Hari Ini Habis (Non Residen Maksimal 2 Kali)',
                        data: karyawan
                    });
                }
            } catch (countErr) {
                console.error('Error checking scan count for non-residence:', countErr);
            }
        }

        // Record scan
        let savedRecord = null;
        let isOfflineSaved = false;
        try {
            if (pool && pool.connected) {
                savedRecord = await db.recordScan(pool, nikKaryawan, today, sesiMakan, currentTime, visitorStatus, LOCAL_IP_ADDRESS, appLocation, HOSTNAME);
            } else {
                throw new Error('Koneksi database terputus atau tidak terinisialisasi.');
            }
        } catch (insertErr) {
            if (pool && pool.connected && (insertErr.number === 2601 || insertErr.number === 2627)) {
                const duplicateRecord = await db.getExistingScan(pool, nikKaryawan, today, sesiMakan);
                return res.status(409).json({
                    status: 'ALREADY_SCANNED',
                    message: `Sudah Scan Untuk ${sesiMakan}`,
                    data: karyawan,
                    savedRecord: duplicateRecord
                });
            }

            // Simpan lokal di file antrean offline jika koneksi database error
            console.warn('Gagal record scan ke database, menyimpan lokal:', insertErr.message);
            await saveToOfflineQueue({
                nik: nikKaryawan,
                date: today,
                sesi: sesiMakan,
                time: currentTime,
                status: visitorStatus,
                nama_lengkap: karyawan.nama_lengkap,
                nama_perusahaan: karyawan.nama_perusahaan,
                depart: karyawan.depart,
                ip_address: LOCAL_IP_ADDRESS,
                lokasi: appLocation,
                nama_pc: HOSTNAME
            });
            isOfflineSaved = true;
            savedRecord = {
                nik: nikKaryawan,
                tanggal: today,
                sesi_makan: sesiMakan,
                time: currentTime,
                status: visitorStatus,
                lokasi: appLocation,
                nama_pc: HOSTNAME,
                ip_address: LOCAL_IP_ADDRESS,
                offline: true
            };
        }

        let peakmealNotice = null;
        let rosterNotice = null;

        if (pool && pool.connected) {
            try {
                if (isIndexim) {
                    const peakmeal = await db.getTodayPeakmealByNik(pool, nikKaryawan, today, sesiMakan);
                    if (peakmeal) {
                        const isPrasmanan = /PRASMANAN|OFFICE 12|OFFICE 33/i.test(peakmeal.lokasi_pengantaran || '');
                        peakmealNotice = {
                            status: 'IN_PLAN',
                            location: peakmeal.lokasi_pengantaran || '-',
                            message: isPrasmanan
                                ? `Pesanan Sesuai (${peakmeal.lokasi_pengantaran || '-'}). Silakan menikmati hidangan prasmanan.`
                                : `Pesanan Sesuai (${peakmeal.lokasi_pengantaran || '-'}).`
                        };
                    }
                }

                const roster = isIndexim ? await db.getTodayRosterByNik(pool, nikKaryawan, today) : null;
                rosterNotice = buildRosterNotice(roster);
            } catch (queryErr) {
                console.warn('Gagal memuat detail peakmeal/roster (offline mode):', queryErr.message);
            }
        }

        res.status(201).json({
            status: 'SUCCESS',
            sesiMakan: sesiMakan,
            message: isOfflineSaved ? `Tersimpan Lokal (Offline)` : sesiMakan,
            source: source,
            matchedBy: matchedBy,
            visitorStatus,
            data: karyawan,
            savedRecord,
            isOffline: isOfflineSaved,
            isOutOfPlan: !!preScanNotice,
            peakmealNotice: preScanNotice || peakmealNotice,
            rosterNotice
        });

    } catch (err) {
        console.error('Error processing scan:', err);
        writeAppLog('ERROR', 'API:/api/scan', err.message, { scannedCode });
        res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
});

// GET /api/offline-queue - Retrieve list of locally queued scans
api.get('/api/offline-queue', async (req, res) => {
    try {
        const queue = await getOfflineQueue();
        res.json(queue);
    } catch (err) {
        res.status(500).json({ error: 'Gagal mengambil antrean offline.' });
    }
});

// POST /api/sync-offline - Manually trigger synchronization of offline scans
api.post('/api/sync-offline', async (req, res) => {
    try {
        if (!pool || !pool.connected) {
            return res.status(503).json({ error: 'Database masih offline. Sinkronisasi gagal.' });
        }
        await syncOfflineScans();
        const queue = await getOfflineQueue();
        res.json({ success: true, remainingCount: queue.length });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Sinkronisasi gagal.' });
    }
});

// POST /api/sync-barcodes-7days - Sync raw barcode scans from last 7 days with HR API
api.post('/api/sync-barcodes-7days', async (req, res) => {
    try {
        if (!pool || !pool.connected) {
            return res.status(503).json({ error: 'Database masih offline. Sinkronisasi gagal.' });
        }
        const result = await syncBarcodeScansFor7Days();
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message || 'Sinkronisasi gagal.' });
    }
});

// GET /api/sync-status - Status sinkronisasi otomatis 3 jam dan antrean offline
api.get('/api/sync-status', async (req, res) => {
    try {
        const cfg = await getLocalConfig();
        const queue = await getOfflineQueue();
        const cache = await getCachedEmployees();
        const intervalHours = cfg.syncIntervalHours !== undefined ? cfg.syncIntervalHours : 3;
        const autoSyncEnabled = cfg.autoSyncEnabled !== undefined ? cfg.autoSyncEnabled : true;
        
        let lastSyncTime = cfg.lastSyncTime || null;
        let nextSyncTime = cfg.nextSyncTime || null;
        if (!nextSyncTime && lastSyncTime && autoSyncEnabled) {
            nextSyncTime = new Date(new Date(lastSyncTime).getTime() + intervalHours * 3600000).toISOString();
        } else if (!nextSyncTime && autoSyncEnabled) {
            nextSyncTime = new Date(Date.now() + intervalHours * 3600000).toISOString();
        }

        res.json({
            intervalHours,
            autoSyncEnabled,
            lastSyncTime,
            nextSyncTime,
            offlineQueueCount: queue.length,
            cachedEmployeesCount: Object.keys(cache).length,
            isSyncing: isFullSyncing,
            dbConnected: !!(pool && pool.connected),
            history: (cfg.syncHistory || []).slice(0, 10)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/sync-now - Eksekusi sinkronisasi manual oleh Admin (1-Klik Sync)
api.post('/api/sync-now', async (req, res) => {
    try {
        const result = await runFullSync({ source: 'ADMIN_MANUAL' });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message || 'Sinkronisasi gagal.' });
    }
});

// POST /api/sync-employees - Perbarui master data karyawan ke cache offline
api.post('/api/sync-employees', async (req, res) => {
    try {
        if (!pool || !pool.connected) {
            const reconnected = await attemptDbReconnect();
            if (!reconnected) {
                return res.status(503).json({ error: 'Database masih offline. Pastikan jaringan server aktif.' });
            }
        }
        const result = await syncActiveEmployeesToCache();
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/sync-settings - Simpan konfigurasi interval auto-sync
api.post('/api/sync-settings', async (req, res) => {
    try {
        const { intervalHours, autoSyncEnabled } = req.body;
        const cfg = await getLocalConfig();
        if (intervalHours !== undefined) {
            cfg.syncIntervalHours = Math.max(1, parseInt(intervalHours, 10) || 3);
        }
        if (autoSyncEnabled !== undefined) {
            cfg.autoSyncEnabled = Boolean(autoSyncEnabled);
        }
        const now = new Date();
        const interval = cfg.syncIntervalHours || 3;
        cfg.nextSyncTime = new Date(now.getTime() + interval * 3600000).toISOString();
        await saveLocalConfig(cfg);
        await setupAutoSyncScheduler();
        res.json({ success: true, config: cfg });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/settings - Save application settings
api.post('/api/settings', async (req, res) => {
    const { nama, description, theme, background, border, lokasi } = req.body;
    try {
        if (lokasi !== undefined) {
            const localCfg = await getLocalConfig();
            localCfg.lokasi = (lokasi || '').trim();
            await saveLocalConfig(localCfg);
        }
        if (pool && pool.connected) {
            await db.saveSettings(pool, nama, description, theme, background, border);
        }
        res.status(200).json({ message: 'Pengaturan berhasil disimpan.' });
    } catch (error) {
        console.error('Error saving settings:', error);
        writeAppLog('ERROR', 'API:/api/settings', error.message);
        res.status(500).json({ error: 'Gagal menyimpan pengaturan.' });
    }
});

// POST /api/clear-photo-cache - Clear all cached employee photos from uploads folder
api.post('/api/clear-photo-cache', async (req, res) => {
    try {
        const fs = require('fs').promises;
        const files = await fs.readdir(UPLOADS_DIR);
        let count = 0;
        for (const file of files) {
            // Hapus file yang diawali dengan photo_ atau temp_photo_
            if (file.startsWith('photo_') || file.startsWith('temp_photo_')) {
                await fs.unlink(path.join(UPLOADS_DIR, file));
                count++;
            }
        }
        writeAppLog('INFO', 'PHOTO', `Berhasil membersihkan cache foto. Total file terhapus: ${count}`);
        res.status(200).json({ success: true, message: `Berhasil menghapus ${count} file cache foto.` });
    } catch (error) {
        console.error('Error clearing photo cache:', error);
        writeAppLog('ERROR', 'API:/api/clear-photo-cache', error.message);
        res.status(500).json({ error: 'Gagal membersihkan cache foto.', message: error.message });
    }
});


// GET /api/scan-history - Get today's scan history
api.get('/api/scan-history', async (req, res) => {
    try {
        if (!pool || !pool.connected) {
            return res.json([]);
        }
        const { lokasi, limit } = req.query;
        const history = await db.getScanHistory(pool, limit ? parseInt(limit, 10) : 50, lokasi || null);
        res.json(history);
    } catch (error) {
        console.error('Error fetching scan history:', error);
        writeAppLog('ERROR', 'API:/api/scan-history', error.message);
        res.status(500).json({ error: 'Gagal mengambil riwayat scan.' });
    }
});

// GET /api/meal-plans - Get meal plans for specific date
api.get('/api/meal-plans', async (req, res) => {
    const { tanggal } = req.query;
    if (!tanggal) {
        return res.status(400).json({ error: 'Parameter tanggal diperlukan.' });
    }
    try {
        if (!pool || !pool.connected) {
            return res.json([]);
        }
        const request = pool.request();
        request.input('tanggal', tanggal);
        
        const result = await request.query(`
            SELECT * FROM tbl_m_meal_plan 
            WHERE CAST(tanggal AS DATE) = CAST(@tanggal AS DATE)
        `);
        
        res.json(result.recordset || []);
    } catch (error) {
        console.error('Error fetching meal plans:', error);
        writeAppLog('ERROR', 'API:/api/meal-plans', error.message, { tanggal });
        res.status(500).json({ error: 'Gagal mengambil data meal plan.' });
    }
});

// POST /api/meal-plan - Save or update single meal plan
api.post('/api/meal-plan', async (req, res) => {
    try {
        if (!pool || !pool.connected) {
            return res.status(503).json({ error: 'Database offline. Gagal menyimpan meal plan.' });
        }

        const data = req.body;
        const request = pool.request();
        
        request.input('tanggal', data.tanggal);
        request.input('sesi_makan', data.sesi_makan);
        request.input('total_calorie', data.total_calorie || 0);

        const fields = [
            'starch', 'main_course_1', 'main_course_2', 'side_dish',
            'vegetables', 'condiment', 'fruit_kantin', 'fruit_packmeal', 'beverage'
        ];

        fields.forEach(field => {
            request.input(`${field}_nama`, data[`${field}_nama`] || null);
            request.input(`${field}_gram`, parseInt(data[`${field}_gram`], 10) || 0);
            request.input(`${field}_kalori`, parseInt(data[`${field}_kalori`], 10) || 0);
        });

        const query = `
            MERGE tbl_m_meal_plan AS target
            USING (VALUES (@tanggal, @sesi_makan)) AS source (tanggal, sesi_makan)
            ON (target.tanggal = source.tanggal AND target.sesi_makan = source.sesi_makan)
            WHEN MATCHED THEN
                UPDATE SET 
                    starch_nama = @starch_nama, starch_gram = @starch_gram, starch_kalori = @starch_kalori,
                    main_course_1_nama = @main_course_1_nama, main_course_1_gram = @main_course_1_gram, main_course_1_kalori = @main_course_1_kalori,
                    main_course_2_nama = @main_course_2_nama, main_course_2_gram = @main_course_2_gram, main_course_2_kalori = @main_course_2_kalori,
                    side_dish_nama = @side_dish_nama, side_dish_gram = @side_dish_gram, side_dish_kalori = @side_dish_kalori,
                    vegetables_nama = @vegetables_nama, vegetables_gram = @vegetables_gram, vegetables_kalori = @vegetables_kalori,
                    condiment_nama = @condiment_nama, condiment_gram = @condiment_gram, condiment_kalori = @condiment_kalori,
                    fruit_kantin_nama = @fruit_kantin_nama, fruit_kantin_gram = @fruit_kantin_gram, fruit_kantin_kalori = @fruit_kantin_kalori,
                    fruit_packmeal_nama = @fruit_packmeal_nama, fruit_packmeal_gram = @fruit_packmeal_gram, fruit_packmeal_kalori = @fruit_packmeal_kalori,
                    beverage_nama = @beverage_nama, beverage_gram = @beverage_gram, beverage_kalori = @beverage_kalori,
                    total_calorie = @total_calorie,
                    updated_at = GETDATE()
            WHEN NOT MATCHED THEN
                INSERT (
                    tanggal, sesi_makan, total_calorie, created_at,
                    starch_nama, starch_gram, starch_kalori,
                    main_course_1_nama, main_course_1_gram, main_course_1_kalori,
                    main_course_2_nama, main_course_2_gram, main_course_2_kalori,
                    side_dish_nama, side_dish_gram, side_dish_kalori,
                    vegetables_nama, vegetables_gram, vegetables_kalori,
                    condiment_nama, condiment_gram, condiment_kalori,
                    fruit_kantin_nama, fruit_kantin_gram, fruit_kantin_kalori,
                    fruit_packmeal_nama, fruit_packmeal_gram, fruit_packmeal_kalori,
                    beverage_nama, beverage_gram, beverage_kalori
                )
                VALUES (
                    @tanggal, @sesi_makan, @total_calorie, GETDATE(),
                    @starch_nama, @starch_gram, @starch_kalori,
                    @main_course_1_nama, @main_course_1_gram, @main_course_1_kalori,
                    @main_course_2_nama, @main_course_2_gram, @main_course_2_kalori,
                    @side_dish_nama, @side_dish_gram, @side_dish_kalori,
                    @vegetables_nama, @vegetables_gram, @vegetables_kalori,
                    @condiment_nama, @condiment_gram, @condiment_kalori,
                    @fruit_kantin_nama, @fruit_kantin_gram, @fruit_kantin_kalori,
                    @fruit_packmeal_nama, @fruit_packmeal_gram, @fruit_packmeal_kalori,
                    @beverage_nama, @beverage_gram, @beverage_kalori
                );
        `;

        await request.query(query);
        res.status(200).json({ message: 'Meal plan berhasil disimpan.' });
    } catch (err) {
        console.error('Error saving meal plan:', err);
        writeAppLog('ERROR', 'API:/api/meal-plan', err.message);
        res.status(500).json({ error: 'Gagal menyimpan meal plan.', message: err.message });
    }
});

// GET /api/download-peakmeal-report - Generate peakmeal/snack request report
api.get('/api/download-peakmeal-report', async (req, res) => {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
        return res.status(400).json({ error: 'Rentang tanggal (startDate dan endDate) diperlukan.' });
    }

    try {
        const start = new Date(`${startDate}T00:00:00`);
        const end = new Date(`${endDate}T00:00:00`);
        const maxDate = new Date();
        maxDate.setHours(0, 0, 0, 0);
        maxDate.setDate(maxDate.getDate() + 3);

        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
            return res.status(400).json({ error: 'Format tanggal tidak valid.' });
        }

        if (start > end) {
            return res.status(400).json({ error: 'Tanggal awal tidak boleh lebih besar dari tanggal akhir.' });
        }

        if (end > maxDate) {
            return res.status(400).json({ error: 'Tanggal pengajuan maksimal sampai 3 hari ke depan.' });
        }

        await db.ensureComplianceScanTable(pool);

        const request = pool.request();
        request.input('startDate', startDate);
        request.input('endDate', endDate);

        const result = await request.query(`
            SELECT
                p.id,
                p.nik,
                ISNULL(NULLIF(p.nama_lengkap, ''), ISNULL(k.nama_lengkap, '')) AS nama_lengkap,
                ISNULL(k.nama_perusahaan, '') AS nama_perusahaan,
                ISNULL(NULLIF(p.departemen, ''), ISNULL(k.departemen, p.kd_depart)) AS departemen,
                CAST(p.tanggal_peakmeal AS date) AS tanggal_peakmeal,
                p.tanggal_pengajuan,
                UPPER(LTRIM(RTRIM(ISNULL(p.jenis_pengajuan, 'PEAKMEAL')))) AS jenis_pengajuan,
                UPPER(LTRIM(RTRIM(ISNULL(p.sesi_makan, 'SIANG')))) AS sesi_makan,
                ISNULL(NULLIF(p.lokasi_pengantaran, ''), '-') AS lokasi_pengantaran,
                ISNULL(m.lokasi_mess, '') AS lokasi_mess,
                ISNULL(m.nomor_kamar, '') AS nomor_kamar,
                p.roster_status,
                p.status,
                p.catatan,
                CASE
                    WHEN UPPER(ISNULL(p.lokasi_pengantaran, '')) LIKE '%MESS%'
                        THEN CONCAT(
                            ISNULL(NULLIF(p.lokasi_pengantaran, ''), 'MESS'),
                            ' - ',
                            ISNULL(NULLIF(m.lokasi_mess, ''), 'Mess belum terdata'),
                            ' / ',
                            ISNULL(NULLIF(m.nomor_kamar, ''), 'Kamar belum terdata')
                        )
                    ELSE ISNULL(NULLIF(p.lokasi_pengantaran, ''), '-')
                END AS tujuan_pengantaran
            FROM [DB_ONE].[dbo].[tbl_t_peakmeal] p
            LEFT JOIN dbo.vw_karyawan_kantin_scan k
                ON p.nik = k.nik
            OUTER APPLY (
                SELECT TOP 1 mk.lokasi_mess, mk.nomor_kamar
                FROM [DB_ONE].[dbo].[tbl_m_mess_karyawan] mk
                WHERE mk.nik = p.nik
                  AND mk.is_active = 1
                ORDER BY mk.updated_at DESC, mk.created_at DESC, mk.id DESC
            ) m
            WHERE p.tanggal_peakmeal IS NOT NULL
              AND CAST(p.tanggal_peakmeal AS date) BETWEEN CAST(@startDate AS date) AND CAST(@endDate AS date)
              AND UPPER(LTRIM(RTRIM(ISNULL(p.status, '')))) <> 'CANCELLED'
            ORDER BY CAST(p.tanggal_peakmeal AS date), p.sesi_makan, tujuan_pengantaran, departemen, nama_lengkap
        `);

        const records = result.recordset || [];
        const violationRequest = pool.request();
        violationRequest.input('startDate', startDate);
        violationRequest.input('endDate', endDate);
        const violationResult = await violationRequest.query(`
            SELECT
                nik,
                nama_lengkap,
                nama_perusahaan,
                departemen,
                tanggal,
                sesi_makan,
                jam_scan,
                kategori_pelanggaran,
                alasan,
                roster_kode,
                roster_keterangan,
                roster_kategori,
                peakmeal_id,
                lokasi_pengantaran,
                lokasi_scan,
                status_pengajuan,
                scan_status,
                created_at
            FROM dbo.tbl_t_pelanggaran_scan_kantin
            WHERE CAST(tanggal AS date) BETWEEN CAST(@startDate AS date) AND CAST(@endDate AS date)
              AND (
                  UPPER(LTRIM(RTRIM(ISNULL(kategori_pelanggaran, '')))) IN ('DI_LUAR_PLAN', 'SALAH_LOKASI_PESANAN')
                  OR UPPER(LTRIM(RTRIM(ISNULL(scan_status, '')))) = 'OUT_OF_PLAN'
              )
            ORDER BY tanggal, sesi_makan, kategori_pelanggaran, lokasi_scan, nama_lengkap, nik
        `);
        const violations = violationResult.recordset || [];
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Kantin Dashboard';
        workbook.created = new Date();

        const borderThin = {
            top: { style: 'thin' },
            bottom: { style: 'thin' },
            left: { style: 'thin' },
            right: { style: 'thin' }
        };
        const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F3D6E' } };
        const subHeaderFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF176B87' } };

        function normalizeJenis(value) {
            return String(value || '').trim().toUpperCase() === 'SNACK' ? 'SNACK' : 'PEAKMEAL';
        }

        function normalizeCompanyName(value) {
            if (!value) return '-';
            const upper = String(value).toUpperCase().trim();
            if (
                upper.includes('SINAR MANDIRI') ||
                upper.includes('SIMA') ||
                upper.includes('SUMBER MUTIARA PRIMA') ||
                upper.includes('SEHATI MANDIRI') ||
                upper.includes('SMU') ||
                upper === 'PT SIMA' ||
                upper === 'PT. SIMA'
            ) {
                return 'PT SEHATI MANDIRI UTAMA';
            }
            return value;
        }

        function normalizeSesi(value) {
            const normalized = String(value || '').trim().toUpperCase();
            if (normalized.includes('PAGI') || normalized.includes('BREAKFAST')) return 'BREAKFAST';
            if (normalized.includes('MALAM') || normalized.includes('DINNER')) return 'DINNER';
            if (normalized.includes('SUPPER')) return 'SUPPER';
            return 'LUNCH';
        }

        function asDateOnly(value) {
            if (!value) return '';
            const date = value instanceof Date ? value : new Date(value);
            if (Number.isNaN(date.getTime())) return '';
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${d}/${m}/${y}`;
        }

        function styleHeader(row) {
            row.eachCell(cell => {
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
                cell.fill = headerFill;
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
                cell.border = borderThin;
            });
        }

        const wsSummary = workbook.addWorksheet('Ringkasan Lokasi');
        wsSummary.columns = [
            { width: 6 },
            { width: 44 },
            { width: 20 },
            { width: 20 },
            { width: 14 },
            { width: 11 },
            { width: 11 },
            { width: 11 },
            { width: 11 },
            { width: 13 },
            { width: 14 },
            { width: 15 }
        ];
        wsSummary.mergeCells('A1:L1');
        wsSummary.getCell('A1').value = 'REKAP PENGAJUAN PEAKMEAL & SNACK';
        wsSummary.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
        wsSummary.getCell('A1').fill = headerFill;
        wsSummary.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
        wsSummary.mergeCells('A2:L2');
        wsSummary.getCell('A2').value = `Periode ${startDate} sampai ${endDate}`;
        wsSummary.getCell('A2').font = { italic: true, color: { argb: 'FF425466' }, name: 'Calibri' };
        wsSummary.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };

        const summaryMap = new Map();
        records.forEach(record => {
            const key = [
                record.tujuan_pengantaran || '-',
                record.lokasi_pengantaran || '-',
                record.lokasi_mess || '-',
                record.nomor_kamar || '-'
            ].join('|');
            if (!summaryMap.has(key)) {
                summaryMap.set(key, {
                    tujuan: record.tujuan_pengantaran || '-',
                    lokasi: record.lokasi_pengantaran || '-',
                    mess: record.lokasi_mess || '-',
                    kamar: record.nomor_kamar || '-',
                    peakmeal: 0,
                    snack: 0,
                    breakfast: 0,
                    lunch: 0,
                    dinner: 0,
                    supper: 0,
                    total: 0
                });
            }

            const item = summaryMap.get(key);
            const isSnack = normalizeJenis(record.jenis_pengajuan) === 'SNACK';
            if (isSnack) {
                item.snack++;
            } else {
                item.peakmeal++;
                const sesi = normalizeSesi(record.sesi_makan);
                if (sesi === 'BREAKFAST') item.breakfast++;
                else if (sesi === 'DINNER') item.dinner++;
                else if (sesi === 'SUPPER') item.supper++;
                else item.lunch++;
            }

            item.total++;
        });

        const grandTotal = [...summaryMap.values()].reduce((total, item) => ({
            peakmeal: total.peakmeal + item.peakmeal,
            snack: total.snack + item.snack,
            breakfast: total.breakfast + item.breakfast,
            lunch: total.lunch + item.lunch,
            dinner: total.dinner + item.dinner,
            supper: total.supper + item.supper,
            total: total.total + item.total
        }), { peakmeal: 0, snack: 0, breakfast: 0, lunch: 0, dinner: 0, supper: 0, total: 0 });

        wsSummary.mergeCells('A3:L3');
        const outOfPlanTotal = violations.filter(item => String(item.kategori_pelanggaran || '').toUpperCase() === 'DI_LUAR_PLAN').length;
        const wrongLocationTotal = violations.filter(item => String(item.kategori_pelanggaran || '').toUpperCase() === 'SALAH_LOKASI_PESANAN').length;
        wsSummary.getCell('A3').value = `TOTAL: ${grandTotal.total} | Total Makan: ${grandTotal.peakmeal} (Breakfast: ${grandTotal.breakfast}, Lunch: ${grandTotal.lunch}, Dinner: ${grandTotal.dinner}, Supper: ${grandTotal.supper}) | Jumlah Snack: ${grandTotal.snack} | Di Luar Plan: ${outOfPlanTotal} | Salah Lokasi: ${wrongLocationTotal}`;
        wsSummary.getCell('A3').font = { bold: true, color: { argb: 'FF0F3D6E' }, name: 'Calibri' };
        wsSummary.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF7FF' } };
        wsSummary.getCell('A3').alignment = { horizontal: 'center', vertical: 'middle' };
        wsSummary.getCell('A3').border = borderThin;

        const summaryHeader = wsSummary.getRow(4);
        ['No', 'Tujuan Pengantaran', 'Lokasi', 'Mess', 'Kamar', 'Breakfast', 'Lunch', 'Dinner', 'Supper', 'Total Makan', 'Jumlah Snack', 'Total Keseluruhan'].forEach((header, index) => {
            summaryHeader.getCell(index + 1).value = header;
        });
        styleHeader(summaryHeader);

        [...summaryMap.values()]
            .sort((a, b) => b.total - a.total || a.tujuan.localeCompare(b.tujuan))
            .forEach((item, index) => {
                const row = wsSummary.getRow(5 + index);
                [index + 1, item.tujuan, item.lokasi, item.mess, item.kamar, item.breakfast, item.lunch, item.dinner, item.supper, item.peakmeal, item.snack, item.total].forEach((value, cellIndex) => {
                    const cell = row.getCell(cellIndex + 1);
                    cell.value = value;
                    cell.border = borderThin;
                    cell.alignment = { horizontal: cellIndex >= 5 || cellIndex === 0 ? 'center' : 'left', vertical: 'middle', wrapText: true };
                    if (cellIndex === 11) {
                        cell.font = { bold: true, name: 'Calibri' };
                        cell.fill = subHeaderFill;
                    }
                });
            });
        if (summaryMap.size > 0) {
            const totalRow = wsSummary.getRow(5 + summaryMap.size);
            ['TOTAL', '', '', '', '', grandTotal.breakfast, grandTotal.lunch, grandTotal.dinner, grandTotal.supper, grandTotal.peakmeal, grandTotal.snack, grandTotal.total].forEach((value, cellIndex) => {
                const cell = totalRow.getCell(cellIndex + 1);
                cell.value = value;
                cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
                cell.fill = subHeaderFill;
                cell.border = borderThin;
                cell.alignment = { horizontal: cellIndex >= 5 || cellIndex === 0 ? 'center' : 'left', vertical: 'middle' };
            });
        }
        wsSummary.views = [{ state: 'frozen', ySplit: 4 }];
        wsSummary.autoFilter = `A4:L${Math.max(4, summaryMap.size + 5)}`;

        const wsDetail = workbook.addWorksheet('Detail Pengajuan');
        wsDetail.columns = [
            { width: 6 },
            { width: 14 },
            { width: 16 },
            { width: 14 },
            { width: 14 },
            { width: 18 },
            { width: 34 },
            { width: 28 },
            { width: 28 },
            { width: 30 },
            { width: 18 },
            { width: 18 },
            { width: 18 },
            { width: 16 },
            { width: 18 },
            { width: 40 }
        ];
        const detailHeader = wsDetail.getRow(1);
        ['No', 'Tanggal', 'Tanggal Pengajuan', 'Jenis', 'Sesi', 'NIK', 'Nama', 'Perusahaan', 'Departemen', 'Tujuan Pengantaran', 'Lokasi', 'Mess', 'Kamar', 'Roster', 'Status', 'Catatan'].forEach((header, index) => {
            detailHeader.getCell(index + 1).value = header;
        });
        styleHeader(detailHeader);

        records.forEach((record, index) => {
            const row = wsDetail.getRow(index + 2);
            [
                index + 1,
                asDateOnly(record.tanggal_peakmeal),
                asDateOnly(record.tanggal_pengajuan),
                normalizeJenis(record.jenis_pengajuan),
                normalizeSesi(record.sesi_makan),
                record.nik || '-',
                record.nama_lengkap || '-',
                normalizeCompanyName(record.nama_perusahaan),
                record.departemen || '-',
                record.tujuan_pengantaran || '-',
                record.lokasi_pengantaran || '-',
                record.lokasi_mess || '-',
                record.nomor_kamar || '-',
                record.roster_status || '-',
                record.status || '-',
                record.catatan || ''
            ].forEach((value, cellIndex) => {
                const cell = row.getCell(cellIndex + 1);
                cell.value = value;
                cell.border = borderThin;
                cell.alignment = { horizontal: cellIndex === 0 ? 'center' : 'left', vertical: 'middle', wrapText: true };
            });
        });
        wsDetail.views = [{ state: 'frozen', ySplit: 1 }];
        wsDetail.autoFilter = `A1:P${Math.max(1, records.length + 1)}`;

        const wsOutOfPlan = workbook.addWorksheet('Di Luar Plan');
        wsOutOfPlan.columns = [
            { width: 6 },
            { width: 14 },
            { width: 14 },
            { width: 18 },
            { width: 34 },
            { width: 28 },
            { width: 28 },
            { width: 18 },
            { width: 24 },
            { width: 28 },
            { width: 28 },
            { width: 18 },
            { width: 18 },
            { width: 48 }
        ];
        const outOfPlanHeader = wsOutOfPlan.getRow(1);
        ['No', 'Tanggal', 'Jam Scan', 'Sesi', 'Nama', 'NIK', 'Perusahaan', 'Departemen', 'Kategori', 'Lokasi Scan', 'Lokasi Pesanan', 'Roster', 'Status', 'Keterangan'].forEach((header, index) => {
            outOfPlanHeader.getCell(index + 1).value = header;
        });
        styleHeader(outOfPlanHeader);

        violations.forEach((item, index) => {
            const row = wsOutOfPlan.getRow(index + 2);
            [
                index + 1,
                asDateOnly(item.tanggal),
                item.jam_scan ? String(item.jam_scan).split('.')[0] : '-',
                normalizeSesi(item.sesi_makan),
                item.nama_lengkap || '-',
                item.nik || '-',
                normalizeCompanyName(item.nama_perusahaan),
                item.departemen || '-',
                item.kategori_pelanggaran || item.scan_status || '-',
                item.lokasi_scan || '-',
                item.lokasi_pengantaran || '-',
                item.roster_kode || item.roster_keterangan || '-',
                item.scan_status || '-',
                item.alasan || ''
            ].forEach((value, cellIndex) => {
                const cell = row.getCell(cellIndex + 1);
                cell.value = value;
                cell.border = borderThin;
                cell.alignment = { horizontal: cellIndex === 0 ? 'center' : 'left', vertical: 'middle', wrapText: true };
                if (cellIndex === 8) {
                    cell.font = { bold: true, color: { argb: 'FF9A3412' }, name: 'Calibri' };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEDD5' } };
                }
            });
        });
        wsOutOfPlan.views = [{ state: 'frozen', ySplit: 1 }];
        wsOutOfPlan.autoFilter = `A1:N${Math.max(1, violations.length + 1)}`;

        const filename = `Pengajuan_Peakmeal_Snack_${startDate}_sd_${endDate}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        console.error('Error generating peakmeal report:', err);
        writeAppLog('ERROR', 'API:/api/download-peakmeal-report', err.message, { startDate, endDate });
        res.status(500).json({ error: 'Gagal membuat laporan pengajuan peakmeal/snack.' });
    }
});

// GET /api/download-report - Generate Excel report
api.get('/api/download-report', async (req, res) => {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
        return res.status(400).json({ error: 'Rentang tanggal (startDate dan endDate) diperlukan.' });
    }

    try {
        const request = pool.request();
        request.input('startDate', startDate);
        request.input('endDate', endDate);

        const result = await request.query(`
            SELECT
                p.nik,
                ISNULL(k.nama_lengkap, '') AS nama_lengkap,
                ISNULL(k.departemen, '') AS depart,
                ISNULL(k.seksi, 'RESIDENCE') AS section,
                k.nama_perusahaan,
                p.tanggal,
                p.time,
                p.sesi_makan,
                ISNULL(p.lokasi, '') AS lokasi,
                ISNULL(p.nama_pc, '') AS nama_pc,
                ISNULL(p.ip_address, '') AS ip_address,
                m.status_residence
            FROM tbl_m_pengunjung_kantin p
            LEFT JOIN dbo.vw_karyawan_kantin_scan k ON p.nik = k.nik
            LEFT JOIN ONE_DB_MITRA.dbo.vw_m_karyawan_aktif m ON p.nik = m.no_nik
            WHERE CAST(p.tanggal AS DATE) BETWEEN CAST(@startDate AS DATE) AND CAST(@endDate AS DATE)
            ORDER BY p.sesi_makan, p.tanggal, p.time
        `);

        const workbook = new ExcelJS.Workbook();

        const logoPathPng = path.join(__dirname, 'renderer/assets/logo-laporan.png');
        const logoPathJpeg = path.join(__dirname, 'renderer/assets/logo-laporan.jpeg');
        const logoPathJpg = path.join(__dirname, 'renderer/assets/logo-laporan.jpg');
        let logoImageId = null;
        if (fsSync.existsSync(logoPathPng)) {
            logoImageId = workbook.addImage({
                buffer: fsSync.readFileSync(logoPathPng),
                extension: 'png'
            });
        } else if (fsSync.existsSync(logoPathJpeg)) {
            logoImageId = workbook.addImage({
                buffer: fsSync.readFileSync(logoPathJpeg),
                extension: 'jpeg'
            });
        } else if (fsSync.existsSync(logoPathJpg)) {
            logoImageId = workbook.addImage({
                buffer: fsSync.readFileSync(logoPathJpg),
                extension: 'jpeg'
            });
        }

        // Partition standard vs GLJ records
        const standardRecords = [];
        const gljRecords = [];

        (result.recordset || []).forEach(row => {
            const rawCompany = (row.nama_perusahaan || '').toUpperCase();
            let mappedCompany = row.nama_perusahaan || '';
            if (
                rawCompany.includes('SINAR MANDIRI') ||
                rawCompany.includes('SIMA') ||
                rawCompany.includes('SUMBER MUTIARA PRIMA') ||
                rawCompany.includes('SEHATI MANDIRI') ||
                rawCompany.includes('SMU') ||
                rawCompany === 'PT SIMA' ||
                rawCompany === 'PT. SIMA'
            ) {
                mappedCompany = 'PT SEHATI MANDIRI UTAMA';
            }

            if (rawCompany.includes('GANESHA LAUTJAYA')) {
                // GLJ
                const mappedRow = {
                    ...row,
                    nama_perusahaan: 'PT GANESHA LAUTJAYA',
                    depart: 'PT.PGLJ'
                };
                gljRecords.push(mappedRow);
            } else {
                // Standard
                let mappedDept = row.depart;
                if (rawCompany.includes('PERTAMINA BINA MEDIKA')) {
                    mappedDept = 'Pertamedika';
                }
                const mappedRow = {
                    ...row,
                    nama_perusahaan: mappedCompany,
                    depart: mappedDept
                };
                standardRecords.push(mappedRow);
            }
        });

        // Helper to format time to "HH:mm:ss"
        function formatTime(timeVal) {
            if (timeVal instanceof Date) {
                const hh = String(timeVal.getUTCHours()).padStart(2, '0');
                const mm = String(timeVal.getUTCMinutes()).padStart(2, '0');
                const ss = String(timeVal.getUTCSeconds()).padStart(2, '0');
                return `${hh}:${mm}:${ss}`;
            }
            if (typeof timeVal === 'string') {
                return timeVal.split('.')[0];
            }
            return '';
        }

        // Sort function: Department (case-insensitive), then Time (chronological)
        function sortRecords(records) {
            return records.sort((a, b) => {
                const deptA = (a.depart || '').toUpperCase();
                const deptB = (b.depart || '').toUpperCase();
                const cmpDept = deptA.localeCompare(deptB);
                if (cmpDept !== 0) {
                    return cmpDept;
                }
                const timeA = formatTime(a.time);
                const timeB = formatTime(b.time);
                return timeA.localeCompare(timeB);
            });
        }

        // Helper to get residence value based on status_residence and NIK mapping
        function getResidenceValue(row) {
            const status = (row.status_residence || '').toUpperCase().trim();
            const nik = (row.nik || '').trim();
            if (nik === '26051871136' || nik === 'M01939') {
                return '-';
            }
            if (nik === '40123088') {
                return 'NON RESIDENCE';
            }
            if (status === 'MESS' || status === 'RESIDENT (MESS)') {
                return 'RESIDENCE';
            }
            if (status === 'NON MESS') {
                return 'NON RESIDENCE';
            }
            return 'RESIDENCE';
        }

        // Sort standard and GLJ records
        sortRecords(standardRecords);
        sortRecords(gljRecords);

        // Group records by session
        const stdB = [];
        const stdL = [];
        const stdD = [];
        standardRecords.forEach(rec => {
            const sesi = (rec.sesi_makan || '').toUpperCase();
            if (sesi === 'MAKAN PAGI') stdB.push(rec);
            else if (sesi === 'MAKAN SIANG') stdL.push(rec);
            else if (sesi === 'MAKAN MALAM') stdD.push(rec);
        });

        const gljB = [];
        const gljL = [];
        const gljD = [];
        gljRecords.forEach(rec => {
            const sesi = (rec.sesi_makan || '').toUpperCase();
            if (sesi === 'MAKAN PAGI') gljB.push(rec);
            else if (sesi === 'MAKAN SIANG') gljL.push(rec);
            else if (sesi === 'MAKAN MALAM') gljD.push(rec);
        });

        // Indonesian date label for signature
        const MONTHS_ID = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
        const parts = endDate.split('-');
        const year = parts[0];
        const monthNum = parseInt(parts[1], 10);
        const day = parseInt(parts[2], 10);
        const dateLabel = `KALIORANG, ${day} ${MONTHS_ID[monthNum - 1]} ${year}`;

        const borderThin = {
            top: { style: 'thin' }, bottom: { style: 'thin' },
            left: { style: 'thin' }, right: { style: 'thin' }
        };

        // Helper to create detail sheet
        function createDetailSheet(sheetName, title, records, isGlj) {
            const ws = workbook.addWorksheet(sheetName);
            
            if (logoImageId !== null) {
                ws.addImage(logoImageId, {
                    tl: { col: 0, row: 0 },
                    br: { col: 1, row: 5 },
                    editAs: 'oneCell'
                });
            }
            
            ws.columns = [
                { width: 5 },  // NO
                { width: 20 }, // NIK
                { width: 38 }, // Nama Lengkap
                { width: 40 }, // Departemen
                { width: 15 }, // RESIDENCE
                { width: 25 }, // Lokasi
                { width: 15 }, // Tanggal
                { width: 20 }  // Waktu
            ];
            
            ws.getRow(1).height = 22;
            ws.getRow(2).height = 20;

            // Row 1: Title merged B1:H1
            ws.mergeCells('B1:H1');
            const titleCell = ws.getCell('B1');
            titleCell.value = title;
            titleCell.font = { bold: true, size: 14, name: 'Calibri' };
            titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

            // Row 2: Subtitle merged B2:H2
            ws.mergeCells('B2:H2');
            const subtitleCell = ws.getCell('B2');
            subtitleCell.value = 'SITE INDEXIM - KALIORANG';
            subtitleCell.font = { bold: true, size: 12, name: 'Calibri' };
            subtitleCell.alignment = { horizontal: 'center', vertical: 'middle' };

            const headerRowNumber = (isGlj && records.length === 0) ? 5 : 6;
            const headers = ['NO', 'NIK', 'Nama Lengkap', 'Departemen', 'RESIDENCE', 'Lokasi', 'Tanggal', 'Waktu'];
            const rHdr = ws.getRow(headerRowNumber);
            rHdr.height = 20;
            
            headers.forEach((h, i) => {
                const cell = rHdr.getCell(i + 1);
                cell.value = h;
                cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
                cell.border = borderThin;
            });

            const DATA_START = headerRowNumber + 1;
            const N = records.length;
            
            if (N > 0) {
                records.forEach((rec, idx) => {
                    const rowNum = DATA_START + idx;
                    const row = ws.getRow(rowNum);
                    row.height = 18;

                    let tanggalStr = rec.tanggal;
                    if (rec.tanggal instanceof Date) {
                        const y = rec.tanggal.getFullYear();
                        const m = String(rec.tanggal.getMonth() + 1).padStart(2, '0');
                        const d = String(rec.tanggal.getDate()).padStart(2, '0');
                        tanggalStr = `${y}-${m}-${d}`;
                    }

                    const scanLocationLabel = rec.lokasi || '-';

                    const values = [
                        idx + 1,
                        rec.nik,
                        rec.nama_lengkap,
                        rec.depart,
                        getResidenceValue(rec),
                        scanLocationLabel,
                        tanggalStr,
                        formatTime(rec.time)
                    ];

                    const COL_ALIGNS = ['center', 'center', 'left', 'left', 'center', 'center', 'center', 'center'];

                    values.forEach((v, i) => {
                        const cell = row.getCell(i + 1);
                        cell.value = v;
                        cell.font = { size: 11, name: 'Calibri' };
                        cell.alignment = { horizontal: COL_ALIGNS[i], vertical: 'middle' };
                        cell.border = borderThin;
                    });
                });
            } else {
                const row = ws.getRow(DATA_START);
                row.height = 18;
                for (let i = 1; i <= 8; i++) {
                    const cell = row.getCell(i);
                    cell.value = '';
                    cell.border = borderThin;
                }
            }

            const dataEndRow = DATA_START + Math.max(1, N) - 1;
            const blankRowAfterData = dataEndRow + 1;
            
            const summaryHdrRow = (N === 0) ? (dataEndRow + 1) : (blankRowAfterData + 1);
            const shRow = ws.getRow(summaryHdrRow);
            shRow.height = 20;

            ['DEPARTEMEN', 'TOTAL'].forEach((h, i) => {
                const cell = shRow.getCell(4 + i);
                cell.value = h;
                cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
                cell.border = borderThin;
            });

            let depts = [];
            if (isGlj) {
                if (N > 0) {
                    depts = ['PT.PGLJ'];
                }
            } else {
                depts = [...new Set(records.map(r => r.depart).filter(Boolean))].sort((a, b) => a.toUpperCase().localeCompare(b.toUpperCase()));
            }

            depts.forEach((dept, i) => {
                const rn = summaryHdrRow + 1 + i;
                const rRow = ws.getRow(rn);
                rRow.height = 18;

                const dCell = rRow.getCell(4);
                dCell.value = dept;
                dCell.font = { size: 11, name: 'Calibri' };
                dCell.alignment = { horizontal: 'center', vertical: 'middle' };
                dCell.border = borderThin;

                const tCell = rRow.getCell(5);
                const rangeEnd = DATA_START + N;
                tCell.value = { formula: `COUNTIF($D$${DATA_START}:$D$${rangeEnd}, D${rn})` };
                tCell.font = { size: 11, name: 'Calibri' };
                tCell.alignment = { horizontal: 'center', vertical: 'middle' };
                tCell.border = borderThin;
            });

            const gtRowNum = summaryHdrRow + 1 + depts.length;
            const gtRow = ws.getRow(gtRowNum);
            gtRow.height = 18;

            const gtD = gtRow.getCell(4);
            gtD.value = 'Grand Total';
            gtD.font = { bold: true, size: 11, name: 'Calibri' };
            gtD.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
            gtD.alignment = { horizontal: 'center', vertical: 'middle' };
            gtD.border = borderThin;

            const gtT = gtRow.getCell(5);
            const rangeEnd = DATA_START + N;
            gtT.value = { formula: `COUNTA($B$${DATA_START}:$B$${rangeEnd})` };
            gtT.font = { bold: true, size: 11, name: 'Calibri' };
            gtT.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
            gtT.alignment = { horizontal: 'center', vertical: 'middle' };
            gtT.border = borderThin;

            const sigDateRowNum = gtRowNum + 3;
            ws.mergeCells(`A${sigDateRowNum}:C${sigDateRowNum}`);
            const sdCell = ws.getCell(`A${sigDateRowNum}`);
            sdCell.value = dateLabel;
            sdCell.font = { bold: true, size: 11, name: 'Calibri' };
            sdCell.alignment = { horizontal: 'left', vertical: 'middle' };
            sdCell.border = undefined;

            const sigBracketRowNum = sigDateRowNum + 4;
            ws.mergeCells(`A${sigBracketRowNum}:C${sigBracketRowNum}`);
            ws.mergeCells(`F${sigBracketRowNum}:H${sigBracketRowNum}`);
            const BRACKET = '(                                                   )';
            const sbA = ws.getCell(`A${sigBracketRowNum}`);
            sbA.value = BRACKET;
            sbA.font = { bold: true, size: 11, name: 'Calibri' };
            sbA.alignment = { horizontal: 'left', vertical: 'middle' };
            sbA.border = undefined;

            const sbF = ws.getCell(`F${sigBracketRowNum}`);
            sbF.value = BRACKET;
            sbF.font = { bold: false, size: 11, name: 'Calibri' }; // Not bold!
            sbF.alignment = { horizontal: 'center', vertical: 'middle' };
            sbF.border = undefined;

            const sigCompanyRowNum = sigBracketRowNum + 1;
            ws.mergeCells(`A${sigCompanyRowNum}:C${sigCompanyRowNum}`);
            ws.mergeCells(`F${sigCompanyRowNum}:H${sigCompanyRowNum}`);
            const scA = ws.getCell(`A${sigCompanyRowNum}`);
            scA.value = 'PT SEHATI MANDIRI UTAMA';
            scA.font = { bold: true, size: 11, name: 'Calibri' };
            scA.alignment = { horizontal: 'left', vertical: 'middle' };
            scA.border = undefined;

            const scF = ws.getCell(`F${sigCompanyRowNum}`);
            scF.value = 'PT INDEXIM COALINDO';
            scF.font = { bold: false, size: 11, name: 'Calibri' }; // Not bold!
            scF.alignment = { horizontal: 'center', vertical: 'middle' };
            scF.border = undefined;
        }

        // Helper to create summary sheet
        function createSummarySheet(sheetName, records, isGlj) {
            const ws = workbook.addWorksheet(sheetName);
            
            if (!isGlj && logoImageId !== null) {
                ws.addImage(logoImageId, {
                    tl: { col: 0, row: 0 },
                    br: { col: 1, row: 5 },
                    editAs: 'oneCell'
                });
            }
            
            ws.columns = [
                { width: 57.09765625 }, // DEPARTMENT
                { width: 10 }, // B
                { width: undefined }, // L
                { width: undefined }, // D
                { width: undefined }, // SNACK
                { width: 25 }  // Approved by signature column
            ];
            
            ws.getRow(1).height = 20;
            ws.getRow(2).height = 20;

            ws.mergeCells('B1:D2');
            const titleCell = ws.getCell('B1');
            titleCell.value = "PRASMANAN\nKALIORANG";
            titleCell.font = { bold: true, size: 12, name: 'Calibri' };
            titleCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

            ws.mergeCells('E1:F1');
            const dateCell = ws.getCell('E1');
            dateCell.value = dateLabel;
            dateCell.font = { bold: true, size: 12, name: 'Calibri' };
            dateCell.alignment = { horizontal: 'right', vertical: 'middle' };

            ws.mergeCells('E2:F2');
            const subCell = ws.getCell('E2');
            subCell.value = "INDEXIM - KALIORANG";
            subCell.font = { bold: true, size: 12, name: 'Calibri' };
            subCell.alignment = { horizontal: 'right', vertical: 'middle' };

            const headerRowNumber = 6;
            const headers = ['DEPARTMENT', 'B', 'L', 'D', 'SNACK', ''];
            const rHdr = ws.getRow(headerRowNumber);
            rHdr.height = 20;
            
            headers.forEach((h, i) => {
                const cell = rHdr.getCell(i + 1);
                cell.value = h;
                if (i === 0) {
                    cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
                    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
                    cell.alignment = { horizontal: 'left', vertical: 'middle' };
                } else {
                    cell.font = { bold: false, size: 11, color: { argb: 'FFFFFFFF' }, name: 'Calibri' };
                    cell.fill = { type: 'pattern', pattern: 'none' };
                    cell.alignment = { horizontal: 'center', vertical: 'middle' };
                }
                cell.border = borderThin;
            });

            const depts = isGlj ? ['PT.PGLJ'] : [...new Set(records.map(r => r.depart).filter(Boolean))].sort((a, b) => a.toUpperCase().localeCompare(b.toUpperCase()));

            let totalB = 0;
            let totalL = 0;
            let totalD = 0;

            depts.forEach((dept, i) => {
                const rn = headerRowNumber + 1 + i;
                const rRow = ws.getRow(rn);
                rRow.height = 18;

                let bCount = 0;
                let lCount = 0;
                let dCount = 0;

                if (isGlj) {
                    records.forEach(rec => {
                        if (rec.sesi_makan === 'MAKAN PAGI') bCount++;
                        else if (rec.sesi_makan === 'MAKAN SIANG') lCount++;
                        else if (rec.sesi_makan === 'MAKAN MALAM') dCount++;
                    });
                } else {
                    records.forEach(rec => {
                        if (rec.depart === dept) {
                            if (rec.sesi_makan === 'MAKAN PAGI') bCount++;
                            else if (rec.sesi_makan === 'MAKAN SIANG') lCount++;
                            else if (rec.sesi_makan === 'MAKAN MALAM') dCount++;
                        }
                    });
                }

                totalB += bCount;
                totalL += lCount;
                totalD += dCount;

                const values = [dept, bCount, lCount, dCount, ' '];
                const COL_ALIGNS = ['left', 'center', 'center', 'center', 'center'];

                values.forEach((v, idx) => {
                    const cell = rRow.getCell(idx + 1);
                    cell.value = v;
                    cell.font = { size: 11, name: 'Calibri' };
                    cell.alignment = { horizontal: COL_ALIGNS[idx], vertical: 'middle' };
                    cell.border = borderThin;
                });
            });

            const totalRowNum = headerRowNumber + 1 + depts.length;
            const tRow = ws.getRow(totalRowNum);
            tRow.height = 18;

            const totalVals = ['TOTAL ORDER', totalB, totalL, totalD, ' '];
            totalVals.forEach((v, idx) => {
                const cell = tRow.getCell(idx + 1);
                cell.value = v;
                cell.font = { bold: true, size: 11, name: 'Calibri' };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
                cell.alignment = { horizontal: 'left', vertical: 'middle' };
                cell.border = borderThin;
            });

            const sigDateRowNum = totalRowNum + 3;
            const rSigDate = ws.getRow(sigDateRowNum);
            rSigDate.getCell(1).value = 'Prepared by,';
            rSigDate.getCell(1).font = { bold: true, size: 11, name: 'Calibri' };
            rSigDate.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
            rSigDate.getCell(1).border = undefined;

            rSigDate.getCell(6).value = 'Approved by,';
            rSigDate.getCell(6).font = { bold: false, size: 11, name: 'Calibri' }; // Not bold!
            rSigDate.getCell(6).alignment = { horizontal: 'left', vertical: 'middle' };
            rSigDate.getCell(6).border = undefined;

            const sigBracketRowNum = sigDateRowNum + 4;
            const rSigBracket = ws.getRow(sigBracketRowNum);
            const BRACKET = '(                                         )';
            rSigBracket.getCell(1).value = BRACKET;
            rSigBracket.getCell(1).font = { bold: true, size: 11, name: 'Calibri' };
            rSigBracket.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
            rSigBracket.getCell(1).border = undefined;

            rSigBracket.getCell(6).value = BRACKET;
            rSigBracket.getCell(6).font = { bold: false, size: 11, name: 'Calibri' }; // Not bold!
            rSigBracket.getCell(6).alignment = { horizontal: 'left', vertical: 'middle' };
            rSigBracket.getCell(6).border = undefined;

            const sigCompanyRowNum = sigBracketRowNum + 1;
            const rSigCompany = ws.getRow(sigCompanyRowNum);
            rSigCompany.getCell(1).value = 'PT SEHATI MANDIRI UTAMA';
            rSigCompany.getCell(1).font = { bold: true, size: 11, name: 'Calibri' };
            rSigCompany.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
            rSigCompany.getCell(1).border = undefined;

            rSigCompany.getCell(6).value = 'PT.Indexim Coalindo';
            rSigCompany.getCell(6).font = { bold: false, size: 11, name: 'Calibri' }; // Not bold!
            rSigCompany.getCell(6).alignment = { horizontal: 'left', vertical: 'middle' };
            rSigCompany.getCell(6).border = undefined;

            // Clear styles and borders on intermediate signature columns (B to E)
            [sigDateRowNum, sigBracketRowNum, sigCompanyRowNum].forEach(rn => {
                const row = ws.getRow(rn);
                for (let c = 2; c <= 5; c++) {
                    const cell = row.getCell(c);
                    cell.font = { bold: false, size: 11, name: 'Calibri' };
                    cell.border = undefined;
                }
            });
        }

        // Add sheets in the exact order
        createDetailSheet('B (Makan Pagi)', 'DATA ABSEN BREAKFAST', stdB, false);
        createDetailSheet('L (Makan Siang)', 'DATA ABSEN LUNCH', stdL, false);
        createDetailSheet('D (Makan Malam)', 'DATA ABSEN DINNER', stdD, false);

        createDetailSheet('B GLJ', 'DATA ABSEN BREAKFAST', gljB, true);
        createDetailSheet('L GLJ', 'DATA ABSEN LUNCH', gljL, true);
        createDetailSheet('D GLJ', 'DATA ABSEN DINNER', gljD, true);

        createSummarySheet('RECONSIL', standardRecords, false);
        createSummarySheet('RECONSIL GLJ', gljRecords, true);

        const filename = `Laporan_Kantin_${startDate}_sd_${endDate}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error('Error generating report:', err);
        writeAppLog('ERROR', 'API:/api/download-report', err.message, { startDate, endDate });
        res.status(500).json({ error: 'Gagal membuat laporan Excel.' });
    }
});

// POST /api/upload-meal-plan - Batch import meal plans from Excel
api.post('/api/upload-meal-plan', mealPlanUpload.single('mealPlanFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Tidak ada file yang diupload.' });
    }

    const workbook = new ExcelJS.Workbook();
    try {
        await workbook.xlsx.readFile(req.file.path);
        const worksheet = workbook.getWorksheet(1);
        let successCount = 0;
        
        worksheet.eachRow({ includeEmpty: false }, async (row, rowNumber) => {
            if (rowNumber === 1) return; // Skip header row

            try {
                const values = row.values.slice(1);
                const request = pool.request();
                
                // Map values to parameters
                request.input('tanggal', values[0] || null);
                request.input('sesi', values[1] || null);
                request.input('starch_nama', values[2] || null);
                request.input('starch_kalori', values[3] || 0);
                request.input('starch_gram', values[4] || 0);
                // Add other fields as needed...
                request.input('total_calorie', values[29] || 0);
                
                const query = `
                    MERGE tbl_m_meal_plan t
                    USING (VALUES (@tanggal, @sesi)) s(tanggal, sesi_makan)
                    ON t.tanggal = s.tanggal AND t.sesi_makan = s.sesi_makan
                    WHEN MATCHED THEN UPDATE SET updated_at = GETDATE()
                    WHEN NOT MATCHED THEN INSERT (tanggal, sesi_makan, total_calorie, created_at) 
                                             VALUES (@tanggal, @sesi, @total_calorie, GETDATE());
                `;
                
                await request.query(query);
                successCount++;
            } catch (err) {
                console.error(`Error processing row ${rowNumber}:`, err);
            }
        });

        res.status(200).json({ message: `Upload berhasil: ${successCount} baris data diproses.` });
    } catch (err) {
        console.error('Error processing Excel file:', err);
        writeAppLog('ERROR', 'API:/api/upload-meal-plan', err.message);
        res.status(500).json({ error: 'Gagal memproses file Excel.' });
    }
});


// =================================================================
// --- IPC Handlers & Siklus Hidup Aplikasi Electron ---
// =================================================================

ipcMain.handle('upload-image', async (event, fileData) => {
    try {
        const { fileBuffer, fileName, tanggal, nama } = fileData;
        if (!fileBuffer || !fileName || !tanggal || !nama) {
            throw new Error('Data tidak lengkap untuk upload gambar.');
        }

        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const newFileName = 'menuImage-' + uniqueSuffix + path.extname(fileName);
        const filePath = path.join(UPLOADS_DIR, newFileName);
        const dbPath = path.join('uploads', newFileName).replace(/\\/g, '/');

        await fs.writeFile(filePath, Buffer.from(fileBuffer));

        const request = pool.request();
        request.input('nama', nama);
        request.input('path', dbPath);
        request.input('tanggal', tanggal);
        
        await request.query(`
            INSERT INTO tbl_m_image_menu (nama, path, tanggal, time, created_by, created_at)
            VALUES (@nama, @path, @tanggal, CAST(GETDATE() AS TIME), 'system', GETDATE())
        `);

        return { success: true, message: 'Gambar berhasil diupload.' };
    } catch (error) {
        console.error('IPC Upload Error:', error);
        writeAppLog('ERROR', 'IPC:upload-image', error.message);
        return { success: false, message: error.message || 'Gagal upload gambar via IPC.' };
    }
});

ipcMain.on('save-dialog', (event, { filename, buffer }) => {
    dialog.showSaveDialog({
        title: 'Simpan Laporan Excel',
        defaultPath: filename,
        filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
    }).then(result => {
        if (!result.canceled && result.filePath) {
            require('fs').writeFileSync(result.filePath, Buffer.from(buffer));
        }
    });
});

ipcMain.on('play-system-beep', () => {
    shell.beep();
});

app.whenReady().then(async () => {
    // Initialize database connection
    await initializeDatabase();

    const port = process.env.SERVER_PORT || 3001;
    api.listen(port, () => {
        console.log(`API server running on http://localhost:${port}`);
        writeAppLog('INFO', 'API', `API server running on http://localhost:${port}`);
    });

    createWindow();

    // Setup penjadwal sinkronisasi otomatis setiap 3 jam (Mode Offline & Online)
    await setupAutoSyncScheduler();

    // Jalankan berkala sinkronisasi offline scan setiap 30 detik jika ada
    setInterval(syncOfflineScans, 30000);

    // Background reconnection watcher: setiap 60 detik cek apakah koneksi pulih
    backgroundReconnectTimer = setInterval(async () => {
        if (!pool || !pool.connected) {
            const reconnected = await attemptDbReconnect();
            if (reconnected) {
                const queue = await getOfflineQueue();
                if (queue.length > 0) {
                    console.log('[Auto-Sync] Koneksi database pulih kembali, menjalankan sinkronisasi antrean...');
                    await runFullSync({ source: 'RECONNECT' });
                }
            }
        }
    }, 60000);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (autoReloadInterval) {
        clearInterval(autoReloadInterval);
        autoReloadInterval = null;
    }

    // Close database connection before exiting
    if (pool) {
        pool.close();
    }
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

process.on('uncaughtException', (err) => {
    writeAppLog('ERROR', 'PROCESS', err.message, { stack: err.stack });
});

process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : null;
    writeAppLog('ERROR', 'PROCESS', message, { stack });
});
