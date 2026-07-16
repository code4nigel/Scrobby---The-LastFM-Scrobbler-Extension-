/**
 * Runs in the MAIN world context on music.youtube.com.
 * Hooks into the Media Session API to capture high-fidelity metadata
 * and playback state changes. Sends events to the content-loader script.
 */

(function () {
  if (!navigator.mediaSession) {
    console.warn("Scrobby: Media Session API not supported in this browser context.");
    return;
  }

  let currentMetadata = null;

  try {
    // Intercept setter/getter of navigator.mediaSession.metadata
    Object.defineProperty(navigator.mediaSession, 'metadata', {
      configurable: true,
      enumerable: true,
      get() {
        return currentMetadata;
      },
      set(value) {
        currentMetadata = value;
        
        // Prepare simplified metadata payload for message passing
        let payload = null;
        if (value) {
          payload = {
            title: value.title || '',
            artist: value.artist || '',
            album: value.album || '',
            artwork: []
          };
          if (value.artwork && value.artwork.length > 0) {
            payload.artwork = Array.from(value.artwork).map(img => ({
              src: img.src,
              sizes: img.sizes || '',
              type: img.type || ''
            }));
          }
        }

        window.postMessage({
          source: 'ytm-scrobbler-inject',
          type: 'METADATA_CHANGE',
          data: payload
        }, '*');
      }
    });

    let currentPlaybackState = 'none';

    // Intercept setter/getter of navigator.mediaSession.playbackState
    Object.defineProperty(navigator.mediaSession, 'playbackState', {
      configurable: true,
      enumerable: true,
      get() {
        return currentPlaybackState;
      },
      set(value) {
        currentPlaybackState = value;
        window.postMessage({
          source: 'ytm-scrobbler-inject',
          type: 'PLAYBACK_STATE_CHANGE',
          data: value
        }, '*');
      }
    });

    // Check if metadata was already set before load
    const initialMetadata = Object.getOwnPropertyDescriptor(Navigator.prototype, 'mediaSession') 
      ? navigator.mediaSession.metadata 
      : null;
    if (initialMetadata) {
      navigator.mediaSession.metadata = initialMetadata;
    }
  } catch (error) {
    console.error("Scrobby: Hook injection error:", error);
  }
})();
