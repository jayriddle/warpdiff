#!/usr/bin/env bash
# Regenerate the gitignored media fixtures (mp4 / wav / mp3) used by tests/warpdiff.spec.ts.
# Each video uses 1-second solid-color segments at known timestamps so tests can sample
# specific pixel values without decoding intermediate frames. Mtimes are pinned to fix
# the GT/A/B slot ordering (oldest → original/GT).

set -euo pipefail

OUT="$(cd "$(dirname "$0")" && pwd)"

ENC_AV="-c:v libx264 -pix_fmt yuv420p -preset veryfast -crf 23 -c:a aac -b:a 96k -movflags +faststart"

make_video() {
    local out="$1" w="$2" h="$3" fps="$4"; shift 4
    local colors=("$@")
    local tmpdir; tmpdir=$(mktemp -d)
    : > "$tmpdir/list.txt"
    local i=0
    for c in "${colors[@]}"; do
        ffmpeg -hide_banner -loglevel error -y \
            -f lavfi -i "color=c=${c}:s=${w}x${h}:r=${fps}:d=1" \
            -f lavfi -i "sine=frequency=$((220 + 110*i)):sample_rate=44100:duration=1" \
            -ac 2 $ENC_AV "$tmpdir/seg_${i}.mp4"
        echo "file '$tmpdir/seg_${i}.mp4'" >> "$tmpdir/list.txt"
        i=$((i+1))
    done
    ffmpeg -hide_banner -loglevel error -y \
        -f concat -safe 0 -i "$tmpdir/list.txt" -c copy "$out"
    rm -rf "$tmpdir"
}

make_video "$OUT/landscape_a.mp4" 960 540 24 red    green   blue
make_video "$OUT/landscape_b.mp4" 960 540 24 yellow magenta cyan  white
make_video "$OUT/portrait.mp4"    540 960 24 orange purple  teal  gray pink

# Video with an intentional 166 ms leading empty audio edit. The decoded audio
# buffer begins at its first sample; WarpDiff must retain the edit-list placement
# separately so scrub preview stays silent before the soundtrack begins.
ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "color=c=black:s=320x180:r=24:d=2" \
    -itsoffset 0.166 -f lavfi -i "sine=frequency=1000:sample_rate=48000:duration=1.5" \
    -map 0:v:0 -map 1:a:0 -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 96k \
    -movflags +faststart "$OUT/audio_offset.mp4"

# HDR-tagged clip (BT.2020 + PQ colr box) — the scrub decoder must REFUSE these
# (Chrome tone-maps HDR <video>; canvas drawImage doesn't) and fall back to
# native scrubbing. Content is SDR testsrc; only the tagging matters.
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "testsrc2=s=320x180:d=1:r=24" \
    -vf "setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc,format=yuv420p" \
    -c:v libx264 \
    -color_primaries bt2020 -color_trc smpte2084 -colorspace bt2020nc \
    -movflags +write_colr "$OUT/pq_hdr.mp4"

# VP9 + VORBIS WebM pair — decodable by the open-codec Chromium builds used in
# sandboxed/CI runs (the H.264 fixtures above need a proprietary-codec Chrome).
# Vorbis (NOT Opus) deliberately: Opus slots take the Chrome Web Audio
# replacement path where <video>.muted is always true — the scrub-drag muted-
# state tests need the PLAIN muted-flag routing that AAC/Vorbis slots use.
# Not every ffmpeg build ships libvorbis (Homebrew's does not by default); fall
# back to ffmpeg's built-in Vorbis encoder, which is marked experimental (needs
# -strict -2) and only accepts stereo — hence the explicit -ac 2, a no-op for
# libvorbis since `sine` is mono. Same codec in the container either way.
if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q ' libvorbis '; then
    VORBIS_ENC=(-c:a libvorbis -ac 2)
else
    VORBIS_ENC=(-c:a vorbis -strict -2 -ac 2)
fi
ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "testsrc2=size=320x180:rate=24:duration=3" \
    -f lavfi -i "sine=frequency=440:duration=3" \
    -c:v libvpx-vp9 -b:v 200k "${VORBIS_ENC[@]}" "$OUT/vorbis_a.webm"
ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "testsrc2=size=320x180:rate=24:duration=3" \
    -f lavfi -i "sine=frequency=660:duration=3" \
    -c:v libvpx-vp9 -b:v 200k "${VORBIS_ENC[@]}" "$OUT/vorbis_b.webm"
# 4-second VP9+Vorbis clip. Pairs with vorbis_a (3 s) for the sync-lock tests that
# need clips of DIFFERENT lengths (loop bounds = [0, shortest]; the longer clip
# must wrap early WITH the shorter one, not at its own end) — the open-codec
# analogue of the landscape_a/landscape_b 3 s/4 s pair.
ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "testsrc2=size=320x180:rate=24:duration=4" \
    -f lavfi -i "sine=frequency=550:duration=4" \
    -c:v libvpx-vp9 -b:v 200k "${VORBIS_ENC[@]}" "$OUT/vorbis_long.webm"
# 30 fps VP9+Vorbis clip (all the others are 24 fps). Pairs with vorbis_a for the
# MIXED-frame-rate frame-stepping test: stepping used to advance each clip by one
# of its OWN frames, so a 24/30 pair diverged 8.3 ms per step (~5 frames adrift
# after 24 taps) with nothing to correct it — the drift lock only runs during
# playback. Equal 3 s duration so the pair stays in Sync range mode.
ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "testsrc2=size=320x180:rate=30:duration=3" \
    -f lavfi -i "sine=frequency=700:duration=3" \
    -c:v libvpx-vp9 -b:v 200k "${VORBIS_ENC[@]}" "$OUT/vorbis_30.webm"

ffmpeg -hide_banner -loglevel error -y -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=3" -ac 2 -c:a pcm_s16le  "$OUT/stereo.wav"
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "sine=frequency=880:sample_rate=22050:duration=3" -ac 1 -c:a pcm_s16le  "$OUT/mono.wav"
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "sine=frequency=220:sample_rate=44100:duration=3" -ac 2 -c:a libmp3lame -b:a 128k "$OUT/track.mp3"

touch -t 202401010000 "$OUT/landscape_a.mp4" "$OUT/stereo.wav" "$OUT/vorbis_a.webm"
touch -t 202401020000 "$OUT/landscape_b.mp4" "$OUT/mono.wav" "$OUT/vorbis_b.webm" "$OUT/vorbis_long.webm"
touch -t 202401030000 "$OUT/portrait.mp4"    "$OUT/track.mp3"
touch -t 202401040000 "$OUT/pq_hdr.mp4"
touch -t 202401050000 "$OUT/audio_offset.mp4"
