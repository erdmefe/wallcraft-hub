#!/usr/bin/env node
/**
 * WallCraft Hub â€” Automated Static Catalog Compiler
 * 
 * Usage:
 *   node scripts/build-hub-catalog.js
 * 
 * Scans:
 *   - shaders/*.json
 *   - widgets/<id>/ (manifest.json, pack.json)
 *   - presets/*.wallcraft-preset.json or presets/*.json
 * 
 * Generates:
 *   - catalog.json (at repository root)
 * 
 * This file eliminates N+1 network requests and API rate limit bottlenecks,
 * allowing thousands of concurrent desktop clients to fetch the marketplace
 * catalog in a single ~40 KB static request via global Anycast CDN.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const OUTPUT_FILE = path.join(REPO_ROOT, 'catalog.json');

function findPreviewImage(baseDir, itemId, fileList) {
  const candidates = [
    `${itemId}.png`,
    `${itemId}.webp`,
    `${itemId}.jpg`,
    'preview.png',
    'preview.webp',
    'preview.jpg',
    'thumbnail.png'
  ];
  for (const c of candidates) {
    if (fileList.includes(c)) {
      const relPath = path.posix.join(baseDir, c);
      const fullPath = path.join(REPO_ROOT, baseDir, c);
      try {
        const stats = fs.statSync(fullPath);
        return `${relPath}?t=${Math.floor(stats.mtimeMs)}`;
      } catch (e) {
        return relPath;
      }
    }
  }
  return null;
}

function buildCatalog() {
  console.log('[WallCraft Catalog Builder] Starting static catalog compilation...');
  const catalog = [];

  // 1. Scan Shaders
  const shadersDir = path.join(REPO_ROOT, 'shaders');
  if (fs.existsSync(shadersDir)) {
    const files = fs.readdirSync(shadersDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    for (const jsonFile of jsonFiles) {
      try {
        const fullPath = path.join(shadersDir, jsonFile);
        const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));

        if (data.id && (data.title || data.name)) {
          const id = data.id;
          let previewImage = null;
          // 1. Developer manifest override (highest priority)
          if (data.previewImage && typeof data.previewImage === 'string') {
            previewImage = data.previewImage.trim();
          }
          // 2. Auto-generated / discovered snapshot fallback
          if (!previewImage) {
            const autoImg = findPreviewImage('shaders', id, files);
            if (autoImg) previewImage = autoImg;
          }

          catalog.push({
            id,
            title: data.title || data.name,
            type: 'shader',
            author: data.author || 'Community',
            version: data.version || '1.0.0',
            category: data.category || 'custom',
            categoryLabel: data.categoryLabel || 'Shader Art',
            desc: data.description || data.desc || '',
            previewGradient: data.previewGradient || 'linear-gradient(135deg, #0f172a 0%, #020617 100%)',
            previewImage,
            shaderFile: jsonFile,
            permissions: Array.isArray(data.permissions) ? data.permissions : [],
            tags: Array.isArray(data.tags) ? data.tags : ['shader', data.category || 'custom']
          });
        }
      } catch (err) {
        console.warn(`[Warning] Skipping invalid shader file ${jsonFile}:`, err.message);
      }
    }
    console.log(`[OK] Processed ${catalog.filter(i => i.type === 'shader').length} shaders.`);
  }

  // 2. Scan Widgets & Packs
  const widgetsDir = path.join(REPO_ROOT, 'widgets');
  if (fs.existsSync(widgetsDir)) {
    const entries = fs.readdirSync(widgetsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirName = entry.name;
      const itemDir = path.join(widgetsDir, dirName);
      const subFiles = fs.readdirSync(itemDir);

      const packPath = path.join(itemDir, 'pack.json');
      const manifestPath = path.join(itemDir, 'manifest.json');

      const isPack = fs.existsSync(packPath);
      const isSingle = !isPack && fs.existsSync(manifestPath);

      if (isPack) {
        try {
          const packData = JSON.parse(fs.readFileSync(packPath, 'utf8'));
          const subWidgets = [];
          const allPermissions = new Set(Array.isArray(packData.permissions) ? packData.permissions : []);

          // Scan subfolders
          const subEntries = fs.readdirSync(itemDir, { withFileTypes: true });
          for (const sub of subEntries) {
            if (!sub.isDirectory()) continue;
            const subDir = sub.name;
            const subManifestPath = path.join(itemDir, subDir, 'manifest.json');
            if (fs.existsSync(subManifestPath)) {
              try {
                const subManifest = JSON.parse(fs.readFileSync(subManifestPath, 'utf8'));
                (subManifest.permissions || []).forEach(p => allPermissions.add(p));
                subWidgets.push({
                  id: subManifest.id || `${dirName}-${subDir}`,
                  dir: subDir,
                  name: subManifest.name || subDir,
                  version: subManifest.version || '1.0.0',
                  desc: subManifest.description || subManifest.desc || '',
                  wrapper: subManifest.wrapper || null,
                  permissions: subManifest.permissions || []
                });
              } catch (e) {}
            }
          }

          let previewImage = null;
          // 1. Developer manifest override (highest priority)
          if (packData.previewImage && typeof packData.previewImage === 'string') {
            previewImage = packData.previewImage.trim();
          }
          // 2. Auto-generated / discovered snapshot fallback
          if (!previewImage) {
            const autoImg = findPreviewImage(`widgets/${dirName}`, dirName, subFiles);
            if (autoImg) previewImage = autoImg;
          }

          catalog.push({
            id: packData.id || dirName,
            dir: dirName,
            repoDirName: dirName,
            type: 'widget-pack',
            title: packData.name || packData.title || dirName,
            author: packData.author || 'Community',
            version: packData.version || '1.0.0',
            category: packData.category || 'suite',
            categoryLabel: packData.categoryLabel || 'Widget Suite',
            desc: packData.description || packData.desc || 'A collection of matching widgets for your wallpaper.',
            previewGradient: packData.previewGradient || 'radial-gradient(ellipse at 50% 25%, rgba(168, 85, 247, 0.16) 0%, rgba(18, 12, 32, 0.8) 55%, #07080e 100%)',
            previewImage,
            permissions: Array.from(allPermissions),
            widgets: subWidgets,
            tags: Array.isArray(packData.tags) ? packData.tags : ['widget-pack', 'suite']
          });
        } catch (err) {
          console.warn(`[Warning] Skipping invalid widget pack ${dirName}:`, err.message);
        }
      } else if (isSingle) {
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          let previewImage = null;
          // 1. Developer manifest override (highest priority)
          if (manifest.previewImage && typeof manifest.previewImage === 'string') {
            previewImage = manifest.previewImage.trim();
          }
          // 2. Auto-generated / discovered snapshot fallback
          if (!previewImage) {
            const autoImg = findPreviewImage(`widgets/${dirName}`, dirName, subFiles);
            if (autoImg) previewImage = autoImg;
          }

          catalog.push({
            id: manifest.id || dirName,
            dir: dirName,
            repoDirName: dirName,
            type: 'widget',
            title: manifest.name || manifest.title || dirName,
            author: manifest.author || 'Community',
            version: manifest.version || '1.0.0',
            category: manifest.category || 'productivity',
            categoryLabel: manifest.categoryLabel || 'Productivity',
            desc: manifest.description || manifest.desc || '',
            previewGradient: manifest.previewGradient || 'radial-gradient(ellipse at 50% 25%, rgba(56, 189, 248, 0.12) 0%, rgba(12, 18, 30, 0.8) 55%, #07080e 100%)',
            previewImage,
            permissions: Array.isArray(manifest.permissions) ? manifest.permissions : [],
            tags: Array.isArray(manifest.tags) ? manifest.tags : ['widget']
          });
        } catch (err) {
          console.warn(`[Warning] Skipping invalid standalone widget ${dirName}:`, err.message);
        }
      }
    }
    console.log(`[OK] Processed ${catalog.filter(i => i.type === 'widget' || i.type === 'widget-pack').length} widgets.`);
  }

  // 3. Scan Presets
  const presetsDir = path.join(REPO_ROOT, 'presets');
  if (fs.existsSync(presetsDir)) {
    const files = fs.readdirSync(presetsDir);
    const presetFiles = files.filter(f => f.endsWith('.wallcraft-preset.json') || f.endsWith('.json'));

    for (const pFile of presetFiles) {
      try {
        const fullPath = path.join(presetsDir, pFile);
        const presetData = JSON.parse(fs.readFileSync(fullPath, 'utf8'));

        if (presetData.id && (presetData.name || presetData.title)) {
          const presetId = presetData.id;
          let previewImage = null;
          // 1. Developer manifest override (highest priority)
          if (presetData.previewImage && typeof presetData.previewImage === 'string') {
            previewImage = presetData.previewImage.trim();
          }
          // 2. Auto-generated / discovered snapshot fallback
          if (!previewImage) {
            const autoImg = findPreviewImage('presets', presetId, files);
            if (autoImg) previewImage = autoImg;
          }

          catalog.push({
            id: presetId,
            type: 'preset',
            title: presetData.name || presetData.title || presetId,
            name: presetData.name || presetData.title || presetId,
            author: presetData.author || 'Community',
            version: presetData.version || '1.0.0',
            category: presetData.category || 'aesthetic',
            categoryLabel: presetData.categoryLabel || 'Desktop Preset',
            desc: presetData.description || presetData.desc || 'Community-crafted desktop preset.',
            previewGradient: presetData.previewGradient || 'linear-gradient(135deg, #0d0907 0%, #1c1209 50%, #2a1a0e 100%)',
            previewImage,
            accentColor: presetData.accentColor || '#00f0ff',
            activeWidgets: Array.isArray(presetData.activeWidgets) ? presetData.activeWidgets : [],
            widgetWrapperStyle: presetData.widgetWrapperStyle || 'squircle-acrylic',
            wallpaperType: presetData.settings?.wallpaperType || presetData.wallpaperType || 'image',
            shaderPreset: presetData.settings?.shaderConfig?.preset || presetData.shaderPreset || null,
            presetFile: pFile,
            permissions: Array.isArray(presetData.permissions) ? presetData.permissions : [],
            tags: Array.isArray(presetData.tags) ? presetData.tags : ['preset', 'theme']
          });
        }
      } catch (err) {
        console.warn(`[Warning] Skipping invalid preset file ${pFile}:`, err.message);
      }
    }
    console.log(`[OK] Processed ${catalog.filter(i => i.type === 'preset').length} presets.`);
  }

  // 4. Safety Guard
  if (catalog.length === 0 && !fs.existsSync(path.join(REPO_ROOT, 'shaders')) && !fs.existsSync(path.join(REPO_ROOT, 'widgets'))) {
    console.warn(`[Warning] Neither shaders/ nor widgets/ directory was found in ${REPO_ROOT}.`);
    console.warn(`[Info] If your hub repository is located elsewhere, run: node scripts/build-hub-catalog.js <path-to-hub>`);
    return;
  }

  // 5. Write catalog.json
  const jsonContent = JSON.stringify(catalog, null, 2);
  fs.writeFileSync(OUTPUT_FILE, jsonContent, 'utf8');
  console.log(`[SUCCESS] Compiled ${catalog.length} items to ${OUTPUT_FILE} (${(Buffer.byteLength(jsonContent) / 1024).toFixed(1)} KB)`);
}

buildCatalog();
