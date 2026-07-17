/**
 * Runs in the ISOLATED world context of music.youtube.com, open.spotify.com, and www.youtube.com.
 * Handles the Last.fm redirect callback, registers media listeners (video/audio),
 * evaluates site settings, and intercepts Thumbs-Up / Like button interactions.
 */

// Intercept Last.fm OAuth callback on YouTube Music
if (window.location.pathname === '/lastfm-callback') {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');
  if (token) {
    // Show a beautiful glowing success screen directly in the tab
    document.documentElement.innerHTML = `
      <html>
        <head>
          <title>Last.fm Authorized</title>
          <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600&display=swap">
          <style>
            body {
              background: #08080c;
              color: #f5f5f7;
              font-family: 'Outfit', sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
            }
            .card {
              background: rgba(18, 18, 26, 0.65);
              border: 1px solid rgba(255, 255, 255, 0.07);
              padding: 40px;
              border-radius: 16px;
              text-align: center;
              box-shadow: 0 12px 30px rgba(0,0,0,0.5);
              backdrop-filter: blur(12px);
              max-width: 400px;
            }
            h1 {
              color: #d51007;
              margin-top: 0;
              font-size: 24px;
              font-weight: 600;
              letter-spacing: -0.01em;
              text-shadow: 0 0 15px rgba(213, 16, 7, 0.4);
            }
            p {
              font-size: 14px;
              color: #8e8e9f;
              line-height: 1.6;
              margin-bottom: 20px;
            }
            .spinner {
              width: 24px;
              height: 24px;
              border: 3px solid rgba(255, 255, 255, 0.1);
              border-top-color: #d51007;
              border-radius: 50%;
              animation: spin 1s infinite linear;
              margin: 0 auto;
            }
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Authorization Successful!</h1>
            <p>You have successfully authorized the extension. This tab will close automatically in a moment.</p>
            <div class="spinner"></div>
          </div>
        </body>
      </html>
    `;

    chrome.runtime.sendMessage({ type: 'AUTH_TOKEN', token })
      .then((res) => {
        if (res && res.success) {
          setTimeout(() => {
            window.close();
          }, 1500);
        } else {
          const p = document.querySelector('p');
          if (p) p.innerHTML = `<span style="color: #ff3b30">Error connecting to Last.fm: ${res ? res.error : 'Unknown error'}</span>`;
          console.error('Auth error:', res ? res.error : 'Unknown');
        }
      })
      .catch((err) => {
        const p = document.querySelector('p');
        if (p) p.innerHTML = `<span style="color: #ff3b30">Error: ${err.message}</span>`;
        console.error('Auth send error:', err);
      });
  }
}

let currentMetadata = null;
let mediaElementHooked = null;
let lastSentState = null;

// Convert low-res Google User Content / YouTube Music / YouTube thumbnails to high-res images
function getHighResArtwork(url) {
  if (!url) return url;

  // 1. YouTube Video Thumbnail upgrading: strip query strings and use hqdefault.jpg
  if (url.includes('ytimg.com/vi/')) {
    let cleanUrl = url.split('?')[0];
    return cleanUrl.replace(/(mqdefault|default|sddefault)\.jpg/, 'hqdefault.jpg');
  }

  // 2. Google User Content / YouTube Music artwork resizing: strip query string and replace size suffix
  if (url.includes('googleusercontent.com') || url.includes('ggpht.com') || url.includes('google.com')) {
    let cleanUrl = url.split('?')[0];
    let highRes = cleanUrl.replace(/=w\d+-h\d+[^/]*/, '=w500-h500');
    highRes = highRes.replace(/=s\d+[^/]*/, '=s500');
    highRes = highRes.replace(/=w\d+[^/]*/, '=w500-h500');
    return highRes;
  }

  return url;
}
let isSiteEnabled = true;

// Resolve hostname-specific toggle permissions
async function checkSitePermission() {
  const hostname = window.location.hostname;
  const results = await chrome.storage.local.get(['site_settings']);
  const settings = results.site_settings || {};
  isSiteEnabled = settings[hostname] !== false;
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.site_settings) {
    checkSitePermission();
  }
});

// Setup Initial Check
checkSitePermission();

// Setup a message handler for events from inject.js
window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data || event.data.source !== 'ytm-scrobbler-inject') {
    return;
  }

  if (event.data.type === 'METADATA_CHANGE') {
    currentMetadata = event.data.data;
    sendPlayerState();
  } else if (event.data.type === 'PLAYBACK_STATE_CHANGE') {
    sendPlayerState();
  }
});

