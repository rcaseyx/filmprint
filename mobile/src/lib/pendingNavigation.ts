let _pendingUsername: string | null = null

export const setPendingProfile = (username: string): void => {
  _pendingUsername = username
}

export const getPendingProfile = (): string | null => _pendingUsername

export const clearPendingProfile = (): void => {
  _pendingUsername = null
}
