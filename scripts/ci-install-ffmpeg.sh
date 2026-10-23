#!/usr/bin/env bash
# Ubuntu CI fixture/preparation FFmpeg. A specific BtbN GPL static build,
# checksum-verified, instead of the distro package. The noble ffmpeg package
# pulls about 100 MB of hard dependencies and has stalled for ~16 minutes on a
# slow Ubuntu archive mirror. This script is the only pin; both Ubuntu jobs
# call it. It does not change the macOS Homebrew install.
set -euo pipefail

FFMPEG_URL='https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-23-13-04/ffmpeg-n8.1.3-24-g92611900bb-linux64-gpl-8.1.tar.xz'
FFMPEG_SHA256='d0eb612b8994407f78413e2929cb4b073bc699c8ab79e198b31624736fdc2f93'

root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
archive="$root/$(basename "$FFMPEG_URL")"

curl --fail --location --retry 5 --retry-delay 2 --retry-all-errors \
  --output "$archive" "$FFMPEG_URL"
printf '%s  %s\n' "$FFMPEG_SHA256" "$archive" | sha256sum -c -

tar -xJf "$archive" -C "$root"
ffmpeg_bin=$(find "$root" -type f -path '*/bin/ffmpeg' -print -quit)
ffprobe_bin=$(dirname "$ffmpeg_bin")/ffprobe
test -n "$ffmpeg_bin" && test -x "$ffmpeg_bin" && test -x "$ffprobe_bin"
sudo install -m 755 "$ffmpeg_bin" "$ffprobe_bin" /usr/local/bin/
hash -r
ffmpeg=/usr/local/bin/ffmpeg
ffprobe=/usr/local/bin/ffprobe
if [[ "$(command -v ffmpeg)" != "$ffmpeg" || "$(command -v ffprobe)" != "$ffprobe" ]]; then
  echo "installed ffmpeg/ffprobe are not first on PATH" >&2
  command -v ffmpeg || true
  command -v ffprobe || true
  exit 1
fi

echo "ffmpeg pin: $FFMPEG_URL"
echo "ffmpeg sha256: $FFMPEG_SHA256"
"$ffmpeg" -version
"$ffprobe" -version

require_name() {
  local kind=$1 name=$2
  if ! "$ffmpeg" -hide_banner "-${kind}" | awk -v name="$name" '$2 == name { ok = 1 } END { exit ok ? 0 : 1 }'; then
    echo "static ffmpeg is missing ${kind%s} ${name}" >&2
    exit 1
  fi
}

# Encoders and filters invoked by tests/fixtures/generate.sh and the
# preparation harness (tools/media-prepare and the SDR fixture checks).
for name in h264 hevc aac flac opus vorbis vp9 ac3 mp3 pcm_s16le; do
  require_name codecs "$name"
done
for name in libx264 libx265 aac flac ffv1 libopus ac3 libvpx-vp9 libvorbis libmp3lame pcm_s16le pcm_s24le; do
  require_name encoders "$name"
done
for name in scale colorspace apad atrim setparams format pan; do
  require_name filters "$name"
done

# Same scale/colorspace/apad chain the preparation harness builds, plus the
# lavfi sources and setparams/format chain the fixture generator uses.
"$ffmpeg" -hide_banner -loglevel error \
  -f lavfi -i 'color=c=black:s=16x16:r=24:d=0.04' \
  -f lavfi -i 'sine=frequency=440:sample_rate=48000:duration=0.04' \
  -f lavfi -i 'aevalsrc=0|0:s=48000:d=0.04' \
  -filter_complex '[0:v]scale=16:16:force_divisible_by=2:in_range=tv:out_range=tv,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709,colorspace=ispace=bt709:iprimaries=bt709:itrc=bt709:irange=tv:space=bt709:primaries=bt709:trc=bt709:range=tv:format=yuv420p:dither=fsb[v];[1:a]apad,atrim=end=0.04,pan=stereo|c0=c0|c1=c0[a]' \
  -map '[v]' -map '[a]' -c:v libx264 -preset ultrafast -c:a aac -f null -
"$ffmpeg" -hide_banner -loglevel error -f lavfi -i 'testsrc2=s=16x16:d=0.04:r=24' \
  -vf 'setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc,format=yuv420p' \
  -c:v libx264 -f null -
echo 'ffmpeg codec check ok'
