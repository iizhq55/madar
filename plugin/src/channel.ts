import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import type { Action } from './types.ts'

export const CHANNEL = 'claude/channel'

/** The request line Claude receives, in the store page's language (English by default). */
export function channelText(a: Action): string {
  const ar = { install: 'ثبّت', uninstall: 'شيل', star: 'نجّم', update: 'حدّث', share: 'شارك' }[a.op]
  const en = { install: 'install', uninstall: 'remove', star: 'star', update: 'update', share: 'share' }[a.op]
  return a.lang === 'ar' ? `مدار: ${ar} ${a.id}` : `Madar: ${en} ${a.id}`
}

export function createChannel(server: Server) {
  return {
    /** Connected only when the client advertised the channel capability at initialize. */
    state(): 'connected' | 'unavailable' {
      return server.getClientCapabilities()?.experimental?.[CHANNEL] ? 'connected' : 'unavailable'
    },
    emit(a: Action): void {
      void server.notification({
        method: 'notifications/claude/channel',
        params: { content: channelText(a), meta: { source: 'madar', op: a.op, id: a.id, lang: a.lang ?? 'en' } },
      })
    },
  }
}
