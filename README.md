# WallCraft Community Hub

The community catalog for [WallCraft](https://github.com/erdmefe/wallcraft): WebGL shaders, sandboxed desktop widgets and desktop presets. See the [developer documentation](https://getwallcraft.com/docs/) for SDK details.

## Repository structure and delivery

```text
wallcraft-hub/
├── catalog-v2.json              # Generated catalog consumed by the desktop app
├── shaders/
│   └── <publication-id>.json
├── widgets/
│   └── <publication-id>/
│       ├── manifest.json
│       ├── widget.html
│       ├── widget.css
│       ├── widget.js
│       └── preview.webp         # Optional preview; other supported formats also work
└── presets/
    └── <publication-id>.wallcraft-preset.json
```

The app reads `catalog-v2.json` from GitHub Raw. Published catalog entries pin package sources to a Git commit and include SHA-256 integrity metadata. Download/star metrics use the separate Cloudflare service at `metrics.getwallcraft.com`. Catalog compilation is a maintainer publishing step, not an automatic workflow in this repository.

## Names, IDs and updates

- Display names may repeat, including between widgets, shaders and presets. Names are not installation or deletion keys.
- Catalog IDs must be unique across all item types, ignoring case. Widget pack child IDs must also be unique and must not collide with catalog items or built-in widget IDs.
- The submission modal generates a publication ID independently of the title. Select the same **saved local source** for later updates to keep its publication ID. Changing the title does not change that mapping.
- Save an unsaved shader or preset locally before its first submission if you plan to update it. Unsaved draft IDs last only while the submission modal remains open. Keep your publication ID when moving a previously published project to another machine; a fresh local source does not inherit that mapping automatically.
- Existing published IDs remain valid. Do not rename existing IDs or generate replacement IDs merely to change a display name.
- Widget `manifest.id` and any shader/preset payload ID must match the catalog ID. Preserve those IDs and the exported asset paths when submitting manually.

## Submitting an item

Submissions are reviewed through GitHub Pull Requests. Items downloaded from the Hub cannot be re-published through the app.

1. Create and test your own shader, widget or preset locally. Save the source before publication if you will send updates.
2. Open the in-app **Submit to Hub** modal and select that saved local source. Enter the title, author, version, description and optional preview.
3. Use **Export Package in this modal** to obtain the publication package. Ordinary local exports may retain the local source identity instead.
4. Use **Submit PR to Hub** with a classic GitHub Personal Access Token with `public_repo` scope, or follow the manual steps below. Never commit the token.

### Manual submission

Install Git and GitHub CLI, run `gh auth login`, fork this repository and clone your fork. Run the modal's Git commands from that checkout, using the package exported from the same modal:

| Item | Export format | Repository destination |
| --- | --- | --- |
| Shader | `.json` | `shaders/<publication-id>.json` |
| Widget | `.zip` | Extract ZIP contents into `widgets/<publication-id>/` |
| Preset | `.wallcraft-preset.json` | `presets/<publication-id>.wallcraft-preset.json` |

Only widget ZIPs contain a root `manifest.json`. Do not add an extra folder around the extracted contents. The submission JSON containing `widgetFiles` is an envelope, not a widget manifest: use the exported ZIP. A later update uses the same publication ID and repository paths with a new version.

### Widget lifecycle and `instanceName`

Widgets run in an iframe with `sandbox="allow-scripts"`. The injected `window.WallCraft` SDK exposes permitted host capabilities; it is separate from your widget lifecycle object. A minimal lifecycle object can use the ID-independent `window.WallCraftWidget` convention:

```javascript
window.WallCraftWidget = {
  init(container, config) { this.container = container; this.update(config); },
  update(config) { this.container.textContent = config?.message || 'Hello WallCraft'; },
  pause() {},
  resume() {},
  destroy() { this.container = null; }
};
```

For an existing object such as `window.MyClockWidget`, the manifest can set `"instanceName": "MyClockWidget"`. It is read as a literal window property, not a nested object path. Without it, the loader derives a name from the final dot-separated ID segment (e.g. `my-clock` becomes `MyClockWidget`), with `window.WallCraftWidget` also accepted. Creator Studio preserves the original instance name when assigning a publication ID. Keep the exported `instanceName` so changing the package ID does not break initialization.

Declare the capabilities you use in `permissions`: `system-stats`, `media`, `audio`, `discord`, `launcher`, or `network`. Declaration does not grant access; the user must approve it. Handle denied calls, stop loops in `pause()`, restart them in `resume()`, and release timers, listeners and subscriptions in `destroy()`. See the [manifest and lifecycle reference](https://getwallcraft.com/docs/#manifest-spec) for the complete contract.

### Preset dependencies

Presets contain layout, settings and references, not embedded widget packages. Publish custom widgets and shaders first, then export the preset from the submission modal so known publication IDs replace local references. Built-in and already installed community item IDs remain unchanged. A reference to an unpublished local widget is not a distributable dependency.

## Local testing

- **Widgets:** Import the exact ZIP through **Settings → Modules & Widgets → Import Package** and verify rendering, settings, pause/resume and cleanup.
- **Shaders:** Import the scene JSON through the app's custom shader controls and preview its rendering.
- **Presets:** Use **Profiles & Presets → Import Preset**, with its referenced custom widgets/shaders available.

Follow the [packaging limits](https://getwallcraft.com/docs/#packaging); exclude caches, `node_modules` and build tools from widget packages.

## Maintainer publishing

The local `Wallcraft Marketplace` tooling lives beside this checkout, not under this repository's `scripts/` directory. Its `build-hub-catalog.js` uses the application's `scripts/community/prepare-catalog.js` validator.

1. Review source changes and retain existing publication IDs. Commit sources before generating commit-pinned hashes.
2. From the tooling directory, run `publish-catalog.bat --check` on a clean Hub checkout to validate without writing, pushing or updating D1.
3. Run the normal `publish-catalog.bat` only when ready to publish. It synchronizes the checkout, optionally generates previews, commits source assets, builds `catalog-v2.json`, pushes GitHub changes and applies the generated D1 allowlist SQL. Existing counters are preserved. The normal mode has remote side effects; `--check` does not.

Do not hand-edit hashes or `repoCommit`, restore the obsolete `catalog.json`, or assume merging a source PR alone regenerates the catalog. Source files are hashed as Git blob bytes to avoid Windows line-ending differences. If publishing fails after the GitHub push, resolve and complete the D1 step as well.

## License

Community contributions are accepted under open community terms compatible with WallCraft's marketplace distribution.
