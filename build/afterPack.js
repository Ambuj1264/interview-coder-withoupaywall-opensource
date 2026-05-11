const { execSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productName}.app`);
  try {
    // Remove quarantine flag
    execSync(`xattr -cr "${appPath}"`, { stdio: 'ignore' });
    // Ad-hoc sign the app — changes "damaged" error to "unidentified developer"
    // which users can bypass with right-click → Open
    execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'pipe' });
    console.log(`  • ad-hoc signed ${context.packager.appInfo.productName}.app`);
  } catch (e) {
    console.warn('  • afterPack signing skipped:', e.message);
  }
};
