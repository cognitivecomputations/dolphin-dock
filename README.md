# Dolphin Dock 🐬

Dolphin Dock is a Google Chrome Extension designed to provide contextual assistance using AI models directly within your browser side panel. It analyzes the content of the current page and allows you to chat with an AI about it.

## Features

*   Integrates with AI models (currently supporting Gemini, with UI for OpenAI, Anthropic, and Custom).
*   Opens in the Chrome side panel.
*   Extracts relevant content from the active web page using Readability.js.
*   Streams responses from the AI model.
*   Markdown rendering with KaTeX support for math formulas.
*   Configurable API key and model selection.

## Prerequisites

*   [Node.js](https://nodejs.org/) (which includes npm) installed on your system.

## Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/cognitivecomputations/dolphin-dock.git 
    cd dolphin-dock
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```

## Building the Extension

This project uses `webpack` to bundle JavaScript modules and `tailwindcss` to build the CSS.

*   **Development Build:** To build the extension for development (with source maps, less optimization):
    ```bash
    npm run build:dev
    ```
*   **Production Build:** To build the extension for production (minified, optimized):
    ```bash
    npm run build
    ```

These commands will:
1.  Compile the Tailwind CSS from `src/input.css` into `sidepanel.css`.
2.  Bundle the JavaScript (`sidepanel.js`, `content.js`, `service-worker.js`) using webpack into the `dist/` directory.

The necessary files for the extension (`manifest.json`, HTML, CSS, bundled JS, images) will be ready in the project's root directory and the `dist/` directory.

## Loading the Extension in Chrome (Development)

1.  Open Google Chrome.
2.  Navigate to `chrome://extensions/`.
3.  Enable **"Developer mode"** using the toggle switch in the top-right corner.
4.  Click the **"Load unpacked"** button that appears.
5.  In the file selection dialog, navigate to the root directory of this project and select it.
6.  The Dolphin Dock extension should now appear in your list of extensions and be active. You can access it via the side panel button in your Chrome toolbar (you might need to pin it first).

**Note:** After making code changes, you'll need to run the appropriate build command (`npm run build` or `npm run build:dev`) again and then reload the extension in `chrome://extensions/` (using the reload icon on the extension's card) to see the updates.
