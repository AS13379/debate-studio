const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const { signAsync } = require('@electron/osx-sign')

module.exports = async function afterPackSparkle(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'debate-studio-sparkle-sign-'))
  const sanitizedPath = path.join(temporaryRoot, `${context.packager.appInfo.productFilename}.app`)
  const entitlements = path.join(context.packager.projectDir, 'build', 'entitlements.mac.plist')

  // Recent macOS versions attach protected provenance/code-signing xattrs while
  // files are copied from the Electron cache. codesign rejects these as
  // resource-fork detritus. Recreate the bundle without extended attributes
  // before signing; this is a build-time sanitization, never an app installer.
  execFileSync('ditto', ['--norsrc', '--noextattr', '--noqtn', appPath, sanitizedPath], { stdio: 'inherit' })
  await signAsync({
    app: sanitizedPath,
    identity: '-',
    identityValidation: false,
    hardenedRuntime: true,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    timestamp: 'none',
    optionsForFile: () => ({
      entitlements,
      hardenedRuntime: true,
      timestamp: 'none'
    }),
    // Sparkle ships its XPC services with a valid nested signature order.
    // Preserve those signatures while signing the Electron host bundle.
    ignore: (file) => file.includes(`${path.sep}Sparkle.framework${path.sep}`)
  })
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=4', sanitizedPath], {
    stdio: 'inherit'
  })
  fs.rmSync(appPath, { recursive: true, force: true })
  fs.renameSync(sanitizedPath, appPath)
  fs.rmSync(temporaryRoot, { recursive: true, force: true })
}
