# Pro Editz Live Studio

Desktop live-streaming app for the **Pro Editz NEW** YouTube channel (Windows and Mac).

## Features
- Sign in with Google, then Go live / End stream in one click (creates the YouTube broadcast, gets the stream key, goes live automatically)
- Stream a game or your screen, or a pre-recorded video that loops forever
- Background music playlist that loops forever, with shuffle and volume
- Game sound and microphone mixing, with a limiter so audio never clips
- Logo watermark, 480p / 720p / 1080p, 30 or 60 fps, bitrate, GPU encoders (NVIDIA, AMD, Intel, Apple)
- Title, description, tags, category, visibility, latency and thumbnail set for every stream
- Live chat reader and chat sender inside the app, stream timer and health stats

## 1. Install
1. Install Node.js 20 or newer from nodejs.org
2. In this folder run:
   ```
   npm install
   npm start
   ```
   FFmpeg is installed automatically (ffmpeg-static). No separate FFmpeg needed.

## 2. Connect Google (one time)
1. Go to console.cloud.google.com and create a project (name it "Pro Editz Live Studio").
2. APIs and Services > Library > search **YouTube Data API v3** > Enable.
3. APIs and Services > OAuth consent screen: choose External, fill app name and your email, then under **Test users** add `kadarsh7991.2@gmail.com`.
4. APIs and Services > Credentials > Create credentials > **OAuth client ID** > Application type **Desktop app**.
5. Copy the Client ID and Client secret into the app (Setup button), then click **Sign in with Google**.

Tip: while the consent screen is in "Testing", Google signs you out every 7 days. Click **Publish app** on the consent screen to stop that (you can ignore the verification warning for personal use).

## 3. Enable live streaming on your channel
Go to youtube.com/features and verify your phone. Live streaming can take up to 24 hours to turn on the first time.

## Game and computer sound
- **Windows:** enable "Stereo Mix" (Sound settings > Recording) or install VB-Cable, then pick it under Sound > Game / computer sound.
- **Mac:** install BlackHole and pick it.
- Set games to borderless windowed. Full-screen exclusive mode can capture black.

## Notes
- Chat reading checks every 10 seconds to save API quota (free quota is 10,000 units a day).
- Use royalty-free music, or YouTube can mute or block the stream.
- If a GPU encoder fails to start, switch Encoder back to CPU (x264).
- To build an installer: `npm run dist`
