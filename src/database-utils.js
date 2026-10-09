/**
 * SQL Server Database Utilities
 * Helper functions untuk menjalankan queries di SQL Server
 */

const sql = require('mssql');

// Wrapper untuk execute query ke SQL Server
async function executeQuery(pool, queryText, params = []) {
    try {
        const request = pool.request();
        
        // Jika ada parameters, tambahkan ke request
        if (params && params.length > 0) {
            params.forEach((param, index) => {
                request.input(`param${index + 1}`, param);
            });
            
            // Replace $1, $2, etc dengan @param1, @param2, etc
            queryText = queryText.replace(/\$(\d+)/g, '@param$1');
        }
        
        const result = await request.query(queryText);
        return result.recordset || [];
    } catch (err) {
        console.error('Database Error:', err);
        throw err;
    }
}

// Get current meal session
async function getCurrentMealSession(pool) {
    const now = new Date();
    const currentTime = now.toTimeString().split(' ')[0].substring(0, 5);
    
    const query = `
        SELECT nama FROM tbl_m_jam_makan 
        WHERE CAST(GETDATE() AS TIME) BETWEEN CAST(mulai AS TIME) AND CAST(selesai AS TIME)
    `;
    
    const result = await executeQuery(pool, query);
    return result.length > 0 ? result[0].nama : 'DILUAR JAM MAKAN';
}

function normalizeMealSession(sesi) {
    const normalized = (sesi || '').toString().trim().toUpperCase();
    if (normalized.includes('PAGI') || normalized === 'BREAKFAST') return 'MAKAN PAGI';
    if (normalized.includes('MALAM') || normalized === 'DINNER') return 'MAKAN MALAM';
    if (normalized.includes('SIANG') || normalized.includes('LUNCH')) return 'MAKAN SIANG';
    return normalized;
}

function toPeakmealSession(sesi) {
    const normalized = normalizeMealSession(sesi);
    if (normalized === 'MAKAN PAGI') return 'PAGI';
    if (normalized === 'MAKAN MALAM') return 'MALAM';
    if (normalized === 'MAKAN SIANG') return 'SIANG';
    return normalized;
}

async function ensureComplianceScanTable(pool) {
    const query = `
        IF OBJECT_ID(N'dbo.tbl_t_pelanggaran_scan_kantin', N'U') IS NULL
           AND OBJECT_ID(N'dbo.tbl_m_pacmel_dan_roster_scan', N'U') IS NOT NULL
        BEGIN
            EXEC sp_rename 'dbo.tbl_m_pacmel_dan_roster_scan', 'tbl_t_pelanggaran_scan_kantin';
        END

        IF OBJECT_ID(N'dbo.tbl_t_pelanggaran_scan_kantin', N'U') IS NULL
        BEGIN
            CREATE TABLE dbo.tbl_t_pelanggaran_scan_kantin (
                id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                nik NVARCHAR(50) NOT NULL,
                nama_lengkap NVARCHAR(255) NULL,
                nama_perusahaan NVARCHAR(255) NULL,
                departemen NVARCHAR(150) NULL,
                tanggal DATE NOT NULL,
                sesi_makan NVARCHAR(100) NULL,
                jam_scan TIME NULL,
                alasan NVARCHAR(500) NOT NULL,
                roster_kode NVARCHAR(50) NULL,
                roster_keterangan NVARCHAR(255) NULL,
                roster_kategori NVARCHAR(50) NULL,
                peakmeal_id VARCHAR(50) NULL,
                lokasi_pengantaran NVARCHAR(150) NULL,
                lokasi_scan NVARCHAR(150) NULL,
                kategori_pelanggaran NVARCHAR(50) NULL,
                status_pengajuan NVARCHAR(50) NULL,
                scan_status NVARCHAR(50) NOT NULL CONSTRAINT DF_tbl_t_pelanggaran_scan_kantin_status DEFAULT ('REJECTED'),
                ip_address VARCHAR(50) NULL,
                created_at DATETIME NOT NULL CONSTRAINT DF_tbl_t_pelanggaran_scan_kantin_created DEFAULT (GETDATE())
            );

            CREATE INDEX IX_tbl_t_pelanggaran_scan_kantin_tanggal
                ON dbo.tbl_t_pelanggaran_scan_kantin(tanggal, sesi_makan, nik);
        END

        IF COL_LENGTH('dbo.tbl_t_pelanggaran_scan_kantin', 'lokasi_scan') IS NULL
        BEGIN
            ALTER TABLE dbo.tbl_t_pelanggaran_scan_kantin ADD lokasi_scan NVARCHAR(150) NULL;
        END

        IF COL_LENGTH('dbo.tbl_t_pelanggaran_scan_kantin', 'kategori_pelanggaran') IS NULL
        BEGIN
            ALTER TABLE dbo.tbl_t_pelanggaran_scan_kantin ADD kategori_pelanggaran NVARCHAR(50) NULL;
        END
    `;

    await executeQuery(pool, query);
}

