# HR SYSTEM INTEGRATION - Panduan Lengkap

## 📡 DUA PENDEKATAN INTEGRASI

### Option 1: API HR Kantin (REKOMENDASI - Lebih Simple)
```
Endpoint: https://indexsafemission_api.indexim.id/api/MinePermit/kantin/scan/{no_nik}
Method: GET
Response: Employee data lengkap
```

**Kelebihan:**
- ✅ Simple, no database link needed
- ✅ Real-time data dari HR system
- ✅ Automatic employee lookup saat scan
- ✅ Permit status check bisa langsung

**Kekurangan:**
- ⚠️ Butuh internet connection
- ⚠️ Slower than local database

---

### Option 2: SQL View dari ONE_DB_MITRA
```
Database: ONE_DB_MITRA
View: dbo.vw_m_karyawan_aktif
```

**Kelebihan:**
- ✅ Fast, data local
- ✅ Works offline
- ✅ Bisa sync berkala

**Kekurangan:**
- ⚠️ Need SQL Server link setup
- ⚠️ Manual sync required
- ⚠️ Data might be stale

---

## 🔄 RECOMMENDED: HYBRID APPROACH

**Strategi Terbaik:**

```
SCAN BARCODE (no_nik)
    ↓
1. Check DB_KANTIN.tbl_m_karyawan (cache)
    ├─ If FOUND → Use local data (fast)
    └─ If NOT FOUND → Call API
        ↓
2. API: /api/MinePermit/kantin/scan/{no_nik}
    ├─ If SUCCESS → INSERT to DB_KANTIN, Use data
    └─ If FAIL → Show error

3. Setiap jam/hari → Sync API → Update local cache
```

**Keuntungan:**
- ✅ Fast (use cache)
- ✅ Works offline (with cached data)
- ✅ Real-time (sync regularly)
- ✅ Fallback if API down

---

## 🗄️ UPDATED DATABASE SCHEMA

### New tbl_m_karyawan Fields

```sql
-- From API Response
no_nik                    -- Scan barcode
nama_lengkap             -- Employee name
tanggal_lahir            -- DOB
jenis_kelamin            -- MALE/FEMALE
email_pribadi            -- Personal email
hp_1                     -- Phone number

-- From HR Organization
id_perusahaan            -- Company ID
nama_perusahaan          -- Company name
id_departemen            -- Department ID
depart                   -- Department name
level                    -- FOREMAN/OFFICER/dll
posisi                   -- Job title
lokasi_kerja             -- Work location

-- Status & Dates
date_of_hire             -- DOH (tanggal masuk)
tanggal_aktif            -- Active since
status_aktif             -- 1=Aktif, 0=Non-aktif
status_aktif_raw         -- Raw status dari HR

-- Mine Permit (Khusus PT INDEXIM)
permit_tanggal_terakhir  -- Permit last update
permit_berakhir_kerja    -- Permit expiry date
is_blacklist_aktif       -- Blacklist status

-- Audit
last_sync_hr             -- Last sync dari HR View
last_sync_api            -- Last sync dari API
source_system            -- 'HR_API' / 'HR_VIEW' / 'MANUAL'
```

---

## 🔌 INTEGRATION IMPLEMENTATION

### A. NODEJS API HELPER FUNCTIONS

File: `src/hr-integration.js`

