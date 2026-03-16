const { app, BrowserWindow, desktopCapturer, ipcMain, screen, globalShortcut, systemPreferences, dialog } = require('electron');
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

  ipcMain.handle('write-file', async (event, { filePath, buffer }) => {
    fs.writeFileSync(filePath, Buffer.from(buffer));
    return true;
  });

  // Convert WebM to MP4 using ffmpeg
  ipcMain.handle('convert-to-mp4', async (event, { inputPath, outputPath }) => {
    const { execFile } = require('child_process');
    return new Promise((resolve, reject) => {
      execFile('ffmpeg', [
        '-y', '-i', inputPath,
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        outputPath
      ], (err, stdout, stderr) => {
        if (err) {
          console.error('ffmpeg error:', stderr);
          reject(err.message);
        } else {
          console.log('MP4 conversion done:', outputPath);
          resolve(outputPath);
        }
      });
    });
  });

  ipcMain.on('open-preview', (event, data) => {
    createPreviewWindow(data);
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
