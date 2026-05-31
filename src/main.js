// --- Import Modul yang Dibutuhkan ---
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const ExcelJS = require('exceljs');
const fs = require('fs').promises; // Gunakan fs.promises
const fsSync = require('fs');
const sql = require('mssql');
const db = require('./database-utils'); // Database utilities
const envPath = app.isPackaged
    ? path.join(process.resourcesPath, '.env')
    : path.resolve(__dirname, '..', '.env');
require('dotenv').config({ path: envPath });
const HR_SCAN_API_BASE = 'https://indexsafemission_api.indexim.id/api/MinePermit/kantin/scan';
const ONEEV_BASE_URL = process.env.ONEEV_BASE_URL || 'https://oneev.indexim.id';
const EMPLOYEE_PHOTO_ENDPOINT = `${ONEEV_BASE_URL}/Employee/PhotoByNik`;
const EMPLOYEE_PHOTO_SECRET = process.env.EMPLOYEE_PHOTO_SECRET || 'hanyalulusyangtahu';
const UPLOADS_DIR = path.join(app.getPath('userData'), 'uploads');

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

// Initialize SQL Server Connection Pool
async function initializeDatabase() {
    try {
        pool = new sql.ConnectionPool(sqlConfig);
        await pool.connect();
        console.log('Successfully connected to SQL Server database.');
        writeAppLog('INFO', 'DB', 'Successfully connected to SQL Server database.');
        return true;
    } catch (err) {
        console.error('Error connecting to database:', err.message);
        writeAppLog('ERROR', 'DB', err.message, {
            server: process.env.DB_SERVER,
            database: process.env.DB_DATABASE
        });
        dialog.showErrorBox('Database Connection Error', 
            `Tidak dapat terhubung ke SQL Server.\nServer: ${process.env.DB_SERVER}\nDatabase: ${process.env.DB_DATABASE}\n\nError: ${err.message}`);
        return false;
    }
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

    if (kategori === 'WORK') {
        return { type: 'success', message: 'Roster sesuai' };
    }

    if (kategori === 'OFF' || kode === 'OFF') {
        return { type: 'error', message: 'Sedang OFF. Roster confirm ke yang bersangkutan.' };
    }

    return null;
}

async function getEmployeeFromHrScanApi(scanValue) {
    const encodedScanValue = encodeURIComponent(scanValue);
    const url = `${HR_SCAN_API_BASE}/${encodedScanValue}`;
    const response = await fetch(url, { method: 'GET' });

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
}

async function getEmployeePhotoByNik(noNik) {
    if (!noNik) {
        return { success: false, source: 'none', photo_url: null, photo_full_url: null };
    }

    const params = new URLSearchParams({
        no_nik: noNik,
        secret_key: EMPLOYEE_PHOTO_SECRET
    });

    const response = await fetch(`${EMPLOYEE_PHOTO_ENDPOINT}?${params.toString()}`, { method: 'GET' });
    if (!response.ok) {
        throw new Error(`Gagal mengambil foto karyawan. HTTP ${response.status}`);
    }

    const payload = await response.json();
    const source = payload.source || 'none';
    const photoUrl = payload.photo_url || null;
    const photoFullUrl = photoUrl ? `${ONEEV_BASE_URL}${photoUrl}` : null;

    return {
        success: Boolean(payload.success),
        no_nik: payload.no_nik || noNik,
        karyawan_id: payload.karyawan_id || null,
        source,
        photo_url: photoUrl,
        photo_full_url: photoFullUrl
    };
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
        if (isPlainNik11(candidate)) {
            const localEmployee = await db.getEmployeeFromKantinView(pool, candidate);
            if (localEmployee) {
                return { employee: localEmployee, source: 'VIEW', matchedBy: candidate };
            }
        }

        const [localResult, apiResult] = await Promise.allSettled([
            db.getEmployeeFromKantinView(pool, candidate),
            getEmployeeFromHrScanApi(candidate)
        ]);

        const localEmployee = localResult.status === 'fulfilled' ? localResult.value : null;
        const apiEmployee = apiResult.status === 'fulfilled' ? apiResult.value : null;

        if (localEmployee) {
            return { employee: localEmployee, source: 'VIEW', matchedBy: candidate };
        }

        if (apiEmployee) {
            return { employee: apiEmployee, source: 'API', matchedBy: candidate };
        }
    }

    return { employee: null, source: null, matchedBy: null };
}

// =================================================================
// --- API ENDPOINTS (Updated for SQL Server) ---
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
    try {
        const currentSesi = await db.getCurrentMealSession(pool);
        const today = db.getTodayDate();
        const visitorCounts = await db.getVisitorCounts(pool, today);
        const mealPlan = await db.getMealPlan(pool, today, currentSesi);
        const menuImages = await db.getMenuImages(pool, today);
        const appSettings = await db.getAppSettings(pool);
        
        const port = process.env.SERVER_PORT || 3001;
        const menuImagesWithUrl = menuImages.map(img => ({
            ...img,
            url: `http://localhost:${port}/images/${path.basename(img.path)}`
        }));

        res.json({
            currentSesi,
            visitorCounts,
            mealPlan: mealPlan || null,
            menuImages: menuImagesWithUrl,
            appSettings: appSettings || null,
        });

    } catch (err) {
        console.error('Error fetching dashboard data:', err);
        writeAppLog('ERROR', 'API:/api/dashboard-data', err.message);
        res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
});

