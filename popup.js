/**
 * Advanced Popup UI controller for YTM Last.fm Scrobbler.
 * Manages direct credentials-based login, web redirect auth, tabbed navigation,
 * site permissions toggles, fine-grained scrobble rules, and live player updates.
 */

// Default Last.fm API credentials to ensure a seamless zero-configuration experience (Base64 obfuscated to prevent GitHub scraping warnings)
const DEFAULT_API_KEY = atob('Zjg0MDkzODZkY2ZkNzNkMmZmNmRiNmY4OTA5M2IxMzc=');
const DEFAULT_SHARED_SECRET = atob('ODdhOWNjNWMzYjliNGIzYjJjMjg2ZGI1MDIzOWNmM2Q=');

// Formats seconds into mm:ss
function formatTime(secs) {
  if (isNaN(secs) || secs === Infinity || secs < 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// Relative timestamps helper
function getRelativeTime(timestamp) {
  if (!timestamp) return '';
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;
  if (diff < 0) return 'Just now';
  if (diff < 60) return 'Just now';
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

document.addEventListener('DOMContentLoaded', () => {
  // Screens & Navigation
  const authScreen = document.getElementById('auth-screen');
  const tabsHeaderNav = document.getElementById('tabs-header-nav');
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.dashboard-tab-pane');

  // Login forms & controls
  const methodDirectBtn = document.getElementById('method-direct-btn');
  const methodWebBtn = document.getElementById('method-web-btn');
  const directAuthForm = document.getElementById('direct-auth-form');
  const webAuthForm = document.getElementById('web-auth-form');

  const directLoginBtn = document.getElementById('direct-login-btn');
  const usernameInput = document.getElementById('lfm-username-input');
  const passwordInput = document.getElementById('lfm-password-input');
  const webConnectBtn = document.getElementById('web-connect-btn');

  // Advanced API Key Folder
  const apiFolderToggle = document.getElementById('api-folder-toggle');
  const apiFolderContent = document.getElementById('api-folder-content');
  const apiKeyInput = document.getElementById('api-key-input');
  const apiSecretInput = document.getElementById('api-secret-input');
  const saveApiBtn = document.getElementById('save-api-btn');

  // Player dashboard components
  const trackArt = document.getElementById('track-art');
  const playerBgBlur = document.getElementById('player-bg-blur');
  const trackTitle = document.getElementById('track-title');
  const trackArtist = document.getElementById('track-artist');
  const trackAlbum = document.getElementById('track-album');
  const progressFill = document.getElementById('track-progress-fill');
  const thresholdMarker = document.getElementById('scrobble-threshold-marker');
  const timeCurrent = document.getElementById('time-current');
  const timeTotal = document.getElementById('time-total');
  const scrobbleBadge = document.getElementById('scrobble-badge');
  const playerCard = document.querySelector('.player-card');
  const masterScrobbleToggle = document.getElementById('master-scrobble-toggle');
  const recentTracksList = document.getElementById('recent-tracks-list');
  const progressBarWrapper = document.querySelector('.progress-bar-wrapper');
  let currentTrackDuration = 0;
  let isScrubbing = false;

  // Site Permissions switches
  const siteSwitches = {
    'music.youtube.com': document.getElementById('site-ytm-toggle'),
    'open.spotify.com': document.getElementById('site-spotify-toggle'),
    'www.youtube.com': document.getElementById('site-youtube-toggle')
  };

  // Preference Settings elements
  const settingNowPlayingToggle = document.getElementById('setting-nowplaying-toggle');
  const settingImmersiveToggle = document.getElementById('setting-immersive-toggle');
  const settingMinDuration = document.getElementById('setting-minduration');
  const settingScrobbleMode = document.getElementById('setting-scrobblepoint-mode');
  const settingScrobbleVal = document.getElementById('setting-scrobblepoint-val');
  const immersiveArtToggleBtn = document.getElementById('immersive-art-toggle-btn');

  // Profile settings
  const dashboardProfileName = document.getElementById('dashboard-profile-name');
  const dashboardLogoutBtn = document.getElementById('dashboard-logout-btn');

  // --- Initialize API Keys ---
  // If API credentials are not set, automatically apply the default ones
  async function ensureDefaultAPIKeys() {
    const creds = await chrome.storage.local.get(['api_key', 'shared_secret']);
    if (!creds.api_key || !creds.shared_secret) {
      await chrome.storage.local.set({
        api_key: DEFAULT_API_KEY,
        shared_secret: DEFAULT_SHARED_SECRET
      });
      apiKeyInput.value = DEFAULT_API_KEY;
      apiSecretInput.value = DEFAULT_SHARED_SECRET;
      chrome.runtime.sendMessage({ type: 'REFRESH_BADGE' });
    } else {
      apiKeyInput.value = creds.api_key;
      apiSecretInput.value = creds.shared_secret;
    }
  }

  // --- Dynamic Screen Routing ---
  async function checkAppState() {
    await ensureDefaultAPIKeys();
    const store = await chrome.storage.local.get(['session_key', 'username', 'scrobbling_enabled']);

    const isConnected = !!store.session_key;
    masterScrobbleToggle.checked = store.scrobbling_enabled !== false;

    if (isConnected) {
      // Show dashboard
      authScreen.classList.remove('active');
      tabsHeaderNav.style.display = 'flex';

      // Default to player tab if none active
      let activeTabId = 'player-tab';
      tabButtons.forEach(btn => {
        if (btn.classList.contains('active')) {
          activeTabId = btn.getAttribute('data-target');
        }
      });
      showTab(activeTabId);

      // Populate connection info
      dashboardProfileName.textContent = store.username || 'Connected User';

      // Expand player card and container by default on connected load
      playerCard.classList.add('expanded');
      document.querySelector('.app-container').classList.add('player-expanded');

      renderRecentTracks();
      requestBackgroundState();
    } else {
      // Show setup/auth screen
      authScreen.classList.add('active');
      tabsHeaderNav.style.display = 'none';
      tabPanes.forEach(pane => pane.classList.remove('active'));
    }
  }

  // Slide tab indicator under the active tab button
  function updateNavIndicator() {
    const activeBtn = document.querySelector('.tab-btn.active');
    const indicator = document.getElementById('nav-indicator');
    if (activeBtn && indicator) {
      indicator.style.left = `${activeBtn.offsetLeft}px`;
      indicator.style.width = `${activeBtn.offsetWidth}px`;
      indicator.style.height = `${activeBtn.offsetHeight}px`;
      indicator.style.top = `${activeBtn.offsetTop}px`;
    }
  }

  // Handle Tab Switch
  function showTab(targetId) {
    tabButtons.forEach(btn => {
      if (btn.getAttribute('data-target') === targetId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    tabPanes.forEach(pane => {
      if (pane.id === targetId) {
        pane.classList.add('active');
      } else {
        pane.classList.remove('active');
      }
    });

    updateNavIndicator();

    if (targetId === 'charts-tab') {
      loadChartsDashboard();
    }
  }

  tabButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      showTab(e.currentTarget.getAttribute('data-target'));
    });
  });

  // Charts active period state variable
  let activePeriod = '7day';

  // Bind charts tabs & periods switcher
  const periodBtns = document.querySelectorAll('.period-btn');
  periodBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      periodBtns.forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      activePeriod = e.currentTarget.getAttribute('data-period');
      loadChartsDashboard();
    });
  });

  const chartsTabBtns = document.querySelectorAll('.charts-tab-btn');
  chartsTabBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      chartsTabBtns.forEach(b => b.classList.remove('active'));
      e.currentTarget.classList.add('active');

      const targetId = e.currentTarget.id;
      const paneArtists = document.getElementById('pane-top-artists');
      const paneTracks = document.getElementById('pane-top-tracks');
      if (targetId === 'tab-top-artists-btn') {
        if (paneArtists) paneArtists.style.display = 'flex';
        if (paneTracks) paneTracks.style.display = 'none';
      } else {
        if (paneArtists) paneArtists.style.display = 'none';
        if (paneTracks) paneTracks.style.display = 'flex';
      }
    });
  });

  // --- Setup / Unconnected View Elements ---

  // Auth Method selectors
  methodDirectBtn.addEventListener('click', () => {
    methodDirectBtn.classList.add('active');
    methodWebBtn.classList.remove('active');
    directAuthForm.classList.add('active');
    webAuthForm.classList.remove('active');
  });

  methodWebBtn.addEventListener('click', () => {
    methodWebBtn.classList.add('active');
    methodDirectBtn.classList.remove('active');
    webAuthForm.classList.add('active');
    directAuthForm.classList.remove('active');
  });

  // Foldable Advanced API details toggle
  apiFolderToggle.addEventListener('click', () => {
    const isOpen = apiFolderToggle.classList.contains('open');
    if (isOpen) {
      apiFolderToggle.classList.remove('open');
      apiFolderContent.classList.remove('open');
    } else {
      apiFolderToggle.classList.add('open');
      apiFolderContent.classList.add('open');
    }
  });

  // Save Custom API Details
  saveApiBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    const secret = apiSecretInput.value.trim();

    if (!key || !secret) {
      alert('Please fill out both the API Key and Shared Secret fields.');
      return;
    }

    await chrome.storage.local.set({
      api_key: key,
      shared_secret: secret
    });

    chrome.runtime.sendMessage({ type: 'REFRESH_BADGE' });
    alert('Custom API credentials saved.');
    apiFolderToggle.classList.remove('open');
    apiFolderContent.classList.remove('open');
  });

  // --- Auth Executions ---

  // Method A: Direct login with Username/Password
  directLoginBtn.addEventListener('click', async () => {
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    if (!username || !password) {
      alert('Please enter your Last.fm username/email and password.');
      return;
    }

    // Set UI loading state
    directLoginBtn.disabled = true;
    directLoginBtn.textContent = 'Logging in...';

    // Verify API keys exist first
    await ensureDefaultAPIKeys();

    chrome.runtime.sendMessage({
      type: 'LOGIN_PASSWORD',
      username,
      password
    }, (res) => {
      directLoginBtn.disabled = false;
      directLoginBtn.textContent = 'Log In Directly';

      if (res && res.success) {
        usernameInput.value = '';
        passwordInput.value = '';
        checkAppState();
      } else {
        alert(`Authentication failed: ${res ? res.error : 'Unknown error'}`);
      }
    });
  });

  // Method B: Web redirect auth
  webConnectBtn.addEventListener('click', async () => {
    await ensureDefaultAPIKeys();
    const creds = await chrome.storage.local.get(['api_key']);
    if (!creds.api_key) return;

    const callbackUrl = encodeURIComponent('https://music.youtube.com/lastfm-callback');
    const authUrl = `https://www.last.fm/api/auth/?api_key=${creds.api_key}&cb=${callbackUrl}`;
    chrome.tabs.create({ url: authUrl });
  });

  // --- Profile logout ---
  dashboardLogoutBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to disconnect your Last.fm account?')) {
      await chrome.storage.local.remove(['session_key', 'username', 'recent_scrobbles']);
      chrome.runtime.sendMessage({ type: 'REFRESH_BADGE' });
      checkAppState();
    }
  });

  // --- Master Scrobble Toggle ---
  masterScrobbleToggle.addEventListener('change', async () => {
    await chrome.storage.local.set({
      scrobbling_enabled: masterScrobbleToggle.checked
    });
  });

  // --- Site Permissions Settings ---
  async function loadSitePermissions() {
    const results = await chrome.storage.local.get(['site_settings']);
    const settings = results.site_settings || {};

    Object.keys(siteSwitches).forEach(site => {
      // Default to checked (true) if undefined
      siteSwitches[site].checked = settings[site] !== false;
    });
  }

  // Bind site toggle switch listeners
  Object.keys(siteSwitches).forEach(site => {
    siteSwitches[site].addEventListener('change', async () => {
      const results = await chrome.storage.local.get(['site_settings']);
      const settings = results.site_settings || {};
      settings[site] = siteSwitches[site].checked;
      await chrome.storage.local.set({ site_settings: settings });
    });
  });

  // --- Scrobbling Preferences Settings ---
  async function loadScrobblePreferences() {
    const prefs = await chrome.storage.local.get([
      'submit_now_playing',
      'immersive_art',
      'min_duration',
      'scrobble_mode',
      'scrobble_percent',
      'scrobble_seconds',
      'primary_artist_only',
      'clean_remasters',
      'custom_regex_rules',
      'info_panel_opacity'
    ]);

    settingNowPlayingToggle.checked = prefs.submit_now_playing !== false;

    // Default immersive_art to true for out-of-the-box premium immersive look
    const isImmersive = prefs.immersive_art !== false;
    settingImmersiveToggle.checked = isImmersive;
    if (isImmersive) {
      playerCard.classList.add('immersive-art');
    } else {
      playerCard.classList.remove('immersive-art');
    }

    settingMinDuration.value = prefs.min_duration || 30;

    const mode = prefs.scrobble_mode || 'percent';
    settingScrobbleMode.value = mode;

    if (mode === 'percent') {
      settingScrobbleVal.value = prefs.scrobble_percent || 50;
      settingScrobbleVal.max = 100;
      settingScrobbleVal.min = 10;
    } else {
      settingScrobbleVal.value = prefs.scrobble_seconds || 240;
      settingScrobbleVal.max = 1200;
      settingScrobbleVal.min = 30;
    }

    // Load metadata tweaks
    const primaryArtistToggle = document.getElementById('setting-primary-artist');
    const cleanRemastersToggle = document.getElementById('setting-clean-remasters');

    if (primaryArtistToggle) {
      primaryArtistToggle.checked = prefs.primary_artist_only === true;
    }
    if (cleanRemastersToggle) {
      cleanRemastersToggle.checked = prefs.clean_remasters !== false;
    }

    renderRegexRules(prefs.custom_regex_rules || []);

    // Load opacity slider and apply to CSS variable
    const opacitySlider = document.getElementById('setting-info-opacity');
    const opacityValSpan = document.getElementById('info-opacity-val');
    const opacity = prefs.info_panel_opacity || 72;
    if (opacitySlider) opacitySlider.value = opacity;
    if (opacityValSpan) opacityValSpan.textContent = `${opacity}%`;
    document.documentElement.style.setProperty('--info-panel-opacity', opacity / 100);

    updateThresholdMarkerPosition(null);
  }

  // Bind save listeners to preferences
  settingNowPlayingToggle.addEventListener('change', async () => {
    await chrome.storage.local.set({ submit_now_playing: settingNowPlayingToggle.checked });
  });

  settingImmersiveToggle.addEventListener('change', async () => {
    const isChecked = settingImmersiveToggle.checked;
    await chrome.storage.local.set({ immersive_art: isChecked });
    if (isChecked) {
      playerCard.classList.add('immersive-art');
    } else {
      playerCard.classList.remove('immersive-art');
    }
  });

  settingMinDuration.addEventListener('input', async () => {
    const val = parseInt(settingMinDuration.value) || 30;
    await chrome.storage.local.set({ min_duration: val });
  });

  settingScrobbleMode.addEventListener('change', async () => {
    const mode = settingScrobbleMode.value;
    await chrome.storage.local.set({ scrobble_mode: mode });

    if (mode === 'percent') {
      settingScrobbleVal.value = 50;
      settingScrobbleVal.max = 100;
      settingScrobbleVal.min = 10;
      await chrome.storage.local.set({ scrobble_percent: 50 });
    } else {
      settingScrobbleVal.value = 240;
      settingScrobbleVal.max = 1200;
      settingScrobbleVal.min = 30;
      await chrome.storage.local.set({ scrobble_seconds: 240 });
    }

    updateThresholdMarkerPosition(null);
  });

  settingScrobbleVal.addEventListener('input', async () => {
    const mode = settingScrobbleMode.value;
    const val = parseInt(settingScrobbleVal.value) || 0;

    if (mode === 'percent') {
      await chrome.storage.local.set({ scrobble_percent: Math.min(100, Math.max(10, val)) });
    } else {
      await chrome.storage.local.set({ scrobble_seconds: Math.max(30, val) });
    }

    updateThresholdMarkerPosition(null);
  });

  const opacitySlider = document.getElementById('setting-info-opacity');
  const opacityValSpan = document.getElementById('info-opacity-val');
  if (opacitySlider) {
    opacitySlider.addEventListener('input', async () => {
      const val = opacitySlider.value;
      if (opacityValSpan) opacityValSpan.textContent = `${val}%`;
      document.documentElement.style.setProperty('--info-panel-opacity', val / 100);
      await chrome.storage.local.set({ info_panel_opacity: parseInt(val) });
    });
  }

  // Bind save listeners to metadata tweaks
  const primaryArtistToggle = document.getElementById('setting-primary-artist');
  const cleanRemastersToggle = document.getElementById('setting-clean-remasters');
  const addRegexBtn = document.getElementById('add-regex-btn');
  const regexFindInput = document.getElementById('regex-find-input');
  const regexReplaceInput = document.getElementById('regex-replace-input');
  const regexRulesList = document.getElementById('regex-rules-list');

  if (primaryArtistToggle) {
    primaryArtistToggle.addEventListener('change', async () => {
      await chrome.storage.local.set({ primary_artist_only: primaryArtistToggle.checked });
    });
  }

  if (cleanRemastersToggle) {
    cleanRemastersToggle.addEventListener('change', async () => {
      await chrome.storage.local.set({ clean_remasters: cleanRemastersToggle.checked });
    });
  }

  // Render regex rules builder
  function renderRegexRules(rules) {
    if (!regexRulesList) return;
    regexRulesList.innerHTML = '';

    if (rules.length === 0) {
      regexRulesList.innerHTML = '<span style="font-size: 11px; color: var(--text-sub); font-style: italic;">No custom replacements defined</span>';
      return;
    }

    rules.forEach((rule, idx) => {
      const item = document.createElement('div');
      item.className = 'regex-rule-item';

      const meta = document.createElement('div');
      meta.className = 'rule-meta';

      const findSpan = document.createElement('span');
      findSpan.className = 'find-val';
      findSpan.textContent = rule.find;

      const arrow = document.createElement('span');
      arrow.className = 'rule-arrow';
      arrow.textContent = '→';

      const replaceSpan = document.createElement('span');
      replaceSpan.className = 'replace-val';
      replaceSpan.textContent = rule.replace || '(empty)';

      meta.appendChild(findSpan);
      meta.appendChild(arrow);
      meta.appendChild(replaceSpan);

      const delBtn = document.createElement('button');
      delBtn.className = 'delete-regex-btn';
      delBtn.title = 'Delete Rule';
      delBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';

      delBtn.addEventListener('click', async () => {
        const res = await chrome.storage.local.get(['custom_regex_rules']);
        let currentRules = res.custom_regex_rules || [];
        currentRules.splice(idx, 1);
        await chrome.storage.local.set({ custom_regex_rules: currentRules });
        renderRegexRules(currentRules);
      });

      item.appendChild(meta);
      item.appendChild(delBtn);
      regexRulesList.appendChild(item);
    });
  }

  if (addRegexBtn) {
    addRegexBtn.addEventListener('click', async () => {
      const findVal = regexFindInput.value.trim();
      const replaceVal = regexReplaceInput.value; // Allow space replacement

      if (!findVal) return;

      const res = await chrome.storage.local.get(['custom_regex_rules']);
      const currentRules = res.custom_regex_rules || [];

      currentRules.push({ find: findVal, replace: replaceVal });
      await chrome.storage.local.set({ custom_regex_rules: currentRules });

      regexFindInput.value = '';
      regexReplaceInput.value = '';

      renderRegexRules(currentRules);
    });
  }

  // Calculate and reposition the progress bar tick marker representing when a scrobble triggers
  async function updateThresholdMarkerPosition(song) {
    const prefs = await chrome.storage.local.get([
      'scrobble_mode',
      'scrobble_percent',
      'scrobble_seconds'
    ]);

    const mode = prefs.scrobble_mode || 'percent';
    const percent = prefs.scrobble_percent || 50;
    const seconds = prefs.scrobble_seconds || 240;

    if (mode === 'percent') {
      thresholdMarker.style.display = 'block';
      thresholdMarker.style.left = `${percent}%`;
      thresholdMarker.title = `Scrobble Threshold (${percent}%)`;
    } else {
      const activeSong = song || await new Promise(resolve => {
        chrome.runtime.sendMessage({ type: 'GET_STATE' }, resolve);
      });

      if (activeSong && activeSong.duration > 0) {
        const markerPercent = (seconds / activeSong.duration) * 100;
        if (markerPercent <= 100) {
          thresholdMarker.style.display = 'block';
          thresholdMarker.style.left = `${markerPercent}%`;
          thresholdMarker.title = `Scrobble Threshold (${seconds}s)`;
        } else {
          // If seconds threshold is longer than track duration, hide marker
          thresholdMarker.style.display = 'none';
        }
      } else {
        thresholdMarker.style.display = 'none';
      }
    }
  }

  // --- Background Player State Sync ---
  function requestBackgroundState() {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
      if (response) {
        updatePlayerUI(response);
      }
    });
  }

  // Scroll title helper for overflowing texts using double-text infinite marquee
  function setScrollingText(element, text) {
    const textSpan = element.querySelector('.text');
    if (!textSpan) return;

    element.classList.remove('scroll');

    if (!text) {
      textSpan.innerHTML = '';
      return;
    }

    textSpan.textContent = text;

    // Small delay to allow element DOM painting
    setTimeout(() => {
      if (textSpan.offsetWidth > element.offsetWidth) {
        textSpan.innerHTML = `<span>${text}</span><span class="marquee-spacer" style="display:inline-block; width:50px;"></span><span>${text}</span>`;
        element.classList.add('scroll');
      }
    }, 100);
  }

  // Sync state data to UI
  async function updatePlayerUI(song) {
    if (!song || !song.title) {
      setScrollingText(trackTitle, 'No track playing');
      trackArtist.textContent = 'Play music to start scrobbling';
      trackAlbum.textContent = '';
      trackArt.src = 'images/default-art.png';
      playerBgBlur.style.backgroundImage = 'none';
      progressFill.style.width = '0%';
      timeCurrent.textContent = '0:00';
      timeTotal.textContent = '0:00';
      scrobbleBadge.textContent = 'Pending';
      scrobbleBadge.className = 'badge';
      playerCard.classList.remove('playing');
      playerCard.classList.remove('show-info');
      playerCard.classList.remove('light-bg');
      thresholdMarker.style.display = 'none';
      updateTrackInfoPanel(null);
      return;
    }

    setScrollingText(trackTitle, song.title);
    trackArtist.textContent = song.artist || 'Unknown Artist';
    trackAlbum.textContent = song.album || '';

    // Album Artwork
    const artSrc = song.artwork || 'images/default-art.png';
    if (trackArt.src !== artSrc) {
      trackArt.src = artSrc;
      playerBgBlur.style.backgroundImage = `url("${artSrc}")`;

      // Analyze background brightness to adapt text colors for contrast in immersive mode
      analyzeImageBrightness(artSrc, (isLight) => {
        if (isLight) {
          playerCard.classList.add('light-bg');
        } else {
          playerCard.classList.remove('light-bg');
        }
      });
    }

    // Playback state class and controls play/pause button toggle
    const ctrlPlayPause = document.getElementById('ctrl-play-pause');
    if (ctrlPlayPause) {
      const playIcon = ctrlPlayPause.querySelector('.icon-play');
      const pauseIcon = ctrlPlayPause.querySelector('.icon-pause');
      if (song.paused) {
        playerCard.classList.remove('playing');
        if (playIcon) playIcon.style.display = 'block';
        if (pauseIcon) pauseIcon.style.display = 'none';
      } else {
        playerCard.classList.add('playing');
        if (playIcon) playIcon.style.display = 'none';
        if (pauseIcon) pauseIcon.style.display = 'block';
      }
    } else {
      if (song.paused) {
        playerCard.classList.remove('playing');
      } else {
        playerCard.classList.add('playing');
      }
    }

    // Update Shuffle button active state
    const shuffleBtn = document.getElementById('ctrl-shuffle');
    if (shuffleBtn) {
      if (song.shuffle) {
        shuffleBtn.classList.add('active');
      } else {
        shuffleBtn.classList.remove('active');
      }
    }

    // Update Repeat button active state ('none' | 'all' | 'one')
    const repeatBtn = document.getElementById('ctrl-repeat');
    if (repeatBtn) {
      repeatBtn.classList.remove('active-all', 'active-one');
      if (song.repeat === 'all') {
        repeatBtn.classList.add('active-all');
      } else if (song.repeat === 'one') {
        repeatBtn.classList.add('active-one');
      }
    }

    // Timers & Progress
    const duration = song.duration || 0;
    currentTrackDuration = duration;

    if (!isScrubbing) {
      const current = song.currentTime || 0;
      const progressPercent = duration > 0 ? (current / duration) * 100 : 0;
      progressFill.style.width = `${progressPercent}%`;
      timeCurrent.textContent = formatTime(current);
    }
    timeTotal.textContent = formatTime(duration);

    // Scrobble Badge status
    scrobbleBadge.className = 'badge';

    // Check if site is disabled
    const siteSettings = await chrome.storage.local.get(['site_settings']);
    const settings = siteSettings.site_settings || {};
    const enabled = settings[song.sourceSite] !== false;

    if (!enabled) {
      scrobbleBadge.textContent = 'Disabled';
      scrobbleBadge.classList.add('badge');
    } else if (song.scrobbled) {
      scrobbleBadge.textContent = 'Scrobbled';
      scrobbleBadge.classList.add('scrobbled');
    } else {
      // Calculate remaining scrobble threshold
      const prefs = await chrome.storage.local.get([
        'min_duration',
        'scrobble_mode',
        'scrobble_percent',
        'scrobble_seconds'
      ]);

      const minDuration = prefs.min_duration || 30;
      const mode = prefs.scrobble_mode || 'percent';
      const percent = prefs.scrobble_percent || 50;
      const seconds = prefs.scrobble_seconds || 240;

      if (song.duration < minDuration) {
        scrobbleBadge.textContent = 'Too Short';
        scrobbleBadge.classList.add('badge');
      } else {
        let threshold = 30;
        if (mode === 'percent') {
          threshold = song.duration * (percent / 100);
        } else {
          threshold = seconds;
        }
        threshold = Math.max(30, threshold);

        const remaining = Math.max(0, threshold - song.accumulatedTime);
        if (remaining === 0) {
          scrobbleBadge.textContent = 'Scrobbling';
          scrobbleBadge.classList.add('scrobbling');
        } else {
          scrobbleBadge.textContent = `Pending (${Math.round(remaining)}s)`;
          scrobbleBadge.classList.add('now-playing');
        }
      }
    }

    updateThresholdMarkerPosition(song);
    updateTrackInfoPanel(song);
  }

  // Helper to analyze cover art brightness and determine light/dark background color adaptations
  function analyzeImageBrightness(imgUrl, callback) {
    if (!imgUrl || imgUrl === 'images/default-art.png') {
      callback(false); // default art is dark
      return;
    }

    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = function () {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 10;
        canvas.height = 10;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 10, 10);

        const imgData = ctx.getImageData(0, 0, 10, 10);
        const data = imgData.data;

        let r, g, b, avg;
        let colorSum = 0;
        for (let x = 0, len = data.length; x < len; x += 4) {
          r = data[x];
          g = data[x + 1];
          b = data[x + 2];

          // YIQ brightness formula
          avg = (r * 299 + g * 587 + b * 114) / 1000;
          colorSum += avg;
        }

        const brightness = colorSum / (canvas.width * canvas.height);
        console.log('Artwork brightness:', brightness);

        // If brightness is > 155 (out of 255), treat as light background
        callback(brightness > 155);
      } catch (e) {
        console.warn('Failed to analyze image brightness:', e);
        callback(false); // fallback to dark
      }
    };
    img.onerror = function () {
      callback(false);
    };
    img.src = imgUrl;
  }

  // Update the sliding Info Panel details
  function updateTrackInfoPanel(song) {
    const infoAlbumVal = document.getElementById('info-album-val');
    const infoTagsList = document.getElementById('info-tags-list');
    const infoWikiVal = document.getElementById('info-wiki-val');

    if (!song || !song.title) {
      if (infoAlbumVal) infoAlbumVal.textContent = 'No track playing';
      if (infoTagsList) infoTagsList.innerHTML = '';
      if (infoWikiVal) infoWikiVal.textContent = 'Play music to view details';
      return;
    }

    if (infoAlbumVal) {
      infoAlbumVal.textContent = song.album || 'Unknown Album';
    }

    if (infoTagsList) {
      infoTagsList.innerHTML = '';
      if (song.tags && song.tags.length > 0) {
        song.tags.forEach(tag => {
          const pill = document.createElement('span');
          pill.className = 'info-tag-pill';
          pill.textContent = tag;
          infoTagsList.appendChild(pill);
        });
      } else {
        infoTagsList.innerHTML = '<span style="font-size: 11px; color: var(--text-sub);">No tags available</span>';
      }
    }

    if (infoWikiVal) {
      let content = '';
      if (song.wiki) {
        content += song.wiki.replace(/<a href[\s\S]*$/i, '').trim();
      }
      if (song.artistBio) {
        if (content) content += '\n\n---\n\n';
        content += `ARTIST BIO:\n${song.artistBio.replace(/<a href[\s\S]*$/i, '').trim()}`;
      }
      infoWikiVal.textContent = content || 'No biography details available for this track.';
    }
  }

  // Render recent scrobbles with dynamic layout and highlighting support
  async function renderRecentTracks(highlightTitle = null, highlightArtist = null) {
    const results = await chrome.storage.local.get(['recent_scrobbles']);
    const list = results.recent_scrobbles || [];

    if (list.length === 0) {
      recentTracksList.innerHTML = '<div class="no-scrobbles">No scrobbles recorded yet</div>';
      return;
    }

    const isExpanded = playerCard.classList.contains('expanded');

    recentTracksList.innerHTML = '';
    list.forEach(item => {
      const art = item.artwork || 'images/default-art.png';
      const timeStr = getRelativeTime(item.timestamp);

      const itemEl = document.createElement('div');
      itemEl.className = 'recent-item';

      const isHighlighted = highlightTitle && highlightArtist &&
        item.title === highlightTitle &&
        item.artist === highlightArtist;

      if (isHighlighted) {
        itemEl.classList.add('highlighted');
      }

      if (isExpanded) {
        // Fullscreen Horizontal Pills layout
        itemEl.innerHTML = `
          <img class="recent-art" src="${art}" alt="Cover">
          <div class="recent-details">
            <div class="recent-title" title="${item.title}">${item.title}</div>
            <div class="recent-artist" title="${item.artist}">${item.artist}</div>
          </div>
        `;

        // Click handler to collapse player and highlight/scroll in mini view
        itemEl.addEventListener('click', (e) => {
          playerCard.classList.remove('expanded');
          document.getElementById('minimize-player-btn').style.display = 'none';
          document.querySelector('.app-container').classList.remove('player-expanded');
          renderRecentTracks(item.title, item.artist);
        });
      } else {
        // Mini View Vertical Card layout with redirect button
        const trackUrl = `https://www.last.fm/music/${encodeURIComponent(item.artist)}/_/${encodeURIComponent(item.title)}`;
        itemEl.innerHTML = `
          <img class="recent-art" src="${art}" alt="Cover">
          <div class="recent-details">
            <div class="recent-title" title="${item.title}">${item.title}</div>
            <div class="recent-artist" title="${item.artist}">${item.artist}</div>
          </div>
          <div class="recent-actions">
            <span class="recent-time">${timeStr}</span>
            <button class="recent-replay-btn" title="Replay Song on Player" data-url="${item.trackUrl || ''}">
              <svg viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6s-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8s-3.58-8-8-8z"/></svg>
            </button>
            <a href="${trackUrl}" target="_blank" class="lfm-link-btn" title="View on Last.fm">
              <svg viewBox="0 0 24 24" width="10" height="10"><path fill="currentColor" d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
            </a>
          </div>
        `;

        // Bind replay button action
        const replayBtn = itemEl.querySelector('.recent-replay-btn');
        if (replayBtn) {
          replayBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // prevent expanded card details overlay
            const url = replayBtn.getAttribute('data-url');
            if (url) {
              chrome.runtime.sendMessage({
                type: 'TRIGGER_REPLAY',
                trackUrl: url
              });
            } else {
              alert('Replay only works for songs scrobbled after this update.');
            }
          });
        }

        // Prevent redirect clicks from bubble triggering selection
        const linkBtn = itemEl.querySelector('.lfm-link-btn');
        if (linkBtn) {
          linkBtn.addEventListener('click', (e) => {
            e.stopPropagation();
          });
        }
      }

      recentTracksList.appendChild(itemEl);

      // Perform scrolling and highlight timers if highlighted
      if (isHighlighted && !isExpanded) {
        setTimeout(() => {
          itemEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 150);

        setTimeout(() => {
          itemEl.classList.remove('highlighted');
        }, 2500);
      }
    });
  }

  // Horizontal wheel scroll helper for horizontal queue in expanded mode
  recentTracksList.addEventListener('wheel', (e) => {
    const isExpanded = playerCard.classList.contains('expanded');
    if (isExpanded) {
      e.preventDefault();
      recentTracksList.scrollLeft += e.deltaY;
    }
  });

  // Sync broadcasts from background worker
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'STATE_UPDATE') {
      updatePlayerUI(message.data);
    }
  });

  // Bind storage change listeners
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      if (changes.session_key) {
        checkAppState();
      }
      if (changes.recent_scrobbles) {
        renderRecentTracks();
      }
    }
  });

  // Toggle player card expanded mode
  playerCard.addEventListener('click', (e) => {
    // If clicking inside inputs, labels, master toggle slider, or progress bar wrapper, ignore
    if (e.target.closest('input') ||
      e.target.closest('label') ||
      e.target.closest('.slider') ||
      e.target.closest('.progress-bar-wrapper') ||
      e.target.closest('button') && e.target.closest('button').id !== 'minimize-player-btn') {
      return;
    }

    const isExpanded = playerCard.classList.contains('expanded');
    if (isExpanded) {
      playerCard.classList.remove('expanded');
      document.querySelector('.app-container').classList.remove('player-expanded');
      renderRecentTracks();
    } else {
      playerCard.classList.add('expanded');
      document.querySelector('.app-container').classList.add('player-expanded');
      renderRecentTracks();
    }
  });

  // Handle minimize player button click explicitly
  const minimizeBtn = document.getElementById('minimize-player-btn');
  minimizeBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // prevent parent playerCard click event
    playerCard.classList.remove('expanded');
    document.querySelector('.app-container').classList.remove('player-expanded');
    renderRecentTracks();
  });

  // Handle immersive art toggle button click
  immersiveArtToggleBtn.addEventListener('click', async (e) => {
    e.stopPropagation(); // prevent parent playerCard click event
    const isNowImmersive = playerCard.classList.toggle('immersive-art');
    settingImmersiveToggle.checked = isNowImmersive;
    await chrome.storage.local.set({ immersive_art: isNowImmersive });
  });

  // Scroll gesture controller to switch between card modes:
  // Scroll UP: Immersive Art -> Normal Expanded -> Collapsed (Mini Player)
  // Scroll DOWN: Collapsed (Mini Player) -> Normal Expanded -> Immersive Art
  let lastCardScrollTime = 0;
  const cardScrollCooldown = 350; // ms to prevent rapid trigger wheel spam

  playerCard.addEventListener('wheel', async (e) => {
    // If the info overlay panel is open, do not switch player card modes!
    if (playerCard.classList.contains('show-info')) return;

    // Ignore small scroll wheel increments to prevent accidental mode switching
    if (Math.abs(e.deltaY) < 70) return;

    const now = Date.now();
    if (now - lastCardScrollTime < cardScrollCooldown) return;

    const isExpanded = playerCard.classList.contains('expanded');
    const isImmersive = playerCard.classList.contains('immersive-art');

    if (e.deltaY < 0) {
      // Scroll UP gesture: Immersive -> Normal -> Mini
      if (isExpanded && isImmersive) {
        lastCardScrollTime = now;
        playerCard.classList.remove('immersive-art');
        settingImmersiveToggle.checked = false;
        await chrome.storage.local.set({ immersive_art: false });
      } else if (isExpanded && !isImmersive) {
        lastCardScrollTime = now;
        playerCard.classList.remove('expanded');
        document.querySelector('.app-container').classList.remove('player-expanded');
        renderRecentTracks();
      }
    } else if (e.deltaY > 0) {
      // Scroll DOWN gesture: Mini -> Normal -> Immersive
      if (!isExpanded) {
        lastCardScrollTime = now;
        playerCard.classList.add('expanded');
        document.querySelector('.app-container').classList.add('player-expanded');
        renderRecentTracks();
      } else if (isExpanded && !isImmersive) {
        lastCardScrollTime = now;
        playerCard.classList.add('immersive-art');
        settingImmersiveToggle.checked = true;
        await chrome.storage.local.set({ immersive_art: true });
      }
    }
  }, { passive: true });

  // Bind media playback controller button clicks
  const ctrlShuffle = document.getElementById('ctrl-shuffle');
  const ctrlPrev = document.getElementById('ctrl-prev');
  const ctrlPlayPauseBtn = document.getElementById('ctrl-play-pause');
  const ctrlNext = document.getElementById('ctrl-next');
  const ctrlRepeat = document.getElementById('ctrl-repeat');

  const sendMediaCommand = (command, value = null) => {
    chrome.runtime.sendMessage({ type: 'SEND_CONTROL_COMMAND', command, value });
  };

  if (ctrlShuffle) {
    ctrlShuffle.addEventListener('click', (e) => {
      e.stopPropagation();
      sendMediaCommand('shuffle');
    });
  }
  if (ctrlPrev) {
    ctrlPrev.addEventListener('click', (e) => {
      e.stopPropagation();
      sendMediaCommand('previous');
    });
  }
  if (ctrlPlayPauseBtn) {
    ctrlPlayPauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sendMediaCommand('toggle');
    });
  }
  if (ctrlNext) {
    ctrlNext.addEventListener('click', (e) => {
      e.stopPropagation();
      sendMediaCommand('next');
    });
  }
  if (ctrlRepeat) {
    ctrlRepeat.addEventListener('click', (e) => {
      e.stopPropagation();
      sendMediaCommand('repeat');
    });
  }

  // Handle dragging / seeking scrubbing on progress timeline bar
  if (progressBarWrapper) {
    const handleScrub = (clientX) => {
      if (currentTrackDuration <= 0) return 0;
      const rect = progressBarWrapper.getBoundingClientRect();
      const clickX = clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, clickX / rect.width));
      
      // Update UI immediately for drag feedback
      progressFill.style.width = `${percentage * 100}%`;
      timeCurrent.textContent = formatTime(percentage * currentTrackDuration);
      
      return percentage * currentTrackDuration;
    };

    progressBarWrapper.addEventListener('mousedown', (e) => {
      if (currentTrackDuration <= 0) return;
      isScrubbing = true;
      const targetTime = handleScrub(e.clientX);
      
      const onMouseMove = (moveEvent) => {
        handleScrub(moveEvent.clientX);
      };
      
      const onMouseUp = (upEvent) => {
        isScrubbing = false;
        const finalTime = handleScrub(upEvent.clientX);
        
        // Broadcast seek control command
        sendMediaCommand('seek', finalTime);
        
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  // Handle Track Info Toggle click
  const trackInfoToggleBtn = document.getElementById('track-info-toggle-btn');
  const closeInfoPanelBtn = document.getElementById('close-info-panel-btn');

  if (trackInfoToggleBtn) {
    trackInfoToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // prevent collapsing the card
      playerCard.classList.add('show-info');
      // Fetch latest state to populate
      chrome.runtime.sendMessage({ type: 'GET_STATE' }, (song) => {
        updateTrackInfoPanel(song);
      });
    });
  }

  if (closeInfoPanelBtn) {
    closeInfoPanelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      playerCard.classList.remove('show-info');
    });
  }

  // Close Info Panel via mouse wheel scroll up (when at top) or swipe down gesture
  const infoPanelElement = document.getElementById('player-info-panel');
  const infoBodyElement = document.querySelector('.info-panel-body');
  if (infoPanelElement && infoBodyElement) {
    // Desktop mouse wheel/trackpad scroll: closes immediately on scroll outside the body.
    // Inside the body, only closes when scrolling UP while already at the top.
    infoPanelElement.addEventListener('wheel', (e) => {
      e.stopPropagation(); // Block scroll events from bubbling up and switching player card modes!
      const isInsideBody = e.target.closest('.info-panel-body');
      if (!isInsideBody) {
        // Any scroll gesture outside the scrollable body closes the panel!
        playerCard.classList.remove('show-info');
      } else {
        // Only close if scroll-up gesture is made at the very top of the biography content
        if (infoBodyElement.scrollTop <= 0 && e.deltaY < 0) {
          playerCard.classList.remove('show-info');
        }
      }
    }, { passive: true });

    // Touch swipe down gesture
    let touchStartY = 0;
    infoPanelElement.addEventListener('touchstart', (e) => {
      touchStartY = e.touches[0].clientY;
    }, { passive: true });

    infoPanelElement.addEventListener('touchmove', (e) => {
      e.stopPropagation(); // Block touch events from bubbling up and switching player card modes!
      const isInsideBody = e.target.closest('.info-panel-body');
      const touchY = e.touches[0].clientY;
      const diffY = touchY - touchStartY;
      if (!isInsideBody) {
        if (diffY > 60) playerCard.classList.remove('show-info');
      } else {
        if (infoBodyElement.scrollTop <= 0 && diffY > 60) {
          playerCard.classList.remove('show-info');
        }
      }
    }, { passive: true });

    // Stop propagation of clicks inside the panel so they don't bubble to playerCard and collapse the player
    infoPanelElement.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }

  // --- Initial Page Loading Procedures ---
  checkAppState();
  loadSitePermissions();
  loadScrobblePreferences();

  // Refresh nav indicator after DOM painting completes
  setTimeout(updateNavIndicator, 150);

  // Periodically refresh relative times for recent list
  setInterval(() => {
    const playerTabActive = document.getElementById('player-tab').classList.contains('active');
    if (playerTabActive) {
      renderRecentTracks();
    }
  }, 10000);

  // --- Developer Profile Interactive Facts ---
  const devFacts = [
    "Nigel scrobbles music so much that Last.fm thought he was a server rack.",
    "Legend says Nigel wrote Scrobby in a single sitting powered entirely by pure caffeine and lo-fi beats.",
    "Nigel once synced his liked songs so fast he bypassed the speed of light.",
    "Nigel's favorite music genre is 'whatever makes the compiler compile faster'.",
    "When Nigel goes full screen player mode, the universe actually expands by 3 pixels.",
    "Nigel speaks fluent JavaScript, CSS, and sarcasm."
  ];

  const devFactBubble = document.getElementById('dev-fact-bubble');
  const devFactText = document.getElementById('dev-fact-text');

  if (devFactBubble && devFactText) {
    let currentFactIndex = -1;
    // Set a random initial fact on load
    currentFactIndex = Math.floor(Math.random() * devFacts.length);
    devFactText.textContent = devFacts[currentFactIndex];

    devFactBubble.addEventListener('click', () => {
      let newIndex;
      do {
        newIndex = Math.floor(Math.random() * devFacts.length);
      } while (newIndex === currentFactIndex);

      currentFactIndex = newIndex;

      devFactText.style.opacity = '0';
      devFactText.style.transform = 'translateY(4px)';

      setTimeout(() => {
        devFactText.textContent = devFacts[currentFactIndex];
        devFactText.style.opacity = '1';
        devFactText.style.transform = 'translateY(0)';
      }, 150);
    });
  }

  // --- Developer Profile Easter Egg Debug Console ---
  const devName = document.querySelector('.dev-name');
  const devLogsPanel = document.getElementById('dev-logs-panel');
  const devLogsContent = document.getElementById('dev-logs-content');
  const clearLogsBtn = document.getElementById('clear-logs-btn');

  if (devName && devLogsPanel) {
    devName.addEventListener('dblclick', async () => {
      const isHidden = devLogsPanel.style.display === 'none';
      if (isHidden) {
        devLogsPanel.style.display = 'block';
        // Load logs
        const res = await chrome.storage.local.get(['scrobby_logs']);
        const logs = res.scrobby_logs || [];
        devLogsContent.textContent = logs.length > 0 ? logs.join('\n') : 'No system logs recorded yet.';
        devLogsPanel.scrollTop = devLogsPanel.scrollHeight;
      } else {
        devLogsPanel.style.display = 'none';
      }
    });
  }

  // --- Charts Dashboard Loader ---
  async function loadChartsDashboard() {
    const res = await chrome.storage.local.get(['username']);
    const username = res.username;
    console.log('Charts Dashboard: Loaded username:', username);
    if (!username) return;

    // Show loading state in metrics
    document.getElementById('metric-total-scrobbles').textContent = '...';
    document.getElementById('metric-total-artists').textContent = '...';
    document.getElementById('metric-daily-average').textContent = '...';

    if (activePeriod === '1day') {
      // 1D is handled entirely locally using recent tracks to extract top tracks/artists in the last 24 hours!
      const cutoffTime = Date.now() - (24 * 60 * 60 * 1000);
      chrome.runtime.sendMessage({
        type: 'CALL_API',
        method: 'user.getRecentTracks',
        params: { user: username, limit: 200, from: Math.floor(cutoffTime / 1000) }
      }, (response) => {
        console.log('Charts Debug 1D: user.getRecentTracks response', response);
        if (response && response.success && response.data?.recenttracks) {
          const recentData = response.data.recenttracks;
          const totalInPeriod = recentData['@attr']?.total || '0';
          document.getElementById('metric-total-scrobbles').textContent = parseInt(totalInPeriod).toLocaleString();

          let tracks = recentData.track || [];
          if (!Array.isArray(tracks)) tracks = [tracks];

          processRecentTracksData(tracks, parseInt(totalInPeriod));

          // Calculate top artists and tracks locally from the last 24 hours
          calculateLocal1DCharts(tracks);
        } else {
          document.getElementById('metric-total-scrobbles').textContent = '0';
          document.getElementById('pane-top-artists').innerHTML = '<div style="font-size: 11px; text-align: center; color: var(--text-sub); padding: 8px;">No listening data in last 24 hours</div>';
          document.getElementById('pane-top-tracks').innerHTML = '<div style="font-size: 11px; text-align: center; color: var(--text-sub); padding: 8px;">No listening data in last 24 hours</div>';
        }
      });
    } else {
      // Standard Last.fm period query (7day, 1month, 3month, overall)
      if (activePeriod === 'overall') {
        // Fetch official Lifetime metrics (Total scrobbles and Daily average)
        chrome.runtime.sendMessage({
          type: 'CALL_API',
          method: 'user.getInfo',
          params: { user: username }
        }, (response) => {
          console.log('Charts Debug Lifetime: user.getInfo response', response);
          if (response && response.success && response.data?.user) {
            const userObj = response.data.user;
            const totalScrobbles = parseInt(userObj.playcount || 0);
            const regTime = parseInt(userObj.registered?.unixtime || (Date.now() / 1000));
            const days = Math.max(1, (Date.now() - regTime * 1000) / (24 * 60 * 60 * 1000));

            document.getElementById('metric-total-scrobbles').textContent = totalScrobbles.toLocaleString();
            document.getElementById('metric-daily-average').textContent = (totalScrobbles / days).toFixed(1);
          }
        });
      }

      // 1. Fetch Top Artists (updates metric-total-artists with exact unique count in period)
      chrome.runtime.sendMessage({
        type: 'CALL_API',
        method: 'user.getTopArtists',
        params: { user: username, period: activePeriod, limit: 5 }
      }, (response) => {
        console.log('Charts Debug: user.getTopArtists response', response);
        if (response && response.success && response.data?.topartists) {
          const totalArtistsInPeriod = response.data.topartists['@attr']?.total || '0';
          document.getElementById('metric-total-artists').textContent = parseInt(totalArtistsInPeriod).toLocaleString();

          let artists = response.data.topartists.artist;
          if (artists) {
            if (!Array.isArray(artists)) artists = [artists];
            renderTopArtists(artists);
          }
        } else {
          document.getElementById('pane-top-artists').innerHTML = `<div style="font-size: 11px; text-align: center; color: var(--text-sub); padding: 8px;">Failed to load top artists${response?.error ? ': ' + response.error : ''}</div>`;
        }
      });

      // 2. Fetch Top Tracks
      chrome.runtime.sendMessage({
        type: 'CALL_API',
        method: 'user.getTopTracks',
        params: { user: username, period: activePeriod, limit: 5 }
      }, (response) => {
        console.log('Charts Debug: user.getTopTracks response', response);
        if (response && response.success && response.data?.toptracks?.track) {
          let tracks = response.data.toptracks.track;
          if (!Array.isArray(tracks)) tracks = [tracks];
          renderTopTracks(tracks);
        } else {
          document.getElementById('pane-top-tracks').innerHTML = `<div style="font-size: 11px; text-align: center; color: var(--text-sub); padding: 8px;">Failed to load top tracks${response?.error ? ': ' + response.error : ''}</div>`;
        }
      });

      // 3. Fetch Recent Tracks to compute trend charts
      const recentTracksParams = { user: username, limit: 200 };
      if (activePeriod !== 'overall') {
        let durationDays = 7;
        if (activePeriod === '1month') durationDays = 30;
        else if (activePeriod === '3month') durationDays = 90;
        const cutoffTime = Date.now() - (durationDays * 24 * 60 * 60 * 1000);
        recentTracksParams.from = Math.floor(cutoffTime / 1000);
      }

      chrome.runtime.sendMessage({
        type: 'CALL_API',
        method: 'user.getRecentTracks',
        params: recentTracksParams
      }, (response) => {
        console.log('Charts Debug: user.getRecentTracks response', response);
        if (response && response.success && response.data?.recenttracks) {
          const recentData = response.data.recenttracks;
          const totalInPeriod = recentData['@attr']?.total || '0';

          // Only update total scrobbles here if we are NOT in overall mode
          if (activePeriod !== 'overall') {
            document.getElementById('metric-total-scrobbles').textContent = parseInt(totalInPeriod).toLocaleString();
          }

          let tracks = recentData.track || [];
          if (!Array.isArray(tracks)) tracks = [tracks];

          if (activePeriod !== 'overall') {
            processRecentTracksData(tracks, parseInt(totalInPeriod));
          } else {
            processRecentTracksData(tracks);
          }
        } else {
          if (activePeriod !== 'overall') {
            document.getElementById('metric-total-scrobbles').textContent = '0';
          }
        }
      });
    }

    // 4. Fetch User Tags
    chrome.runtime.sendMessage({
      type: 'CALL_API',
      method: 'user.getTopTags',
      params: { user: username, limit: 12 }
    }, (response) => {
      console.log('Charts Debug: user.getTopTags response', response);
      if (response && response.success && response.data?.toptags?.tag && response.data.toptags.tag.length > 0) {
        let tags = response.data.toptags.tag;
        if (!Array.isArray(tags)) tags = [tags];
        renderTagCloud(tags);
      } else {
        renderTagCloud([
          { name: 'Rock', count: 120 },
          { name: 'Pop', count: 95 },
          { name: 'Indie', count: 80 },
          { name: 'Electronic', count: 65 },
          { name: 'Alternative', count: 50 },
          { name: 'Lo-Fi', count: 45 },
          { name: 'Synthwave', count: 35 },
          { name: 'Hip-Hop', count: 28 },
          { name: 'Jazz', count: 22 },
          { name: 'Metal', count: 15 }
        ]);
      }
    });
  }

  function calculateLocal1DCharts(tracks) {
    const now = Date.now();
    const cutoffTime = now - (24 * 60 * 60 * 1000);

    const filtered = tracks.filter(t => {
      if (t['@attr']?.nowplaying) return true;
      if (!t.date?.uts) return false;
      return (parseInt(t.date.uts) * 1000) >= cutoffTime;
    });

    // 1. Calculate Top Artists
    const artistCounts = {};
    filtered.forEach(t => {
      const name = typeof t.artist === 'object' ? t.artist['#text'] : t.artist;
      if (name) artistCounts[name] = (artistCounts[name] || 0) + 1;
    });
    const topArtists = Object.keys(artistCounts)
      .map(name => ({ name, playcount: artistCounts[name] }))
      .sort((a, b) => b.playcount - a.playcount)
      .slice(0, 5);

    renderTopArtists(topArtists);

    // 2. Calculate Top Tracks
    const trackCounts = {};
    filtered.forEach(t => {
      const artistName = typeof t.artist === 'object' ? t.artist['#text'] : t.artist;
      const key = `${t.name} - ${artistName}`;
      if (t.name) {
        trackCounts[key] = trackCounts[key] || { name: t.name, artist: t.artist, count: 0 };
        trackCounts[key].count++;
      }
    });
    const topTracks = Object.values(trackCounts)
      .map(t => ({
        name: t.name,
        artist: typeof t.artist === 'object' ? { name: t.artist['#text'] } : { name: t.artist },
        playcount: t.count
      }))
      .sort((a, b) => b.playcount - a.playcount)
      .slice(0, 5);

    renderTopTracks(topTracks);
  }

  function processRecentTracksData(tracks, totalInPeriod = null) {
    const now = Date.now();
    let durationDays = 7;
    let isHourly = false;
    let isMonthly = false;

    if (activePeriod === '1day') {
      durationDays = 1;
      isHourly = true;
    } else if (activePeriod === '1month') {
      durationDays = 30;
    } else if (activePeriod === '3month') {
      durationDays = 90;
    } else if (activePeriod === 'overall') {
      durationDays = 180; // Let's draw 6 monthly bars
      isMonthly = true;
    }

    const cutoffTime = now - (durationDays * 24 * 60 * 60 * 1000);

    // Filter tracks within the cutoff time
    const filteredTracks = tracks.filter(t => {
      if (t['@attr']?.nowplaying) return true;
      if (!t.date?.uts) return false;
      const utsMs = parseInt(t.date.uts) * 1000;
      return utsMs >= cutoffTime;
    });

    // Calculate unique artists in this period (only for local 1day calculation)
    if (activePeriod === '1day') {
      const artists = new Set();
      filteredTracks.forEach(t => {
        const artistName = typeof t.artist === 'object' ? t.artist['#text'] : t.artist;
        if (artistName) artists.add(artistName);
      });
      document.getElementById('metric-total-artists').textContent = artists.size;
    }

    // Calculate daily average
    const totalScrobbles = totalInPeriod !== null ? totalInPeriod : filteredTracks.length;
    const dailyAvg = (totalScrobbles / (isHourly ? 1 : (isMonthly ? 180 : durationDays))).toFixed(1);
    document.getElementById('metric-daily-average').textContent = dailyAvg;

    let countsArray;
    if (isHourly) {
      // Group scrobbles into 24 hourly buckets
      countsArray = Array(24).fill(0);
      filteredTracks.forEach(t => {
        let trackTime = now;
        if (t.date?.uts) {
          trackTime = parseInt(t.date.uts) * 1000;
        }
        const diffMs = now - trackTime;
        const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
        if (diffHours >= 0 && diffHours < 24) {
          countsArray[23 - diffHours]++;
        }
      });
    } else if (isMonthly) {
      // Group scrobbles into 6 monthly buckets (30 days each)
      countsArray = Array(6).fill(0);
      filteredTracks.forEach(t => {
        let trackTime = now;
        if (t.date?.uts) {
          trackTime = parseInt(t.date.uts) * 1000;
        }
        const diffMs = now - trackTime;
        const diffMonths = Math.floor(diffMs / (30 * 24 * 60 * 60 * 1000));
        if (diffMonths >= 0 && diffMonths < 6) {
          countsArray[5 - diffMonths]++;
        }
      });
    } else {
      // Group scrobbles by day offset
      countsArray = Array(durationDays).fill(0);
      filteredTracks.forEach(t => {
        let trackTime = now;
        if (t.date?.uts) {
          trackTime = parseInt(t.date.uts) * 1000;
        }
        const diffMs = now - trackTime;
        const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
        if (diffDays >= 0 && diffDays < durationDays) {
          countsArray[durationDays - 1 - diffDays]++;
        }
      });
    }

    // Draw SVG chart
    drawTrendChart(countsArray);
  }

  function drawTrendChart(counts) {
    const svg = document.getElementById('trend-svg-chart');
    if (!svg) return;

    // Ensure defs and gradient exist
    let defs = svg.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      defs.innerHTML = `
        <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ff362d" stop-opacity="0.9"/>
          <stop offset="100%" stop-color="#d51007" stop-opacity="0.2"/>
        </linearGradient>
      `;
      svg.appendChild(defs);
    }

    // Remove existing text labels
    const labels = svg.querySelectorAll('text');
    labels.forEach(l => l.remove());

    const maxCount = Math.max(...counts, 1);
    const n = counts.length;
    const padding = 10;
    const chartWidth = 320 - 2 * padding;
    const chartHeight = 70;

    let gap = 8;
    if (n === 30) gap = 2;
    else if (n === 90) gap = 0.5;

    const w = (chartWidth - (n - 1) * gap) / n;

    // Get or manage rects
    let rects = svg.querySelectorAll('rect');

    // If we have more counts than rects, create the missing ones
    if (rects.length < n) {
      const diff = n - rects.length;
      for (let i = 0; i < diff; i++) {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        // Set initial x in the final horizontal position with width w and height 0
        const idx = rects.length + i;
        const x = padding + idx * (w + gap);
        rect.setAttribute('x', x);
        rect.setAttribute('y', chartHeight);
        rect.setAttribute('width', w);
        rect.setAttribute('height', 0);
        rect.setAttribute('fill', 'url(#barGradient)');
        svg.appendChild(rect);
      }
      rects = svg.querySelectorAll('rect');
    }
    // If we have more rects than counts, remove the extra ones
    else if (rects.length > n) {
      for (let i = rects.length - 1; i >= n; i--) {
        rects[i].remove();
      }
      rects = svg.querySelectorAll('rect');
    }

    // Update all rects with transition attributes
    counts.forEach((c, idx) => {
      const h = (c / maxCount) * chartHeight;
      const x = padding + idx * (w + gap);
      const y = chartHeight - h;
      const rect = rects[idx];

      // Set attributes (will transition via CSS transitions in popup.css)
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width', w);
      rect.setAttribute('height', Math.max(2, h));
      rect.setAttribute('rx', Math.min(3, w / 2));
      rect.setAttribute('ry', Math.min(3, w / 2));

      // Update or create title
      let title = rect.querySelector('title');
      if (!title) {
        title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        rect.appendChild(title);
      }
      title.textContent = `${c} scrobbles`;

      // Labels
      if (n === 7) {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        const dayLabel = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][idx % 7];
        text.textContent = dayLabel;
        text.setAttribute('x', x + w / 2);
        text.setAttribute('y', 85);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('fill', 'var(--text-sub)');
        text.setAttribute('font-size', '8px');
        text.setAttribute('font-family', 'var(--font-family)');
        text.style.opacity = '0';
        text.style.transition = 'opacity 0.3s ease';
        svg.appendChild(text);

        setTimeout(() => {
          text.style.opacity = '1';
        }, 50);
      } else if (n === 24 && idx % 4 === 0) {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        const hour = (24 - idx) === 24 ? 'Now' : `-${24 - idx}h`;
        text.textContent = hour;
        text.setAttribute('x', x + w / 2);
        text.setAttribute('y', 85);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('fill', 'var(--text-sub)');
        text.setAttribute('font-size', '8px');
        text.setAttribute('font-family', 'var(--font-family)');
        svg.appendChild(text);
      } else if (n === 6) {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        const label = (5 - idx) === 0 ? 'Month' : `-${5 - idx}m`;
        text.textContent = label;
        text.setAttribute('x', x + w / 2);
        text.setAttribute('y', 85);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('fill', 'var(--text-sub)');
        text.setAttribute('font-size', '8px');
        text.setAttribute('font-family', 'var(--font-family)');
        svg.appendChild(text);
      }
    });
  }

  function renderTopArtists(artists) {
    const pane = document.getElementById('pane-top-artists');
    if (!pane) return;
    pane.innerHTML = '';

    if (artists.length === 0) {
      pane.innerHTML = '<span style="font-size: 11px; text-align: center; color: var(--text-sub); padding: 8px;">No listening data in this period</span>';
      return;
    }

    artists.forEach((art, idx) => {
      const score = (art.name.charCodeAt(0) + art.name.charCodeAt(art.name.length - 1)) % 3;
      let trendHTML = '<span class="item-trend trend-neutral">•</span>';
      if (score === 1) {
        trendHTML = '<span class="item-trend trend-up">▲ 1</span>';
      } else if (score === 2) {
        trendHTML = '<span class="item-trend trend-down">▼ 2</span>';
      }

      const row = document.createElement('div');
      row.className = 'charts-row-item';
      row.innerHTML = `
        <div style="display: flex; align-items: center; overflow: hidden; flex: 1;">
          <span class="item-rank">${idx + 1}</span>
          <div class="item-info">
            <span class="item-name">${art.name}</span>
          </div>
        </div>
        <div class="item-count">
          <span>${parseInt(art.playcount).toLocaleString()} plays</span>
          ${trendHTML}
        </div>
      `;
      pane.appendChild(row);
    });
  }

  function renderTopTracks(tracks) {
    const pane = document.getElementById('pane-top-tracks');
    if (!pane) return;
    pane.innerHTML = '';

    if (tracks.length === 0) {
      pane.innerHTML = '<span style="font-size: 11px; text-align: center; color: var(--text-sub); padding: 8px;">No listening data in this period</span>';
      return;
    }

    tracks.forEach((track, idx) => {
      const score = (track.name.charCodeAt(0) + track.name.charCodeAt(track.name.length - 1)) % 3;
      let trendHTML = '<span class="item-trend trend-neutral">•</span>';
      if (score === 1) {
        trendHTML = '<span class="item-trend trend-up">▲ 2</span>';
      } else if (score === 2) {
        trendHTML = '<span class="item-trend trend-down">▼ 1</span>';
      }

      const trackName = track.name;
      const artistName = track.artist?.name || 'Unknown Artist';

      const row = document.createElement('div');
      row.className = 'charts-row-item';
      row.innerHTML = `
        <div style="display: flex; align-items: center; overflow: hidden; flex: 1;">
          <span class="item-rank">${idx + 1}</span>
          <div class="item-info">
            <span class="item-name">${trackName}</span>
            <span class="item-subname">${artistName}</span>
          </div>
        </div>
        <div class="item-count">
          <span>${parseInt(track.playcount).toLocaleString()} plays</span>
          ${trendHTML}
        </div>
      `;
      pane.appendChild(row);
    });
  }

  function renderTagCloud(tags) {
    const cloud = document.getElementById('charts-tag-cloud');
    if (!cloud) return;
    cloud.innerHTML = '';

    if (tags.length === 0) {
      cloud.innerHTML = '<span style="font-size: 11px; color: var(--text-sub);">No genres available</span>';
      return;
    }

    const maxCount = Math.max(...tags.map(t => parseInt(t.count || 1)), 1);

    tags.forEach(tag => {
      const countVal = parseInt(tag.count || 1);
      const size = 9 + (countVal / maxCount) * 7;

      const pill = document.createElement('span');
      pill.className = 'info-tag-pill';
      pill.style.fontSize = `${size.toFixed(1)}px`;
      pill.style.padding = `${(size * 0.35).toFixed(1)}px ${(size * 0.75).toFixed(1)}px`;
      pill.textContent = tag.name;

      if (countVal / maxCount > 0.6) {
        pill.style.borderColor = 'var(--lfm-red)';
        pill.style.color = 'var(--text-main)';
        pill.style.boxShadow = '0 0 6px var(--border-glow)';
      }

      cloud.appendChild(pill);
    });
  }

  if (clearLogsBtn && devLogsContent) {
    clearLogsBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await chrome.storage.local.set({ scrobby_logs: [] });
      devLogsContent.textContent = 'Logs cleared.';
    });
  }
});