```javascript
const axios = require('axios');
const sql = require('mssql');

const HR_API_BASE = 'https://indexsafemission_api.indexim.id';
const KANTIN_SCAN_ENDPOINT = '/api/MinePermit/kantin/scan';

/**
 * Scan employee dari API HR
 * @param {string} noNik - Nomor NIK karyawan
 * @returns {Promise<object>} Employee data
 */
async function scanEmployeeFromAPI(noNik) {
    try {
        const response = await axios.get(
            `${HR_API_BASE}${KANTIN_SCAN_ENDPOINT}/${noNik}`
        );
        
        if (response.data.status === 200) {
            const employeeData = response.data.data[0];
            return {
                success: true,
                data: employeeData,
                source: 'HR_API'
            };
        } else {
            return {
                success: false,
                error: response.data.message,
                source: 'HR_API'
            };
        }
    } catch (error) {
        console.error('API Error:', error.message);
        return {
            success: false,
            error: error.message,
            source: 'HR_API'
        };
    }
}

/**
 * Get employee dari local database
 * @param {object} pool - SQL pool
 * @param {string} noNik - Nomor NIK
 * @returns {Promise<object>} Employee data atau null
 */
async function getEmployeeFromDB(pool, noNik) {
    try {
        const request = pool.request();
        request.input('noNik', sql.NVarChar(50), noNik);
        
        const result = await request.query(`
            SELECT TOP 1
                no_nik,
                nama_lengkap,
                nama_perusahaan,
                depart,
                level,
                posisi,
                status_aktif,
                permit_berakhir_kerja,
                last_sync_api
            FROM tbl_m_karyawan
            WHERE no_nik = @noNik AND status_aktif = 1
        `);
        
        return result.recordset.length > 0 ? result.recordset[0] : null;
    } catch (error) {
        console.error('DB Query Error:', error.message);
        return null;
    }
}

/**
 * Sync employee data dari API ke database
 * @param {object} pool - SQL pool
 * @param {object} employeeData - Data dari API
 */
async function syncEmployeeToDB(pool, employeeData) {
    try {
        const request = pool.request();
        
        request.input('noNik', sql.NVarChar(50), employeeData.noNik);
        request.input('namaLengkap', sql.NVarChar(255), employeeData.namaLengkap);
        request.input('tglLahir', sql.DateTime2, employeeData.tglLahir);
        request.input('doh', sql.DateTime2, employeeData.doh);
        request.input('idPerusahaan', sql.Int, employeeData.idPerusahaan);
        request.input('namaPerusahaan', sql.NVarChar(255), employeeData.namaPerusahaan);
        request.input('idDepartment', sql.Int, employeeData.idDepartment);
        request.input('depart', sql.NVarChar(100), employeeData.depart);
        request.input('level', sql.NVarChar(100), employeeData.level);
        request.input('posisi', sql.NVarChar(255), employeeData.posisi);
        
        // MERGE: Insert jika baru, Update jika sudah ada
        const query = `
            MERGE tbl_m_karyawan AS target
            USING (SELECT @noNik AS no_nik) AS source
            ON target.no_nik = source.no_nik
            WHEN MATCHED THEN
                UPDATE SET
                    nama_lengkap = @namaLengkap,
                    tanggal_lahir = @tglLahir,
                    date_of_hire = @doh,
                    id_perusahaan = @idPerusahaan,
                    nama_perusahaan = @namaPerusahaan,
                    id_departemen = @idDepartment,
                    depart = @depart,
                    level = @level,
                    posisi = @posisi,
                    status_aktif = 1,
                    status_aktif_raw = 'AKTIF',
                    last_sync_api = GETDATE(),
                    source_system = 'HR_API',
                    updated_at = GETDATE()
            WHEN NOT MATCHED THEN
                INSERT (no_nik, nama_lengkap, tanggal_lahir, date_of_hire, 
                        id_perusahaan, nama_perusahaan, id_departemen, depart,
                        level, posisi, status_aktif, status_aktif_raw,
                        last_sync_api, source_system, created_at, updated_at)
                VALUES (@noNik, @namaLengkap, @tglLahir, @doh,
                        @idPerusahaan, @namaPerusahaan, @idDepartment, @depart,
                        @level, @posisi, 1, 'AKTIF',
                        GETDATE(), 'HR_API', GETDATE(), GETDATE());
        `;
        
        await request.query(query);
        console.log(`Employee ${employeeData.noNik} synced to DB`);
    } catch (error) {
        console.error('Sync Error:', error.message);
    }
}

/**
 * SCANNING WORKFLOW: Hybrid approach
 * @param {object} pool - SQL pool
 * @param {string} noNik - Nomor NIK yang di-scan
 */
async function processEmployeeScan(pool, noNik) {
    try {
        // Step 1: Check local database first (faster)
        console.log(`[SCAN] Checking local DB for ${noNik}...`);
        let employee = await getEmployeeFromDB(pool, noNik);
        
        if (employee) {
            console.log(`[SCAN] Found in DB - ${employee.nama_lengkap}`);
            
            // Check if data is fresh (synced within 24 hours)
            const lastSyncTime = new Date(employee.last_sync_api);
            const hoursSinceSync = (Date.now() - lastSyncTime) / (1000 * 60 * 60);
            
            if (hoursSinceSync < 24) {
                // Data masih fresh, gunakan langsung
                return {
                    success: true,
                    employee: employee,
                    fromCache: true
                };
            }
            
            console.log(`[SCAN] Data stale (${hoursSinceSync.toFixed(1)} hours), refreshing from API...`);
        }
        
        // Step 2: Call API (if not in DB or data stale)
        console.log(`[SCAN] Calling API for ${noNik}...`);
        const apiResult = await scanEmployeeFromAPI(noNik);
        
        if (!apiResult.success) {
            // API failed - return cached data if available
            if (employee) {
                console.log(`[SCAN] API failed, using cached data`);
                return {
                    success: true,
                    employee: employee,
                    fromCache: true,
                    warning: 'Using cached data - API unavailable'
                };
            }
            
            return {
                success: false,
                error: apiResult.error,
                message: 'Employee not found and API unavailable'
            };
        }
        
        // Step 3: Sync to database
        console.log(`[SCAN] Syncing to DB...`);
        const employeeData = apiResult.data;
        await syncEmployeeToDB(pool, employeeData);
        
        // Return API data
        return {
            success: true,
            employee: employeeData,
            fromCache: false
        };
        
    } catch (error) {
        console.error('[SCAN] Error:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = {
    scanEmployeeFromAPI,
    getEmployeeFromDB,
    syncEmployeeToDB,
    processEmployeeScan
};
```

