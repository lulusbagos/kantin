/**
 * API ENDPOINTS - SQL Server Version
 * Contoh update endpoint dari PostgreSQL ke SQL Server
 * 
 * NOTE: Ganti bagian-bagian ini di main.js sesuai dengan pola di bawah
 */

// =====================================================================
// CONTOH 1: GET /api/dashboard-data
// =====================================================================
api.get('/api/dashboard-data', async (req, res) => {
    try {
        const db = require('./database-utils');
        
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
        res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
});

// =====================================================================
// CONTOH 2: POST /api/scan
// =====================================================================
api.post('/api/scan', async (req, res) => {
    const { nik } = req.body;
    if (!nik || nik.trim() === '') {
        return res.status(400).json({ status: 'ERROR', message: 'NIK tidak boleh kosong.' });
    }

    try {
        const db = require('./database-utils');
        
        // Get employee
        const karyawan = await db.getEmployeeByNIK(pool, nik);
        if (!karyawan) {
            return res.status(404).json({ status: 'NOT_FOUND', message: 'Data Karyawan Tidak Ditemukan.' });
        }

        // Get current session
        const now = new Date();
        const currentTime = now.toTimeString().split(' ')[0];
        const today = db.getTodayDate();
        const sesiMakan = await db.getCurrentMealSession(pool);
        
        if (sesiMakan === 'DILUAR JAM MAKAN') {
            return res.status(400).json({ status: 'OUT_OF_SESSION', message: 'Di Luar Jam Makan', data: karyawan });
        }

        // Check if already scanned
        const alreadyScanned = await db.hasAlreadyScanned(pool, nik, today, sesiMakan);
        if (alreadyScanned) {
            return res.status(409).json({ status: 'ALREADY_SCANNED', message: `Sudah Scan Untuk ${sesiMakan}`, data: karyawan });
        }

        // Record scan
        await db.recordScan(pool, nik, today, sesiMakan, currentTime);

        res.status(201).json({ status: 'SUCCESS', message: sesiMakan, data: karyawan });

    } catch (err) {
        console.error('Error processing scan:', err);
        res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
});

// =====================================================================
// CONTOH 3: POST /api/settings
// =====================================================================
api.post('/api/settings', async (req, res) => {
    const { nama, description, theme, background, border } = req.body;
    try {
        const db = require('./database-utils');
        
        await db.saveSettings(pool, nama, description, theme, background, border);
        
        res.status(200).json({ message: 'Pengaturan berhasil disimpan.' });
    } catch (error) {
        console.error('Error saving settings:', error);
        res.status(500).json({ error: 'Gagal menyimpan pengaturan.' });
    }
});

// =====================================================================
// CONTOH 4: GET /api/scan-history
// =====================================================================
api.get('/api/scan-history', async (req, res) => {
    try {
        const db = require('./database-utils');
        
        const history = await db.getScanHistory(pool, 50);
        
        res.json(history);
    } catch (error) {
        console.error('Error fetching scan history:', error);
        res.status(500).json({ error: 'Gagal mengambil riwayat scan.' });
    }
});

// =====================================================================
// CONTOH 5: GET /api/meal-plans
// =====================================================================
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
        
        res.json(result.recordset);
    } catch (error) {
        console.error('Error fetching meal plans:', error);
        res.status(500).json({ error: 'Gagal mengambil data meal plan.' });
    }
});

// =====================================================================
// CONTOH 6: POST /api/meal-plan
// =====================================================================
api.post('/api/meal-plan', async (req, res) => {
    const p = req.body;
    try {
        const request = pool.request();
        
        // Input parameters
        request.input('tanggal', p.tanggal);
        request.input('sesi', p.sesi_makan);
        request.input('starch_nama', p.starch_nama);
        request.input('starch_kalori', p.starch_kalori || 0);
        request.input('starch_gram', p.starch_gram || 0);
        // ... tambah parameters lainnya sesuai kebutuhan
        request.input('total_calorie', p.total_calorie || 0);
        
        const query = `
            MERGE tbl_m_meal_plan t
            USING (VALUES (@tanggal, @sesi)) s(tanggal, sesi_makan)
            ON t.tanggal = s.tanggal AND t.sesi_makan = s.sesi_makan
            WHEN MATCHED THEN
                UPDATE SET 
                    starch_nama = @starch_nama,
                    starch_kalori = @starch_kalori,
                    starch_gram = @starch_gram,
                    total_calorie = @total_calorie,
                    updated_at = GETDATE()
            WHEN NOT MATCHED THEN
                INSERT (tanggal, sesi_makan, starch_nama, starch_kalori, starch_gram, total_calorie, created_at)
                VALUES (@tanggal, @sesi, @starch_nama, @starch_kalori, @starch_gram, @total_calorie, GETDATE());
        `;
        
        await request.query(query);
        res.status(201).json({ message: `Meal plan untuk ${p.sesi_makan} berhasil disimpan.` });
    } catch (error) {
        console.error('Error saving meal plan:', error);
        res.status(500).json({ error: 'Gagal menyimpan meal plan.' });
    }
});

// =====================================================================
// MIGRATION NOTES
// =====================================================================

/*
PERBEDAAN ANTARA POSTGRESQL DAN SQL SERVER:

1. PARAMETER BINDING:
   PostgreSQL: $1, $2, $3
   SQL Server: @param1, @param2, @param3

2. LIMIT SYNTAX:
   PostgreSQL: LIMIT 50
   SQL Server: TOP 50

3. DATE/TIME FUNCTIONS:
   PostgreSQL: NOW(), CURRENT_DATE
   SQL Server: GETDATE(), CAST(GETDATE() AS DATE)

4. TYPE CASTING:
   PostgreSQL: $1::text
   SQL Server: CAST(@param AS VARCHAR)

5. MERGE/UPSERT:
   PostgreSQL: INSERT ... ON CONFLICT ... DO UPDATE
   SQL Server: MERGE ... WHEN MATCHED/NOT MATCHED

6. CONCATENATION:
   PostgreSQL: ||
   SQL Server: + (atau CONCAT function)

7. QUERIES STRUCTURE:
   Pool Query (PostgreSQL):
   ```
   pool.query('SELECT * FROM users WHERE id = $1', [id])
   ```
   
   Request Query (SQL Server):
   ```
   const request = pool.request();
   request.input('id', id);
   const result = await request.query('SELECT * FROM users WHERE id = @id');
   ```

STEP-BY-STEP UNTUK UPDATE ENDPOINT:

1. Ganti pool.query() dengan request approach
2. Gunakan request.input() untuk parameters
3. Ganti $1, $2 dengan @param1, @param2
4. Ganti PostgreSQL functions dengan SQL Server equivalents
5. Ganti TOP X daripada LIMIT X
6. Gunakan CAST untuk type conversions
7. Test di SSMS dulu sebelum update di Node.js

DATABASE UTILS YANG SUDAH TERSEDIA:
- executeQuery(pool, queryText, params)
- getCurrentMealSession(pool)
- getTodayDate()
- getVisitorCounts(pool, date)
- getEmployeeByNIK(pool, nik)
- hasAlreadyScanned(pool, nik, date, sesi)
- recordScan(pool, nik, date, sesi, time, status)
- getMealPlan(pool, date, sesi)
- getMenuImages(pool, date)
- getAppSettings(pool)
- saveSettings(pool, nama, description, theme, background, border)
- getScanHistory(pool, limit)

Gunakan utilities ini untuk mempercepat migration!
*/
