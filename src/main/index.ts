import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { ensureBootstrap } from './auth/auth'
import { migrate, openDb } from './data/db'
import { seedReferenceData } from './data/seed'
import { registerIpc } from './ipc'

/** The single SQLite file lives in Electron's per-user data dir. */
function dbPath(): string {
  return join(app.getPath('userData'), 'paritosh.db')
}

/** Generated migrations ship beside the app in prod (extraResources), at the repo root in dev. */
function migrationsFolder(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'drizzle')
    : join(app.getAppPath(), 'drizzle')
}

function initDb(): void {
  openDb(dbPath())
  migrate(migrationsFolder())
  seedReferenceData()
  ensureBootstrap() // default admin + current calendar year on first run (no lockout)
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    title: 'Paritosh Cold',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  initDb()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