// Fallback DOM scraping when MediaSession API is unpopulated or delayed
function scrapeDOMFallback() {
  const hostname = window.location.hostname;

  if (hostname === 'music.youtube.com') {
    const playerBar = document.querySelector('ytmusic-player-bar');
    if (!playerBar) return null;

    const titleEl = playerBar.querySelector('.title');
    const title = titleEl ? titleEl.innerText.trim() : '';

    const subtitleEl = playerBar.querySelector('.subtitle');
    let artist = '';
    let album = '';

    if (subtitleEl) {
      const links = subtitleEl.querySelectorAll('a');
      if (links.length > 0) {
        artist = links[0].innerText.trim();
        if (links.length > 1) {
          album = links[1].innerText.trim();
        }
      } else {
        const parts = subtitleEl.innerText.split('•');
        if (parts.length > 0) artist = parts[0].trim();
        if (parts.length > 1) album = parts[1].trim();
      }
    }

    const thumbnailImg = playerBar.querySelector('img.image');
    let artworkUrl = '';
    if (thumbnailImg) {
      artworkUrl = thumbnailImg.src || '';
    }

    if (!title && !artist) return null;

    return { title, artist, album, artwork: artworkUrl ? [{ src: artworkUrl }] : [] };
  } 
  
  else if (hostname === 'www.youtube.com') {
    // Scraping YouTube video uploader & title
    const titleEl = document.querySelector('#container h1.ytd-video-primary-info-renderer') || 
                    document.querySelector('.ytd-watch-metadata #title h1');
    let title = titleEl ? titleEl.innerText.trim() : '';
    if (!title && document.title) {
      title = document.title.replace(/\s*-\s*YouTube$/, '').trim();
    }

    const ownerEl = document.querySelector('#upload-info #channel-name a') || 
                    document.querySelector('.ytd-video-owner-renderer #channel-name a');
    const artist = ownerEl ? ownerEl.innerText.trim() : '';

    if (!title && !artist) return null;

    return { title, artist, album: '', artwork: [] };
  }
  
  else if (hostname === 'open.spotify.com') {
    // Spotify fallback: read bottom player bar
    const titleEl = document.querySelector('[data-testid="now-playing-widget"] [data-testid="context-item-link"]') ||
                    document.querySelector('[data-testid="now-playing-widget"] [data-testid="context-item-info-title"]');
    const artistEl = document.querySelector('[data-testid="now-playing-widget"] [data-testid="context-item-info-subtitles"]') ||
                     document.querySelector('[data-testid="now-playing-widget"] [data-testid="track-info-artists"]');
    const imgEl = document.querySelector('[data-testid="now-playing-widget"] img');

    const title = titleEl ? titleEl.innerText.trim() : '';
    const artist = artistEl ? artistEl.innerText.trim() : '';
    const artworkUrl = imgEl ? imgEl.src : '';

    if (!title && !artist) return null;

    return { title, artist, album: '', artwork: artworkUrl ? [{ src: artworkUrl }] : [] };
  }

  return null;
}

// Assemble the best metadata available
function getBestMetadata() {
  if (currentMetadata && currentMetadata.title && currentMetadata.artist) {
    return currentMetadata;
  }
  const scraped = scrapeDOMFallback();
  if (scraped && scraped.title) {
    return scraped;
  }
  return currentMetadata || scraped;
}

// Resolve either video or audio elements
function getActiveMediaElement() {
  return document.querySelector('video') || document.querySelector('audio');
}

