/**
 * Standalone Aion CLI entry — bundled to out/main/cli.js (electron-vite + scripts/build-cli.mjs).
 */
declare const __AION_VERSION__: string | undefined;

function versionString(): string {
  if (typeof __AION_VERSION__ === 'string' && __AION_VERSION__.length > 0) {
    return __AION_VERSION__;
  }
  return '0.0.0';
}

function printHelp(): void {
  console.log(`AionUi CLI

Usage:
  node out/main/cli.js [options]

Options:
  --help, -h     Show this message
  --version, -v  Print version
`);
}

function main(): void {
  const argv = process.argv.slice(2);

  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  if (argv.includes('--version') || argv.includes('-v')) {
    console.log(versionString());
    process.exit(0);
  }

  printHelp();
  process.stderr.write('No command given. See --help.\n');
  process.exit(1);
}

main();
