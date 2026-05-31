const { contextBridge, ipcRenderer } = require('electron');

/**
 * contextBridge adalah modul Electron yang aman untuk mengekspos API dari proses Main (backend)
 * ke proses Renderer (frontend) tanpa membocorkan fungsionalitas Node.js yang sensitif.
 * * Di sini, kita membuat objek global `window.api` yang bisa diakses di renderer.js.
 */
contextBridge.exposeInMainWorld('api', {
    // Fungsi untuk memanggil endpoint di backend menggunakan metode GET
    get: (url) => fetch(`http://localhost:${process.env.SERVER_PORT || 3001}${url}`).then(res => res.json()),

    // Fungsi untuk memanggil endpoint di backend menggunakan metode POST
    post: (url, data) => fetch(`http://localhost:${process.env.SERVER_PORT || 3001}${url}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
    }).then(res => res.json()),

    // Fungsi untuk mengupload file (misalnya gambar atau Excel)
    upload: (url, formData) => fetch(`http://localhost:${process.env.SERVER_PORT || 3001}${url}`, {
        method: 'POST',
        body: formData, // FormData tidak memerlukan header Content-Type, browser akan set otomatis
    }).then(res => res.json()),

    // Upload via IPC (untuk file buffer / local processing di main process)
    uploadWithIpc: (channel, payload) => ipcRenderer.invoke(channel, payload),

    // Fungsi untuk mendownload file (seperti laporan Excel)
    download: async (url) => {
        const response = await fetch(`http://localhost:${process.env.SERVER_PORT || 3001}${url}`);
        if (!response.ok) {
            throw new Error('Network response was not ok.');
        }
        // Mengambil nama file dari header Content-Disposition
        const disposition = response.headers.get('content-disposition');
        let filename = 'laporan.xlsx'; // Default filename
        if (disposition && disposition.indexOf('attachment') !== -1) {
            const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
            const matches = filenameRegex.exec(disposition);
            if (matches != null && matches[1]) {
                filename = matches[1].replace(/['"]/g, '');
            }
        }

        const blob = await response.blob();
        return { blob, filename };
    },

    // Memberi tahu proses Main untuk menyimpan file yang di-download
    saveFile: (filename, blob) => {
        const reader = new FileReader();
        reader.onload = function() {
            const buffer = Buffer.from(reader.result);
            ipcRenderer.send('save-dialog', { filename, buffer });
        };
        reader.readAsArrayBuffer(blob);
    }
});

// Listener untuk membuka dialog error dari proses Main
ipcRenderer.on('show-error-dialog', (event, { title, content }) => {
    dialog.showErrorBox(title, content);
});

// Menambahkan listener di proses Main untuk menangani penyimpanan file
// Ini harus ada di main.js, tapi kita bisa memicunya dari sini.
// Pastikan Anda menambahkan kode ini di main.js:
/*
ipcMain.on('save-dialog', (event, { filename, buffer }) => {
    dialog.showSaveDialog({
        title: 'Simpan Laporan Excel',
        defaultPath: filename,
        filters: [{ name: 'Excel Files', extensions: ['xlsx'] }]
    }).then(result => {
        if (!result.canceled && result.filePath) {
            require('fs').writeFileSync(result.filePath, buffer);
        }
    });
});
*/