async function ensureScanTableColumns(pool) {
    const query = `
        IF NOT EXISTS (
            SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'tbl_m_pengunjung_kantin' AND COLUMN_NAME = 'lokasi'
        )
        BEGIN
            ALTER TABLE tbl_m_pengunjung_kantin ADD lokasi NVARCHAR(150) NULL;
        END

        IF NOT EXISTS (
            SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = 'tbl_m_pengunjung_kantin' AND COLUMN_NAME = 'nama_pc'
        )
        BEGIN
            ALTER TABLE tbl_m_pengunjung_kantin ADD nama_pc NVARCHAR(100) NULL;
        END
    `;
    await executeQuery(pool, query);
}

// Get today's date in YYYY-MM-DD format (local time, not UTC)
function getTodayDate() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// Get visitor counts by session
async function getVisitorCounts(pool, date) {
    const query = `
        SELECT sesi_makan, COUNT(*) as total 
        FROM tbl_m_pengunjung_kantin 
        WHERE CAST(tanggal AS DATE) = CAST(@date AS DATE)
        GROUP BY sesi_makan
    `;
    
    const request = pool.request();
    request.input('date', date);
    const result = await request.query(query);
    
    const counts = {
        'MAKAN PAGI': 0,
        'MAKAN SIANG': 0,
        'MAKAN MALAM': 0
    };
    
    result.recordset.forEach(row => {
        if (counts.hasOwnProperty(row.sesi_makan)) {
            counts[row.sesi_makan] = row.total;
        }
    });
    
    return counts;
}

// Get employee from local kantin view
async function getEmployeeFromKantinView(pool, nikOrScanCode) {
    const query = `
        SELECT TOP 1
            nik AS no_nik,
            nama_lengkap,
            nama_perusahaan,
            departemen AS depart,
            posisi
        FROM dbo.vw_karyawan_kantin_scan
        WHERE nik = @scan
    `;

    const request = pool.request();
    request.input('scan', nikOrScanCode);
    const result = await request.query(query);

    return result.recordset.length > 0 ? result.recordset[0] : null;
}

// Get today's peakmeal data by NIK
async function getTodayPeakmealByNik(pool, nik, date, sesi = null) {
    const query = `
        SELECT TOP 1
            id,
            nik,
            nama_lengkap,
            tanggal_peakmeal,
            lokasi_pengantaran,
            status,
            jenis_pengajuan,
            sesi_makan
        FROM [DB_ONE].[dbo].[tbl_t_peakmeal]
        WHERE nik = @nik
          AND CAST(tanggal_peakmeal AS DATE) = CAST(@date AS DATE)
          AND UPPER(LTRIM(RTRIM(ISNULL(jenis_pengajuan, 'PEAKMEAL')))) = 'PEAKMEAL'
          AND UPPER(LTRIM(RTRIM(ISNULL(status, '')))) <> 'CANCELLED'
          AND (@sesi IS NULL OR UPPER(LTRIM(RTRIM(ISNULL(sesi_makan, 'SIANG')))) = @sesi)
        ORDER BY updated_at DESC, created_at DESC
    `;

    const request = pool.request();
    request.input('nik', nik);
    request.input('date', date);
    request.input('sesi', sql.VarChar(30), sesi ? toPeakmealSession(sesi) : null);
    const result = await request.query(query);

    return result.recordset.length > 0 ? result.recordset[0] : null;
}