---

### B. INTEGRATION KE EXISTING SCANNING ENDPOINT

File: `src/main.js` - Update `/api/scan` endpoint

```javascript
const hrIntegration = require('./hr-integration');

// Update existing /api/scan endpoint
app.post('/api/scan', async (req, res) => {
    const { nik } = req.body;
    
    try {
        // Process scan dengan HR integration
        const scanResult = await hrIntegration.processEmployeeScan(pool, nik);
        
        if (!scanResult.success) {
            return res.status(404).json({
                status: 'error',
                message: scanResult.error || 'Employee not found'
            });
        }
        
        const employee = scanResult.employee;
        
        // Get current meal session
        const currentSession = await getCurrentMealSession(pool);
        const today = getTodayDate();
        
        // Check if already scanned this session
        const alreadyScanned = await hasAlreadyScanned(pool, nik, today, currentSession);
        
        if (alreadyScanned) {
            return res.status(400).json({
                status: 'already_scanned',
                message: `${employee.nama_lengkap || employee.namaLengkap} already scanned for ${currentSession}`,
                employee: {
                    nik: employee.noNik || employee.no_nik,
                    name: employee.namaLengkap || employee.nama_lengkap,
                    department: employee.depart,
                    level: employee.level,
                    permitExpiry: employee.permit_berakhir_kerja
                }
            });
        }
        
        // Record the scan
        const scanTime = new Date().toTimeString().split(' ')[0];
        await recordScan(pool, nik, today, currentSession, scanTime, 'SUCCESS');
        
        res.status(200).json({
            status: 'success',
            message: `${employee.nama_lengkap || employee.namaLengkap} successfully scanned`,
            employee: {
                nik: employee.noNik || employee.no_nik,
                name: employee.namaLengkap || employee.nama_lengkap,
                company: employee.namaPerusahaan || employee.nama_perusahaan,
                department: employee.depart,
                level: employee.level || 'N/A',
                position: employee.posisi || employee.nama_posisi,
                permitExpiry: employee.permit_berakhir_kerja
            },
            session: currentSession,
            fromCache: scanResult.fromCache,
            timestamp: new Date()
        });
        
    } catch (error) {
        console.error('Scan error:', error);
        res.status(500).json({
            status: 'error',
            message: 'Internal server error'
        });
    }
});
```

---

### C. PERIODIC SYNC TASK

```javascript
// Sync semua karyawan dari API setiap jam
const cron = require('node-cron');

// Setiap jam (cron: '0 * * * *')
cron.schedule('0 * * * *', async () => {
    console.log('[SYNC] Starting hourly employee sync...');
    
    try {
        // Get list of active employees from local DB
        const request = pool.request();
        const result = await request.query(`
            SELECT DISTINCT no_nik
            FROM tbl_m_karyawan
            WHERE status_aktif = 1 
            AND source_system = 'HR_API'
            LIMIT 100
        `);
        
        // Refresh each employee from API
        for (const emp of result.recordset) {
            const apiResult = await hrIntegration.scanEmployeeFromAPI(emp.no_nik);
            if (apiResult.success) {
                await hrIntegration.syncEmployeeToDB(pool, apiResult.data);
            }
        }
        
        console.log(`[SYNC] Completed - ${result.recordset.length} employees updated`);
        
    } catch (error) {
        console.error('[SYNC] Error:', error.message);
    }
});
```

