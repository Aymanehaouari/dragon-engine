# Free iPhone install — Windows + free Apple ID

You do **not** need a Mac or a paid Apple Developer membership for this personal
sideloading path.

## 1. Build DRAGON in Codemagic

Codemagic has a free tier for individual/hobby use. Connect this GitHub repository,
then select the workflow named:

`DRAGON iPhone Free Build`

The repository root contains `codemagic.yaml`, so Codemagic can discover it
automatically.

When the build is complete, download:

`DRAGON-Free.ipa`

This IPA is intentionally unsigned. AltServer signs it for your own iPhone using
your free Apple ID.

## 2. Install AltServer on Windows

Use AltStore Classic / AltServer for Windows.

AltStore's Windows setup requires the Apple versions of iTunes and iCloud. Follow
AltStore's current Windows installation guide.

After AltServer is running:

1. Connect the iPhone to the PC and trust the computer.
2. Install AltStore onto the iPhone with AltServer.
3. Enable Developer Mode on iOS if requested.
4. On Windows, hold **Shift** while clicking the AltServer tray icon.
5. Choose **Sideload .ipa…**.
6. Select `DRAGON-Free.ipa`.
7. Sign in with the Apple ID used for sideloading.

The app will then appear on the iPhone.

## Free-account limitation

Apps installed with a free Apple developer account expire after 7 days. AltStore
can refresh them while the iPhone can reach AltServer on the same Wi‑Fi network,
or you can refresh/reinstall manually.

Apple also limits free accounts to a small number of simultaneously sideloaded
apps.

## Background audio

DRAGON's native iOS shell configures an AVAudioSession for background playback and
lock-screen / Control Center commands for direct audio streams that DRAGON is
allowed to play.

The app does not extract YouTube audio or bypass YouTube playback restrictions.
