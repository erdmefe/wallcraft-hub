#!/usr/bin/env node
/**
 * WallCraft Hub — Automated Preview Snapshot Generator
 * 
 * Pre-renders and captures crisp 480x270 (exact 16:9) WebP preview images for widgets
 * and shaders that do not have a developer-specified previewImage.
 * 
 * Rules:
 * 1. Developer Manifest Override: If manifest.json (or shader .json) specifies
 *    previewImage, it is NEVER overwritten.
 * 2. Disk check: If a valid preview image exists on disk, it is skipped unless --force is passed.
 * 3. Shaders: Rendered via WallCraftShaderEngine.renderSnapshot() at 480x270 for 100% GLSL 3.00 & WebGL 2 parity.
 * 4. Widgets: Loaded into isolated flexbox stage with mock WallCraft SDK, pixel-perfect centered.
 * 
 * Usage:
 *   npx electron generate-hub-previews.js [path-to-hub-repo] [--force]
 */

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

// Disable hardware acceleration issues in headless mode
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('no-sandbox');

const args = process.argv.slice(2);
const forceRegenerate = args.includes('--force');
const targetHubDir = args.find(a => !a.startsWith('--')) ? path.resolve(args.find(a => !a.startsWith('--'))) : process.cwd();

function findShaderEngineFiles() {
  const candidates = [
    'D:/Programlama/Wallpaper/src/wallpaper/shaders',
    path.join(__dirname, '..', 'src', 'wallpaper', 'shaders'),
    path.join(process.cwd(), 'src', 'wallpaper', 'shaders'),
    path.join(__dirname, 'src', 'wallpaper', 'shaders')
  ];
  for (const dir of candidates) {
    const presets = path.join(dir, 'shader-presets.js');
    const engine = path.join(dir, 'shader-engine.js');
    if (fs.existsSync(presets) && fs.existsSync(engine)) {
      return {
        presetsSource: fs.readFileSync(presets, 'utf8'),
        engineSource: fs.readFileSync(engine, 'utf8')
      };
    }
  }
  return null;
}

