import { create } from 'zustand'
import type { Session } from '@shared/contracts'

/** Renderer copy of the working session (the authoritative one lives in the main process). */
interface SessionState {
  session: Session | null
  setSession: (s: Session | null) => void
}

export const useSession = create<SessionState>((set) => ({
  session: null,
  setSession: (session) => set({ session })
}))
