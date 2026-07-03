import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'path'
import { ensureBootstrap } from './auth/auth'
import { backupNow } from './backup'
import { migrate, openDb } from './data/db'
import { seedReferenceData } from './data/seed'
import { dbPath, migrationsFolder } from './paths'
import { backfillAccountCodes } from './services/accounts'
import { registerIpc } from './ipc'

function initDb(): void {
  openDb(dbPath())
  migrate(migrationsFolder())
  seedReferenceData()
  ensureBootstrap() // default admin + current calendar year on first run (no lockout)
  backfillAccountCodes() // assign numbers to any accounts created before this feature
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

  // Hardening: the app is a self-contained SPA. Never let the renderer spawn child windows or
  // navigate to another origin — both can only be injection/abuse. External links (if any are
  // ever added) open in the user's real browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const appOrigin = process.env['ELECTRON_RENDERER_URL'] ?? 'file://'
    if (!url.startsWith(appOrigin)) event.preventDefault()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  initDb()

  // Automatic on-open backup (software.md §5). A failure (folder deleted, drive unplugged) must
  // not stop the accountant from working — warn loudly and carry on. No-op before first-run setup.
  try {
    backupNow('open')
  } catch (e) {
    dialog.showErrorBox(
      'Backup failed',
      `Could not copy the database to the backup folder:\n${(e as Error).message}\n\n` +
        'The app will still open. Fix the backup folder from the Backup page.'
    )
  }

  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// The matching on-quit backup. Errors only logged — a dialog here would trap the user in a
// half-quit app; the on-open backup surfaces a broken folder the next time they start.
app.on('before-quit', () => {
  try {
    backupNow('quit')
  } catch (e) {
    console.error('quit-time backup failed:', e)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