// POST /api/scan - Process employee barcode scan
api.post('/api/scan', async (req, res) => {
    const { nik: scannedCode } = req.body;
    if (!scannedCode || scannedCode.trim() === '') {
        return res.status(400).json({ status: 'ERROR', message: 'Kode QR/NIK tidak boleh kosong.' });
    }

    try {
        // Hybrid lookup: local view first, then HR API fallback
        const lookup = await getEmployeeForScan(scannedCode.trim());
        const karyawan = lookup.employee;
        if (!karyawan) {
            return res.status(404).json({ status: 'NOT_FOUND', message: 'Data karyawan tidak ditemukan di view lokal maupun API HR.' });
        }

        // Get current session
        const now = new Date();
        const currentTime = now.toTimeString().split(' ')[0];
        const today = db.getTodayDate();
        const sesiMakan = await db.getCurrentMealSession(pool);
        const nikKaryawan = karyawan.no_nik;
        const isIndexim = isIndeximCompany(karyawan);
        const visitorStatus = isIndexim ? 'SUCCESS' : 'TAMU';
        
        if (sesiMakan === 'DILUAR JAM MAKAN') {
            return res.status(400).json({ status: 'OUT_OF_SESSION', message: 'Di Luar Jam Makan', data: karyawan });
        }

        // Check if already scanned
        const alreadyScanned = await db.hasAlreadyScanned(pool, nikKaryawan, today, sesiMakan);
        if (alreadyScanned) {
            return res.status(409).json({ status: 'ALREADY_SCANNED', message: `Sudah Scan Untuk ${sesiMakan}`, data: karyawan });
        }

        // Record scan
        await db.recordScan(pool, nikKaryawan, today, sesiMakan, currentTime, visitorStatus);

        let peakmealNotice = null;
        if (isIndexim) {
            const peakmeal = await db.getTodayPeakmealByNik(pool, nikKaryawan, today);
            if (peakmeal) {
                peakmealNotice = `Anda sudah dipesankan peakmeal. Lokasi pengantaran: ${peakmeal.lokasi_pengantaran || '-'}`;
            }
        }

        const roster = isIndexim ? await db.getTodayRosterByNik(pool, nikKaryawan, today) : null;
        const rosterNotice = buildRosterNotice(roster);
        let photoInfo = { success: false, source: 'none', photo_url: null, photo_full_url: null };
        try {
            photoInfo = await getEmployeePhotoByNik(nikKaryawan);
        } catch (photoErr) {
            console.warn('Photo lookup warning:', photoErr.message);
        }

        const responseEmployee = {
            ...karyawan,
            photo_source: photoInfo.source || 'none',
            photo_url: photoInfo.photo_url || null,
            photo_full_url: photoInfo.photo_full_url || null
        };

        res.status(201).json({
            status: 'SUCCESS',
            message: sesiMakan,
            source: lookup.source,
            matchedBy: lookup.matchedBy,
            visitorStatus,
            data: responseEmployee,
            peakmealNotice,
            rosterNotice
        });

    } catch (err) {
        console.error('Error processing scan:', err);
        writeAppLog('ERROR', 'API:/api/scan', err.message, { scannedCode });
        res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
});

// POST /api/settings - Save application settings
api.post('/api/settings', async (req, res) => {
    const { nama, description, theme, background, border } = req.body;
    try {
        await db.saveSettings(pool, nama, description, theme, background, border);
        res.status(200).json({ message: 'Pengaturan berhasil disimpan.' });
    } catch (error) {
        console.error('Error saving settings:', error);
        writeAppLog('ERROR', 'API:/api/settings', error.message);
        res.status(500).json({ error: 'Gagal menyimpan pengaturan.' });
    }
});

// GET /api/scan-history - Get today's scan history
api.get('/api/scan-history', async (req, res) => {
    try {
        const history = await db.getScanHistory(pool, 50);
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
                ISNULL(k.nama_perusahaan, '') AS perusahaan,
                ISNULL(k.departemen, '') AS depart,
                ISNULL(k.seksi, '') AS section,
                p.tanggal,
                p.time,
                p.sesi_makan
            FROM tbl_m_pengunjung_kantin p
            LEFT JOIN dbo.vw_karyawan_kantin_scan k ON p.nik = k.nik
            WHERE CAST(p.tanggal AS DATE) BETWEEN CAST(@startDate AS DATE) AND CAST(@endDate AS DATE)
            ORDER BY p.tanggal, p.time
        `);

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Laporan Pengunjung');

        worksheet.columns = [
            { header: 'NIK', key: 'nik', width: 15 },
            { header: 'Nama Lengkap', key: 'nama_lengkap', width: 30 },
            { header: 'Perusahaan', key: 'perusahaan', width: 30 },
            { header: 'Departemen', key: 'depart', width: 20 },
            { header: 'Section', key: 'section', width: 20 },
            { header: 'Tanggal', key: 'tanggal', width: 15 },
            { header: 'Waktu', key: 'time', width: 15 },
            { header: 'Sesi Makan', key: 'sesi_makan', width: 20 },
        ];
        
        worksheet.getRow(1).font = { bold: true };
        worksheet.addRows(result.recordset || []);
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="Laporan_Pengunjung_${startDate}_sd_${endDate}.xlsx"`);
        
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

app.whenReady().then(async () => {
    // Initialize database connection first
    const dbConnected = await initializeDatabase();
    if (!dbConnected) {
        app.quit();
        return;
    }

    const port = process.env.SERVER_PORT || 3001;
    api.listen(port, () => {
        console.log(`API server running on http://localhost:${port}`);
        writeAppLog('INFO', 'API', `API server running on http://localhost:${port}`);
    });

    createWindow();

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
