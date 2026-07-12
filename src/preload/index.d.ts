export {}

declare global {
  interface Window {
    debateStudio: {
      getAppVersion(): Promise<string>
    }
  }
}