---

## 📦 SETUP INSTRUCTIONS

### 1. Install node-cron (untuk periodic sync)
```bash
npm install axios node-cron
```

### 2. Add hr-integration.js to project
```
Lokasi: src/hr-integration.js
Copy isi file dari section A di atas
```

### 3. Update main.js
- Import module: `const hrIntegration = require('./hr-integration');`
- Replace `/api/scan` endpoint (dari section B)
- Add cron job untuk sync (dari section C)

### 4. Update database dengan extended schema
```bash
1. Jalankan: UPDATE_KARYAWAN_WITH_HR_INTEGRATION.sql
2. Existing data tetap intact
3. New fields sudah ready untuk HR data
```

### 5. Test Integration
```bash
npm start

# Test scan dengan curl
curl -X POST http://localhost:3001/api/scan \
  -H "Content-Type: application/json" \
  -d '{"nik":"24011010924"}'

# Response:
{
    "status": "success",
    "message": "RIDWAN ASZHAR successfully scanned",
    "employee": {
        "nik": "24011010924",
        "name": "RIDWAN ASZHAR",
        "company": "PT INDEXIM COALINDO",
        "department": "COMPLIANCE & CONTROL",
        "level": "FOREMAN/OFFICER",
        "position": "OFFICER INTERNAL CONTROL GENERAL ADMINISTRATION",
        "permitExpiry": "2024-XX-XX"
    },
    "session": "MAKAN PAGI",
    "fromCache": false
}
```

---

## 🎯 WORKFLOW SUMMARY

```
Barcode Scan (no_nik)
    ↓
API: /api/scan
    ↓
1. Check tbl_m_karyawan (fast cache)
    ├─ Found & Fresh (< 24h) → Return ✓
    └─ Not found or Stale → Continue
    ↓
2. Call API: /api/MinePermit/kantin/scan/{no_nik}
    ├─ Success → MERGE to DB + Return ✓
    └─ Fail + Have cache → Use cache ✓
    └─ Fail + No cache → Error ✗
    ↓
3. Record scan di tbl_m_pengunjung_kantin
    ↓
4. Hourly sync task update permit & status data
```

---

## ⚠️ CONSIDERATIONS

### Permit Expiry Check
```javascript
// Tambahkan check di response jika permit sudah mau expired
if (employee.permit_berakhir_kerja) {
    const daysLeft = Math.ceil(
        (new Date(employee.permit_berakhir_kerja) - new Date()) / (1000*60*60*24)
    );
    
    if (daysLeft < 7) {
        response.warning = `Permit expires in ${daysLeft} days`;
    }
}
```

### Blacklist Check
```javascript
// Cek jika karyawan di-blacklist
if (scanResult.employee.is_blacklist_aktif === 1) {
    return res.status(403).json({
        status: 'blacklisted',
        message: 'Employee is blacklisted',
        employee: scanResult.employee
    });
}
```

### Offline Mode
- If API down → Use cached data (set last_sync_api < 24 hours)
- Periodically sync when online via cron task

---

## 📊 MONITORING

### Check sync status
```sql
SELECT 
    no_nik,
    nama_lengkap,
    source_system,
    last_sync_api,
    DATEDIFF(HOUR, last_sync_api, GETDATE()) as hours_since_sync
FROM tbl_m_karyawan
ORDER BY last_sync_api DESC
LIMIT 20;
```

### Check pending syncs
```sql
SELECT COUNT(*) as stale_records
FROM tbl_m_karyawan
WHERE last_sync_api < DATEADD(DAY, -1, GETDATE())
AND source_system = 'HR_API';
```

---

**Status:** ✅ HR Integration ready to implement
**Approach:** Hybrid (Cache + API)
**Performance:** Fast (local cache first)
**Reliability:** Fallback to cache if API down
