const fs = require('node:fs');
const path = require('node:path');

const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
const cssPath = path.join(__dirname, '..', 'public', 'css', 'variables.css');
const libraryJsPath = path.join(__dirname, '..', 'public', 'js', 'library.js');

const html = fs.readFileSync(htmlPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');
const libraryJs = fs.readFileSync(libraryJsPath, 'utf8');

const checks = [
  ['boot script added to hide the UI until i18n is ready', html.includes('app-ready')],
  ['preload hides the page before translations finish', css.includes('html:not(.app-ready) body {') && css.includes('visibility: hidden')],
  ['empty-state title is not statically bound to i18n', !html.includes('empty-state-title" data-i18n="reader.emptyTitle')],
  ['language change refreshes loading empty-state text', libraryJs.includes('refreshEmptyStateForLanguage') && libraryJs.includes("t('reader.loading')")]
];

const failures = checks.filter(([, passed]) => !passed);

if (failures.length) {
  for (const [label] of failures) {
    console.error(`FAIL: ${label}`);
  }
  process.exit(1);
}

console.log('PASS: i18n flash prevention checks succeeded');
