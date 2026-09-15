# DRAGON iPhone app

This folder contains a native iOS shell for DRAGON.

## What it does

- Loads the existing DRAGON interface in a WKWebView.
- Configures an iOS background audio session.
- Provides a native AVPlayer bridge for direct audio URLs that DRAGON is allowed to play.
- Supports lock-screen / Control Center play and pause for those native audio streams.
- Keeps the existing YouTube experience in the foreground.

The native audio bridge intentionally does not extract audio from YouTube or bypass
YouTube playback restrictions.

## Build requirements

You need macOS with Xcode installed. Windows cannot build or sign an iPhone app.

Install XcodeGen:

```bash
brew install xcodegen
```

Then:

```bash
cd ios
xcodegen generate
open DRAGON.xcodeproj
```

Choose your iPhone as the run destination, select your Apple ID under
Signing & Capabilities, and press Run.

The free Apple ID signing path is fine for personal testing, but Apple may require
periodic re-signing.
