# Kantin Digital Dashboard - Professional Edition

## Overview
Aplikasi desktop Electron untuk manajemen kantin digital dengan UI/UX modern dan professional.

## Tech Stack
- **Frontend**: Electron, Tailwind CSS, Vanilla JavaScript
- **Backend**: Express.js, Node.js
- **Database**: SQL Server 2019+
- **Architecture**: Desktop App with Built-in Web Server

## Setup Instructions

### 1. Prerequisites
- Node.js v16+ dan npm
- SQL Server 2019 atau lebih baru
- Windows/Linux/macOS

### 2. Database Setup

#### Create Database & Tables
```sql
-- Di SQL Server Management Studio (SSMS), jalankan:
-- 1. Buat database baru
CREATE DATABASE DB_KANTIN;

-- 2. Gunakan database
USE DB_KANTIN;

-- 3. Jalankan schema dari file: database/schema.sql
-- Copy-paste semua script dari database/schema.sql ke SSMS
```

#### Connection Details
- **Server**: 172.16.1.93
- **Database**: DB_KANTIN
- **User**: sa
- **Password**: technical.indexim.123

### 3. Installation & Setup

```bash
# 1. Navigate to project directory
cd "d:\4. PROJECT\14. Web\Kantin"

# 2. Install dependencies
npm install

# 3. Verify environment file
# Check .env file is configured correctly:
DB_SERVER=172.16.1.93
DB_USER=sa
DB_PASSWORD=technical.indexim.123
DB_DATABASE=DB_KANTIN
DB_PORT=1433
SERVER_PORT=3001

# 4. Start the application
npm run start
```

## Project Structure
```
Kantin/
├── src/
│   ├── main.js              # Electron main process
│   ├── preload.js           # Security preload script
│   └── renderer/
│       ├── index.html       # Main UI
│       ├── renderer.js      # Frontend logic
│       └── style.css        # Styling (Premium Design)
├── database/
│   └── schema.sql           # SQL Server schema
├── uploads/                 # Image storage
├── .env                     # Configuration
└── package.json             # Dependencies
```

## API Endpoints
- `GET /api/dashboard-data` - Get dashboard info
- `POST /api/scan` - Process barcode scan
- `GET /api/meal-plans?tanggal=YYYY-MM-DD` - Get meal plans
- `POST /api/meal-plan` - Create/update meal plan
- `GET /api/scan-history` - Get today's scan history
- `GET /api/download-report` - Download Excel report
- `POST /api/settings` - Update app settings

## Database Tables
1. **tbl_m_jam_makan** - Meal times (breakfast, lunch, dinner)
2. **tbl_m_karyawan** - Employee master data
3. **tbl_m_pengunjung_kantin** - Visitor transaction records
4. **tbl_m_meal_plan** - Daily meal plans
5. **tbl_m_image_menu** - Menu images
6. **tbl_m_setting_aplikasi** - App settings

## Migration from PostgreSQL to SQL Server

### Key Changes Made:
1. ✅ Replaced `pg` driver with `mssql`
2. ✅ Updated connection configuration
3. ✅ Created SQL Server schema (T-SQL)
4. ✅ Updated .env variables
5. ⏳ Need to update query methods in API endpoints

### Query Migration Notes:
- PostgreSQL: `$1, $2...` → SQL Server: `@param1, @param2...`
- Parameterized queries differ slightly
- Use `mssql` driver's request object

## UI/UX Improvements

### New Features:
- Modern gradient color scheme (Purple to Pink)
- Animated blob background
- Glass morphism effect with blur
- Smooth animations & transitions
- Premium shadows & glow effects
- Responsive design
- Improved typography
- Status badges & icons
- Professional card components

### Colors:
- **Primary**: #667eea (Purple)
- **Accent**: #f97316 (Orange)
- **Success**: #10b981 (Green)
- **Error**: #ef4444 (Red)

## Troubleshooting

### Database Connection Issues:
```
Error: "Tidak dapat terhubung ke SQL Server"
→ Check server IP (172.16.1.93) is reachable
→ Verify sa user credentials
→ Ensure DB_KANTIN database exists
→ Check SQL Server firewall settings (port 1433)
```

### Missing Dependencies:
```
npm install
```

### Port Conflicts:
If port 3001 is in use, update `.env`:
```
SERVER_PORT=3002
```

## Development

### Running in Development Mode:
```bash
npm run start
```

### Building Distribution:
(Will be added in future)

## Next Steps for Development:
1. ✅ Basic UI/UX upgrade
2. ✅ Database schema creation
3. ⏳ Update all API query methods for SQL Server
4. ⏳ Add SQL Server connection pooling improvements
5. ⏳ Test all endpoints with real data
6. ⏳ Add error handling & logging
7. ⏳ Create employee views from user requirements
8. ⏳ Performance optimization

## Notes for Team:
- Employee data views will be created after basic setup
- Database already supports future expansion for HR integration
- UI is now professional and scalable
- All components are reusable and maintainable

## Support
For issues or questions, refer to the setup instructions above.

Last Updated: May 2026
