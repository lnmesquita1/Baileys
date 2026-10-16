const [major, minor] = process.versions.node.split('.').map(Number);

if (major < 22 || (major === 22 && minor < 19)) {
  console.error(
    `\n❌ This package requires Node.js 22.19.0+ to run reliably.\n` +
    `   You are using Node.js ${process.versions.node}.\n` +
    `   Please upgrade to Node.js 22.19.0+ to proceed.\n`
  );
  process.exit(1);
}
