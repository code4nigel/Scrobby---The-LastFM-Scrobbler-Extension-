/**
 * Service Worker (background script) for the Advanced Multi-Site Last.fm Scrobbler.
 * Coordinates play timelines, enforces custom scrobble settings, signs API requests,
 * synchronizes loved tracks, and executes the metadata correction pipeline.
 */

import { md5 } from './md5.js';

// Default Last.fm API credentials to ensure a seamless zero-configuration experience
const DEFAULT_API_KEY = 'f8409386dcfd73d2ff6db6f89093b137';
const DEFAULT_SHARED_SECRET = '87a9cc5c3b9b4b3b2c286db50239cf3d';

// Currently active song state
let currentSong = {
  title: '',
  artist: '',
  album: '',
  duration: 0,
  currentTime: 0,
  paused: true,
  artwork: '',
  accumulatedTime: 0,
  lastUpdate: null,
  scrobbled: false,
  nowPlayingSent: false,
  startTimestamp: 0,
  sourceSite: ''
};

// Update extension icon badge depending on authentication status
async function updateBadge() {
  try {
    const creds = await chrome.storage.local.get(['api_key', 'session_key']);
    const apiKey = creds.api_key || DEFAULT_API_KEY;
    if (!apiKey || !creds.session_key) {
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#d51007' }); // Last.fm Red
      chrome.action.setTitle({ title: 'Setup Last.fm Credentials' });
    } else {
      chrome.action.setBadgeText({ text: '' });
      chrome.action.setTitle({ title: 'Scrobby Active' });
    }
  } catch (err) {
    console.error('Error updating badge:', err);
  }
}

// Generate Last.fm API Signature (api_sig)
function generateSignature(params, secret) {
  const sortedKeys = Object.keys(params).sort();
  let sigString = '';
  for (const key of sortedKeys) {
    if (key === 'api_sig' || key === 'format') continue;
    sigString += key + params[key];
  }
  sigString += secret;
  return md5(sigString);
}

// Global API Caller helper for Last.fm
async function callLastFm(method, params, requiresAuth = true) {
  const creds = await chrome.storage.local.get(['api_key', 'shared_secret', 'session_key']);
  const apiKey = creds.api_key || DEFAULT_API_KEY;
  const secret = creds.shared_secret || DEFAULT_SHARED_SECRET;
  const sessionKey = creds.session_key;

  if (!apiKey) {
    throw new Error('API Key missing. Please configure the extension popup.');
  }

  const finalParams = {
    method,
    api_key: apiKey,
    ...params
  };

  if (requiresAuth) {
    if (!sessionKey) throw new Error('Not authenticated.');
    finalParams.sk = sessionKey;
  }

  // Generate signature if we have a secret
  if (secret) {
    finalParams.api_sig = generateSignature(finalParams, secret);
  }

  finalParams.format = 'json';

  const url = 'https://ws.audioscrobbler.com/2.0/';
  const isPost = method === 'track.scrobble' || 
                 method === 'track.updateNowPlaying' || 
                 method === 'track.love' || 
                 method === 'track.unlove' ||
                 method === 'auth.getMobileSession';
  
  let response;
  if (isPost) {
    const bodyParams = new URLSearchParams();
    for (const [k, v] of Object.entries(finalParams)) {
      bodyParams.append(k, v);
    }
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: bodyParams
    });
  } else {
    const query = new URLSearchParams(finalParams).toString();
    response = await fetch(`${url}?${query}`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(data.message || `Last.fm API Error ${data.error}`);
  }
  return data;
}

// Broadcasts status state to open extension popups
function broadcastState() {
  chrome.runtime.sendMessage({
    type: 'STATE_UPDATE',
    data: currentSong
  }).catch(() => {
    // Suppress errors when no popup is open to receive the message
  });
}

