import { isAbsolute, join } from 'node:path'

export const STABLE_APP_DATA_DIRECTORY_NAME = 'debate-studio'

export function resolveAppDataDirectory(
  systemAppDataDirectory: string,
  environment: NodeJS.ProcessEnv = process.env
): string {
  const override = environment['DEBATE_STUDIO_USER_DATA_DIR']?.trim()
  if (override && isAbsolute(override)) return override
  return join(systemAppDataDirectory, STABLE_APP_DATA_DIRECTORY_NAME)
}
