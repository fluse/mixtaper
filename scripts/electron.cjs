// Startet Electron – ohne ELECTRON_RUN_AS_NODE, das z. B. VS Code-Terminals setzen
// und Electron sonst als reines Node.js laufen lässt.
const { spawn } = require('child_process');
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('close', (code) => process.exit(code ?? 0));
