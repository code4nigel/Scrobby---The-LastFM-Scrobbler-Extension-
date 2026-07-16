# Scrobby 🎵 - The Ultimate Last.fm Scrobbler

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen.svg)]()
[![Platform](https://img.shields.io/badge/Platform-Chromium-blue.svg)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Scrobby** is a beautiful, premium, and feature-rich browser extension designed for Chromium-based browsers (Edge, Brave, Chrome) that automatically tracks and scrobbles your music playback from **YouTube Music**, **Spotify Web Player**, and **YouTube Videos** directly to your Last.fm profile.

It features a stunning glassmorphic dark interface, dynamic liquid tab transitions, custom progress tracking, real-time liked-to-loved syncing, and an advanced metadata correction pipeline.

---

## 📸 Interface Preview

![Scrobby UI Preview](images/preview.png)

---

## ✨ Features

*   **Unified Multi-Site Support**: Track your music seamlessly across:
    *   **YouTube Music** (`music.youtube.com`)
    *   **Spotify Web Player** (`open.spotify.com`)
    *   **YouTube Videos** (`www.youtube.com`)
*   **Direct Authentication (Zero Redirect)**: Log in directly using your Last.fm username and password inside the extension. Your credentials are sent securely via HTTPS directly to Last.fm and are never saved locally; only a session key is preserved.
*   **Loved Tracks Syncing**: Liking a track on YouTube Music (thumbs up) or Spotify (Heart) instantly registers it as a **Loved Track** on your Last.fm profile. Toggling it off removes the Loved state.
*   **Smart Remix & Video Auto-Correction**:
    *   Strips promotional noise like `[Official Video]`, `(Lyric Video)`, `(Remix)`, etc.
    *   Splits single-line video titles into clean `Artist` and `Track` properties.
    *   Verifies against Last.fm's database; if not found, it triggers a search lookup fallback to match the official track names and caches it locally.
*   **Custom Scrobble Controls**:
    *   Adjust minimum track duration threshold.
    *   Select custom scrobble trigger points (either by percentage of track played or elapsed seconds).
    *   A custom white marker tick shows exactly where on the timeline your scrobble triggers!
*   **Per-Site Permissions**: Toggle scrobbling on/off dynamically site-by-site.
*   **Master Scrobble Switch**: A global pause button to temporarily stop all scrobbling activity.
*   **Fluid Liquid Animations**: Glassmorphic dashboard tabs slide, stretch, and fade smoothly using hardware-accelerated transitions.

---

## 🚀 Installation Guide

Since this is a custom unpacked extension, you can install it manually in less than 1 minute:

1.  **Download or clone** this repository to a folder on your computer.
2.  Open your browser and navigate to the Extensions page:
    *   **Brave**: `brave://extensions`
    *   **Edge**: `edge://extensions`
    *   **Chrome**: `chrome://extensions`
3.  Turn **ON** **Developer mode** (toggle in the top-right corner).
4.  Click the **Load unpacked** button (top-left corner).
5.  Select the folder containing this extension (the folder containing `manifest.json`).
6.  Pin **Scrobby** to your toolbar for quick access!

---

## 🔑 Setup & Authentication

1.  **API Credentials Setup (Required)**:
    *   Due to Last.fm's developer terms, custom extensions require an active developer key.
    *   Go to [Last.fm's Create API Account](https://www.last.fm/api/account/create) (takes 30 seconds).
    *   Input your contact email and a name like `Scrobby Extension`.
    *   Copy your unique **API Key** and **Shared Secret**.
2.  **Activate Scrobby**:
    *   Open the extension popup and expand the **Advanced API Key Setup** folder.
    *   Paste your keys and click **Save API Credentials**.
    *   Input your **Last.fm Username & Password** in the Direct Login tab and click **Log In Directly** to load your dashboard!

---

## 🛠️ Technology Stack

*   **Manifest V3**: Modern browser extension standard.
*   **Vanilla HTML5/CSS3/JavaScript**: Fast, lightweight, and zero external framework dependencies.
*   **Media Session API Interceptor**: Injects into the page `MAIN` world to intercept media metadata streams directly.
*   **CSS Mask Scroll fading**: Blurs out overflowing horizontal pills for a clean scroll boundary.
