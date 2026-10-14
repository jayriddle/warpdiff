# Observations from the initial failed WebKit run

The failed page snapshot was read before the corrected test ran. These observations are transcribed from that inspection, rather than a retained copy of the whole snapshot:

- The generated video review was active, showing 128×72, 16:9 and a 1-second duration.
- The source audio accessibility label was `Source audio: Dolby Digital`.
- The displayed metrics were `-21.7 LUFS` and `TP -18.1 dBTP`.
- The waveform appeared with `Mono` and `Audio waveform` labels; a spectrogram was also present.
- The failed name assertion in [webkit-before.txt](webkit-before.txt) reported `.review` rather than `.review_aac.mp4`.

These observations show that the original AC-3 asset reached audio analysis while retaining its original source metadata, rather than satisfying the test's assumed AAC conversion. The corrected test explicitly invokes conversion when the original file is still loaded.

The next Playwright run reused its output directory and removed the original failed snapshot. An attempt to copy it afterward returned ENOENT. The complete initial failure log was saved separately and remains available; the original full snapshot is not retained.