// Extract Shuffle and Repeat states from the active site player bar
function getShuffleRepeatState() {
  const hostname = window.location.hostname;
  let shuffle = false;
  let repeat = 'none'; // 'none' | 'all' (playlist) | 'one' (track)
  
  try {
    if (hostname === 'music.youtube.com') {
      const shuffleBtn = document.querySelector('ytmusic-player-bar .shuffle, ytmusic-player-bar [title*="Shuffle"]');
      if (shuffleBtn) {
        shuffle = shuffleBtn.getAttribute('aria-pressed') === 'true' || 
                  shuffleBtn.hasAttribute('active') || 
                  shuffleBtn.classList.contains('active') ||
                  (shuffleBtn.getAttribute('aria-label') || '').toLowerCase().includes('disable');
      }
      
      const repeatBtn = document.querySelector('ytmusic-player-bar .repeat, ytmusic-player-bar [title*="Repeat"]');
      if (repeatBtn) {
        const title = (repeatBtn.getAttribute('title') || '').toLowerCase();
        const ariaLabel = (repeatBtn.getAttribute('aria-label') || '').toLowerCase();
        if (title.includes('one') || title.includes('track') || ariaLabel.includes('one')) {
          repeat = 'one';
        } else if (title.includes('all') || title.includes('list') || ariaLabel.includes('all')) {
          repeat = 'all';
        } else {
          repeat = 'none';
        }
      }
    } 
    else if (hostname === 'open.spotify.com') {
      const shuffleBtn = document.querySelector('[data-testid="control-button-shuffle"]');
      if (shuffleBtn) {
        shuffle = shuffleBtn.getAttribute('aria-checked') === 'true' || 
                  shuffleBtn.classList.contains('control-button--active') ||
                  (shuffleBtn.getAttribute('aria-label') || '').toLowerCase().includes('disable');
      }
      
      const repeatBtn = document.querySelector('[data-testid="control-button-repeat"]');
      if (repeatBtn) {
        const checked = repeatBtn.getAttribute('aria-checked'); // "true" (one) | "mixed" (all) | "false" (none)
        if (checked === 'true') {
          repeat = 'one';
        } else if (checked === 'mixed') {
          repeat = 'all';
        } else {
          repeat = 'none';
        }
      }
    }
  } catch (e) {
    console.warn('Scrobby: Error reading shuffle/repeat state:', e);
  }
  
  return { shuffle, repeat };
}

// Send playback state updates to the background service worker
function sendPlayerState() {
  if (!isSiteEnabled) return;

  const media = getActiveMediaElement();
  const metadata = getBestMetadata();

  if (!media || !metadata || !metadata.title) {
    return;
  }

  const shuffleRepeat = getShuffleRepeatState();

  const state = {
    title: metadata.title,
    artist: metadata.artist || 'Unknown Artist',
    album: metadata.album || '',
    artwork: metadata.artwork && metadata.artwork.length > 0 ? getHighResArtwork(metadata.artwork[0].src) : '',
    currentTime: media.currentTime,
    duration: media.duration || 0,
    paused: media.paused,
    playbackRate: media.playbackRate,
    sourceSite: window.location.hostname,
    shuffle: shuffleRepeat.shuffle,
    repeat: shuffleRepeat.repeat,
    trackUrl: window.location.href,
    timestamp: Date.now()
  };

  // Avoid spamming the background worker with duplicate metadata or minimal time-drift
  if (lastSentState &&
      lastSentState.title === state.title &&
      lastSentState.artist === state.artist &&
      lastSentState.paused === state.paused &&
      lastSentState.shuffle === state.shuffle &&
      lastSentState.repeat === state.repeat &&
      Math.abs(lastSentState.currentTime - state.currentTime) < 1.0 &&
      lastSentState.duration === state.duration) {
    return;
  }

  lastSentState = state;

  chrome.runtime.sendMessage({
    type: 'PLAYER_STATE',
    data: state
  }).catch(() => {
    // Ignore context invalidations during extension reloads
  });
}

// Monitor DOM for the active video/audio element and hook events
function monitorPlayer() {
  if (!isSiteEnabled) return;

  const media = getActiveMediaElement();
  if (media && media !== mediaElementHooked) {
    mediaElementHooked = media;

    const events = ['play', 'pause', 'timeupdate', 'durationchange', 'ended', 'seeking', 'seeked'];
    events.forEach(event => {
      media.addEventListener(event, sendPlayerState);
    });
  }
}

