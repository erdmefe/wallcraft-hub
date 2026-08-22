# WallCraft Community Hub 🌌

Welcome to the official **WallCraft Community Hub** repository. This public catalog powers the in-app WallCraft Marketplace, providing curated 3D WebGL shaders and desktop interactive widgets for users worldwide.

## 📦 Repository Structure

- `catalog.json`: Master catalog index containing verified community shaders and widgets.
- `shaders/`: Exported `.json` 3D fragment shader scene definitions.
- `widgets/`: Exported `.zip` packaged modular widgets (HTML, CSS, JS, manifest.json).

## 🚀 How to Submit Your Creation

### 1. 3D WebGL Shaders (.json)
1. Open **WallCraft -> Settings -> Background -> 3D Shader Scenes**.
2. Write and tune your shader in the Custom Shader IDE.
3. Click **"Export (.json)"** to download your validated JSON manifest.
4. Click **"Submit to Hub"** in the Marketplace to open a pre-filled GitHub submission issue or submit a Pull Request adding your shader to `catalog.json`.

### 2. Desktop Widgets (.zip)
1. Build your widget with standard `manifest.json`, `widget.html`, `widget.css`, `widget.js`.
2. Test locally by dropping into `%APPDATA%\WallCraft\user-widgets\your-widget-id\`.
3. Compress into `.zip` and submit via a Pull Request.

---
*Maintained by the WallCraft Open Community.*
