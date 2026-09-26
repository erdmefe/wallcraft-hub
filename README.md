# WallCraft Community Hub

The official community catalog and distribution hub for [WallCraft](https://github.com/erdmefe/wallcraft) — providing verified 3D WebGL shaders, sandboxed desktop widgets, and workspace presets for the in-app Marketplace.

---

## Architecture & Distribution

WallCraft Hub operates as a zero-touch public catalog. Desktop clients consume the catalog through a single-shot request cached on edge networks, eliminating N+1 API overhead.

- **Static Catalog Delivery:** `catalog.json` is served directly via jsDelivr Anycast CDN and GitHub Raw.
- **Edge Telemetry:** Real-time download counters and stars are synchronized asynchronously via a Cloudflare Workers microservice (`wallcraft-metrics`), backed by an in-memory TTL cache and local persistent store fallback.
- **Integrity Verification:** Package payloads support optional cryptographic SHA-256 integrity verification.
- **Client Fallback:** If the network is unavailable, clients gracefully fall back to locally cached catalog manifests without blocking startup.

---

## Repository Structure

```
wallcraft-hub/
├── catalog.json              # Master compiled catalog consumed by desktop clients
├── shaders/                  # 3D WebGL GLSL fragment shader scene definitions (.json)
├── widgets/                  # Sandboxed community widgets (unpacked folder per widget)
│   └── <widget-id>/
│       ├── manifest.json     # Widget metadata, grid spans, and config schema
│       ├── widget.html       # Markup structure
│       ├── widget.css        # Scoped stylesheet
│       ├── widget.js         # Lifecycle logic (init, update, destroy)
│       └── preview.webp      # 16:9 vitrine preview image (or .png)
├── presets/                  # Full desktop layout & theme presets (.wallcraft-preset.json)
├── scripts/                  # Catalog compilation and asset tooling
└── .github/
    └── workflows/
        └── build-catalog.yml # Automated CI to compile and validate catalog.json
```

---

## Submission Guidelines

Submissions are reviewed and integrated via GitHub Pull Requests.

### 1. 3D WebGL Shaders (`shaders/`)

Shaders are WebGL 2.0 fragment programs rendered directly on the GPU behind desktop icons.

1. Open **WallCraft -> Settings -> Background -> Custom Shader IDE**.
2. Write and preview your shader in the integrated editor.
3. Click **Export (.json)** to generate a validated scene JSON.
4. Place the exported file into `shaders/<shader-id>.json`.
5. Add a 16:9 preview image: `shaders/<shader-id>.webp` (or `.png`).
6. Submit a Pull Request.

**Shader Requirements:**
- Must compile cleanly with WebGL 2.0 / GLSL 3.00 ES.
- Core Shadertoy-compatible uniforms (`iResolution`, `iTime`, `iTimeDelta`, `iFrame`, `iMouse`, `iChannel0..3`) are provided automatically.
- Audio reactivity is available via `iAudioSpectrum[32]` and `iAudioWaveform[32]`.
- Multi-pass pipelines support `Common`, `Buffer A` through `Buffer D`, and `Image` passes with ping-pong FBO feedback.

---

### 2. Desktop Widgets (`widgets/`)

Widgets are modular web components executed within strict HTML5 iframe sandboxes: `<iframe sandbox="allow-scripts">` with an opaque (`null`) origin. Widgets have zero access to Node.js, Electron host internals, or the local filesystem. All host communication occurs over an asynchronous `postMessage` RPC bridge.

1. Create a dedicated folder under `widgets/<widget-id>/`.
2. Provide the four required files:
   - `manifest.json`: Configuration schema, 24×24 grid dimensions, and permission declarations.
   - `widget.html`: Interface markup.
   - `widget.css`: Theme-compatible styling.
   - `widget.js`: Widget lifecycle logic (`window.WallCraft.onUpdate`, `onDestroy`).
3. Add a 16:9 preview image (`preview.webp` or `preview.png`).
4. Test locally (see [Local Testing](#local-testing)).
5. Submit a Pull Request.

#### Manifest Specification (`manifest.json`)

```json
{
  "id": "my-custom-widget",
  "name": "My Custom Widget",
  "version": "1.0.0",
  "author": "YourName",
  "description": "Clean desktop widget for WallCraft",
  "gridSpan": {
    "cols": 4,
    "rows": 4,
    "minCols": 2,
    "minRows": 2
  },
  "permissions": ["system-stats"],
  "entry": {
    "html": "widget.html",
    "css": "widget.css",
    "script": "widget.js"
  },
  "configSchema": [
    {
      "key": "refreshInterval",
      "label": "Refresh Interval (seconds)",
      "type": "range",
      "min": 1,
      "max": 60,
      "step": 1,
      "default": 5
    }
  ]
}
```

#### Supported Permissions
Widgets requiring host capabilities must explicitly declare them in the `permissions` array:
- `"system-stats"`: Hardware telemetry (CPU, RAM, GPU, storage, network traffic).
- `"media"`: Windows SMTC playback state, track metadata, and playback controls.
- `"audio"`: Windows WASAPI audio session levels, master volume, and peak meters.
- `"discord"`: Discord Voice Gateway RPC state and active speaker status.
- `"launcher"`: Safe application shortcut and URL launching.

#### JavaScript Lifecycle (`widget.js`)
Widgets interact with the host through the injected `window.WallCraft` (or `window.wallcraft`) SDK:

```javascript
window.WallCraft = window.WallCraft || {};

// Called when user settings change in the WallCraft control panel
if (window.WallCraft.onUpdate) {
  window.WallCraft.onUpdate((config) => {
    // Apply dynamic configuration changes
  });
}

// Clean up all timers, intervals, and listeners to prevent memory leaks
window.addEventListener('beforeunload', () => {
  if (typeof window.onDestroy === 'function') {
    window.onDestroy();
  }
});
```

---

### 3. Desktop Presets (`presets/`)

Presets bundle active wallpaper shaders, video/image backgrounds, active widgets, 24×24 grid coordinates, and wrapper themes into a single shareable file.

1. Configure your layout in WallCraft.
2. Navigate to **Settings -> Profiles & Presets**.
3. Click **Export Preset** to download your `<preset-id>.wallcraft-preset.json`.
4. Place the file in `presets/` and open a Pull Request.

---

## Local Testing

Test your creation locally before submitting:

- **Widgets:** Copy your widget folder into `%APPDATA%\WallCraft\user-widgets\<widget-id>\`. Restart WallCraft or re-open the marketplace to test installation, rendering, and interaction.
- **Shaders:** Place your exported `.json` file in `%APPDATA%\WallCraft\shaders\<shader-id>.json`. It will be immediately available in the 3D Shader selector.
- **Presets:** Open WallCraft **Settings -> Profiles & Presets -> Import Preset** and select your `.wallcraft-preset.json` file.

---

## Security & Quality Standards

- **Isolated Execution:** Widgets run in an opaque sandbox origin. Direct access to `require`, `process`, or parent windows is strictly blocked.
- **Lifecycle Cleanliness:** All `setInterval`, `requestAnimationFrame`, and DOM event listeners must be properly cleared on unload. Leaking background resources will result in PR rejection.
- **Theme Compatibility:** Widgets should adapt gracefully to WallCraft's 17 wrapper themes by relying on CSS custom properties or transparent containers when zero-wrapper styling is active.
- **Grid Discipline:** Content must fit predictably within the declared 24×24 magnetic grid boundaries.

---

## License

Community contributions are accepted under open community terms compatible with WallCraft's marketplace distribution.