// Intercept clicks on thumbs up / like buttons across supported sites
document.addEventListener('click', (event) => {
  if (!isSiteEnabled) return;

  const hostname = window.location.hostname;

  // 1. YouTube Music
  if (hostname === 'music.youtube.com') {
    const renderer = event.target.closest('ytmusic-like-button-renderer');
    if (renderer) {
      // Determine dislike first to prevent name substring overlap collision ("dislike" contains "like")
      const isDislikeBtn = event.target.closest('.dislike, [aria-label*="dislike"], [aria-label*="Dislike"]');
      const isLikeBtn = !isDislikeBtn && event.target.closest('.like, [aria-label*="like"], [aria-label*="Like"]');
      
      if (isLikeBtn) {
        const currentStatus = renderer.getAttribute('like-status');
        // If current status is LIKE, clicking un-likes it (love: false); otherwise it likes it (love: true)
        chrome.runtime.sendMessage({ type: 'LOVE_TRACK', love: currentStatus !== 'LIKE' });
      } else if (isDislikeBtn) {
        chrome.runtime.sendMessage({ type: 'LOVE_TRACK', love: false });
      }
      return;
    }
  } 
  
  // 2. YouTube
  else if (hostname === 'www.youtube.com') {
    const dislikeButton = event.target.closest('#button-shape-dislike button, button[aria-label*="dislike"], button[aria-label*="Dislike"]');
    const likeButton = !dislikeButton && event.target.closest('#button-shape-like button, button[aria-label*="like"], button[aria-label*="Like"]');

    if (likeButton) {
      const isPressed = likeButton.getAttribute('aria-pressed') === 'true';
      chrome.runtime.sendMessage({ type: 'LOVE_TRACK', love: !isPressed });
    } else if (dislikeButton) {
      chrome.runtime.sendMessage({ type: 'LOVE_TRACK', love: false });
    }
  } 
  
  // 3. Spotify
  else if (hostname === 'open.spotify.com') {
    const button = event.target.closest('button');
    if (!button) return;

    const ariaLabel = button.getAttribute('aria-label') || '';
    if (ariaLabel.includes('Save to Your Library') || ariaLabel.includes('Add to Liked Songs')) {
      chrome.runtime.sendMessage({ type: 'LOVE_TRACK', love: true });
    } else if (ariaLabel.includes('Remove from Your Library') || ariaLabel.includes('Remove from Liked Songs')) {
      chrome.runtime.sendMessage({ type: 'LOVE_TRACK', love: false });
    }
  }
});

// Listen for player control messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'MEDIA_CONTROL') {
    const command = message.command;
    const media = getActiveMediaElement();
    const hostname = window.location.hostname;
    
    try {
      if (command === 'play') {
        if (media) media.play().catch(() => {});
      } else if (command === 'pause') {
        if (media) media.pause();
      } else if (command === 'toggle') {
        if (media) {
          if (media.paused) media.play().catch(() => {});
          else media.pause();
        }
      } else if (command === 'next') {
        if (hostname === 'music.youtube.com') {
          const btn = document.querySelector('ytmusic-player-bar .next-button, ytmusic-player-bar [title="Next song"], ytmusic-player-bar .next-button button');
          if (btn) btn.click();
        } else if (hostname === 'open.spotify.com') {
          const btn = document.querySelector('[data-testid="control-button-skip-forward"]');
          if (btn) btn.click();
        } else if (hostname === 'www.youtube.com') {
          const btn = document.querySelector('.ytp-next-button');
          if (btn) btn.click();
        }
      } else if (command === 'previous') {
        if (hostname === 'music.youtube.com') {
          const btn = document.querySelector('ytmusic-player-bar .previous-button, ytmusic-player-bar [title="Previous song"], ytmusic-player-bar .previous-button button');
          if (btn) btn.click();
        } else if (hostname === 'open.spotify.com') {
          const btn = document.querySelector('[data-testid="control-button-skip-back"]');
          if (btn) btn.click();
        }
      } else if (command === 'shuffle') {
        if (hostname === 'music.youtube.com') {
          const btn = document.querySelector('ytmusic-player-bar .shuffle, ytmusic-player-bar [title="Shuffle"]');
          if (btn) btn.click();
        } else if (hostname === 'open.spotify.com') {
          const btn = document.querySelector('[data-testid="control-button-shuffle"]');
          if (btn) btn.click();
        }
      } else if (command === 'repeat') {
        if (hostname === 'music.youtube.com') {
          const btn = document.querySelector('ytmusic-player-bar .repeat, ytmusic-player-bar [title*="Repeat"]');
          if (btn) btn.click();
        } else if (hostname === 'open.spotify.com') {
          const btn = document.querySelector('[data-testid="control-button-repeat"]');
          if (btn) btn.click();
        }
      } else if (command === 'seek') {
        if (media && typeof message.value === 'number') {
          media.currentTime = message.value;
        }
      }
      sendResponse({ success: true });
    } catch (e) {
      console.error('Scrobby: Control execution failed:', e);
      sendResponse({ success: false, error: e.message });
    }
    return true;
  }
});

// Periodic monitoring checks
setInterval(monitorPlayer, 1000);