// Clean video metadata descriptors and resolve uploader-artist splits
function cleanTrackInfo(title, artist, sourceSite) {
  let cleanTitle = title;
  let cleanArtist = artist;

  // 1. Remove common video/music descriptive text tags
  const noiseRegex = /\s*([\[\(])\s*(official|lyric|video|music|hd|mv|audio|live|remix|version|4k|raw|visualizer|clip|performance|studio|w\/\s*lyrics|full\s*album|edit|cover)[^\]\)]*([\]\)])/gi;
  cleanTitle = cleanTitle.replace(noiseRegex, '').trim();

  // 2. Check for YouTube / Topic splits if YTM/YouTube parsed it as one title
  const isYouTube = sourceSite === 'www.youtube.com' || cleanArtist === 'YouTube' || cleanArtist.toLowerCase().includes('topic');
  if (isYouTube && cleanTitle.includes(' - ')) {
    const parts = cleanTitle.split(' - ');
    cleanArtist = parts[0].trim();
    cleanTitle = parts.slice(1).join(' - ').trim();
  }

  // 3. Normalization cleanup
  cleanTitle = cleanTitle.replace(/\s+/g, ' ').replace(/^["']|["']$/g, '').trim();
  cleanArtist = cleanArtist.replace(/\s+/g, ' ').replace(/^["']|["']$/g, '').trim();

  return { title: cleanTitle, artist: cleanArtist };
}

// Word overlap check to validate Last.fm searches against original metadata
function isMatchValid(originalTitle, originalArtist, matchedTitle, matchedArtist) {
  const originalStr = `${originalTitle} ${originalArtist}`.toLowerCase();
  const matchedTitleWords = matchedTitle.toLowerCase().split(/\s+/);
  const overlap = matchedTitleWords.filter(word => word.length > 2 && originalStr.includes(word));
  return overlap.length > 0;
}

// Correction pipeline: verifies track on Last.fm, applies cleaning, searches, and caches results
async function getCorrectedMetadata(rawTitle, rawArtist, sourceSite) {
  const cacheKey = `corr_${rawArtist}_${rawTitle}`;
  
  try {
    const cached = await chrome.storage.local.get([cacheKey]);
    if (cached[cacheKey]) {
      return cached[cacheKey];
    }
  } catch (err) {
    console.error('Cache read error:', err);
  }

  // Verify raw as-is
  try {
    await callLastFm('track.getInfo', { track: rawTitle, artist: rawArtist }, false);
    const result = { title: rawTitle, artist: rawArtist };
    await chrome.storage.local.set({ [cacheKey]: result });
    return result;
  } catch (err) {
    // raw track not found, proceed to clean and search
    console.log(`Scrobby: "${rawTitle}" by ${rawArtist} not found as-is. Cleaning and searching...`);
  }

  const cleaned = cleanTrackInfo(rawTitle, rawArtist, sourceSite);

  // Search Last.fm
  try {
    const searchRes = await callLastFm('track.search', { track: cleaned.title, artist: cleaned.artist }, false);
    const matches = searchRes?.results?.trackmatches?.track;
    if (matches && matches.length > 0) {
      const topMatch = matches[0];
      if (isMatchValid(rawTitle, rawArtist, topMatch.name, topMatch.artist)) {
        const result = { title: topMatch.name, artist: topMatch.artist };
        console.log(`Scrobby: Snapped match to "${result.title}" by ${result.artist}`);
        await chrome.storage.local.set({ [cacheKey]: result });
        return result;
      }
    }
  } catch (err) {
    console.warn('Scrobby: Search lookup error:', err);
  }

  // Fallback to cleaned metadata if search fails or yields no valid match
  await chrome.storage.local.set({ [cacheKey]: cleaned });
  return cleaned;
}

// Update Now Playing status on Last.fm
async function updateNowPlaying(song) {
  try {
    const settings = await chrome.storage.local.get(['scrobbling_enabled', 'submit_now_playing']);
    if (settings.scrobbling_enabled === false) return;
    if (settings.submit_now_playing === false) return; // Custom config override

    console.log(`Scrobby: Setting Now Playing -> "${song.title}" by ${song.artist}`);
    await callLastFm('track.updateNowPlaying', {
      artist: song.artist,
      track: song.title,
      album: song.album || '',
      duration: Math.round(song.duration) || ''
    });
  } catch (err) {
    console.error('Scrobby: Failed to update Now Playing:', err);
  }
}

// Submit Scrobble to Last.fm
async function scrobbleTrack(song) {
  try {
    const settings = await chrome.storage.local.get(['scrobbling_enabled']);
    if (settings.scrobbling_enabled === false) return;

    console.log(`Scrobby: Submitting Scrobble -> "${song.title}" by ${song.artist}`);
    await callLastFm('track.scrobble', {
      'artist[0]': song.artist,
      'track[0]': song.title,
      'timestamp[0]': song.startTimestamp,
      'album[0]': song.album || ''
    });

    // Save to local recent list
    const results = await chrome.storage.local.get(['recent_scrobbles']);
    let recent = results.recent_scrobbles || [];
    recent = [{
      title: song.title,
      artist: song.artist,
      album: song.album || '',
      timestamp: song.startTimestamp,
      artwork: song.artwork
    }, ...recent].slice(0, 20);
    await chrome.storage.local.set({ recent_scrobbles: recent });
    
    console.log('Scrobby: Scrobble submitted successfully.');
  } catch (err) {
    console.error('Scrobby: Failed to scrobble track:', err);
  }
}

// Handles incoming player states from YTM/Spotify/YouTube content script
async function handlePlayerState(data) {
  // Execute correction pipeline on song change
  const isNewSong = currentSong.title !== data.title || currentSong.artist !== data.artist;

  if (isNewSong) {
    // 1. Accumulate residual played time of previous song
    if (!currentSong.paused && currentSong.lastUpdate) {
      const delta = (Date.now() - currentSong.lastUpdate) / 1000;
      if (delta > 0 && delta < 5) {
        currentSong.accumulatedTime += delta;
      }
    }

    // 2. Initialize new song details (placeholder until correction finishes)
    currentSong = {
      title: data.title,
      artist: data.artist,
      album: data.album || '',
      duration: data.duration || 0,
      currentTime: data.currentTime || 0,
      paused: data.paused,
      artwork: data.artwork || '',
      accumulatedTime: 0,
      lastUpdate: data.paused ? null : Date.now(),
      scrobbled: false,
      nowPlayingSent: false,
      startTimestamp: Math.floor(Date.now() / 1000),
      sourceSite: data.sourceSite || ''
    };

    // Broadcast the raw state first for instant UI response
    broadcastState();

    // 3. Resolve metadata corrections asynchronously
    const corrected = await getCorrectedMetadata(data.title, data.artist, data.sourceSite);
    
    // Ensure the track hasn't changed since lookup began
    if (currentSong.startTimestamp === Math.floor(Date.now() / 1000) || currentSong.title === data.title) {
      currentSong.title = corrected.title;
      currentSong.artist = corrected.artist;
      
      if (!currentSong.paused) {
        updateNowPlaying(currentSong);
        currentSong.nowPlayingSent = true;
      }
      broadcastState();
    }
  } else {
    // Accumulate played duration if song was not paused
    if (!currentSong.paused) {
      if (currentSong.lastUpdate) {
        const delta = (Date.now() - currentSong.lastUpdate) / 1000;
        if (delta > 0 && delta < 5) {
          currentSong.accumulatedTime += delta;
        }
      }
    }

    // Sync state
    currentSong.currentTime = data.currentTime;
    currentSong.paused = data.paused;
    currentSong.duration = data.duration;
    currentSong.artwork = data.artwork || currentSong.artwork;
    currentSong.album = data.album || currentSong.album;
    currentSong.lastUpdate = data.paused ? null : Date.now();

    // Trigger now playing if un-paused and not sent yet
    if (!currentSong.paused && !currentSong.nowPlayingSent) {
      updateNowPlaying(currentSong);
      currentSong.nowPlayingSent = true;
    }
  }

  // Load advanced scrobble settings
  const rules = await chrome.storage.local.get([
    'min_duration', 
    'scrobble_mode', 
    'scrobble_percent', 
    'scrobble_seconds'
  ]);

  const minDuration = parseInt(rules.min_duration) || 30;
  const scrobbleMode = rules.scrobble_mode || 'percent';
  const scrobblePercent = parseInt(rules.scrobble_percent) || 50;
  const scrobbleSeconds = parseInt(rules.scrobble_seconds) || 240;

  // Enforce scrobble rules
  if (!currentSong.scrobbled && currentSong.duration >= minDuration) {
    let targetThreshold = 30;
    if (scrobbleMode === 'percent') {
      targetThreshold = currentSong.duration * (scrobblePercent / 100);
    } else {
      targetThreshold = scrobbleSeconds;
    }

    // Force absolute minimum threshold to be 30 seconds
    targetThreshold = Math.max(30, targetThreshold);

    if (currentSong.accumulatedTime >= targetThreshold) {
      currentSong.scrobbled = true;
      await scrobbleTrack(currentSong);
    }
  }

  broadcastState();
}

// Sync Loved state with Last.fm
async function syncLovedTrack(love) {
  if (!currentSong || !currentSong.title) return;
  try {
    const method = love ? 'track.love' : 'track.unlove';
    console.log(`Scrobby: Sending ${method} -> "${currentSong.title}" by ${currentSong.artist}`);
    await callLastFm(method, {
      track: currentSong.title,
      artist: currentSong.artist
    });
  } catch (err) {
    console.error('Scrobby: Love/Unlove sync error:', err);
  }
}

// Listen for message events from popups or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PLAYER_STATE') {
    handlePlayerState(message.data);
    sendResponse({ success: true });
  } else if (message.type === 'GET_STATE') {
    sendResponse(currentSong);
  } else if (message.type === 'LOVE_TRACK') {
    syncLovedTrack(message.love);
    sendResponse({ success: true });
  } else if (message.type === 'AUTH_TOKEN') {
    const token = message.token;
    callLastFm('auth.getSession', { token }, false)
      .then(async (res) => {
        if (res.session && res.session.key && res.session.name) {
          await chrome.storage.local.set({
            session_key: res.session.key,
            username: res.session.name
          });
          await updateBadge();
          sendResponse({ success: true, username: res.session.name });
        } else {
          sendResponse({ success: false, error: 'Malformed API session response.' });
        }
      })
      .catch(err => {
        sendResponse({ success: false, error: err.message });
      });
    return true; 
  } else if (message.type === 'LOGIN_PASSWORD') {
    const { username, password } = message;
    callLastFm('auth.getMobileSession', { username, password }, false)
      .then(async (res) => {
        if (res.session && res.session.key && res.session.name) {
          await chrome.storage.local.set({
            session_key: res.session.key,
            username: res.session.name
          });
          await updateBadge();
          sendResponse({ success: true, username: res.session.name });
        } else {
          sendResponse({ success: false, error: 'Malformed credentials response.' });
        }
      })
      .catch(err => {
        sendResponse({ success: false, error: err.message });
      });
    return true;
  } else if (message.type === 'REFRESH_BADGE') {
    updateBadge().then(() => sendResponse({ success: true }));
    return true;
  }
});

// Run badge update on install or startup
chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);
