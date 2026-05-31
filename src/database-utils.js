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

// Get today's date in YYYY-MM-DD format
function getTodayDate() {
    return new Date().toISOString().split('T')[0];
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
async function getTodayPeakmealByNik(pool, nik, date) {
    const query = `
        SELECT TOP 1
            nik,
            nama_lengkap,
            tanggal_peakmeal,
            lokasi_pengantaran,
            status,
            jenis_pengajuan
        FROM dbo.vw_peakmeal_harian
        WHERE nik = @nik
          AND CAST(tanggal_peakmeal AS DATE) = CAST(@date AS DATE)
        ORDER BY updated_at DESC, created_at DESC
    `;

    const request = pool.request();
    request.input('nik', nik);
    request.input('date', date);
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

// Check if already scanned
async function hasAlreadyScanned(pool, nik, date, sesi) {
    const query = `
        SELECT TOP 1 pid FROM tbl_m_pengunjung_kantin 
        WHERE nik = @nik AND CAST(tanggal AS DATE) = CAST(@date AS DATE) AND sesi_makan = @sesi
    `;
    
    const request = pool.request();
    request.input('nik', nik);
    request.input('date', date);
    request.input('sesi', sesi);
    const result = await request.query(query);
    
    return result.recordset.length > 0;
}

// Insert scan record
async function recordScan(pool, nik, date, sesi, time, status = 'SUCCESS') {
    const query = `
        INSERT INTO tbl_m_pengunjung_kantin (nik, tanggal, status, time, sesi_makan, created_at)
        VALUES (@nik, @date, @status, @time, @sesi, GETDATE())
    `;
    
    const request = pool.request();
    request.input('nik', nik);
    request.input('date', date);
    request.input('status', status);
    request.input('time', time);
    request.input('sesi', sesi);
    
    await request.query(query);
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

// Get scan history for today
async function getScanHistory(pool, limit = 50) {
    const query = `
        SELECT TOP ${limit} 
            p.nik,
            ISNULL(k.nama_lengkap, '') AS nama_lengkap,
            ISNULL(k.nama_perusahaan, '') AS nama_perusahaan,
            ISNULL(k.departemen, '') AS depart,
            p.time,
            p.sesi_makan,
            p.status
        FROM tbl_m_pengunjung_kantin p
        LEFT JOIN dbo.vw_karyawan_kantin_scan k ON p.nik = k.nik
        WHERE CAST(p.tanggal AS DATE) = CAST(GETDATE() AS DATE)
        ORDER BY p.time DESC
    `;
    
    const result = await executeQuery(pool, query);
    return result;
}

module.exports = {
    executeQuery,
    getCurrentMealSession,
    getTodayDate,
    getVisitorCounts,
    getEmployeeFromKantinView,
    getTodayPeakmealByNik,
    getTodayRosterByNik,
    hasAlreadyScanned,
    recordScan,
    getMealPlan,
    getMenuImages,
    getAppSettings,
    saveSettings,
    getScanHistory
};
