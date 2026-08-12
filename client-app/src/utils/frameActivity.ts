export type FrameActivityMessage = {
  type: 'assets-game-resume' | 'assets-game-pause'
}

export function frameActivityMessage(active: boolean): FrameActivityMessage {
  return { type: active ? 'assets-game-resume' : 'assets-game-pause' }
}