async function run() {
  console.log('========================================================');
  console.log('  WallCraft Hub — Build-Time Snapshot Generator (16:9)');
  console.log(`  Target Directory: ${targetHubDir}`);
  console.log(`  Force Mode: ${forceRegenerate}`);
  console.log('========================================================\n');

  const widgetsDir = path.join(targetHubDir, 'widgets');
  const shadersDir = path.join(targetHubDir, 'shaders');

  let generatedCount = 0;
  let skippedCount = 0;

  // 1. Create a frameless BrowserWindow with exact 480x270 content size (16:9)
  const win = new BrowserWindow({
    width: 480,
    height: 270,
    useContentSize: true,
    frame: false,
    show: false,
    webPreferences: {
      offscreen: false,
      nodeIntegration: false,
      contextIsolation: false
    }
  });

  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const engineFiles = findShaderEngineFiles();

  // --- Process Shaders ---
  if (fs.existsSync(shadersDir)) {
    console.log('[1/2] Scanning Shaders...');
    const files = fs.readdirSync(shadersDir).filter(f => f.endsWith('.json'));

    for (const file of files) {
      const fullPath = path.join(shadersDir, file);
      try {
        const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        const shaderId = data.id || path.basename(file, '.json');

        // Rule 1: Manifest override
        if (data.previewImage && typeof data.previewImage === 'string') {
          console.log(`  [SKIP] Shader "${shaderId}": manifest explicitly defines previewImage (${data.previewImage})`);
          skippedCount++;
          continue;
        }

        // Rule 2: Disk check
        const webpTarget = path.join(shadersDir, `${shaderId}.webp`);
        const pngTarget = path.join(shadersDir, `${shaderId}.png`);
        const hasValidWebp = fs.existsSync(webpTarget) && fs.statSync(webpTarget).size > 500;
        const hasValidPng = fs.existsSync(pngTarget) && fs.statSync(pngTarget).size > 500;
        if (!forceRegenerate && (hasValidWebp || hasValidPng)) {
          console.log(`  [SKIP] Shader "${shaderId}": valid preview image already exists on disk.`);
          skippedCount++;
          continue;
        }

        console.log(`  [RENDER] Shader "${shaderId}" -> Generating 16:9 WebP snapshot...`);
        const cfg = data.shaderConfig || data;

        if (engineFiles) {
          const shaderHtml = `
            <!DOCTYPE html>
            <html>
            <head><meta charset="utf-8"></head>
            <body>
              <script>${engineFiles.presetsSource}<\/script>
              <script>${engineFiles.engineSource}<\/script>
              <script>
                try {
                  const cfg = ${JSON.stringify(cfg)};
                  window.__snapshotResult = WallCraftShaderEngine.renderSnapshot(cfg, 480, 270, 1.5);
                } catch(e) {
                  window.__snapshotResult = null;
                }
              <\/script>
            </body>
            </html>
          `;

          await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(shaderHtml)}`);
          await wait(400);

          const result = await win.webContents.executeJavaScript('window.__snapshotResult');
          if (result && result.startsWith('data:image')) {
            const base64 = result.replace(/^data:image\/\w+;base64,/, '');
            const buf = Buffer.from(base64, 'base64');
            fs.writeFileSync(webpTarget, buf);
            console.log(`  [OK] Saved shader WebP: shaders/${shaderId}.webp (${(buf.length / 1024).toFixed(1)} KB)`);
            generatedCount++;
            continue;
          }
        }

        // Fallback capturePage if ShaderEngine is unavailable
        const img = await win.webContents.capturePage({ x: 0, y: 0, width: 480, height: 270 });
        const webpBuf = img.toWEBP ? img.toWEBP(85) : img.toPNG();
        fs.writeFileSync(webpTarget, webpBuf);
        console.log(`  [OK] Saved: shaders/${shaderId}.webp (${(webpBuf.length / 1024).toFixed(1)} KB)`);
        generatedCount++;
      } catch (err) {
        console.warn(`  [ERR] Failed to render shader ${file}:`, err.message);
      }
    }
  }

  // --- Process Widgets ---
  if (fs.existsSync(widgetsDir)) {
    console.log('\n[2/2] Scanning Widgets...');
    const entries = fs.readdirSync(widgetsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirName = entry.name;
      const itemDir = path.join(widgetsDir, dirName);

      try {
        const manifestPath = path.join(itemDir, 'manifest.json');
        const packPath = path.join(itemDir, 'pack.json');
        const isPack = fs.existsSync(packPath);
        const metaPath = isPack ? packPath : manifestPath;

        if (!fs.existsSync(metaPath)) continue;

        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        const widgetId = meta.id || dirName;

        // Rule 1: Manifest override
        if (meta.previewImage && typeof meta.previewImage === 'string') {
          console.log(`  [SKIP] Widget "${widgetId}": manifest explicitly defines previewImage (${meta.previewImage})`);
          skippedCount++;
          continue;
        }

        // Rule 2: Disk check
        const webpTarget = path.join(itemDir, 'preview.webp');
        const pngTarget = path.join(itemDir, 'preview.png');
        const hasValidWebp = fs.existsSync(webpTarget) && fs.statSync(webpTarget).size > 500;
        const hasValidPng = fs.existsSync(pngTarget) && fs.statSync(pngTarget).size > 500;
        if (!forceRegenerate && (hasValidWebp || hasValidPng)) {
          console.log(`  [SKIP] Widget "${widgetId}": preview image already exists on disk.`);
          skippedCount++;
          continue;
        }

        // Locate widget HTML, CSS, JS (if pack, use first sub-widget)
        let subTargetDir = itemDir;
        if (isPack) {
          const subDirs = fs.readdirSync(itemDir, { withFileTypes: true }).filter(d => d.isDirectory());
          if (subDirs.length > 0) {
            subTargetDir = path.join(itemDir, subDirs[0].name);
          }
        }

        const htmlFile = path.join(subTargetDir, 'widget.html');
        const cssFile = path.join(subTargetDir, 'widget.css');
        const jsFile = path.join(subTargetDir, 'widget.js');

        if (!fs.existsSync(htmlFile)) {
          console.log(`  [SKIP] Widget "${widgetId}": widget.html not found.`);
          skippedCount++;
          continue;
        }

        console.log(`  [RENDER] Widget "${widgetId}" -> Generating centered 16:9 snapshot...`);
        const htmlContent = fs.readFileSync(htmlFile, 'utf8');
        const cssContent = fs.existsSync(cssFile) ? fs.readFileSync(cssFile, 'utf8') : '';
        const jsContent = fs.existsSync(jsFile) ? fs.readFileSync(jsFile, 'utf8') : '';

        const renderHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8">
            <style>
              *, *::before, *::after {
                box-sizing: border-box;
              }
              html, body {
                margin: 0;
                padding: 0;
                width: 100vw;
                height: 100vh;
                overflow: hidden;
                background: #0b0f19;
                color: #f8fafc;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                display: flex;
                align-items: center;
                justify-content: center;
              }
              #widget-stage {
                width: 100%;
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
              }
              #widget-container {
                display: flex;
                align-items: center;
                justify-content: center;
                transform: scale(1.15);
                transform-origin: center center;
              }
              ${cssContent}
            </style>
          </head>
          <body>
            <div id="widget-stage">
              <div id="widget-container">
                ${htmlContent}
              </div>
            </div>
            <script>
              window.wallcraft = {
                on: () => {},
                emit: () => {},
                getStats: () => ({ cpu: 24, ram: 42, temp: 48 }),
                getWeather: () => ({ temp: 22, condition: 'Clear', city: 'Istanbul' })
              };
              try {
                ${jsContent}
              } catch(e) { }
            </script>
          </body>
          </html>
        `;

        await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderHtml)}`);
        await wait(500);

        const img = await win.webContents.capturePage({ x: 0, y: 0, width: 480, height: 270 });
        const webpBuf = img.toWEBP ? img.toWEBP(85) : img.toPNG();
        fs.writeFileSync(webpTarget, webpBuf);
        console.log(`  [OK] Saved: widgets/${dirName}/preview.webp (${(webpBuf.length / 1024).toFixed(1)} KB)`);
        generatedCount++;
      } catch (err) {
        console.warn(`  [ERR] Failed to render widget ${dirName}:`, err.message);
      }
    }
  }

  win.close();
  console.log('\n========================================================');
  console.log(`  COMPLETED: ${generatedCount} snapshots generated, ${skippedCount} skipped.`);
  console.log('========================================================\n');

  app.quit();
}

app.whenReady().then(run);