// Get today's roster data by NIK
async function getTodayRosterByNik(pool, nik, date) {
    const query = `
        SELECT TOP 1
            nik,
            working_date,
            roster_status_id,
            roster_kode,
            roster_keterangan,
            roster_kategori,
            roster_warna
        FROM dbo.vw_roster_harian
        WHERE nik = @nik
          AND CAST(working_date AS DATE) = CAST(@date AS DATE)
        ORDER BY updated_at DESC, created_at DESC
    `;

    const request = pool.request();
    request.input('nik', nik);
    request.input('date', date);
    const result = await request.query(query);

    return result.recordset.length > 0 ? result.recordset[0] : null;
}

async function recordComplianceViolation(pool, payload) {
    await ensureComplianceScanTable(pool);

    const query = `
        INSERT INTO dbo.tbl_t_pelanggaran_scan_kantin (
            nik,
            nama_lengkap,
            nama_perusahaan,
            departemen,
            tanggal,
            sesi_makan,
            jam_scan,
            alasan,
            roster_kode,
            roster_keterangan,
            roster_kategori,
            peakmeal_id,
            lokasi_pengantaran,
            lokasi_scan,
            kategori_pelanggaran,
            status_pengajuan,
            scan_status,
            ip_address,
            created_at
        )
        VALUES (
            @nik,
            @nama_lengkap,
            @nama_perusahaan,
            @departemen,
            @tanggal,
            @sesi_makan,
            @jam_scan,
            @alasan,
            @roster_kode,
            @roster_keterangan,
            @roster_kategori,
            @peakmeal_id,
            @lokasi_pengantaran,
            @lokasi_scan,
            @kategori_pelanggaran,
            @status_pengajuan,
            @scan_status,
            @ip_address,
            GETDATE()
        )
    `;

    const request = pool.request();
    request.input('nik', sql.NVarChar(50), payload.nik || '');
    request.input('nama_lengkap', sql.NVarChar(255), payload.nama_lengkap || null);
    request.input('nama_perusahaan', sql.NVarChar(255), payload.nama_perusahaan || null);
    request.input('departemen', sql.NVarChar(150), payload.departemen || null);
    request.input('tanggal', sql.Date, payload.tanggal);
    request.input('sesi_makan', sql.NVarChar(100), normalizeMealSession(payload.sesi_makan || ''));
    request.input('jam_scan', sql.VarChar(8), payload.jam_scan || null);
    request.input('alasan', sql.NVarChar(500), payload.alasan || 'Scan ditolak oleh validasi roster/peakmeal.');
    request.input('roster_kode', sql.NVarChar(50), payload.roster_kode || null);
    request.input('roster_keterangan', sql.NVarChar(255), payload.roster_keterangan || null);
    request.input('roster_kategori', sql.NVarChar(50), payload.roster_kategori || null);
    request.input('peakmeal_id', sql.VarChar(50), payload.peakmeal_id || null);
    request.input('lokasi_pengantaran', sql.NVarChar(150), payload.lokasi_pengantaran || null);
    request.input('lokasi_scan', sql.NVarChar(150), payload.lokasi_scan || null);
    request.input('kategori_pelanggaran', sql.NVarChar(50), payload.kategori_pelanggaran || null);
    request.input('status_pengajuan', sql.NVarChar(50), payload.status_pengajuan || null);
    request.input('scan_status', sql.NVarChar(50), payload.scan_status || 'REJECTED');
    request.input('ip_address', sql.VarChar(50), payload.ip_address || null);

    await request.query(query);
}

// Check if already scanned
async function hasAlreadyScanned(pool, nik, date, sesi) {
    const existingScan = await getExistingScan(pool, nik, date, sesi);
    return Boolean(existingScan);
}

