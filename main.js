const { app, BrowserWindow, desktopCapturer, ipcMain, screen, globalShortcut, systemPreferences, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

let mainWindow;
let previewWindow;
let cursorTracker = null;
let cursorData = [];
let recordingStartTime = 0;

let originalCursorSize = null;

// Cursor hiding is disabled for now - it causes app crashes.
// The custom cursor in the editor replaces the original visually.
function showCursorHider() {
  console.log('Cursor hiding: skipped (using editor custom cursor instead)');
}

function hideCursorHider() {
  console.log('Cursor restore: skipped');
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 620,
    resizable: false,
    alwaysOnTop: true,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a2e',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile('index.html');

  if (process.platform === 'darwin') {
    const screenStatus = systemPreferences.getMediaAccessStatus('screen');
    console.log('Screen recording permission:', screenStatus);
    // Request mic permission
    systemPreferences.askForMediaAccess('microphone').then((granted) => {
      console.log('Microphone permission:', granted ? 'granted' : 'denied');
    });
    // Request camera permission
    systemPreferences.askForMediaAccess('camera').then((granted) => {
      console.log('Camera permission:', granted ? 'granted' : 'denied');
    });
  }
}

function startCursorTracking() {
  cursorData = [];
  recordingStartTime = Date.now();
  // Use bounds (includes position for multi-monitor) with correct coordinates
  const primaryDisplay = screen.getPrimaryDisplay();
  const bounds = primaryDisplay.bounds;

  cursorTracker = setInterval(() => {
    const point = screen.getCursorScreenPoint();
    // Normalize relative to the display bounds
    cursorData.push({
      t: Date.now() - recordingStartTime,
      x: (point.x - bounds.x) / bounds.width,
      y: (point.y - bounds.y) / bounds.height,
    });
  }, 33);
}

function stopCursorTracking() {
  if (cursorTracker) {
    clearInterval(cursorTracker);
    cursorTracker = null;
  }
  return cursorData;
}

function createPreviewWindow(data) {
  previewWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f0f23',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  previewWindow.loadFile('preview.html');
  previewWindow.webContents.once('did-finish-load', () => {
    previewWindow.webContents.send('load-video', data);
  });
  previewWindow.webContents.on('crashed', (e) => {
    console.error('Preview window crashed:', e);
  });
  previewWindow.webContents.on('render-process-gone', (e, details) => {
    console.error('Preview render process gone:', details);
  });
  // Log renderer console to main process
  previewWindow.webContents.on('console-message', (e, level, msg) => {
    console.log('[Preview]', msg);
  });

  previewWindow.on('closed', () => {
    console.log('Preview window closed');
    previewWindow = null;
  });
  previewWindow.on('unresponsive', () => {
    console.error('Preview window unresponsive');
  });
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    const { nativeImage } = require('electron');
    const iconPath = path.join(__dirname, 'icon.png');
    try { app.dock.setIcon(nativeImage.createFromPath(iconPath)); } catch(e) {}
  }
  createMainWindow();

  ipcMain.handle('get-sources', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
      });
      return sources.map((s) => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL(),
      }));
    } catch (err) {
      console.error('Failed to get sources:', err);
      return [];
    }
  });

  ipcMain.handle('get-screen-size', () => {
    const primaryDisplay = screen.getPrimaryDisplay();
    return primaryDisplay.size;
  });

  ipcMain.on('start-cursor-tracking', (event, options) => {
    startCursorTracking();
    if (options && options.hideCursor) {
      showCursorHider();
    }
  });

  ipcMain.on('stop-cursor-tracking', (event) => {
    try {
      const positions = stopCursorTracking();
      hideCursorHider();
      event.reply('cursor-data', positions);
    } catch (e) {
      console.error('stop-cursor-tracking error:', e);
      event.reply('cursor-data', []);
    }
  });

  ipcMain.handle('save-webcam', async (event, buffer) => {
    try {
      const downloadsPath = app.getPath('downloads');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filePath = path.join(downloadsPath, `octo-webcam-${timestamp}.webm`);
      fs.writeFileSync(filePath, Buffer.from(buffer));
      console.log('Webcam saved:', filePath, 'size:', buffer.byteLength);
      return filePath;
    } catch (e) {
      console.error('save-webcam error:', e);
      throw e;
    }
  });

  ipcMain.handle('save-video', async (event, buffer) => {
    try {
      const downloadsPath = app.getPath('downloads');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filePath = path.join(downloadsPath, `octo-capture-${timestamp}.webm`);
      fs.writeFileSync(filePath, Buffer.from(buffer));
      console.log('Video saved:', filePath, 'size:', buffer.byteLength);
      return filePath;
    } catch (e) {
      console.error('save-video error:', e);
      throw e;
    }
  });

  ipcMain.handle('save-video-dialog', async (event, defaultName) => {
    const ext = (defaultName || '').split('.').pop() || 'webm';
    const filterMap = {
      gif: [{ name: 'GIF Image', extensions: ['gif'] }],
      mp4: [{ name: 'MP4 Video', extensions: ['mp4'] }],
      mov: [{ name: 'MOV Video', extensions: ['mov'] }],
      webm: [{ name: 'WebM Video', extensions: ['webm'] }],
    };
    const filters = filterMap[ext] || filterMap.webm;
    const result = await dialog.showSaveDialog(previewWindow || mainWindow, {
      title: 'Export',
      defaultPath: path.join(app.getPath('downloads'), defaultName || 'octo-export.webm'),
      filters,
    });
    return result.filePath || null;
  });

  ipcMain.handle('select-folder-dialog', async () => {
    const result = await dialog.showOpenDialog(previewWindow || mainWindow, {
      title: '저장 폴더 선택',
      defaultPath: app.getPath('downloads'),
      properties: ['openDirectory', 'createDirectory'],
    });
    return (result.filePaths && result.filePaths[0]) || null;
  });

  ipcMain.handle('save-image-dialog', async (event, defaultName) => {
    const result = await dialog.showSaveDialog(previewWindow || mainWindow, {
      title: '이미지 저장',
      defaultPath: path.join(app.getPath('downloads'), defaultName || 'octo-capture.png'),
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
    });
    return result.filePath || null;
  });

  ipcMain.handle('write-file', async (event, { filePath, buffer }) => {
    fs.writeFileSync(filePath, Buffer.from(buffer));
    return true;
  });

  // Find ffmpeg binary
  function findFfmpeg() {
    const candidates = [
      'ffmpeg',
      '/usr/local/bin/ffmpeg',
      '/opt/homebrew/bin/ffmpeg',
      '/usr/bin/ffmpeg',
      path.join(process.resourcesPath || '', 'ffmpeg'),
      // Windows paths
      'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
      path.join(process.resourcesPath || '', 'ffmpeg.exe'),
    ];
    for (const p of candidates) {
      try { execSync(`"${p}" -version`, { stdio: 'ignore' }); return p; } catch(e) {}
    }
    return null;
  }

  // Convert WebM to MP4/MOV using ffmpeg
  ipcMain.handle('convert-video', async (event, { inputPath, outputPath, format, quality }) => {
    const { execFile } = require('child_process');
    const ffmpegPath = findFfmpeg();
    if (!ffmpegPath) {
      throw new Error('ffmpeg를 찾을 수 없습니다. brew install ffmpeg로 설치해주세요.');
    }
    // quality: 'high' (crf 18), 'medium' (crf 23), 'low' (crf 32)
    const crfMap = { high: '18', medium: '23', low: '32' };
    const crf = crfMap[quality] || '23';
    const args = ['-y', '-i', inputPath];
    if (format === 'mov') {
      args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', crf,
                '-c:a', 'aac', '-b:a', '128k',
                '-f', 'mov', '-movflags', '+faststart');
    } else {
      args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', crf,
                '-c:a', 'aac', '-b:a', '128k',
                '-movflags', '+faststart');
    }
    args.push(outputPath);
    return new Promise((resolve, reject) => {
      execFile(ffmpegPath, args, (err, stdout, stderr) => {
        if (err) {
          console.error('ffmpeg error:', stderr);
          reject(err.message);
        } else {
          console.log(`${format.toUpperCase()} conversion done:`, outputPath);
          resolve(outputPath);
        }
      });
    });
  });

  // Legacy handler for backwards compat
  ipcMain.handle('convert-to-mp4', async (event, { inputPath, outputPath }) => {
    const { execFile } = require('child_process');
    const ffmpegPath = findFfmpeg();
    if (!ffmpegPath) throw new Error('ffmpeg not found');
    return new Promise((resolve, reject) => {
      execFile(ffmpegPath, [
        '-y', '-i', inputPath,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        outputPath
      ], (err, stdout, stderr) => {
        if (err) { console.error('ffmpeg error:', stderr); reject(err.message); }
        else { resolve(outputPath); }
      });
    });
  });

  ipcMain.on('open-preview', (event, data) => {
    createPreviewWindow(data);
  });

  ipcMain.on('open-screen-settings', () => {
    if (process.platform === 'darwin') {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
    } else if (process.platform === 'win32') {
      shell.openExternal('ms-settings:privacy-broadfilesystemaccess');
    }
  });

  ipcMain.on('open-camera-settings', () => {
    if (process.platform === 'darwin') {
      shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Camera');
    } else if (process.platform === 'win32') {
      shell.openExternal('ms-settings:privacy-webcam');
    }
  });

  globalShortcut.register('CommandOrControl+Shift+R', () => {
    if (mainWindow) {
      mainWindow.webContents.send('toggle-recording');
      mainWindow.show();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  hideCursorHider(); // Always restore cursor on quit
});

// Safety: restore cursor if app crashes
process.on('exit', hideCursorHider);
process.on('SIGINT', () => { hideCursorHider(); process.exit(); });
process.on('uncaughtException', (err) => { hideCursorHider(); console.error(err); process.exit(1); });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
});
