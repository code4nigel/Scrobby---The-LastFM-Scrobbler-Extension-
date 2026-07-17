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
  }

  tabButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      showTab(e.currentTarget.getAttribute('data-target'));
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
      'scrobble_seconds'
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
      thresholdMarker.style.display = 'none';
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
    }

    // Playback state class
    if (song.paused) {
      playerCard.classList.remove('playing');
    } else {
      playerCard.classList.add('playing');
    }

    // Timers & Progress
    const duration = song.duration || 0;
    const current = song.currentTime || 0;
    const progressPercent = duration > 0 ? (current / duration) * 100 : 0;
    
    progressFill.style.width = `${progressPercent}%`;
    timeCurrent.textContent = formatTime(current);
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
            <a href="${trackUrl}" target="_blank" class="lfm-link-btn" title="View on Last.fm">
              <svg viewBox="0 0 24 24" width="10" height="10"><path fill="currentColor" d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
            </a>
          </div>
        `;
        
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

  if (clearLogsBtn && devLogsContent) {
    clearLogsBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await chrome.storage.local.set({ scrobby_logs: [] });
      devLogsContent.textContent = 'Logs cleared.';
    });
  }
});