// Format time string or Date object to HH:mm:ss
function formatTimeOnly(timeVal) {
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

// Format date string or Date object to YYYY-MM-DD
function formatDateOnly(dateVal) {
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

// Get existing scan record for a given employee/date/session
async function getExistingScan(pool, nik, date, sesi) {
    const query = `
        SELECT TOP 1 
            pid, 
            nik, 
            CONVERT(VARCHAR(10), tanggal, 120) AS tanggal, 
            status, 
            CONVERT(VARCHAR(8), time, 108) AS time, 
            sesi_makan, 
            created_at, 
            ISNULL(lokasi, '') AS lokasi, 
            ISNULL(nama_pc, '') AS nama_pc, 
            ISNULL(ip_address, '') AS ip_address
        FROM tbl_m_pengunjung_kantin
        WHERE nik = @nik AND CAST(tanggal AS DATE) = CAST(@date AS DATE) AND sesi_makan = @sesi
        ORDER BY created_at DESC
    `;
    
    const request = pool.request();
    request.input('nik', nik);
    request.input('date', date);
    request.input('sesi', sesi);
    const result = await request.query(query);
    
    if (result.recordset && result.recordset.length > 0) {
        const row = result.recordset[0];
        return {
            ...row,
            tanggal: formatDateOnly(row.tanggal) || date,
            time: formatTimeOnly(row.time)
        };
    }
    return null;
}

// Insert scan record
async function recordScan(pool, nik, date, sesi, time, status = 'SUCCESS', ipAddress = null, lokasi = null, namaPc = null) {
    const query = `
        INSERT INTO tbl_m_pengunjung_kantin (nik, tanggal, status, time, sesi_makan, created_at, ip_address, lokasi, nama_pc)
        OUTPUT inserted.pid, inserted.nik, inserted.tanggal, inserted.status, inserted.time, inserted.sesi_makan, inserted.created_at, inserted.ip_address, inserted.lokasi, inserted.nama_pc
        VALUES (@nik, @date, @status, @time, @sesi, GETDATE(), @ipAddress, @lokasi, @namaPc)
    `;
    
    const request = pool.request();
    request.input('nik', nik);
    request.input('date', date);
    request.input('status', status);
    request.input('time', time);
    request.input('sesi', sesi);
    request.input('ipAddress', ipAddress);
    request.input('lokasi', sql.NVarChar(150), lokasi || null);
    request.input('namaPc', sql.NVarChar(100), namaPc || null);
    
    const result = await request.query(query);
    if (result.recordset && result.recordset.length > 0) {
        const row = result.recordset[0];
        return {
            ...row,
            tanggal: formatDateOnly(row.tanggal) || (typeof date === 'string' ? date : formatDateOnly(date)),
            time: formatTimeOnly(row.time) || (typeof time === 'string' ? time : formatTimeOnly(time))
        };
    }
    return null;
}

// Get meal plan for date and session
async function getMealPlan(pool, date, sesi) {
    const query = `
        SELECT TOP 1 * FROM tbl_m_meal_plan 
        WHERE CAST(tanggal AS DATE) = CAST(@date AS DATE) AND sesi_makan = @sesi
    `;
    
    const request = pool.request();
    request.input('date', date);
    request.input('sesi', sesi);
    const result = await request.query(query);
    
    return result.recordset.length > 0 ? result.recordset[0] : null;
}

// Get menu images for date
async function getMenuImages(pool, date) {
    const query = `
        SELECT * FROM tbl_m_image_menu 
        WHERE CAST(tanggal AS DATE) = CAST(@date AS DATE)
        ORDER BY id DESC
    `;
    
    const request = pool.request();
    request.input('date', date);
    const result = await request.query(query);
    
    return result.recordset;
}

// Get app settings
async function getAppSettings(pool) {
    const query = `
        SELECT TOP 1 * FROM tbl_m_setting_aplikasi 
        ORDER BY id DESC
    `;
    
    const result = await executeQuery(pool, query);
    return result.length > 0 ? result[0] : null;
}

// Insert or update settings
async function saveSettings(pool, nama, description, theme, background, border) {
    const checkQuery = `SELECT TOP 1 id FROM tbl_m_setting_aplikasi`;
    const checkResult = await executeQuery(pool, checkQuery);
    
    if (checkResult.length > 0) {
        // Update
        const query = `
            UPDATE tbl_m_setting_aplikasi 
            SET nama = @nama, description = @desc, theme = @theme, 
                background = @bg, border = @border, updated_at = GETDATE()
            WHERE id = @id
        `;
        
        const request = pool.request();
        request.input('nama', nama);
        request.input('desc', description);
        request.input('theme', theme);
        request.input('bg', background);
        request.input('border', border);
        request.input('id', checkResult[0].id);
        
        await request.query(query);
    } else {
        // Insert
        const query = `
            INSERT INTO tbl_m_setting_aplikasi (nama, description, theme, background, border, insert_by, created_at)
            VALUES (@nama, @desc, @theme, @bg, @border, 'system', GETDATE())
        `;
        
        const request = pool.request();
        request.input('nama', nama);
        request.input('desc', description);
        request.input('theme', theme);
        request.input('bg', background);
        request.input('border', border);
        
        await request.query(query);
    }
}

// Get scan history for today (with optional location filter)
async function getScanHistory(pool, limit = 50, location = null) {
    let query = `
        SELECT TOP ${parseInt(limit, 10) || 50} 
            p.nik,
            ISNULL(k.nama_lengkap, '') AS nama_lengkap,
            ISNULL(k.nama_perusahaan, '') AS nama_perusahaan,
            ISNULL(k.departemen, '') AS depart,
            CONVERT(VARCHAR(8), p.time, 108) AS time,
            p.sesi_makan,
            p.status,
            ISNULL(p.lokasi, '') AS lokasi,
            ISNULL(p.nama_pc, '') AS nama_pc,
            ISNULL(p.ip_address, '') AS ip_address
        FROM tbl_m_pengunjung_kantin p
        LEFT JOIN dbo.vw_karyawan_kantin_scan k ON p.nik = k.nik
        WHERE CAST(p.tanggal AS DATE) = CAST(GETDATE() AS DATE)
    `;
    
    const request = pool.request();
    const trimmedLoc = String(location || '').trim();
    if (trimmedLoc && trimmedLoc.toUpperCase() !== 'XAFETARIA' && trimmedLoc.toUpperCase() !== 'ALL') {
        query += ` AND LTRIM(RTRIM(ISNULL(p.lokasi, ''))) = @location`;
        request.input('location', sql.NVarChar(150), trimmedLoc);
    }
    
    query += ` ORDER BY p.created_at DESC`;
    
    const result = await request.query(query);
    return result.recordset || [];
}


// Get all active employees for offline master cache
async function getAllActiveEmployees(pool) {
    // 1. Coba dari vw_karyawan_kantin_scan
    try {
        const request = pool.request();
        const query = `
            SELECT 
                nik AS no_nik,
                nama_lengkap,
                nama_perusahaan,
                departemen AS depart,
                posisi
            FROM dbo.vw_karyawan_kantin_scan
        `;
        const result = await request.query(query);
        if (result.recordset && result.recordset.length > 0) {
            return result.recordset;
        }
    } catch (err) {
        console.warn('Query vw_karyawan_kantin_scan warning, fallback ke vw_m_karyawan_aktif:', err.message);
    }

    // 2. Fallback ke ONE_DB_MITRA.dbo.vw_m_karyawan_aktif
    try {
        const req2 = pool.request();
        const query2 = `
            SELECT 
                no_nik,
                nama_lengkap,
                nama_perusahaan,
                departemen AS depart,
                posisi,
                status_residence
            FROM ONE_DB_MITRA.dbo.vw_m_karyawan_aktif
            WHERE status_karyawan = 'AKTIF' OR status_karyawan IS NULL
        `;
        const res2 = await req2.query(query2);
        return res2.recordset || [];
    } catch (e2) {
        console.error('Gagal mengambil daftar karyawan untuk cache offline:', e2.message);
        return [];
    }
}

module.exports = {
    executeQuery,
    ensureComplianceScanTable,
    ensureScanTableColumns,
    getCurrentMealSession,
    normalizeMealSession,
    toPeakmealSession,
    getTodayDate,
    getVisitorCounts,
    getEmployeeFromKantinView,
    getTodayPeakmealByNik,
    getTodayRosterByNik,
    recordComplianceViolation,
    hasAlreadyScanned,
    getExistingScan,
    recordScan,
    getMealPlan,
    getMenuImages,
    getAppSettings,
    saveSettings,
    getScanHistory,
    getAllActiveEmployees
};
