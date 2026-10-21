import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { Store } from '../persistence'
import { resolveDesktopAuthorizedPath } from '../ipc/local-file-access-resolution'
import { saveDroppedImageFileInRuntime } from './dropped-image-runtime-upload'
import { isTrustedClipboardRenderer } from './clipboard-trust'

type SaveImageFileRequest = {
  filePath: string
  runtimeEnvironmentId: string
}

function normalizeSaveImageFileRequest(args: unknown): SaveImageFileRequest | null {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return null
  }
  const filePath = (args as { filePath?: unknown }).filePath
  const runtimeEnvironmentId = (args as { runtimeEnvironmentId?: unknown }).runtimeEnvironmentId
  if (
    typeof filePath !== 'string' ||
    filePath === '' ||
    typeof runtimeEnvironmentId !== 'string' ||
    runtimeEnvironmentId.trim() === ''
  ) {
    return null
  }
  return { filePath, runtimeEnvironmentId }
}

function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (!isTrustedClipboardRenderer(event.sender)) {
    throw new Error('Unauthorized clipboard IPC sender')
  }
}

// Why: a file dropped onto a remote terminal chat would otherwise be refused —
// the agent can't read this machine's paths. Uploading the bytes through the
// same runtime temp pipeline a remote clipboard paste uses gives it a path it
// can read, with no orcad change.
export function registerDroppedImageFileHandlers(store: Store): void {
  ipcMain.removeHandler('clipboard:saveImageFileAsTempFile')
  ipcMain.handle(
    'clipboard:saveImageFileAsTempFile',
    async (event, args: unknown): Promise<string> => {
      assertTrustedSender(event)
      const request = normalizeSaveImageFileRequest(args)
      if (!request) {
        throw new Error('Invalid image file upload request')
      }
      const authorizedPath = await resolveDesktopAuthorizedPath(request.filePath, store)
      return saveDroppedImageFileInRuntime(
        app.getPath('userData'),
        request.runtimeEnvironmentId,
        authorizedPath
      )
    }
  )
}

export function unregisterDroppedImageFileHandlers(): void {
  ipcMain.removeHandler('clipboard:saveImageFileAsTempFile')
}
